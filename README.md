# StudyLoad (front end + Supabase backend có sẵn)
Mở `HUONG_DAN_SUPABASE.md` để chạy thử và triển khai; `BAO_CAO_DOI_CHIEU.md` liệt kê đối chiếu đặc tả ↔ giao diện ↔ backend.

Cấu trúc: `index.html`, `styles.css`, `config.js` (URL + publishable key của dự án), `api.js` (toàn bộ giao tiếp Supabase),
`app.js` (lõi: nhiệm vụ, lịch, bộ đếm học, dự án), `pages-core.js` (hồ sơ, yêu cầu GV, giao bài, minh chứng),
`pages-admin.js` (quản trị), `pages-class.js` (quản lý lớp), `supabase/001_frontend_additions.sql` (các bổ sung đã áp dụng).
Không có khóa bí mật nào trong mã; mọi kiểm tra quyền do RLS + hàm RPC của Supabase quyết định.
