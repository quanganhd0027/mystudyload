-- Admin xóa lớp (chặn nếu lớp còn bài tập đã giao)
create or replace function public.admin_delete_class(p_class_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_name text; v_mem int; v_asg int;
begin
  if not public.is_admin() then raise exception 'Chỉ quản trị viên được xóa lớp.' using errcode='42501'; end if;
  select name into v_name from public.classes where id = p_class_id;
  if v_name is null then raise exception 'Không tìm thấy lớp.'; end if;
  select count(*) into v_asg from public.assignments where class_id = p_class_id;
  if v_asg > 0 then raise exception 'Lớp % còn % bài tập đã giao, không thể xóa. Hãy xóa hoặc chuyển các bài tập đó trước.', v_name, v_asg using errcode='23503'; end if;
  select count(*) into v_mem from public.class_members where class_id = p_class_id;
  delete from public.classes where id = p_class_id;
  return jsonb_build_object('name', v_name, 'members', v_mem);
end $$;
revoke all on function public.admin_delete_class(uuid) from public, anon;
grant execute on function public.admin_delete_class(uuid) to authenticated;
