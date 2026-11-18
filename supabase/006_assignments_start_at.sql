alter table public.assignments add column if not exists start_at timestamptz;
comment on column public.assignments.start_at is 'Ngày bắt đầu làm bài (tùy chọn). Trống thì lịch dùng created_at.';
