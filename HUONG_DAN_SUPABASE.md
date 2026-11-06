# Hướng dẫn chạy StudyLoad với Supabase

Front end đã được nối sẵn với dự án Supabase **Study Load** (`https://wbodoxqobkonkafjhfoh.supabase.co`) — `config.js` đã chứa URL và *publishable key* (khóa công khai, an toàn để đặt trong trình duyệt). **Không bao giờ** dán `service_role`/secret key vào front end.

## 1. Chạy thử
1. Giải nén, mở thư mục bằng một máy chủ tĩnh (ví dụ `npx serve .` hoặc `python3 -m http.server 8080`), vào `http://localhost:8080`.
2. Đăng nhập admin hiện có (email `quanganhd2011@gmail.com`; tên tài khoản dự phòng `user_5c5a48b4`) hoặc đăng ký tài khoản mới.

## 2. Cấu hình trên Supabase (làm một lần)
- **Authentication → URL Configuration**: thêm địa chỉ web của bạn vào *Site URL* và *Redirect URLs* (ví dụ `http://localhost:8080` và tên miền thật) để thư xác nhận email quay về đúng nơi.
- **Authentication → Providers → Email**: nếu muốn đăng ký xong dùng được ngay thì tắt *Confirm email*; nếu bật, cần cấu hình SMTP riêng khi chạy thật (SMTP mặc định bị giới hạn số thư).
- **Authentication → Policies/Password**: bật **Leaked password protection** (cảnh báo bảo mật duy nhất còn lại của dự án).

## 3. Quy trình sử dụng
- Admin: tạo **Môn học** → tạo **Lớp** → thêm **Học sinh** vào lớp → phân công **Chủ nhiệm / giáo viên bộ môn** (nút "Giáo viên").
- Học sinh đăng ký → có thể gửi "Yêu cầu quyền giáo viên" trong Hồ sơ → admin duyệt trong *Người dùng → Yêu cầu giáo viên*.
- Giáo viên bộ môn (hoặc lớp phó học tập) giao bài ở *Quản lý lớp → Tổng quan → Giao nhiệm vụ*; hệ thống tự tạo tiến độ cho từng học sinh.
- Chủ nhiệm bổ nhiệm cán bộ, tạo tổ; lớp trưởng/lớp phó lao động giao việc, xếp lịch trực; học sinh nộp minh chứng, người có quyền duyệt.

## 4. Dữ liệu nằm ở đâu
- Bài do lớp giao, tiến độ, cán bộ, trực nhật, thông báo, báo cáo tuần, dự án: các bảng của Supabase (có RLS).
- Nhiệm vụ cá nhân, thời gian bận, phiên học, cài đặt nhắc: bảng `user_app_state` (chỉ chủ tài khoản đọc/ghi).
- Tệp minh chứng: bucket riêng tư, đường dẫn bắt buộc bắt đầu bằng `<user_id>/`, xem qua signed URL ngắn hạn.

## 5. Triển khai
Có thể đưa nguyên thư mục lên Netlify / Vercel / Cloudflare Pages / GitHub Pages (không cần bước build).
