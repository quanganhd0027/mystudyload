-- Xếp hạng: học sinh thấy lớp/khối của mình; giáo viên thấy lớp/khối mình dạy hoặc chủ nhiệm; admin thấy tất cả
create or replace function public.get_ranking(p_scope text, p_class_id uuid default null, p_grade int default null, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid := auth.uid(); m date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
  adm boolean := public.is_admin(); res jsonb;
begin
  if uid is null or not public.is_active_user() then raise exception 'Bạn cần đăng nhập.' using errcode='42501'; end if;
  if p_scope = 'class' then
    if p_class_id is null then raise exception 'Chưa chọn lớp.'; end if;
    if not (adm or public.is_class_member(p_class_id) or public.is_class_homeroom_teacher(p_class_id) or public.teaches_class(p_class_id)) then raise exception 'Bạn không đủ quyền thực hiện thao tác này.' using errcode='42501'; end if;
  elsif p_scope = 'grade' then
    if p_grade is null then raise exception 'Chưa chọn khối.'; end if;
    if not (adm
      or exists (select 1 from public.class_members cm join public.classes c on c.id=cm.class_id where cm.student_id=uid and public.class_grade(c.name)=p_grade)
      or exists (select 1 from public.classes c where public.class_grade(c.name)=p_grade and (public.is_class_homeroom_teacher(c.id) or public.teaches_class(c.id)))) then
      raise exception 'Bạn không đủ quyền thực hiện thao tác này.' using errcode='42501'; end if;
  else raise exception 'Phạm vi xếp hạng không hợp lệ.'; end if;
  with st as (
    select p.id, p.display_name, p.student_id as code, min(c.name) as cname, min(c.id::text)::uuid as cid
    from public.class_members cm join public.classes c on c.id=cm.class_id join public.profiles p on p.id=cm.student_id
    where p.role='student' and ((p_scope='class' and cm.class_id=p_class_id) or (p_scope='grade' and public.class_grade(c.name)=p_grade))
    group by p.id, p.display_name, p.student_id),
  sc as (
    select st.*, 100 + coalesce(sum(e.points),0)::int as pts, count(e.id) filter (where e.points>0)::int as plus_n, count(e.id) filter (where e.points<0)::int as minus_n
    from st left join public.point_events e on e.student_id=st.id and e.month=m group by st.id, st.display_name, st.code, st.cname, st.cid),
  rk as (select sc.*, rank() over (order by pts desc) as rnk from sc),
  cl as (select cname, cid, round(avg(pts),1) as avg_pts, count(*) as n from sc group by cname, cid),
  clr as (select cl.*, rank() over (order by avg_pts desc) as rnk from cl)
  select jsonb_build_object('month', m, 'scope', p_scope, 'me', uid,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',display_name,'code',code,'class',cname,'points',pts,'plus',plus_n,'minus',minus_n,'rank',rnk) order by rnk, display_name) from (select * from rk order by rnk, display_name limit 500) q), '[]'::jsonb),
    'classes', case when p_scope='grade' then coalesce((select jsonb_agg(jsonb_build_object('id',cid,'name',cname,'avg',avg_pts,'students',n,'rank',rnk) order by rnk, cname) from clr), '[]'::jsonb) else '[]'::jsonb end)
  into res;
  return res;
end $$;
revoke all on function public.get_ranking(text, uuid, int, date) from public, anon;
grant execute on function public.get_ranking(text, uuid, int, date) to authenticated;
