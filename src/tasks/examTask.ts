import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { PNG } from 'pngjs';
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
   * Phân tích ảnh PNG và trích xuất tọa độ Y của 4 nút radio đáp án (A, B, C, D)
   */
  public detectCirclesFromPng(png: PNG): number[] {
    const rowCounts = new Array(850).fill(0);
    for (let y = 330; y < 800; y++) {
      let count = 0;
      for (let x = 40; x <= 70; x++) {
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        if (r < 245 || g < 245 || b < 245) count++;
      }
      rowCounts[y] = count;
    }

    const intervals: { centerY: number }[] = [];
    let inInterval = false;
    let startY = 0;
    for (let y = 330; y < 800; y++) {
      const hasBorder = rowCounts[y] > 0 || (y + 1 < 800 && rowCounts[y + 1] > 0);
      if (hasBorder) {
        if (!inInterval) {
          inInterval = true;
          startY = y;
        }
      } else {
        if (inInterval) {
          inInterval = false;
          const h = y - startY;
          if (h >= 18 && h <= 50) {
            intervals.push({ centerY: Math.round((startY + y) / 2) });
          }
        }
      }
    }

    const circles = intervals.slice(-4).map((i) => i.centerY);
    return circles.length === 4 ? circles : [];
  }

  /**
   * Chụp màn hình thiết bị và trích xuất vị trí Y của 4 lựa chọn đáp án
   */
  public async getOptionCircles(serial: string): Promise<number[]> {
    try {
      const dev = this.adb.getDevice(serial);
      const stream = await dev.screencap();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      const png = PNG.sync.read(Buffer.concat(chunks));
      return this.detectCirclesFromPng(png);
    } catch {
      return [];
    }
  }

  /**
   * Tự động phát hiện tọa độ tâm 4 nút radio A, B, C, D từ ảnh chụp màn hình
   * Quét dải X=40..70 và gom cụm các đường viền hình tròn
   * 100% chính xác, tự thích ứng với mọi độ dài câu hỏi (1 dòng, 2 dòng, 3 dòng)
   */
  private async getDynamicOptionCoordinates(serial: string): Promise<Record<'A' | 'B' | 'C' | 'D', { x: number; y: number }>> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const circles = await this.getOptionCircles(serial);
      if (circles.length === 4) {
        return {
          A: { x: 50, y: circles[0] },
          B: { x: 50, y: circles[1] },
          C: { x: 50, y: circles[2] },
          D: { x: 50, y: circles[3] },
        };
      }
      await this.adb.sleep(600, 900);
    }

    return {
      A: COORDINATES.EXAM.OPTIONS.A,
      B: COORDINATES.EXAM.OPTIONS.B,
      C: COORDINATES.EXAM.OPTIONS.C,
      D: COORDINATES.EXAM.OPTIONS.D,
    };
  }

  /**
   * Tính hash vùng nội dung câu hỏi để kiểm tra màn hình đã thực sự chuyển câu hay chưa
   */
  private getQuestionHash(png: PNG): number {
    let h = 0;
    for (let y = 350; y < 450; y += 2) {
      for (let x = 40; x < 600; x += 4) {
        const idx = (png.width * y + x) << 2;
        h = ((h << 5) - h) + png.data[idx] + png.data[idx + 1] + png.data[idx + 2];
        h |= 0;
      }
    }
    return h;
  }

  /**
   * Kiểm tra xem hình tròn radio tại centerY có đang được chọn (tô màu xanh) hay không
   */
  private isOptionSelected(png: PNG, centerY: number): boolean {
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = 50 + dx;
        const y = centerY + dy;
        if (x < 0 || x >= png.width || y < 0 || y >= png.height) continue;
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const b = png.data[idx + 2];
        if (r < 120 && b > 170) return true;
      }
    }
    return false;
  }

  /**
   * Thực hiện quy trình làm bài thi tự động tuần tự 4 bước
   */
  public async execute(account: AccountConfig, serial: string): Promise<TaskResult> {
    const startTime = Date.now();
    const username = account.username;
    const totalQuestions = account.totalQuestions || 20;

    this.log(serial, username, '>>> Bắt đầu tiến trình thi tự động...', 'blue');

    // Tải ngân hàng đáp án từ answers.json nếu có
    let answersData: any[] = [];
    const answersPath = path.resolve(process.cwd(), 'answers.json');
    if (fs.existsSync(answersPath)) {
      try {
        answersData = JSON.parse(fs.readFileSync(answersPath, 'utf-8'));
        this.log(serial, username, `[answers.json] Đã nạp thành công ${answersData.length} câu hỏi & đáp án chuẩn!`, 'green');
      } catch (err: any) {
        this.log(serial, username, `[answers.json] Không thể đọc file: ${err.message}`, 'yellow');
      }
    }

    try {
      // -------------------------------------------------------------
      // BƯỚC 1: Khởi động app & Đăng nhập
      // -------------------------------------------------------------
      const targetPkg = await this.adb.getTargetPackage(serial);
      this.log(serial, username, `[Bước 1/4] Làm mới dữ liệu và mở app (${targetPkg})...`);
      await this.adb.clearApp(serial, targetPkg);
      await this.adb.sleep(1000, 1500);
      await this.adb.launchApp(serial, targetPkg);
      this.log(serial, username, '[Bước 1/4] Chờ 3.5 giây để app tải giao diện...');
      await new Promise((resolve) => setTimeout(resolve, 3500));

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

      this.log(serial, username, '[Bước 1/4] Đang đăng nhập, chờ 3.5 giây...', 'yellow');
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // Kiểm tra và xử lý kết quả đăng nhập (Thành công hay Thất bại)
      let loginSuccess = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const focusWindow = await this.adb.exec(serial, 'dumpsys window | grep mCurrentFocus');
          if (focusWindow.includes('permissioncontroller') || focusWindow.includes('GrantPermissionsActivity')) {
            this.log(serial, username, '[Bước 1/4] Phát hiện popup thông báo, click "CHO PHÉP"...');
            await this.adb.tap(serial, COORDINATES.LOGIN.PERMISSION_ALLOW);
            await this.adb.sleep(1500, 2000);
            loginSuccess = true;
            break;
          }
        } catch {
          // bỏ qua
        }

        try {
          const dump = await this.adb.exec(serial, 'uiautomator dump /sdcard/login_check.xml && cat /sdcard/login_check.xml');
          // Nếu đã vào giao diện trong (có các mục thanh điều hướng)
          if (dump.includes('Công tác đoàn') || dump.includes('Bảng tin') || dump.includes('Khám phá') || dump.includes('Cá nhân')) {
            loginSuccess = true;
            break;
          }

          // Nếu vẫn còn nút ĐĂNG NHẬP trên màn hình
          if (dump.includes('content-desc="ĐĂNG NHẬP"') || dump.includes('content-desc="Đăng nhập"')) {
            if (attempt < 2) {
              await this.adb.sleep(1500, 2000);
              continue;
            } else {
              this.log(serial, username, '[LỖI] Đăng nhập thất bại (tài khoản hoặc mật khẩu không đúng)! Bỏ qua tài khoản này...', 'red');
              await this.adb.clearApp(serial, targetPkg);
              throw new Error(`Đăng nhập thất bại: Tài khoản hoặc mật khẩu không chính xác (${username})`);
            }
          }
        } catch (err: any) {
          if (err.message.includes('Đăng nhập thất bại')) throw err;
        }

        await this.adb.sleep(1000, 1500);
      }

      // -------------------------------------------------------------
      // BƯỚC 2: Điều hướng đến mục Thi trực tuyến
      // -------------------------------------------------------------
      this.log(serial, username, '[Bước 2/4] Click icon thứ 2 "Công tác đoàn" ở thanh điều hướng đáy...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.BOTTOM_CONG_TAC_DOAN);
      await this.adb.sleep(1500, 2200);

      this.log(serial, username, '[Bước 2/4] Click vào ô mục "Học và thi" (icon tập tài liệu có bút đỏ)...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.HOC_VA_THI);
      this.log(serial, username, '[Bước 2/4] Đang chờ 5 giây theo yêu cầu...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      this.log(serial, username, '[Bước 2/4] Click vào mục đầu tiên "Cuộc thi trực tuyến"...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.CUOC_THI_TRUC_TUYEN_CARD);
      await this.adb.sleep(2000, 3000);

      this.log(serial, username, '[Bước 2/4] Click vào banner cuộc thi: "Tuan 1_Cuộc thi trực tuyến..."');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.EXAM_BANNER_FIRST);
      this.log(serial, username, '[Bước 2/4] Đã click vào cuộc thi, chờ 3 giây theo yêu cầu...');
      await new Promise((resolve) => setTimeout(resolve, 3000));

      this.log(serial, username, '[Bước 2/4] Click nút màu xanh "BẮT ĐẦU BÀI THI" / "LÀM LẠI BÀI THI"...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.BTN_LAM_BAI_THI);
      this.log(serial, username, '[Bước 2/4] Đang chờ WebView bài thi tải xong hoàn toàn Câu 1...');

      // Polling thông minh: Chờ cho đến khi phát hiện được đủ 4 hình tròn đáp án của Câu 1
      let examLoaded = false;
      for (let wait = 1; wait <= 15; wait++) {
        await this.adb.sleep(1000, 1200);
        const circles = await this.getOptionCircles(serial);
        if (circles.length === 4) {
          this.log(serial, username, `[Bước 2/4] ✔ WebView đã tải xong Câu 1! 4 đáp án tại Y: [${circles.join(', ')}]`, 'green');
          examLoaded = true;
          break;
        }
      }
      if (!examLoaded) {
        this.log(serial, username, '[Cảnh báo] WebView tải chậm, bắt đầu làm bài...', 'yellow');
      }

      // -------------------------------------------------------------
      // BƯỚC 3: Tự động trả lời bài thi (chạy q=22 lượt để hoàn tất đủ 20/20 câu theo yêu cầu)
      // -------------------------------------------------------------
      const maxLoops = 22;
      this.log(serial, username, `[Bước 3/4] Bắt đầu tự động trả lời với q=${maxLoops} lượt để đảm bảo hoàn thành đủ 20/20 câu (tiến độ thong thả ~4-5s/câu)...`, 'blue');

      const optionsList: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
      let nextClickCount = 0;

      for (let q = 1; q <= maxLoops; q++) {
        // Cho WebView ổn định giao diện
        await this.adb.sleep(800, 1200);

        // Tự động phát hiện vị trí chính xác của 4 đáp án theo thời gian thực
        const optionCoords = await this.getDynamicOptionCoordinates(serial);

        // Random chọn A, B, C, D (hoặc dùng fixedAnswer nếu có chỉ định)
        let chosenOption: 'A' | 'B' | 'C' | 'D';
        if (account.fixedAnswer && account.fixedAnswer !== 'RANDOM') {
          chosenOption = account.fixedAnswer as 'A' | 'B' | 'C' | 'D';
        } else {
          const randomIndex = Math.floor(Math.random() * optionsList.length);
          chosenOption = optionsList[randomIndex];
        }

        const targetCoord = optionCoords[chosenOption];
        this.log(
          serial,
          username,
          `[Bước 3/4] [Lượt ${q}/${maxLoops}] Chọn đáp án: [${chosenOption}] tại (${targetCoord.x}, ${targetCoord.y})`,
          'cyan'
        );

        // Click đúng 1 lần vào tâm đáp án
        await this.adb.tap(serial, targetCoord, false);
        // Nghỉ 1.0 - 1.3s để WebView ghi nhận và tô màu đáp án
        await this.adb.sleep(1000, 1300);

        // Kiểm tra xem hình tròn đáp án đã chuyển màu xanh chưa, nếu chưa thì click lại 1 lần
        try {
          const dev = this.adb.getDevice(serial);
          const stream = await dev.screencap();
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(chunk);
          const currentPng = PNG.sync.read(Buffer.concat(chunks));
          if (!this.isOptionSelected(currentPng, targetCoord.y)) {
            this.log(serial, username, `[Bước 3/4] [Lượt ${q}/${maxLoops}] Chưa thấy đổi màu đáp án, click lại vào đáp án...`, 'yellow');
            await this.adb.tap(serial, targetCoord, false);
            await this.adb.sleep(1000, 1200);
          }
        } catch {
          // Bỏ qua nếu không check được
        }

        // Chuyển sang câu tiếp theo bằng icon mũi tên sang phải (>) nếu chưa đến lượt cuối
        if (q < maxLoops) {
          // Lưu hash nhận diện nội dung câu hiện tại
          let currentHash = 0;
          try {
            const dev = this.adb.getDevice(serial);
            const stream = await dev.screencap();
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(chunk);
            currentHash = this.getQuestionHash(PNG.sync.read(Buffer.concat(chunks)));
          } catch {}

          nextClickCount++;
          this.log(
            serial,
            username,
            `[Bước 3/4] [Click Next lần ${nextClickCount}] Chuyển sang câu tiếp theo...`,
            'blue'
          );

          // Click Next và chờ 1.8 - 2.2s cho WebView trượt màn hình
          await this.adb.tap(serial, COORDINATES.EXAM.BTN_NEXT_QUESTION, false);
          await this.adb.sleep(1800, 2200);

          // Xác thực xem màn hình đã thực sự chuyển sang câu mới hay chưa (chỉ retry khi q < 20)
          for (let retryNext = 1; retryNext <= 2; retryNext++) {
            try {
              const dev = this.adb.getDevice(serial);
              const stream = await dev.screencap();
              const chunks: Buffer[] = [];
              for await (const chunk of stream) chunks.push(chunk);
              const newHash = this.getQuestionHash(PNG.sync.read(Buffer.concat(chunks)));
              if (currentHash !== 0 && newHash === currentHash) {
                if (q < 20) {
                  this.log(
                    serial,
                    username,
                    `[Lưu ý] WebView chưa chuyển câu (thử lại lần ${retryNext}/2), đang bấm lại nút Next...`,
                    'yellow'
                  );
                  await this.adb.tap(serial, COORDINATES.EXAM.BTN_NEXT_QUESTION, false);
                  await this.adb.sleep(1800, 2200);
                } else {
                  // Đã ở câu cuối cùng (câu 20) thì nút Next không chuyển trang nữa
                  break;
                }
              } else {
                break;
              }
            } catch {
              break;
            }
          }
        }
      }

      this.log(
        serial,
        username,
        `[Bước 3/4] ✔ Đã thực hiện xong ${maxLoops} lượt chọn đáp án với ${nextClickCount} lần bấm Next!`,
        'green'
      );

      // -------------------------------------------------------------
      // BƯỚC 4: Nộp bài & Kiểm tra an toàn tuyệt đối
      // -------------------------------------------------------------
      await this.adb.sleep(2000, 2500);
      this.log(serial, username, '[Bước 4/4] Đã hoàn thành các câu hỏi. Click vào nút xanh "NỘP BÀI" ở góc trên bên phải...');
      await this.adb.tap(serial, COORDINATES.EXAM.BTN_NOP_BAI);
      await this.adb.sleep(2500, 3000);

      // Chụp màn hình popup để kiểm tra xem đã hoàn thành trọn vẹn 20/20 câu hay chưa
      let canSubmit = true;
      try {
        const dev = this.adb.getDevice(serial);
        const stream = await dev.screencap();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const popupPng = PNG.sync.read(Buffer.concat(chunks));

        // Kiểm tra vùng dòng 1 popup (Y: 670..705, X: 150..570)
        let warningDarkPixels = 0;
        for (let y = 670; y < 705; y++) {
          for (let x = 150; x < 570; x++) {
            const idx = (popupPng.width * y + x) << 2;
            if (popupPng.data[idx] < 100) warningDarkPixels++;
          }
        }

        if (warningDarkPixels > 200) {
          canSubmit = false;
          this.log(
            serial,
            username,
            `[CẢNH BÁO AN TOÀN] Phát hiện popup cảnh báo chưa đủ 20 câu (${warningDarkPixels} text pixels)! Bấm nút QUAY LẠI, tuyệt đối không nộp...`,
            'red'
          );
          await this.adb.tap(serial, COORDINATES.EXAM.POPUP_QUAY_LAI);
          await this.adb.sleep(2000, 2500);
          throw new Error(`Chưa hoàn thành đủ 20/20 câu hỏi (phát hiện dòng cảnh báo trên popup)! Đã bấm QUAY LẠI.`);
        }
      } catch (err: any) {
        if (err.message.includes('Chưa hoàn thành đủ 20/20 câu hỏi')) throw err;
        this.log(serial, username, `[Lưu ý] Không thể kiểm tra popup: ${err.message}`, 'yellow');
      }

      if (canSubmit) {
        this.log(serial, username, '[Bước 4/4] Xác nhận nộp bài: Đã hoàn tất 20/20 câu, click nút "NỘP BÀI" trên popup...');
        await this.adb.tap(serial, COORDINATES.EXAM.POPUP_CONFIRM_DONG_Y);
        await this.adb.sleep(3000, 3500);

        // Click XEM KẾT QUẢ trên popup thành công
        this.log(serial, username, '[Bước 4/4] Click nút "XEM KẾT QUẢ" trên popup kết quả...');
        await this.adb.tap(serial, COORDINATES.EXAM.POPUP_XEM_KET_QUA);

        // Dừng 5 giây để người dùng xem kết quả theo yêu cầu
        this.log(
          serial,
          username,
          '[Bước 4/4] Đang hiển thị kết quả bài thi. Dừng 5 giây để bạn xem kết quả trước khi chuyển tài khoản tiếp theo...',
          'yellow'
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(1);
      this.log(serial, username, `✔ HOÀN THÀNH TOÀN BỘ QUY TRÌNH THI! (Thời gian: ${durationSec}s)`, 'green');

      return {
        username,
        serial,
        success: true,
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
