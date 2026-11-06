# Báo cáo đối chiếu: đặc tả ↔ giao diện ↔ backend Supabase

## Cách làm
Giữ nguyên backend sẵn có của dự án Study Load (31 bảng, ~60 RPC, 4 bucket) và sửa front end cho khớp. Chỉ thêm các thứ không phá hủy: 5 hàm hỗ trợ (`resolve_login`, `username_available`, `get_class_staff`, `admin_stats`, `admin_user_lookup`), 2 hàm sửa lớp/môn cho admin (`admin_update_class`, `admin_update_subject`), cột `projects.meta` (nhóm/lịch sử dự án) cùng quyền ghi cột đó.

## Màn hình đã bổ sung so với bản gốc
Đăng ký/đăng nhập (email hoặc tên tài khoản) · hồ sơ + yêu cầu quyền giáo viên · tổng quan admin · người dùng (sửa, đổi vai trò, khóa/mở khóa) · duyệt yêu cầu giáo viên · lớp (tạo/sửa, thêm học sinh, phân công GV) · môn học · nhật ký kiểm toán · quản lý lớp (thành viên, tổ + báo cáo tuần của tổ, cán bộ, nhiệm vụ cán bộ, trực nhật + minh chứng + duyệt, thông báo, báo cáo tuần, ủy quyền) · giao bài cho lớp · minh chứng bài tập. Mọi màn có trạng thái tải / rỗng / lỗi / không đủ quyền / mất mạng / đang lưu / đã lưu.

## Đã kiểm chứng
- Mô phỏng giao diện (jsdom, mock theo đúng schema thật) cho học sinh, giáo viên, admin: không lỗi; ghi tiến độ chỉ `UPDATE assignment_progress`, không tạo bản ghi lạ.
- Trên DB thật, dưới vai trò `authenticated` của admin (giao dịch rồi hoàn tác, không còn dữ liệu thử): tạo/sửa lớp và môn, giao bài, tạo dự án + ghi `meta`, ghi `user_app_state` đều chạy đúng quyền cột/RLS.
- Advisor bảo mật: chỉ còn cảnh báo dự kiến (`resolve_login`/`username_available` cho anon để đăng nhập bằng tên) và *Leaked password protection* chưa bật.
- **Chưa** thử bằng trình duyệt thật với nhiều tài khoản (học sinh/giáo viên/cán bộ) — hiện DB chỉ có 1 tài khoản admin. Nên tạo vài tài khoản thử và đi qua quy trình ở HUONG_DAN.

## Khác biệt do backend sẵn có (cần biết)
1. Học sinh/GV **không ghi được** `study_sessions` từ trình duyệt (không có quyền INSERT) → phiên học, nhiệm vụ cá nhân, thời gian bận, "còn cần học", lịch sử, thư viện lưu trong `user_app_state`; `actual_minutes`/trạng thái vẫn ghi vào `assignment_progress`.
2. Không có "giáo viên xác nhận hoàn thành" và trạng thái `overdue` ở máy chủ → quá hạn tính ở máy khách.
3. Chỉ có yêu cầu "xin quyền giáo viên"; chưa có yêu cầu phụ trách lớp/môn. Lớp không có trạng thái ngừng hoạt động.
4. Không có cách gỡ GV chủ nhiệm/bộ môn hay xóa lớp/môn từ giao diện (backend không có RPC; thao tác xóa cố ý không thêm).
5. Tạo dự án theo lớp chỉ admin/GV chủ nhiệm (RLS); thành viên dự án phải thuộc lớp. Học sinh tạo nhiệm vụ dự án sẽ bị máy chủ từ chối (giao diện báo lỗi và tải lại).
6. Thông báo trong ứng dụng vẫn là thông báo cục bộ (chưa nối bảng `user_notifications`).
7. Xóa minh chứng trực nhật không hỗ trợ; xóa minh chứng bài tập chỉ xóa bản ghi, tệp cũ vẫn nằm trong bucket (không có quyền xóa file).
