export interface Point {
  x: number;
  y: number;
  description?: string;
}

export interface ScreenSize {
  width: number;
  height: number;
}

// Độ phân giải màn hình chuẩn dọc 720x1280
export const STANDARD_WIDTH = 720;
export const STANDARD_HEIGHT = 1280;

/**
 * Danh sách package name của ứng dụng Thanh Niên Việt Nam
 * (Bao gồm com.vnpt.tnvn chính thức và alias vn.thanhnienvietnam)
 */
export const APP_PACKAGES = ['com.vnpt.tnvn', 'vn.thanhnienvietnam'];

/**
 * Hàm chuẩn hóa và co giãn tọa độ theo kích thước thực tế của màn hình thiết bị
 * @param point Tọa độ gốc trên màn hình chuẩn 720x1280
 * @param actualWidth Chiều rộng màn hình thực tế (pixel)
 * @param actualHeight Chiều cao màn hình thực tế (pixel)
 * @param jitter Độ lệch ngẫu nhiên pixel (+-jitter) để mô phỏng ngón tay người dùng (mặc định 2px)
 */
export function scaleCoordinate(
  point: Point,
  actualWidth: number,
  actualHeight: number,
  jitter: number = 2
): Point {
  const scaleX = actualWidth / STANDARD_WIDTH;
  const scaleY = actualHeight / STANDARD_HEIGHT;

  const baseX = point.x * scaleX;
  const baseY = point.y * scaleY;

  // Thêm độ lệch ngẫu nhiên nhỏ (human jitter)
  const deltaX = (Math.random() * 2 - 1) * jitter;
  const deltaY = (Math.random() * 2 - 1) * jitter;

  return {
    x: Math.round(baseX + deltaX),
    y: Math.round(baseY + deltaY),
    description: point.description,
  };
}

/**
 * Danh mục toàn bộ tọa độ nút bấm và input chuẩn hóa theo 720x1280
 */
export const COORDINATES = {
  // Bước 1: Màn hình Đăng nhập
  LOGIN: {
    // Ô nhập Email/Số điện thoại/CCCD (bounds chuẩn [40, 706][680, 756])
    USERNAME_INPUT: { x: 360, y: 731, description: 'Ô nhập Email/Số điện thoại/CCCD' },
    // Ô nhập Mật khẩu (bounds chuẩn [40, 848][680, 898])
    PASSWORD_INPUT: { x: 360, y: 873, description: 'Ô nhập Mật khẩu' },
    // Nút cam ĐĂNG NHẬP (bounds chuẩn [66, 1016][654, 1112])
    LOGIN_BUTTON: { x: 360, y: 1064, description: 'Nút cam ĐĂNG NHẬP' },
    // Nút CHO PHÉP gửi thông báo (bounds chuẩn [98, 662][622, 774])
    PERMISSION_ALLOW: { x: 360, y: 718, description: 'Nút CHO PHÉP thông báo' },
  },

  // Bước 2: Điều hướng đến cuộc thi
  NAVIGATION: {
    // Bottom Navigation Bar: Icon thứ 2 hình cặp sách "Công tác đoàn"
    BOTTOM_CONG_TAC_DOAN: { x: 216, y: 1210, description: 'Bottom Bar: Công tác đoàn' },
    // Màn hình Công tác đoàn: Ô thứ 2 "Học và thi" (tập tài liệu bút đỏ)
    HOC_VA_THI: { x: 511, y: 345, description: 'Mục Học và thi' },
    // Màn hình tiếp theo: Mục đầu tiên "Cuộc thi trực tuyến"
    CUOC_THI_TRUC_TUYEN_CARD: { x: 360, y: 230, description: 'Mục Cuộc thi trực tuyến' },
    // Tab "Đang diễn ra"
    TAB_DANG_DIEN_RA: { x: 140, y: 165, description: 'Tab Đang diễn ra' },
    // Banner cuộc thi đầu tiên: "Tuan 1_Cuộc thi Huỳnh Thúc Kháng"
    EXAM_BANNER_FIRST: { x: 360, y: 460, description: 'Banner Cuộc thi Huỳnh Thúc Kháng' },
    // Nút màu xanh lớn: "BẮT ĐẦU BÀI THI" hoặc "LÀM LẠI BÀI THI" (bounds [33, 875][687, 940] -> tâm y: 908)
    BTN_LAM_BAI_THI: { x: 360, y: 908, description: 'Nút BẮT ĐẦU BÀI THI / LÀM LẠI BÀI THI' },
  },

  // Bước 3: Màn hình làm 20 câu trắc nghiệm
  EXAM: {
    // 4 lựa chọn đáp án A, B, C, D (tâm radio button tròn chuẩn)
    OPTIONS: {
      A: { x: 50, y: 475, description: 'Đáp án A' },
      B: { x: 50, y: 545, description: 'Đáp án B' },
      C: { x: 50, y: 615, description: 'Đáp án C' },
      D: { x: 50, y: 685, description: 'Đáp án D' },
    },
    // Nút icon Mũi tên sang phải '>' ở góc dưới cùng bên phải để chuyển sang câu tiếp theo
    // Bounds [550, 1164][693, 1247] -> Tâm chuẩn (622, 1205)
    BTN_NEXT_QUESTION: { x: 622, y: 1205, description: 'Nút mũi tên sang phải (>)' },
    // Nút xanh "NỘP BÀI" ở góc trên cùng bên phải màn hình
    BTN_NOP_BAI: { x: 576, y: 215, description: 'Nút NỘP BÀI (góc trên phải)' },
    // Popup xác nhận nộp bài: Nút xanh "NỘP BÀI" (bounds tâm chuẩn x: 453, y: 816)
    POPUP_CONFIRM_DONG_Y: { x: 453, y: 816, description: 'Nút Nộp bài trên popup xác nhận' },
    // Popup xác nhận: Nút xám "QUAY LẠI" (tâm chuẩn x: 266, y: 816)
    POPUP_QUAY_LAI: { x: 266, y: 816, description: 'Nút QUAY LẠI trên popup xác nhận' },
    // Popup thông báo nộp bài thành công: Nút xanh "XEM KẾT QUẢ" (tâm chuẩn x: 360, y: 940)
    POPUP_XEM_KET_QUA: { x: 360, y: 940, description: 'Nút XEM KẾT QUẢ' },
  },
};
