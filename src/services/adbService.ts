import { Adb } from '@devicefarmer/adbkit';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Point, ScreenSize, scaleCoordinate, STANDARD_WIDTH, STANDARD_HEIGHT, APP_PACKAGES } from '../config/coordinates.js';

/**
 * Tự động tìm đường dẫn adb.exe trên máy Windows
 */
export function detectAdbPath(): string | undefined {
  if (process.env.ADB_PATH && fs.existsSync(process.env.ADB_PATH)) {
    return process.env.ADB_PATH;
  }

  const candidatePaths = [
    'E:\\LDPlayer\\LDPlayer14\\adb.exe',
    'E:\\LDPlayer\\LDPlayer9\\adb.exe',
    'C:\\LDPlayer\\LDPlayer9\\adb.exe',
    'D:\\LDPlayer\\LDPlayer9\\adb.exe',
    'C:\\leidian\\LDPlayer9\\adb.exe',
    'D:\\leidian\\LDPlayer9\\adb.exe',
    'E:\\leidian\\LDPlayer9\\adb.exe',
    'C:\\Program Files\\LDPlayer\\LDPlayer9\\adb.exe',
    'C:\\Users\\Admin\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export class AdbService {
  private client: any;
  private screenSizeCache = new Map<string, ScreenSize>();
  private activePackageCache = new Map<string, string>();

  constructor(host: string = '127.0.0.1', port: number = 5037) {
    const bin = detectAdbPath();
    this.client = Adb.createClient({ host, port, bin });
  }

  /**
   * Lấy client adbkit gốc
   */
  public getClient() {
    return this.client;
  }

  /**
   * Lấy DeviceClient tương ứng với serial
   */
  public getDevice(serial: string) {
    return this.client.getDevice(serial);
  }

  /**
   * Chạy lệnh shell adb trên thiết bị và đọc toàn bộ output trả về dạng string
   */
  public async exec(serial: string, command: string): Promise<string> {
    const dev = this.getDevice(serial);
    const stream = await dev.shell(command);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8').trim();
  }

  /**
   * Lấy kích thước màn hình đang hiển thị thực tế (xử lý chính xác cả khi màn hình xoay portrait/landscape)
   */
  public async getScreenSize(serial: string): Promise<ScreenSize> {
    if (this.screenSizeCache.has(serial)) {
      return this.screenSizeCache.get(serial)!;
    }

    try {
      // 1. Kiểm tra kích thước khung nhìn hiện tại qua dumpsys window
      const winOutput = await this.exec(serial, 'dumpsys window');
      const curMatch = winOutput.match(/cur=(\d+)x(\d+)/);
      if (curMatch) {
        const w = parseInt(curMatch[1], 10);
        const h = parseInt(curMatch[2], 10);
        if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
          const size = { width: w, height: h };
          this.screenSizeCache.set(serial, size);
          return size;
        }
      }

      // 2. Fallback: wm size
      const wmOutput = await this.exec(serial, 'wm size');
      const match = wmOutput.match(/(\d+)x(\d+)/g);
      if (match && match.length > 0) {
        const lastMatch = match[match.length - 1];
        const [wStr, hStr] = lastMatch.split('x');
        let width = parseInt(wStr, 10);
        let height = parseInt(hStr, 10);

        // Nếu app là dạng dọc (portrait) mà wm size báo ngang (do config tablet LDPlayer), đảo lại
        if (width > height) {
          const temp = width;
          width = height;
          height = temp;
        }

        const size = { width, height };
        this.screenSizeCache.set(serial, size);
        return size;
      }
    } catch {
      // Bỏ qua lỗi
    }

    const fallback: ScreenSize = { width: STANDARD_WIDTH, height: STANDARD_HEIGHT };
    this.screenSizeCache.set(serial, fallback);
    return fallback;
  }

  /**
   * Tự động phát hiện package name đã cài đặt trên thiết bị (com.vnpt.tnvn hoặc vn.thanhnienvietnam)
   */
  public async getTargetPackage(serial: string): Promise<string> {
    if (this.activePackageCache.has(serial)) {
      return this.activePackageCache.get(serial)!;
    }

    try {
      const dev = this.getDevice(serial);
      for (const pkg of APP_PACKAGES) {
        const installed = await dev.isInstalled(pkg);
        if (installed) {
          this.activePackageCache.set(serial, pkg);
          return pkg;
        }
      }
    } catch {
      // fallback
    }

    const defaultPkg = APP_PACKAGES[0]; // com.vnpt.tnvn
    this.activePackageCache.set(serial, defaultPkg);
    return defaultPkg;
  }

  /**
   * Click (tap) vào một tọa độ chuẩn (sẽ tự động scale theo màn hình thực tế)
   */
  public async tap(
    serial: string,
    point: Point,
    addJitter: boolean = true
  ): Promise<{ x: number; y: number }> {
    const size = await this.getScreenSize(serial);
    const scaled = scaleCoordinate(point, size.width, size.height, addJitter ? 2 : 0);
    await this.exec(serial, `input tap ${scaled.x} ${scaled.y}`);
    return scaled;
  }

  /**
   * Vuốt (swipe) giữa 2 tọa độ trên màn hình
   */
  public async swipe(
    serial: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs: number = 300
  ): Promise<void> {
    const size = await this.getScreenSize(serial);
    const p1 = scaleCoordinate({ x: x1, y: y1 }, size.width, size.height, 0);
    const p2 = scaleCoordinate({ x: x2, y: y2 }, size.width, size.height, 0);
    await this.exec(serial, `input swipe ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${durationMs}`);
  }

  /**
   * Nhập văn bản chính xác qua lệnh `input text`
   * Tự động escape các ký tự đặc biệt theo quy chuẩn Android Shell
   */
  public async inputText(serial: string, text: string): Promise<void> {
    const escaped = text
      .split('')
      .map((char) => {
        if (char === ' ') return '%s';
        if (['&', ';', '(', ')', '<', '>', '|', '"', "'", '`', '$', '\\'].includes(char)) {
          return `\\${char}`;
        }
        return char;
      })
      .join('');

    await this.exec(serial, `input text "${escaped}"`);
  }

  /**
   * Gửi mã phím Android KeyEvent
   */
  public async keyEvent(serial: string, keyCode: number | string): Promise<void> {
    await this.exec(serial, `input keyevent ${keyCode}`);
  }

  /**
   * Xóa nhanh ký tự trong ô input (gửi phím Backspace / KEYCODE_DEL nhiều lần)
   */
  public async clearInput(serial: string, count: number = 30): Promise<void> {
    await this.keyEvent(serial, 123); // KEYCODE_MOVE_END
    const delCommands = Array(count).fill('input keyevent 67').join(' && ');
    await this.exec(serial, delCommands);
  }

  /**
   * Khởi động ứng dụng bằng monkey launcher
   */
  public async launchApp(serial: string, packageName?: string): Promise<void> {
    const pkg = packageName || (await this.getTargetPackage(serial));
    await this.exec(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  }

  /**
   * Dọn dẹp phiên làm việc của ứng dụng (xóa dữ liệu / cache / đăng xuất)
   */
  public async clearApp(serial: string, packageName?: string): Promise<void> {
    const pkg = packageName || (await this.getTargetPackage(serial));
    const dev = this.getDevice(serial);
    try {
      await dev.clear(pkg);
    } catch {
      await this.exec(serial, `pm clear ${pkg}`);
    }
  }

  /**
   * Buộc dừng ứng dụng
   */
  public async forceStopApp(serial: string, packageName?: string): Promise<void> {
    const pkg = packageName || (await this.getTargetPackage(serial));
    await this.exec(serial, `am force-stop ${pkg}`);
  }

  /**
   * Chụp màn hình và lưu thành file ảnh
   */
  public async takeScreenshot(serial: string, destinationFilePath: string): Promise<string> {
    const dir = path.dirname(destinationFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const dev = this.getDevice(serial);
    const stream = await dev.screencap();
    const writeStream = fs.createWriteStream(destinationFilePath);
    await pipeline(stream, writeStream);
    return destinationFilePath;
  }

  /**
   * Hàm chờ ngẫu nhiên giữa minMs và maxMs để giả lập thao tác người dùng tự nhiên
   */
  public async sleep(minMs: number = 500, maxMs: number = 1500): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

// Export singleton instance mặc định
export const adbService = new AdbService();
