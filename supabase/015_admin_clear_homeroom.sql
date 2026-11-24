-- Admin bỏ giáo viên chủ nhiệm của lớp
create or replace function public.admin_clear_homeroom_teacher(p_class_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Bạn không có quyền thực hiện thao tác này'; end if;
  update public.class_homeroom_teachers set ended_at = now() where class_id = p_class_id and ended_at is null;
end $$;
revoke all on function public.admin_clear_homeroom_teacher(uuid) from public, anon;
grant execute on function public.admin_clear_homeroom_teacher(uuid) to authenticated;
