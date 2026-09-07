# Công cụ Tự động hóa Thi trực tuyến "Thanh Niên Việt Nam" (Multi-instance Automation Tool)

Công cụ tự động hóa đa luồng (Multi-instance) viết bằng **TypeScript / Node.js**, điều khiển trực tiếp các máy ảo **LDPlayer** (hoặc giả lập Android) thông qua thư viện `@devicefarmer/adbkit` cho ứng dụng **"Thanh Niên Việt Nam"** (Package: `com.vnpt.tnvn` / `vn.thanhnienvietnam`).

---

## 📌 Tính năng nổi bật

1. **Chuẩn hóa tọa độ 720x1280 & Auto-scale thông minh**:
   - Tất cả tọa độ gốc được thiết kế chuẩn theo màn hình dọc 720x1280.
   - Hệ thống tự động đo độ phân giải thực tế của máy ảo (`wm size` & `dumpsys window`) và scale theo tỷ lệ chính xác (hỗ trợ 540x960, 720x1280, 900x1600, 1080x1920...).
   - Tích hợp **human jitter** (độ lệch ngẫu nhiên 1-3px) và **delay ngẫu nhiên** (500ms - 1500ms) để chống phát hiện bot.

2. **Quy trình 4 bước tự động hóa 100%**:
   - **Bước 1**: Mở app qua lệnh `monkey`, tự động nhập Email/Số điện thoại/CCCD và Mật khẩu, nhấn "ĐĂNG NHẬP".
   - **Bước 2**: Điều hướng Bottom Bar "Công tác đoàn" -> Thẻ "Học và thi" -> "Cuộc thi trực tuyến" -> Chọn cuộc thi cụ Huỳnh Thúc Kháng -> Nhấn "LÀM BÀI THI" / "LÀM LẠI BÀI THI".
   - **Bước 3**: Vòng lặp 20 câu trắc nghiệm: Chờ ngẫu nhiên 1.5s - 2.5s đọc đề, chọn đáp án ngẫu nhiên A/B/C/D (hoặc cố định theo config), click icon mũi tên `>` sang câu tiếp theo.
   - **Bước 4**: Nhấn "NỘP BÀI", click "Đồng ý" trên dialog xác nhận, chờ 3s chụp ảnh kết quả lưu vào `logs/screenshots/{username}_result.png`, chạy `pm clear` reset phiên làm việc.

3. **Chạy đa luồng song song (Multi-instance)**:
   - Tự động quét và phát hiện tất cả các máy ảo LDPlayer đang online.
   - Phân phối tài khoản từ hàng đợi `accounts.json` vào Worker Pool để các máy ảo chạy đồng thời.

---

## 📁 Cấu trúc thư mục

```
E:/tnvn-automation/
├── package.json                      # Cấu hình dự án & dependencies
├── tsconfig.json                     # Cấu hình TypeScript ES2022
├── accounts.json                     # Danh sách tài khoản cần thi
├── logs/
│   └── screenshots/                  # Thư mục lưu ảnh chụp màn hình kết quả thi
└── src/
    ├── config/
    │   └── coordinates.ts            # Bảng tọa độ chuẩn 720x1280 & hàm scale động
    ├── services/
    │   ├── adbService.ts             # Wrapper ADBKit (tap, swipe, input, keyevent, sleep, clear...)
    │   └── deviceManager.ts          # Quét tự động danh sách máy ảo LDPlayer online
    ├── tasks/
    │   └── examTask.ts               # Triển khai toàn bộ 4 bước làm bài thi
    └── index.ts                      # Điểm khởi chạy CLI đa luồng
```

---

## ⚙ Cấu hình máy ảo LDPlayer

1. Mở **LDPlayer** -> Vào **Cài đặt (Settings)** (biểu tượng bánh răng ở cạnh phải).
2. Tại mục **Nâng cao (Advanced)**:
   - Độ phân giải khuyến nghị: Chọn **Điện thoại (Mobile)** -> `720x1280` (hoặc bất kỳ độ phân giải dọc nào, công cụ sẽ tự scale).
3. Tại mục **Khác (Other)**:
   - **Gỡ lỗi ADB (ADB Debug)**: Chọn **Mở kết nối cục bộ (Open local connection)**.
4. Nhấn **Lưu** và khởi động lại LDPlayer.

---

## 📝 Cấu hình tài khoản (`accounts.json`)

Chỉnh sửa tệp `accounts.json` tại thư mục gốc:

```json
[
  {
    "username": "tranvantinh0923coze@gmail.com",
    "password": "MatKhauCuaBan123",
    "deviceSerial": "",
    "fixedAnswer": "RANDOM"
  },
  {
    "username": "0381234567",
    "password": "MatKhauCuaBan456",
    "deviceSerial": "",
    "fixedAnswer": "A"
  }
]
```

- `username`: Email, số điện thoại hoặc số CCCD đăng nhập.
- `password`: Mật khẩu tài khoản.
- `deviceSerial`: (Tùy chọn) Để trống `""` để hệ thống tự động gán máy ảo khả dụng, hoặc điền serial cụ thể (ví dụ: `emulator-5554`).
- `fixedAnswer`: Chế độ chọn đáp án: `"RANDOM"` (ngẫu nhiên A/B/C/D) hoặc cố định `"A"`, `"B"`, `"C"`, `"D"`.

---

## 🚀 Hướng dẫn chạy

### 1. Quét danh sách máy ảo đang kết nối:
```bash
pnpm start -- --scan
# hoặc
node dist/index.js --scan
```

### 2. Chạy tự động song song toàn bộ máy ảo:
```bash
pnpm start
# hoặc
node dist/index.js
```

### 3. Chạy chế độ test đơn lẻ (1 tài khoản đầu tiên):
```bash
pnpm start -- --single
```

### 4. Chỉ định chạy trên 1 máy ảo cụ thể:
```bash
pnpm start -- --device emulator-5554
```

### 5. Giới hạn số máy ảo chạy đồng thời:
```bash
pnpm start -- --concurrency 2
```

### 6. Ghi đè đáp án cho tất cả tài khoản:
```bash
# Luôn chọn đáp án A
pnpm start -- --fixed A

# Hoặc luôn chọn ngẫu nhiên
pnpm start -- --fixed RANDOM
```

---

## 📊 Kết quả & Ảnh chụp màn hình

- Mỗi khi hoàn thành lượt thi, công cụ tự động chụp màn hình kết quả và lưu vào:
  `logs/screenshots/{username}_result.png`
- Nếu xảy ra lỗi bất ngờ, ảnh màn hình thời điểm lỗi cũng được tự động lưu vào:
  `logs/screenshots/{username}_error_{timestamp}.png` để phục vụ chẩn đoán.
