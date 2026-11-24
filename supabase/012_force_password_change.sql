-- Bắt đổi mật khẩu ở lần đăng nhập đầu (tài khoản tạo sẵn). Bảng riêng, chỉ truy cập qua RPC.
create table if not exists public.password_change_required (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.password_change_required enable row level security;
revoke all on public.password_change_required from anon, authenticated;

create or replace function public.my_must_change_password() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.password_change_required where user_id = auth.uid());
$$;
create or replace function public.clear_must_change_password() returns void
language sql security definer set search_path='' as $$
  delete from public.password_change_required where user_id = auth.uid();
$$;
revoke all on function public.my_must_change_password(), public.clear_must_change_password() from public, anon;
grant execute on function public.my_must_change_password(), public.clear_must_change_password() to authenticated;

-- 32 học sinh tạo sẵn (lớp 10a1)
insert into public.password_change_required(user_id)
select p.id from public.profiles p
where p.role='student' and p.student_id in ('31379','31587','31557','31484','31615','31480','31580','31540','31437','31490','31478','31364','31459','31395','31414','31412','31473','31565','31524','31568','31413','31407','31525','31387','31561','31462','31400','31528','31566','31358','31628','31517')
on conflict do nothing;
