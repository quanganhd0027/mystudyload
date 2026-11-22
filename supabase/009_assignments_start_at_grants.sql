-- 009: cấp quyền ghi cho cột start_at (006 thêm cột nhưng chưa cấp quyền → giao bài có 'Ngày bắt đầu' bị 'permission denied')
grant insert (start_at), update (start_at) on public.assignments to authenticated;
