-- 011: lấy mã học sinh của thành viên lớp (chỉ admin / GVCN / GV bộ môn / cán bộ lớp chính của lớp đó). Đã áp dụng trên Supabase.
create or replace function public.get_class_member_codes(p_class_id uuid)
returns table(user_id uuid, student_code text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.student_id
  from public.class_members cm
  join public.profiles p on p.id = cm.student_id
  where cm.class_id = p_class_id
    and p.student_id is not null
    and public.is_active_user()
    and (public.is_admin() or public.is_class_homeroom_teacher(p_class_id) or public.teaches_class(p_class_id) or public.has_main_officer_role(p_class_id));
$$;
revoke all on function public.get_class_member_codes(uuid) from public, anon;
grant execute on function public.get_class_member_codes(uuid) to authenticated;
