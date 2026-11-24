-- Khối của lớp (6–12): học sinh trong lớp tự thuộc khối của lớp. Admin đổi bằng admin_set_class_grade.
alter table public.classes add column if not exists grade int check (grade between 6 and 12);
update public.classes set grade = public.class_grade(name) where grade is null and public.class_grade(name) between 6 and 12;
create or replace function public.class_grade_of(p_class uuid) returns int language sql stable security definer set search_path='' as $$
  select coalesce(c.grade, case when public.class_grade(c.name) between 6 and 12 then public.class_grade(c.name) end) from public.classes c where c.id = p_class; $$;
create or replace function public.student_effective_grade(p_uid uuid) returns int language sql stable security definer set search_path='' as $$
  select coalesce((select min(public.class_grade_of(cm.class_id)) from public.class_members cm where cm.student_id = p_uid),
    (select grade from public.student_grades where user_id = p_uid)); $$;
create or replace function public.my_grade() returns int language sql stable security definer set search_path='' as $$
  select public.student_effective_grade(auth.uid()); $$;
create or replace function public.admin_set_class_grade(p_class_id uuid, p_grade int) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Chỉ quản trị viên được đổi khối của lớp.' using errcode='42501'; end if;
  if p_grade is not null and (p_grade < 6 or p_grade > 12) then raise exception 'Khối phải từ 6 đến 12.'; end if;
  update public.classes set grade = p_grade where id = p_class_id;
  if not found then raise exception 'Không tìm thấy lớp'; end if;
  insert into public.audit_logs(actor_id, class_id, action, target_table, target_id, details) values (auth.uid(), p_class_id, 'class_grade_set', 'classes', p_class_id::text, jsonb_build_object('grade', p_grade));
end $$;
revoke all on function public.class_grade_of(uuid), public.admin_set_class_grade(uuid, int) from public, anon;
grant execute on function public.class_grade_of(uuid), public.admin_set_class_grade(uuid, int) to authenticated;
-- get_ranking cũng được cập nhật (dùng class_grade_of) trong cùng migration trên máy chủ.
