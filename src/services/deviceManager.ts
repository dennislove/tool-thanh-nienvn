import { adbService, AdbService } from './adbService.js';
import { ScreenSize } from '../config/coordinates.js';

export interface DeviceInfo {
  serial: string;
  type: string;
  model?: string;
  resolution?: ScreenSize;
}

export class DeviceManager {
  private adb: AdbService;

  constructor(adb: AdbService = adbService) {
    this.adb = adb;
  }

  /**
   * Tự động quét và liệt kê tất cả các thiết bị/máy ảo Android đang kết nối
   */
  public async getConnectedDevices(): Promise<DeviceInfo[]> {
    try {
      const client = this.adb.getClient();
      const rawDevices = await client.listDevices();

      const devices: DeviceInfo[] = [];

      for (const d of rawDevices) {
        // Chỉ lấy các thiết bị ở trạng thái sẵn sàng 'device'
        if (d.type === 'device') {
          let model = 'Unknown';
          let resolution: ScreenSize = { width: 720, height: 1280 };

          try {
            model = await this.adb.exec(d.id, 'getprop ro.product.model');
            resolution = await this.adb.getScreenSize(d.id);
          } catch {
            // bỏ qua lỗi đọc thuộc tính phụ
          }

          devices.push({
            serial: d.id,
            type: d.type,
            model,
            resolution,
          });
        }
      }

      return devices;
    } catch (error: any) {
      console.error('[DeviceManager] Lỗi khi quét danh sách thiết bị ADB:', error.message);
      return [];
    }
  }

  /**
   * Thử kết nối vào các port giả lập LDPlayer phổ biến (5555, 5557, 5559...) nếu danh sách trống
   */
  public async tryConnectLdplayerPorts(
    ports: number[] = [5555, 5557, 5559, 5561, 5563, 5565]
  ): Promise<void> {
    const client = this.adb.getClient();
    for (const port of ports) {
      try {
        await client.connect('127.0.0.1', port);
      } catch {
        // Không có máy ảo ở port này
      }
    }
  }

  /**
   * Kiểm tra một thiết bị cụ thể có online không
   */
  public async isDeviceOnline(serial: string): Promise<boolean> {
    const devices = await this.getConnectedDevices();
    return devices.some((d) => d.serial === serial);
  }
}

export const deviceManager = new DeviceManager();
