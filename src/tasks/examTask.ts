import path from 'node:path';
import chalk from 'chalk';
import { adbService, AdbService } from '../services/adbService.js';
import { COORDINATES } from '../config/coordinates.js';

export interface AccountConfig {
  username: string;
  password: string;
  deviceSerial?: string;
  fixedAnswer?: 'A' | 'B' | 'C' | 'D' | 'RANDOM';
  totalQuestions?: number;
}

export interface TaskResult {
  username: string;
  serial: string;
  success: boolean;
  screenshotPath?: string;
  error?: string;
  durationMs: number;
}

export class ExamTask {
  private adb: AdbService;

  constructor(adb: AdbService = adbService) {
    this.adb = adb;
  }

  private log(serial: string, username: string, message: string, color: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' = 'cyan') {
    const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const prefix = `[${timestamp}][${serial}][${username}]`;
    const coloredPrefix = chalk.bold(prefix);
    const coloredMsg = chalk[color](message);
    console.log(`${coloredPrefix} ${coloredMsg}`);
  }

  /**
   * Thực hiện quy trình làm bài thi tự động tuần tự 4 bước
   */
  public async execute(account: AccountConfig, serial: string): Promise<TaskResult> {
    const startTime = Date.now();
    const username = account.username;
    const totalQuestions = account.totalQuestions || 20;

    this.log(serial, username, '>>> Bắt đầu tiến trình thi tự động...', 'blue');

    try {
      // -------------------------------------------------------------
      // BƯỚC 1: Khởi động app & Đăng nhập
      // -------------------------------------------------------------
      const targetPkg = await this.adb.getTargetPackage(serial);
      this.log(serial, username, `[Bước 1/4] Mở app (${targetPkg}) qua lệnh monkey launcher...`);
      await this.adb.launchApp(serial, targetPkg);
      this.log(serial, username, '[Bước 1/4] Chờ 3 giây để app tải giao diện...');
      await new Promise((resolve) => setTimeout(resolve, 3000));

      this.log(serial, username, '[Bước 1/4] Click vào ô nhập Email/Số điện thoại/CCCD...');
      await this.adb.tap(serial, COORDINATES.LOGIN.USERNAME_INPUT);
      await this.adb.sleep(600, 1000);
      await this.adb.clearInput(serial, 40);
      await this.adb.sleep(300, 600);

      this.log(serial, username, `[Bước 1/4] Nhập tài khoản: ${username}`);
      await this.adb.inputText(serial, username);
      await this.adb.sleep(600, 1200);

      this.log(serial, username, '[Bước 1/4] Click vào ô nhập Mật khẩu...');
      await this.adb.tap(serial, COORDINATES.LOGIN.PASSWORD_INPUT);
      await this.adb.sleep(600, 1000);
      await this.adb.clearInput(serial, 40);
      await this.adb.sleep(300, 600);

      this.log(serial, username, '[Bước 1/4] Nhập mật khẩu...');
      await this.adb.inputText(serial, account.password);
      await this.adb.sleep(600, 1200);

      this.log(serial, username, '[Bước 1/4] Click nút cam "ĐĂNG NHẬP"...');
      await this.adb.tap(serial, COORDINATES.LOGIN.LOGIN_BUTTON);

      this.log(serial, username, '[Bước 1/4] Đang đăng nhập, chờ 4 giây để vào Bảng tin...', 'yellow');
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // -------------------------------------------------------------
      // BƯỚC 2: Điều hướng đến mục Thi trực tuyến
      // -------------------------------------------------------------
      this.log(serial, username, '[Bước 2/4] Click icon thứ 2 "Công tác đoàn" ở thanh điều hướng đáy...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.BOTTOM_CONG_TAC_DOAN);
      await this.adb.sleep(1500, 2200);

      this.log(serial, username, '[Bước 2/4] Click vào ô mục "Học và thi" (icon tập tài liệu có bút đỏ)...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.HOC_VA_THI);
      await this.adb.sleep(1500, 2200);

      this.log(serial, username, '[Bước 2/4] Click vào mục đầu tiên "Cuộc thi trực tuyến"...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.CUOC_THI_TRUC_TUYEN_CARD);
      await this.adb.sleep(1800, 2500);

      this.log(serial, username, '[Bước 2/4] Click vào banner cuộc thi đầu tiên: "Tuan 1_Cuộc thi Huỳnh Thúc Kháng"...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.EXAM_BANNER_FIRST);
      await this.adb.sleep(2000, 3000);

      this.log(serial, username, '[Bước 2/4] Click nút màu xanh "LÀM BÀI THI" / "LÀM LẠI BÀI THI"...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.BTN_LAM_BAI_THI);
      await this.adb.sleep(2000, 3000);

      // -------------------------------------------------------------
      // BƯỚC 3: Tự động trả lời 20 câu hỏi trắc nghiệm
      // -------------------------------------------------------------
      this.log(serial, username, `[Bước 3/4] Bắt đầu tự động trả lời ${totalQuestions} câu hỏi trắc nghiệm...`, 'blue');

      const optionsList: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

      for (let q = 1; q <= totalQuestions; q++) {
        // 1. Chờ ngẫu nhiên 1.5 - 2.5 giây để giả lập thời gian đọc đề
        this.log(serial, username, `[Bước 3/4] [Câu ${q}/${totalQuestions}] Đang đọc đề (delay 1.5s - 2.5s)...`);
        await this.adb.sleep(1500, 2500);

        // 2. Chọn 1 trong 4 đáp án (A, B, C, D)
        let chosenOption: 'A' | 'B' | 'C' | 'D';
        if (account.fixedAnswer && account.fixedAnswer !== 'RANDOM') {
          chosenOption = account.fixedAnswer;
        } else {
          const randomIndex = Math.floor(Math.random() * optionsList.length);
          chosenOption = optionsList[randomIndex];
        }

        this.log(serial, username, `[Bước 3/4] [Câu ${q}/${totalQuestions}] Chọn đáp án: [${chosenOption}]`);
        const targetCoord = COORDINATES.EXAM.OPTIONS[chosenOption];
        await this.adb.tap(serial, targetCoord);
        await this.adb.sleep(600, 1200);

        // 3. Nếu chưa phải câu cuối, nhấp vào nút icon Mũi tên sang phải '>' để chuyển câu
        if (q < totalQuestions) {
          this.log(serial, username, `[Bước 3/4] [Câu ${q}/${totalQuestions}] Nhấn '>' sang câu tiếp theo...`);
          await this.adb.tap(serial, COORDINATES.EXAM.BTN_NEXT_QUESTION);
          await this.adb.sleep(800, 1500);
        }
      }

      // -------------------------------------------------------------
      // BƯỚC 4: Nộp bài & Đăng xuất / Dọn dẹp
      // -------------------------------------------------------------
      this.log(serial, username, '[Bước 4/4] Đã hoàn tất 20 câu. Click vào nút xanh "NỘP BÀI" ở góc trên bên phải...');
      await this.adb.tap(serial, COORDINATES.EXAM.BTN_NOP_BAI);
      await this.adb.sleep(1200, 1800);

      this.log(serial, username, '[Bước 4/4] Xác nhận nộp bài: Click nút "Đồng ý" trên popup...');
      await this.adb.tap(serial, COORDINATES.EXAM.POPUP_CONFIRM_DONG_Y);

      this.log(serial, username, '[Bước 4/4] Chờ 3 giây để hệ thống tính điểm và hiển thị kết quả...', 'yellow');
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Chụp màn hình lưu vào thư mục logs/screenshots/{username}_result.png
      const sanitizedName = username.replace(/[^a-zA-Z0-9_-]/g, '_');
      const screenshotFilename = `${sanitizedName}_result.png`;
      const screenshotPath = path.resolve(process.cwd(), 'logs', 'screenshots', screenshotFilename);

      this.log(serial, username, `[Bước 4/4] Chụp ảnh màn hình kết quả: ${screenshotFilename}`);
      await this.adb.takeScreenshot(serial, screenshotPath);
      this.log(serial, username, `[Bước 4/4] Đã lưu ảnh kết quả tại: ${screenshotPath}`, 'green');

      // Dọn dẹp phiên làm việc qua `pm clear`
      this.log(serial, username, `[Bước 4/4] Dọn dẹp dữ liệu app (pm clear ${targetPkg})...`);
      await this.adb.clearApp(serial, targetPkg);
      await this.adb.sleep(1000, 1500);

      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(1);
      this.log(serial, username, `✔ HOÀN THÀNH TOÀN BỘ QUY TRÌNH THI! (Thời gian: ${durationSec}s)`, 'green');

      return {
        username,
        serial,
        success: true,
        screenshotPath,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      this.log(serial, username, `✖ GẶP LỖI: ${error.message}`, 'red');

      // Cố gắng chụp màn hình lúc bị lỗi để người dùng tiện debug
      try {
        const sanitizedName = username.replace(/[^a-zA-Z0-9_-]/g, '_');
        const errorScreenshot = path.resolve(
          process.cwd(),
          'logs',
          'screenshots',
          `${sanitizedName}_error_${Date.now()}.png`
        );
        await this.adb.takeScreenshot(serial, errorScreenshot);
        this.log(serial, username, `[Lỗi] Đã lưu ảnh chụp lỗi tại: ${errorScreenshot}`, 'yellow');
      } catch {
        // Bỏ qua nếu không chụp được
      }

      return {
        username,
        serial,
        success: false,
        error: error.message,
        durationMs,
      };
    }
  }
}

export const examTask = new ExamTask();
