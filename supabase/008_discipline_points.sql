-- 008: điểm nề nếp theo học sinh + bảng xếp hạng (chỉ thêm mới)
create or replace function public.sl_norm(t text) returns text language sql immutable set search_path='' as $$
  select btrim(regexp_replace(translate(lower(coalesce(t,'')), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'), '[^a-z0-9]+', ' ', 'g'))
$$;

create table if not exists public.point_rules(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('plus','minus')),
  grp text, name text not null, points int not null,
  keywords text[] not null default '{}', active boolean not null default true, sort int not null default 0,
  created_at timestamptz not null default now());
create table if not exists public.point_files(
  id uuid primary key default gen_random_uuid(),
  name text not null, uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  total int not null default 0, applied int not null default 0, unmatched int not null default 0,
  skipped int not null default 0, points_sum int not null default 0);
create table if not exists public.point_events(
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.point_files(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  rule_id uuid references public.point_rules(id) on delete set null,
  points int not null, event_date date not null, month date not null,
  raw_text text, created_at timestamptz not null default now());
create index if not exists point_events_month_idx on public.point_events(month, student_id);
create index if not exists point_events_file_idx on public.point_events(file_id);
create table if not exists public.point_unmatched(
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.point_files(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text not null, norm_text text not null, hint_points int, event_date date not null,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now());
create index if not exists point_unmatched_open_idx on public.point_unmatched(status, norm_text);

alter table public.point_rules enable row level security;
alter table public.point_files enable row level security;
alter table public.point_events enable row level security;
alter table public.point_unmatched enable row level security;
drop policy if exists point_rules_read on public.point_rules;
create policy point_rules_read on public.point_rules for select to authenticated using (true);
drop policy if exists point_files_read on public.point_files;
create policy point_files_read on public.point_files for select to authenticated using (uploaded_by = auth.uid() or public.is_admin());
drop policy if exists point_events_read on public.point_events;
create policy point_events_read on public.point_events for select to authenticated using (student_id = auth.uid() or public.is_admin());
drop policy if exists point_unmatched_read on public.point_unmatched;
create policy point_unmatched_read on public.point_unmatched for select to authenticated using (public.is_admin());

insert into public.point_rules(kind,grp,name,points,keywords,sort)
select * from (values
('plus','Điểm cộng','Học sinh có hành động tích cực',5,array['hanh dong tich cuc']::text[],0),
('plus','Điểm cộng','Tham gia hỗ trợ sự kiện',3,array['ho tro su kien']::text[],1),
('plus','Điểm cộng','Nhặt được đồ rơi',5,array['nhat duoc do']::text[],2),
('plus','Điểm cộng','FSP: Từ 8 - 9 điểm',5,array[]::text[],3),
('plus','Điểm cộng','FSP: Từ 9 - 10 điểm',10,array[]::text[],4),
('plus','Điểm cộng','Mỗi nhận xét tích cực trên FSP (dư)',3,array[]::text[],5),
('plus','Điểm cộng','Hỗ trợ bạn học (kèm học, động viên) – GVCN xét',10,array[]::text[],6),
('plus','Điểm cộng','Đạt top 10 của khối trong kì thi KSCL (theo môn)',10,array['top 10']::text[],7),
('plus','Điểm cộng','Đóng góp sáng kiến/ý tưởng cho lớp, trường – GVCN xét',10,array[]::text[],8),
('plus','Điểm cộng','Đạt danh hiệu HS Giỏi/Xuất sắc cuối kỳ, năm học',15,array['hoc sinh gioi','hs gioi','hoc sinh xuat sac']::text[],9),
('plus','Điểm cộng','Đại diện lớp/trường đạt giải thi đấu/văn nghệ cấp trường trở lên',10,array['dat giai','dai dien lop']::text[],10),
('plus','Điểm cộng','Hoàn thành tốt nhiệm vụ cán sự lớp/tổ trưởng trong tháng',5,array['hoan thanh tot nhiem vu']::text[],11),
('plus','Điểm cộng','Không vi phạm nề nếp trong cả tháng',5,array[]::text[],12),
('plus','Điểm cộng','Tham gia hiến máu nhân đạo/thiện nguyện',5,array['hien mau','thien nguyen']::text[],13),
('minus','Mức 1 – Vi phạm nghiêm trọng','Đánh nhau',-30,array['danh nhau']::text[],14),
('minus','Mức 1 – Vi phạm nghiêm trọng','Thái độ chưa tốt với thầy cô',-30,array['thai do chua tot voi thay co','thai do voi thay co']::text[],15),
('minus','Mức 1 – Vi phạm nghiêm trọng','Tàng trữ, sử dụng chất cấm',-30,array['chat cam']::text[],16),
('minus','Mức 1 – Vi phạm nghiêm trọng','Trộm cắp, trấn lột',-30,array['trom cap','tran lot']::text[],17),
('minus','Mức 1 – Vi phạm nghiêm trọng','Cờ bạc/cá độ',-30,array['co bac','ca do']::text[],18),
('minus','Mức 1 – Vi phạm nghiêm trọng','Lưu hành nội dung phản cảm, phản nhân văn',-30,array['phan cam','phan nhan van']::text[],19),
('minus','Mức 1 – Vi phạm nghiêm trọng','Xúc phạm nhân phẩm, danh dự/xâm phạm thân thể',-30,array['xuc pham','xam pham than the']::text[],20),
('minus','Mức 2 – Vi phạm nặng','Phá hoại tài sản của nhà trường',-20,array['pha hoai tai san']::text[],21),
('minus','Mức 2 – Vi phạm nặng','Gây gổ, xô xát làm mất trật tự, an ninh trong trường',-20,array['mat trat tu an ninh','mat an ninh']::text[],22),
('minus','Mức 3 – Vi phạm nội quy','Tự ý ra khỏi trường',-10,array['ra khoi truong']::text[],23),
('minus','Mức 3 – Vi phạm nội quy','Sử dụng thiết bị điện tử sai mục đích',-10,array['thiet bi dien tu']::text[],24),
('minus','Mức 3 – Vi phạm nội quy','Trốn tiết',-10,array['tron tiet']::text[],25),
('minus','Mức 3 – Vi phạm nội quy','Không tắt điện/điều hoà sau khi ra khỏi lớp',-10,array['khong tat dien','tat dien','dieu hoa']::text[],26),
('minus','Mức 3 – Vi phạm nội quy','Thể hiện tình cảm đôi lứa trong trường',-10,array['tinh cam doi lua']::text[],27),
('minus','Mức 3 – Vi phạm nội quy','Tàng trữ/sử dụng chất cháy nổ',-10,array['chay no']::text[],28),
('minus','Mức 3 – Vi phạm nội quy','Sử dụng điện thoại trong trường',-10,array['dien thoai']::text[],29),
('minus','Mức 3 – Vi phạm nội quy','Cố ý phá hoại cảnh quan nhà trường',-10,array['canh quan']::text[],30),
('minus','Mức 3 – Vi phạm nội quy','Gây gổ, xô xát với bạn học',-10,array['xo xat','gay go']::text[],31),
('minus','Mức 3 – Vi phạm nội quy','Vi phạm quy chế thi',-10,array['quy che thi']::text[],32),
('minus','Mức 3 – Vi phạm nội quy','Để giày, dép sai quy định',-10,array['ke giay','tu giay','de giay']::text[],33),
('minus','Mức 3 – Vi phạm nội quy','Mang đồ ăn ngoài vào lớp liên hoan chưa được duyệt',-10,array['lien hoan']::text[],34),
('minus','Mức 4 – Tác phong, nề nếp','Sai đồng phục',-5,array['dong phuc']::text[],35),
('minus','Mức 4 – Tác phong, nề nếp','Đi học muộn',-5,array['di hoc muon','di muon']::text[],36),
('minus','Mức 4 – Tác phong, nề nếp','Nói bậy',-5,array['noi bay']::text[],37),
('minus','Mức 4 – Tác phong, nề nếp','Ăn/mua quà vặt mang vào lớp',-5,array['qua vat','an vat']::text[],38),
('minus','Mức 4 – Tác phong, nề nếp','Không kê bàn ghế, dọn ngăn bàn sau giờ',-5,array['ke ban ghe','ngan ban']::text[],39),
('minus','Mức 4 – Tác phong, nề nếp','Đồ dùng cá nhân để bừa bãi',-5,array['de bua bai','locker bua']::text[],40),
('minus','Mức 4 – Tác phong, nề nếp','Dùng nước uống để rửa tay/nô đùa',-5,array['rua tay','dung nuoc uong']::text[],41),
('minus','Mức 4 – Tác phong, nề nếp','Đá bóng/chơi thể thao trong lớp học, hành lang',-5,array['da bong','choi the thao']::text[],42),
('minus','Mức 4 – Tác phong, nề nếp','Nô đùa gây mất vệ sinh trường học',-5,array['mat ve sinh']::text[],43),
('minus','Mức 4 – Tác phong, nề nếp','Uống nước trực tiếp bằng miệng ở vòi cây nước',-5,array['uong nuoc truc tiep','voi cay nuoc']::text[],44),
('minus','Mức 4 – Tác phong, nề nếp','Lấy hàng, bưu phẩm khi chưa được phép',-5,array['buu pham','lay hang']::text[],45),
('minus','Mức 4 – Tác phong, nề nếp','Mang động vật vào trường',-5,array['dong vat']::text[],46),
('minus','Mức 4 – Tác phong, nề nếp','Đi giày, dép trong lớp học',-5,array['di giay','di dep']::text[],47),
('minus','Mức 5 – Vi phạm nhẹ','Tủ locker không có khoá',-1,array['khong co khoa']::text[],48),
('minus','Mức 5 – Vi phạm nhẹ','Vào tiết muộn',-2,array['vao tiet muon']::text[],49),
('minus','Học tập','Mỗi nhận xét tiêu cực dư trên FSP',-5,array[]::text[],50),
('minus','Học tập','Thiếu bài tập',-5,array['thieu bai','thieu btvn','chua lam bai']::text[],51),
('minus','Bán trú','Trốn ngủ',-10,array['tron ngu']::text[],52),
('minus','Bán trú','Tự ý đổi phòng ngủ',-10,array['doi phong ngu']::text[],53),
('minus','Bán trú','Vi phạm nề nếp giờ ăn',-10,array['gio an']::text[],54),
('minus','Bán trú','Thiếu túi ngủ',-5,array['thieu tui ngu']::text[],55),
('minus','Bán trú','Mất trật tự giờ bán trú',-5,array['mat trat tu gio ban tru','mat trat tu ban tru']::text[],56),
('minus','Bán trú','Túi ngủ không để đúng quy định',-5,array['tui ngu khong de']::text[],57),
('minus','Bán trú','Vào phòng ngủ muộn',-2,array['vao phong ngu muon']::text[],58)
) v(kind,grp,name,points,keywords,sort)
where not exists (select 1 from public.point_rules);

create or replace function public.can_score_class(p_class uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_admin() or public.is_class_homeroom_teacher(p_class) or public.has_main_officer_role(p_class) or public.teaches_class(p_class)
$$;
revoke all on function public.can_score_class(uuid) from public, anon;
grant execute on function public.can_score_class(uuid) to authenticated;

create or replace function public.can_import_points() returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_active_user() and (public.is_admin() or public.is_teacher() or exists (
    select 1 from public.class_officer_roles o where o.user_id=auth.uid() and o.ended_at is null and o.role in ('class_president','academic_vp')))
$$;
revoke all on function public.can_import_points() from public, anon;
grant execute on function public.can_import_points() to authenticated;

create or replace function public.import_point_file(p_name text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); fid uuid; r jsonb; code text; sid uuid; txt text; n text; note text; d date; rid uuid; pts int; hint int;
  v_total int:=0; v_applied int:=0; v_unm int:=0; v_nostu int:=0; v_unk int:=0; v_exc int:=0; v_oos int:=0; v_blank int:=0; v_psum int:=0;
begin
  if not public.can_import_points() then raise exception 'Bạn không đủ quyền thực hiện thao tác này.' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'File không có dòng dữ liệu.'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'File quá lớn (tối đa 3000 dòng mỗi lần).'; end if;
  insert into public.point_files(name, uploaded_by) values (left(coalesce(nullif(btrim(p_name),''),'file'),200), uid) returning id into fid;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_total := v_total + 1;
    txt := nullif(btrim(coalesce(r->>'text','')),'');
    if txt is null then v_blank := v_blank + 1; continue; end if;
    code := nullif(regexp_replace(coalesce(r->>'code',''),'[^0-9]','','g'),'');
    if code is null then v_nostu := v_nostu + 1; continue; end if;   -- dòng nhận xét cả lớp: tạm chưa tính
    select p.id into sid from public.profiles p where p.role='student' and regexp_replace(coalesce(p.student_id,''),'[^0-9]','','g') = code limit 1;
    if sid is null then v_unk := v_unk + 1; continue; end if;
    if not exists (select 1 from public.class_members m where m.student_id=sid and public.can_score_class(m.class_id)) then v_oos := v_oos + 1; continue; end if;
    n := public.sl_norm(txt); note := public.sl_norm(r->>'note');
    if note like '%phep%' or n ~ '(^| )nghi( |$)' then v_exc := v_exc + 1; continue; end if;   -- nghỉ / có phép: không tính
    begin d := (r->>'date')::date; exception when others then d := null; end;
    if d is null then d := (now() at time zone 'Asia/Ho_Chi_Minh')::date; end if;
    begin hint := nullif(btrim(coalesce(r->>'points','')),'')::numeric::int; exception when others then hint := null; end;
    rid := null; pts := null;
    select pr.id, pr.points into rid, pts from public.point_rules pr, lateral unnest(pr.keywords) k
      where pr.active and k <> '' and n like '%'||k||'%' order by length(k) desc, abs(pr.points) desc limit 1;
    if rid is null then
      insert into public.point_unmatched(file_id, student_id, raw_text, norm_text, hint_points, event_date) values (fid, sid, left(txt,300), n, hint, d);
      v_unm := v_unm + 1;
    else
      insert into public.point_events(file_id, student_id, rule_id, points, event_date, month, raw_text) values (fid, sid, rid, pts, d, date_trunc('month', d)::date, left(txt,300));
      v_applied := v_applied + 1; v_psum := v_psum + pts;
    end if;
  end loop;
  update public.point_files set total=v_total, applied=v_applied, unmatched=v_unm, skipped=v_nostu+v_unk+v_oos+v_exc+v_blank, points_sum=v_psum where id = fid;
  insert into public.audit_logs(actor_id, action, target_table, target_id, details)
    values (uid, 'points_import', 'point_files', fid::text, jsonb_build_object('name', left(coalesce(p_name,''),120), 'applied', v_applied, 'unmatched', v_unm));
  return jsonb_build_object('file_id', fid, 'total', v_total, 'applied', v_applied, 'unmatched', v_unm, 'class_level', v_nostu, 'unknown_student', v_unk, 'out_of_scope', v_oos, 'excused', v_exc, 'blank', v_blank, 'points_sum', v_psum);
end $$;
revoke all on function public.import_point_file(text, jsonb) from public, anon;
grant execute on function public.import_point_file(text, jsonb) to authenticated;

create or replace function public.list_point_files() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'by',coalesce(p.display_name,''),'created_at',f.created_at,'total',f.total,'applied',f.applied,
    'unmatched',(select count(*) from public.point_unmatched u where u.file_id=f.id and u.status='open'),'skipped',f.skipped,'points_sum',f.points_sum,'mine',f.uploaded_by=auth.uid()) order by f.created_at desc), '[]'::jsonb)
  from public.point_files f left join public.profiles p on p.id=f.uploaded_by
  where public.can_import_points() and (f.uploaded_by=auth.uid() or public.is_admin())
$$;
revoke all on function public.list_point_files() from public, anon;
grant execute on function public.list_point_files() to authenticated;

create or replace function public.delete_point_file(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.point_files; cnt int;
begin
  select * into f from public.point_files where id=p_id;
  if f.id is null then raise exception 'Không tìm thấy file.'; end if;
  if not (public.is_admin() or (f.uploaded_by = auth.uid() and public.can_import_points())) then raise exception 'Bạn không đủ quyền thực hiện thao tác này.' using errcode='42501'; end if;
  select count(*) into cnt from public.point_events where file_id=p_id;
  delete from public.point_files where id=p_id;
  insert into public.audit_logs(actor_id, action, target_table, target_id, details)
    values (auth.uid(), 'points_file_delete', 'point_files', p_id::text, jsonb_build_object('name', f.name, 'revoked_events', cnt));
  return jsonb_build_object('revoked', cnt);
end $$;
revoke all on function public.delete_point_file(uuid) from public, anon;
grant execute on function public.delete_point_file(uuid) to authenticated;

create or replace function public.list_unmatched_points() returns jsonb
language sql stable security definer set search_path='' as $$
  select case when not public.is_admin() then '[]'::jsonb else coalesce((select jsonb_agg(x order by (x->>'count')::int desc) from (
    select jsonb_build_object('norm', u.norm_text, 'sample', min(u.raw_text), 'count', count(*), 'hint', max(u.hint_points)) x
    from public.point_unmatched u where u.status='open' group by u.norm_text) s), '[]'::jsonb) end
$$;
revoke all on function public.list_unmatched_points() from public, anon;
grant execute on function public.list_unmatched_points() to authenticated;

create or replace function public.resolve_point_unmatched(p_norm text, p_rule uuid, p_dismiss boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pr public.point_rules; cnt int := 0;
begin
  if not public.is_admin() then raise exception 'Bạn không đủ quyền thực hiện thao tác này.' using errcode='42501'; end if;
  if p_dismiss then
    update public.point_unmatched set status='dismissed' where status='open' and norm_text=p_norm;
    get diagnostics cnt = row_count; return jsonb_build_object('dismissed', cnt);
  end if;
  select * into pr from public.point_rules where id=p_rule;
  if pr.id is null then raise exception 'Chưa chọn mục điểm.'; end if;
  if p_norm <> '' and not (p_norm = any(pr.keywords)) then update public.point_rules set keywords = keywords || p_norm where id=pr.id; end if;
  select count(*) into cnt from public.point_unmatched u where u.status='open' and u.norm_text=p_norm;
  with ins as (
    insert into public.point_events(file_id, student_id, rule_id, points, event_date, month, raw_text)
    select u.file_id, u.student_id, pr.id, pr.points, u.event_date, date_trunc('month', u.event_date)::date, u.raw_text
    from public.point_unmatched u where u.status='open' and u.norm_text=p_norm returning file_id)
  update public.point_files f set applied = f.applied + s.c, points_sum = f.points_sum + s.c * pr.points
    from (select file_id, count(*)::int c from ins group by file_id) s where f.id = s.file_id;
  update public.point_unmatched set status='resolved' where status='open' and norm_text=p_norm;
  insert into public.audit_logs(actor_id, action, target_table, target_id, details)
    values (auth.uid(), 'points_unmatched_resolve', 'point_rules', pr.id::text, jsonb_build_object('phrase', left(p_norm,120), 'events', cnt));
  return jsonb_build_object('applied', cnt);
end $$;
revoke all on function public.resolve_point_unmatched(text, uuid, boolean) from public, anon;
grant execute on function public.resolve_point_unmatched(text, uuid, boolean) to authenticated;

create or replace function public.admin_update_point_rule(p_id uuid, p_points int, p_keywords text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Bạn không đủ quyền thực hiện thao tác này.' using errcode='42501'; end if;
  update public.point_rules set points = p_points,
    keywords = coalesce((select array_agg(distinct k) from (select public.sl_norm(x) k from unnest(string_to_array(coalesce(p_keywords,''), ',')) x) t where k <> ''), '{}'::text[])
  where id = p_id;
  insert into public.audit_logs(actor_id, action, target_table, target_id, details)
    values (auth.uid(), 'points_rule_update', 'point_rules', p_id::text, jsonb_build_object('points', p_points));
end $$;
revoke all on function public.admin_update_point_rule(uuid, int, text) from public, anon;
grant execute on function public.admin_update_point_rule(uuid, int, text) to authenticated;

create or replace function public.class_grade(p_name text) returns int
language sql immutable set search_path='' as $$
  select nullif(substring(btrim(coalesce(p_name,'')) from '^[0-9]+'), '')::int
$$;

create or replace function public.get_ranking(p_scope text, p_class_id uuid default null, p_grade int default null, p_month date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid := auth.uid(); m date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
  priv boolean := public.is_admin() or public.is_teacher(); res jsonb;
begin
  if uid is null or not public.is_active_user() then raise exception 'Bạn cần đăng nhập.' using errcode='42501'; end if;
  if p_scope = 'class' then
    if p_class_id is null then raise exception 'Chưa chọn lớp.'; end if;
    if not (priv or public.is_class_member(p_class_id)) then raise exception 'Bạn không đủ quyền thực hiện thao tác này.' using errcode='42501'; end if;
  elsif p_scope = 'grade' then
    if p_grade is null then raise exception 'Chưa chọn khối.'; end if;
    if not (priv or exists (select 1 from public.class_members cm join public.classes c on c.id=cm.class_id where cm.student_id=uid and public.class_grade(c.name)=p_grade)) then
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

create or replace function public.my_point_events(p_month date default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('date',e.event_date,'points',e.points,'rule',coalesce(r.name,e.raw_text),'text',e.raw_text) order by e.event_date desc, e.created_at desc), '[]'::jsonb)
  from public.point_events e left join public.point_rules r on r.id=e.rule_id
  where e.student_id=auth.uid() and e.month = date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date
$$;
revoke all on function public.my_point_events(date) from public, anon;
grant execute on function public.my_point_events(date) to authenticated;
