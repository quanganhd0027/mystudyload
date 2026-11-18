-- Ảnh đại diện: cột avatar_at, bucket công khai 'avatars' (2MB, jpeg/png/webp), RPC set_avatar / get_avatars.
-- (Đã áp dụng trên dự án qua migration "avatars".)
alter table public.profiles add column if not exists avatar_at timestamptz;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars','avatars',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
-- Policies: người dùng ghi/xóa file '<uid>.jpg' của mình; admin ghi/xóa của mọi người.
-- Functions: set_avatar(p_user, p_has) (admin đổi ảnh người khác được ghi audit_logs), get_avatars(p_ids).
