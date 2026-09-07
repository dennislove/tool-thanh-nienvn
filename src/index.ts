import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { deviceManager, DeviceInfo } from './services/deviceManager.js';
import { examTask, AccountConfig, TaskResult } from './tasks/examTask.js';

const program = new Command();

program
  .name('tnvn-automation')
  .description('Công cụ tự động hóa thi trực tuyến Thanh Niên Việt Nam trên LDPlayer/Android')
  .version('1.0.0')
  .option('-a, --accounts <path>', 'Đường dẫn file danh sách tài khoản', 'accounts.json')
  .option('-s, --single', 'Chỉ chạy 1 tài khoản đầu tiên trên 1 thiết bị đầu tiên', false)
  .option('-d, --device <serial>', 'Chỉ định serial máy ảo cụ thể để chạy')
  .option('-c, --concurrency <number>', 'Giới hạn số luồng/máy ảo chạy đồng thời', (v) => parseInt(v, 10))
  .option('-f, --fixed <answer>', 'Ghi đè đáp án: A, B, C, D hoặc RANDOM')
  .option('--scan', 'Chỉ quét danh sách máy ảo/thiết bị ADB đang kết nối', false)
  .parse(process.argv);

const options = program.opts();

async function main() {
  console.log(chalk.bold.blue('==============================================================='));
  console.log(chalk.bold.cyan('  THANH NIÊN VIỆT NAM - MULTI-INSTANCE AUTOMATION TOOL'));
  console.log(chalk.bold.blue('===============================================================\n'));

  // 1. Quét thiết bị giả lập
  console.log(chalk.gray('[1/3] Đang quét các thiết bị / máy ảo LDPlayer qua ADB...'));
  let devices = await deviceManager.getConnectedDevices();

  if (devices.length === 0) {
    console.log(chalk.yellow('[ADB] Chưa thấy thiết bị nào, đang thử kết nối các cổng LDPlayer mặc định (5555, 5557...)...'));
    await deviceManager.tryConnectLdplayerPorts();
    devices = await deviceManager.getConnectedDevices();
  }

  if (devices.length === 0) {
    console.log(chalk.red('\n[LỖI] Không tìm thấy thiết bị Android hoặc máy ảo LDPlayer nào đang kết nối!'));
    console.log(chalk.yellow('Hướng dẫn khắc phục:'));
    console.log(chalk.white(' 1. Khởi động ít nhất 1 cửa sổ LDPlayer.'));
    console.log(chalk.white(' 2. Vào Cài đặt LDPlayer -> Khác (Other) -> Gỡ lỗi ADB -> Chọn "Mở kết nối cục bộ" (Open local connection).'));
    console.log(chalk.white(' 3. Đảm bảo adb server đang chạy: gõ `adb devices` trong PowerShell.\n'));
    process.exit(1);
  }

  console.log(chalk.green(`[✔] Đã phát hiện ${devices.length} thiết bị/máy ảo sẵn sàng:`));
  devices.forEach((d, idx) => {
    const res = d.resolution ? `${d.resolution.width}x${d.resolution.height}` : '720x1280 (chuẩn)';
    console.log(`    #${idx + 1}: ${chalk.bold.cyan(d.serial)} | Model: ${d.model} | Độ phân giải: ${chalk.yellow(res)}`);
  });

  if (options.scan) {
    console.log(chalk.gray('\nĐã hoàn tất quét thiết bị (--scan). Thoát chương trình.'));
    process.exit(0);
  }

  // 2. Đọc file accounts.json
  const accountsFilePath = path.resolve(process.cwd(), options.accounts);
  if (!fs.existsSync(accountsFilePath)) {
    console.log(chalk.red(`\n[LỖI] Không tìm thấy file tài khoản: ${accountsFilePath}`));
    process.exit(1);
  }

  let accounts: AccountConfig[] = [];
  try {
    const rawData = fs.readFileSync(accountsFilePath, 'utf-8');
    accounts = JSON.parse(rawData);
  } catch (err: any) {
    console.log(chalk.red(`\n[LỖI] File ${options.accounts} không đúng định dạng JSON: ${err.message}`));
    process.exit(1);
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log(chalk.red(`\n[LỖI] Danh sách tài khoản trong ${options.accounts} đang rỗng!`));
    process.exit(1);
  }

  // Áp dụng cờ fixedAnswer nếu người dùng truyền vào
  if (options.fixed) {
    const fixVal = options.fixed.toUpperCase();
    accounts.forEach((acc) => {
      acc.fixedAnswer = fixVal;
    });
  }

  // Nếu chỉ chạy đơn lẻ
  if (options.single) {
    accounts = [accounts[0]];
    console.log(chalk.yellow('\n[Chế độ] Đang chạy chế độ đơn lẻ (--single): Chỉ chạy 1 tài khoản đầu tiên.'));
  }

  // Lọc thiết bị nếu người dùng chỉ định --device
  if (options.device) {
    const targetDev = devices.find((d) => d.serial === options.device);
    if (!targetDev) {
      console.log(chalk.red(`\n[LỖI] Thiết bị ${options.device} không có trong danh sách đang online!`));
      process.exit(1);
    }
    devices = [targetDev];
  }

  console.log(chalk.gray(`\n[2/3] Tổng số tài khoản cần chạy: ${chalk.bold.green(accounts.length)}`));

  // 3. Thực thi song song hoặc hàng đợi đa luồng
  console.log(chalk.gray('[3/3] Đang khởi chạy tiến trình tự động hóa...\n'));

  const results: TaskResult[] = [];
  const queue = [...accounts];

  // Giới hạn luồng tối đa
  const maxConcurrency = options.concurrency && options.concurrency > 0
    ? Math.min(options.concurrency, devices.length)
    : devices.length;

  const activeDevices = devices.slice(0, maxConcurrency);

  console.log(chalk.blue(`==> Khởi tạo Worker Pool với ${chalk.bold(activeDevices.length)} máy ảo hoạt động song song.\n`));

  // Worker handler: mỗi worker quản lý 1 máy ảo, lần lượt lấy tài khoản từ hàng đợi
  const runWorker = async (device: DeviceInfo) => {
    while (queue.length > 0) {
      const account = queue.shift();
      if (!account) break;

      // Nếu tài khoản chỉ định serial riêng, kiểm tra xem có khớp không
      if (account.deviceSerial && account.deviceSerial !== device.serial) {
        // Trả lại queue cho worker phù hợp (nếu có)
        queue.push(account);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const result = await examTask.execute(account, device.serial);
      results.push(result);
    }
  };

  // Khởi động tất cả workers song song
  await Promise.all(activeDevices.map((d) => runWorker(d)));

  // Báo cáo tổng kết
  console.log(chalk.bold.blue('\n==============================================================='));
  console.log(chalk.bold.green('                     KẾT QUẢ TỔNG HỢP                          '));
  console.log(chalk.bold.blue('==============================================================='));

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  results.forEach((r, i) => {
    const status = r.success ? chalk.bold.green('THÀNH CÔNG') : chalk.bold.red('THẤT BẠI');
    const time = (r.durationMs / 1000).toFixed(1) + 's';
    console.log(
      `#${i + 1}: ${chalk.bold.cyan(r.username)} | Máy: ${r.serial} | Trạng thái: ${status} | TG: ${time}`
    );
    if (r.screenshotPath) {
      console.log(`    Ảnh kết quả: ${chalk.gray(r.screenshotPath)}`);
    }
    if (r.error) {
      console.log(`    Chi tiết lỗi: ${chalk.red(r.error)}`);
    }
  });

  console.log(chalk.bold.blue('---------------------------------------------------------------'));
  console.log(
    `Tổng kết: ${chalk.bold.green(successCount + ' thành công')}, ${chalk.bold.red(failCount + ' thất bại')} trên tổng số ${results.length} tài khoản.`
  );
  console.log(chalk.bold.blue('===============================================================\n'));
}

main().catch((err) => {
  console.error(chalk.red('Lỗi không mong muốn trong main():'), err);
  process.exit(1);
});
