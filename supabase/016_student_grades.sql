-- Khối (6–12) của học sinh, do học sinh tự chọn ở lần vào đầu; xếp hạng khối tính theo khối này (nếu chưa chọn thì lấy theo tên lớp).
create table if not exists public.student_grades (
  user_id uuid primary key references auth.users(id) on delete cascade,
  grade int not null check (grade between 6 and 12),
  updated_at timestamptz not null default now()
);
alter table public.student_grades enable row level security;
revoke all on public.student_grades from anon, authenticated;
create or replace function public.my_grade() returns int language sql stable security definer set search_path='' as $$
  select grade from public.student_grades where user_id = auth.uid(); $$;
create or replace function public.set_my_grade(p_grade int) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Bạn cần đăng nhập.' using errcode='42501'; end if;
  if p_grade is null or p_grade < 6 or p_grade > 12 then raise exception 'Khối phải từ 6 đến 12.'; end if;
  insert into public.student_grades(user_id, grade) values (auth.uid(), p_grade)
  on conflict (user_id) do update set grade = excluded.grade, updated_at = now();
end $$;
create or replace function public.student_effective_grade(p_uid uuid) returns int language sql stable security definer set search_path='' as $$
  select coalesce((select grade from public.student_grades where user_id = p_uid),
    (select min(public.class_grade(c.name)) from public.class_members cm join public.classes c on c.id = cm.class_id where cm.student_id = p_uid)); $$;
revoke all on function public.my_grade(), public.set_my_grade(int), public.student_effective_grade(uuid) from public, anon;
grant execute on function public.my_grade(), public.set_my_grade(int), public.student_effective_grade(uuid) to authenticated;
-- get_ranking (phạm vi khối theo student_effective_grade) được cập nhật trong cùng migration; xem hàm trên máy chủ.
