-- Các bổ sung KHÔNG phá hủy đã được áp dụng lên dự án "Study Load" (wbodoxqobkonkafjhfoh).
-- File này chỉ để lưu vết/tái tạo; chạy lại an toàn (create or replace / if not exists).

-- (1) Đăng nhập bằng tên tài khoản + kiểm tra trùng tên khi đăng ký (anon được gọi, chỉ trả email/boolean)
create or replace function public.resolve_login(p_username text) returns text language sql stable security definer set search_path = '' as $$
  select u.email::text from public.profiles p join auth.users u on u.id = p.id
  where p.username = lower(trim(p_username)) and p.is_banned = false limit 1 $$;
create or replace function public.username_available(p_username text) returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where username = lower(trim(p_username))) $$;
grant execute on function public.resolve_login(text), public.username_available(text) to anon, authenticated;

-- (2) get_class_staff, admin_stats, admin_user_lookup: xem migration "studyload_frontend_helpers" trong mục Database → Migrations.
-- (3) projects.meta + hai hàm sửa lớp/môn dành cho admin: xem migrations
--     "studyload_projects_meta" và "studyload_admin_edit_rpcs_and_project_meta".
alter table public.projects add column if not exists meta jsonb not null default '{}'::jsonb;
grant insert (meta), update (meta) on public.projects to authenticated;
