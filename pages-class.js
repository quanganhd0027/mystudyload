/* StudyLoad · pages-class.js — Quản lý lớp: thành viên, tổ, cán bộ, nhiệm vụ cán bộ, trực nhật, thông báo, báo cáo tuần, ủy quyền.
   Mọi kiểm tra quyền thật nằm ở máy chủ (RLS + hàm RPC); giao diện chỉ ẩn/hiện nút cho gọn. */
(() => {
'use strict';
const SL = window.SL, A = window.SLApi, { esc, ui, $ } = SL, { toIso, fmtBytes } = SL.util, sb = A.sb;
const ROLE = { class_president: 'Cán bộ lớp', academic_vp: 'Cán bộ lớp', labor_vp: 'Lớp phó lao động', team_leader: 'Tổ trưởng' };
const MAIN = ['class_president', 'academic_vp', 'labor_vp'];
const OT_STATUS = { not_started: ['Chưa làm', ''], in_progress: ['Đang làm', 'amber'], completed: ['Hoàn thành', 'green'] };
const DUTY_STATUS = { pending: ['Chờ thực hiện', ''], submitted: ['Đã nộp, chờ duyệt', 'amber'], approved: ['Đã duyệt', 'green'], rejected: ['Bị từ chối', 'red'] };
const CAT = { academic: 'Học tập', labor: 'Lao động', culture: 'Văn nghệ', general: 'Chung' };
const PRI = { low: 'Thường', normal: 'Vừa', high: 'Cao' };
const day = (d) => SL.localDay(d);
const monday = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return day(x); };
const addDays = (s, n) => { const x = new Date(s + 'T00:00:00'); x.setDate(x.getDate() + n); return day(x); };
const K = { classId: null, tab: 'overview', week: monday(new Date()) };
const myClasses = () => { const me = SL.current(), cs = SL.state().classes;
  return SL.isAdmin() ? cs : cs.filter((c) => c.studentIds.includes(me.id) || c.teacherIds.includes(me.id)); };

async function loadCtx(cls) {
  const id = cls.id;
  const [teams, officers, delegs] = await Promise.all([
    A.run(sb.from('class_teams').select('*').eq('class_id', id).eq('is_active', true).order('name')),
    A.run(sb.from('class_officer_roles').select('*').eq('class_id', id).is('ended_at', null)),
    A.rpc('get_class_delegations', { p_class_id: id })]);
  const tmembers = teams.length ? await A.run(sb.from('class_team_members').select('*').in('team_id', teams.map((t) => t.id)).is('left_at', null)) : [];
  const names = {}, codes = {}; SL.state().users.forEach((u) => { names[u.id] = u.name; codes[u.id] = u.studentCode; });
  // Mã học sinh của thành viên chỉ giáo viên/cán bộ lớp/admin được xem (máy chủ kiểm tra quyền); học sinh thường nhận rỗng
  try { (await A.rpc('get_class_member_codes', { p_class_id: id }) || []).forEach((r) => { codes[r.user_id] = r.student_code; }); } catch (e) { /* không đủ quyền: giữ ô trống */ }
  const me = SL.current().id, now = Date.now();
  const members = cls.studentIds.map((s) => ({ student_id: s }));
  const activeDeleg = (delegs || []).filter((d) => !d.revoked_at && new Date(d.starts_at) <= now && now < new Date(d.ends_at));
  const direct = officers.filter((o) => o.user_id === me).map((o) => o.role);
  const delegated = activeDeleg.filter((d) => d.delegated_to === me).map((d) => d.officer_role);
  const roles = [...new Set([...direct, ...delegated])], has = (...r) => r.some((x) => roles.includes(x));
  const adm = SL.isAdmin(), home = cls.homeroomId === me, tch = cls.teacherIds.includes(me);
  const isOfficer = direct.some((r) => r === 'class_president' || r === 'academic_vp');
  const lead = officers.some((o) => o.role === 'team_leader' && o.user_id === me);
  const perms = { adm, home, tch, roles, direct, isOfficer, stats: adm || home || tch || isOfficer, manageMembers: adm || home, manageTeams: adm || home || isOfficer, assignOfficers: adm || home,
    createOT: adm || home || roles.length > 0, manageDuty: adm || home || has('labor_vp') || isOfficer, postAnn: adm || home || isOfficer,
    viewReports: adm || home || isOfficer, editReports: adm || home || isOfficer,
    assign: adm || isOfficer || tch, notify: adm || home || tch || isOfficer, delegate: adm || home || direct.length > 0, lead };
  return { cls, members, teams, tmembers, officers, delegs: delegs || [], names, codes, perms, me };
}
const nm = (c, id) => esc(c.names[id] || '(không rõ)');
const memberOpts = (c, sel) => c.members.map((m) => `<option value="${m.student_id}" ${m.student_id === sel ? 'selected' : ''}>${nm(c, m.student_id)}</option>`).join('');
const teamOpts = (c, blank) => (blank ? `<option value="">${blank}</option>` : '') + c.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
const needMsg = (m) => `<div class="notice">${m}</div>`;

/* ---------- Trang chính ---------- */
SL.pages.classmgmt = {
  title: 'Quản lý lớp', sub: 'Thành viên, tổ, cán bộ lớp, nhiệm vụ, trực nhật, thông báo, báo cáo tuần và ủy quyền.',
  render(el) {
    const list = myClasses(), canCreate = SL.isTeacher() && !SL.isAdmin();
    const createBtn = canCreate ? '<button id="kcreate">+ Tạo lớp</button><button class="secondary" id="kclaim">Nhận lớp</button><button class="secondary" id="kassign">Giao bài cho lớp khác</button>' : '';
    if (!list.length) { el.innerHTML = (canCreate ? `<div class="toolbar">${createBtn}</div>` : '') + ui.empty(SL.isStudent() ? 'Bạn chưa thuộc lớp nào. Hãy nhờ giáo viên chủ nhiệm thêm bạn vào lớp bằng mã học sinh của bạn.' : canCreate ? 'Bạn chưa có lớp nào. Hãy bấm "Tạo lớp" hoặc "Nhận lớp" để bắt đầu.' : 'Bạn chưa được phân công lớp nào. Hãy liên hệ quản trị viên.'); $('#kcreate')?.addEventListener('click', createClass); $('#kclaim')?.addEventListener('click', () => SL.claimClass(() => SL.reload())); $('#kassign')?.addEventListener('click', SL.assignPick); return; }
    let id = SL.selectedClass || K.classId; SL.selectedClass = null;
    if (!list.find((c) => c.id === id)) id = list[0].id; K.classId = id;
    el.innerHTML = `<div class="toolbar"><select id="kcls">${list.map((c) => `<option value="${c.id}" ${c.id === id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>${createBtn}</div><div id="kbody"></div>`;
    $('#kcreate')?.addEventListener('click', createClass); $('#kclaim')?.addEventListener('click', () => SL.claimClass(() => SL.reload())); $('#kassign')?.addEventListener('click', SL.assignPick);
    $('#kcls').onchange = (e) => { K.classId = e.target.value; K.tab = 'overview'; SL.pages.classmgmt.render(el); };
    drawTab();
  }
};
function createClass() {
  const yr = new Date().getFullYear(), m = new Date().getMonth();
  const y0 = m >= 7 ? yr : yr - 1;
  ui.form('Tạo lớp mới', `<form><label>Tên lớp *</label><input name="n" required maxlength="60" placeholder="VD: 10A1"><label>Năm học</label><input name="y" maxlength="20" value="${y0}-${y0 + 1}"><label>Mô tả</label><input name="d" maxlength="200"></form><div class="footer-note">Bạn sẽ là giáo viên chủ nhiệm của lớp này. Mỗi giáo viên chỉ tự tạo được 1 lớp (có thể nhận thêm lớp chưa có chủ nhiệm). Sau khi tạo, vào tab "Thành viên" để thêm học sinh.</div>`, 'Tạo lớp',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      const id = await A.rpc('teacher_create_class', { p_name: v.n.trim(), p_academic_year: v.y.trim() || null, p_description: v.d.trim() || null });
      SL.selectedClass = id; K.classId = id; K.tab = 'members'; await SL.reload(); }, 'Đã tạo lớp.');
}
function drawTab() {
  const body = $('#kbody'); if (!body) return;
  const cls = SL.state().classes.find((c) => c.id === K.classId);
  ui.load(body, () => loadCtx(cls), (ctx) => {
    const P = ctx.perms;
    const tabs = [['overview', 'Tổng quan'], ['members', 'Thành viên'], ['teams', 'Tổ'], ['officers', 'Cán bộ lớp'], ['otasks', 'Nhiệm vụ cán bộ'], ['duty', 'Trực nhật'], ['ann', 'Thông báo lớp'], ...(P.notify ? [['notify', 'Gửi thông báo']] : []), ...(P.stats ? [['stats', 'Thống kê bài tập']] : []), ...(P.viewReports ? [['reports', 'Báo cáo tuần']] : []), ['deleg', 'Ủy quyền']];
    if (!SL.isAdmin()) { const keep = ['members', 'teams', 'duty', 'notify', 'reports']; const kt = tabs.filter((t) => keep.includes(t[0])); tabs.length = 0; tabs.push(...kt); if (!tabs.find((t) => t[0] === K.tab)) K.tab = 'members'; } // lớp trưởng: chỉ 5 mục
    if (!tabs.find((t) => t[0] === K.tab)) K.tab = 'overview';
    body.innerHTML = `<div id="kwarn"></div><div class="subtabs">${tabs.map(([k, l]) => `<button data-k="${k}" class="${K.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="ktab"></div>`;
    body.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { K.tab = b.dataset.k; drawTab(); }));
    TABS[K.tab]($('#ktab'), ctx, drawTab);
    if (P.adm || P.home || P.isOfficer) A.rpc('class_workload_alerts', { p_class_id: cls.id }).then((rows) => {
      const w = $('#kwarn'); if (!w || !rows || !rows.length) return;
      w.innerHTML = `<div class="notice red warn-load"><b>⚠ ${rows.length} bạn đang quá tải bài tập</b> — không đủ thời gian rảnh để học xong trước hạn:<div class="warn-list">${rows.map((r) => `<span class="badge red">${esc(r.display_name)} · ${r.overloaded_tasks} bài · thiếu ${SL.fmtMin ? SL.fmtMin(r.overload_minutes) : r.overload_minutes + ' phút'}</span>`).join(' ')}</div></div>`;
    }, () => {});
  });
}
const TABS = {};
const formErr = (e) => { throw e; };

/* ---------- Tổng quan ---------- */
TABS.overview = (el, c) => {
  const P = c.perms, subs = SL.subjects(), byT = {}; (c.cls.subjectTeachers || []).forEach((r) => (byT[r.teacherId] ||= []).push(subs.find((s) => s.id === r.subjectId)?.name || ''));
  const myRoles = P.adm ? 'Quản trị viên' : P.home ? 'Giáo viên chủ nhiệm' : P.tch ? 'Giáo viên bộ môn' : P.roles.length ? P.roles.map((r) => ROLE[r]).join(', ') : 'Học sinh';
  el.innerHTML = `<div class="grid"><div class="card span-6"><div class="between"><h2>${esc(c.cls.name)}</h2>${c.perms.adm ? '<button class="small secondary" id="clsEdit">Sửa tên lớp</button>' : ''}</div><dl class="kv"><dt>Năm học</dt><dd>${esc(c.cls.academicYear || '—')}</dd><dt>Mô tả</dt><dd>${esc(c.cls.description || '—')}</dd><dt>Chủ nhiệm</dt><dd>${c.cls.homeroomId ? nm(c, c.cls.homeroomId) : '<span class="muted">Chưa có</span>'}</dd><dt>Sĩ số</dt><dd>${c.members.length}</dd><dt>Số tổ</dt><dd>${c.teams.length}</dd><dt>Vai trò của bạn</dt><dd>${esc(myRoles)}</dd></dl></div>
    <div class="card span-6"><h2>Giáo viên bộ môn</h2>${Object.keys(byT).length ? Object.entries(byT).map(([t, s]) => `<div class="item"><div class="item-title">${nm(c, t)}</div><div class="item-meta">${esc(s.join(', '))}</div></div>`).join('') : ui.empty('Chưa phân công giáo viên bộ môn.')}${P.assign ? `<div style="margin-top:12px"><button class="small" id="asgn">Giao nhiệm vụ cho cả lớp</button></div>` : ''}</div></div>`;
  $('#asgn')?.addEventListener('click', () => SL.assignToClass(c.cls.id));
  $('#clsEdit')?.addEventListener('click', () => SL.classForm && SL.classForm(c.cls));
};

/* ---------- Thành viên (giáo viên chủ nhiệm thêm bằng mã học sinh) ---------- */
const CODE_ST = { ok: ['Sẵn sàng thêm', 'green'], added: ['Đã thêm', 'green'], in_class: ['Đã ở trong lớp', ''], not_found: ['Không tìm thấy mã', 'red'], not_student: ['Không phải tài khoản học sinh', 'red'], banned: ['Tài khoản bị khóa', 'red'], duplicate: ['Mã trùng nhiều tài khoản', 'red'] };
const parseCodes = (t) => [...new Set(String(t || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
function addByCode(c, preset) {
  SL.modal('Thêm học sinh vào lớp', `<label>Tìm học sinh theo mã, số điện thoại hoặc tên (gõ gần đúng cũng được)</label><input id="sq" type="text" name="sl_find_student" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="VD: 315 · 0912… · Nguyễn Văn" style="width:100%"><div id="sres" style="margin-top:10px;max-height:340px;overflow:auto"></div><div class="footer-note">Gõ ít nhất 2 ký tự. Bấm "Thêm" để cho học sinh vào lớp ngay, không cần nhập lại.</div>`, 'Đóng');
  const q = $('#sq'), res = $('#sres'); $('#modalSubmit').onclick = () => SL.closeModal(); q.focus();
  let t, seq = 0;
  const draw = (rows) => {
    res.innerHTML = rows.length ? rows.map((r) => `<div class="item"><div class="item-main"><div class="item-title">${esc(r.display_name || r.username)}</div><div class="item-meta">${r.student_code ? 'Mã HS: <b>' + esc(r.student_code) + '</b>' : ''}${r.phone ? (r.student_code ? ' · ' : '') + 'SĐT: <b>' + esc(r.phone) + '</b>' : ''} · ${esc(r.username)}</div></div>${r.in_class ? '<span class="badge green">Đã ở trong lớp</span>' : `<button class="small" data-add="${r.user_id}">Thêm</button>`}</div>`).join('') : '<div class="muted" style="padding:8px">Không tìm thấy học sinh phù hợp.</div>';
    res.querySelectorAll('[data-add]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await A.rpc('teacher_add_student', { p_class_id: c.cls.id, p_user_id: b.dataset.add }); b.outerHTML = '<span class="badge green">Đã thêm</span>'; added = true; }
      catch (e) { b.disabled = false; SL.toast(A.toApiError(e).message); }
    }));
  };
  let added = false;
  q.oninput = () => { clearTimeout(t); const v = q.value.trim(); if (v.length < 2) { res.innerHTML = ''; return; }
    t = setTimeout(async () => { const my = ++seq; try { const rows = await A.rpc('teacher_search_students', { p_class_id: c.cls.id, p_q: v }); if (my === seq) draw(rows); } catch (e) { res.innerHTML = `<div class="notice red">${esc(A.toApiError(e).message)}</div>`; } }, 300); };
  if (preset && preset.length >= 2) { q.value = preset; q.dispatchEvent(new Event('input')); }
  const obs = new MutationObserver(() => { if (!document.getElementById('sq')) { obs.disconnect(); if (added) SL.reload(); } });
  obs.observe(document.getElementById('modalRoot'), { childList: true, subtree: true });
}
TABS.members = (el, c) => {
  const P = c.perms;
  el.innerHTML = `<div class="toolbar"><input id="mq" placeholder="Tìm học sinh…">${P.manageMembers ? '<button id="madd">+ Thêm học sinh</button>' : ''}</div><div id="mList"></div>`;
  $('#madd')?.addEventListener('click', () => addByCode(c, $('#mq').value.trim()));
  const draw = () => { const s = $('#mq').value.toLowerCase(), rows = c.members.filter((m) => ((c.names[m.student_id] || '') + ' ' + (c.codes[m.student_id] || '')).toLowerCase().includes(s));
    $('#mList').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Mã HS</th><th>Chức vụ</th><th>Tổ</th>${P.manageMembers ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((m) => {
      const o = c.officers.filter((x) => x.user_id === m.student_id).map((x) => ROLE[x.role]).join(', '), t = c.tmembers.filter((x) => x.student_id === m.student_id).map((x) => c.teams.find((tt) => tt.id === x.team_id)?.name).filter(Boolean).join(', ');
      return `<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap">${SL.av(m.student_id, c.names[m.student_id], o ? 'officer' : 'student', 28)}${nm(c, m.student_id)}</span></td><td>${esc(c.codes[m.student_id] || '—')}</td><td>${esc(o) || '—'}</td><td>${esc(t) || '—'}</td>${P.manageMembers ? `<td><button class="small danger" data-rmm="${m.student_id}">Xóa khỏi lớp</button></td>` : ''}</tr>`; }).join('')}</tbody></table></div>` : ui.empty(c.members.length ? 'Không có học sinh phù hợp trong lớp.' : 'Lớp chưa có học sinh. Hãy bấm "Thêm học sinh" và tìm theo mã hoặc số điện thoại.') + (P.manageMembers && s.trim().length >= 2 ? `<div style="text-align:center;margin-top:8px"><button id="mfind">Tìm “${esc($('#mq').value.trim())}” trong toàn hệ thống để thêm vào lớp</button></div>` : '');
    $('#mfind')?.addEventListener('click', () => addByCode(c, $('#mq').value.trim()));
    $('#mList').querySelectorAll('[data-rmm]').forEach((b) => (b.onclick = async () => { if (!confirm('Xóa học sinh này khỏi lớp? Chức vụ cán bộ/tổ của bạn ấy trong lớp cũng sẽ bị gỡ.')) return; b.disabled = true;
      try { await A.rpc('teacher_remove_class_member', { p_class_id: c.cls.id, p_student_id: b.dataset.rmm }); SL.toast('Đã xóa khỏi lớp.'); await SL.reload(); } catch (e) { SL.toast(A.toApiError(e).message); b.disabled = false; } })); };
  $('#mq').oninput = draw; draw();
};

/* ---------- Tổ ---------- */
TABS.teams = (el, c, refresh) => {
  const P = c.perms;
  el.innerHTML = `${P.manageTeams ? '<div class="toolbar"><button id="tnew">+ Tạo tổ</button></div>' : ''}${c.teams.length ? c.teams.map((t) => {
    const mem = c.tmembers.filter((m) => m.team_id === t.id), lead = c.officers.find((o) => o.role === 'team_leader' && o.team_id === t.id), isMem = mem.some((m) => m.student_id === c.me);
    const canEdit = P.adm || P.home || P.isOfficer || (lead && lead.user_id === c.me);
    return `<div class="card" style="margin-bottom:12px"><div class="section-head"><h3>${esc(t.name)}</h3><span class="muted">Tổ trưởng: ${lead ? nm(c, lead.user_id) : '—'}</span></div>
      ${mem.length ? mem.map((m) => `<div class="ev-item"><span>${nm(c, m.student_id)}</span>${canEdit ? `<button class="small danger" data-rm="${t.id}|${m.student_id}">Gỡ</button>` : ''}</div>`).join('') : '<div class="muted">Tổ chưa có thành viên.</div>'}
      <div class="row" style="margin-top:8px">${canEdit ? `<button class="small secondary" data-add="${t.id}">+ Thêm thành viên</button>` : ''}${isMem || P.adm || P.home || canEdit ? `<button class="small secondary" data-upd="${t.id}">Báo cáo tuần của tổ</button>` : ''}</div></div>`; }).join('') : ui.empty('Lớp chưa có tổ nào.')}`;
  $('#tnew')?.addEventListener('click', () => ui.form('Tạo tổ', `<form><label>Tên tổ *</label><input name="n" required maxlength="40"><label>Mô tả</label><input name="d" maxlength="120"></form>`, 'Tạo tổ',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      await A.rpc('create_class_team', { p_class_id: c.cls.id, p_name: v.n.trim(), p_description: v.d.trim() || null }); refresh(); }, 'Đã tạo tổ.'));
  el.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { const tid = b.dataset.add, inT = new Set(c.tmembers.filter((m) => m.team_id === tid).map((m) => m.student_id));
    ui.form('Thêm thành viên vào tổ', `<form><select name="s">${c.members.filter((m) => !inT.has(m.student_id)).map((m) => `<option value="${m.student_id}">${nm(c, m.student_id)}</option>`).join('')}</select></form>`, 'Thêm',
      async (root) => { const s = root.querySelector('[name=s]').value; if (!s) return false; await A.rpc('add_class_team_member', { p_team_id: tid, p_student_id: s }); refresh(); }, 'Đã thêm vào tổ.'); }));
  el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { const [t, s] = b.dataset.rm.split('|'); if (!confirm('Gỡ học sinh khỏi tổ?')) return; b.disabled = true;
    try { await A.rpc('remove_class_team_member', { p_team_id: t, p_student_id: s }); SL.toast('Đã gỡ khỏi tổ.'); refresh(); } catch (e) { SL.toast(A.toApiError(e).message); b.disabled = false; } }));
  el.querySelectorAll('[data-upd]').forEach((b) => (b.onclick = () => teamUpdates(c, b.dataset.upd)));
};
async function teamUpdates(c, teamId) {
  const wk = K.week, team = c.teams.find((t) => t.id === teamId);
  let rows; try { rows = await A.run(sb.from('team_weekly_updates').select('*').eq('team_id', teamId).eq('week_start', wk)); } catch (e) { return SL.toast(A.toApiError(e).message); }
  const mine = rows.find((r) => r.user_id === c.me), isMem = c.tmembers.some((m) => m.team_id === teamId && m.student_id === c.me);
  ui.form(`Báo cáo tuần ${wk} · ${esc(team.name)}`, `<div>${rows.filter((r) => r.user_id !== c.me).map((r) => `<div class="item"><div><div class="item-title">${nm(c, r.user_id)}</div><div class="item-meta">Đã làm: ${esc(r.completed_text || '—')}<br>Dự kiến: ${esc(r.planned_text || '—')}<br>Vướng mắc: ${esc(r.blocker_text || '—')}</div></div></div>`).join('') || '<div class="muted">Chưa có báo cáo của thành viên khác.</div>'}</div>
    ${isMem ? `<form style="margin-top:12px"><label>Tuần này tôi đã làm</label><textarea name="c" rows="2">${esc(mine?.completed_text || '')}</textarea><label>Dự kiến tuần sau</label><textarea name="p" rows="2">${esc(mine?.planned_text || '')}</textarea><label>Vướng mắc</label><textarea name="b" rows="2">${esc(mine?.blocker_text || '')}</textarea></form>` : '<div class="notice">Chỉ thành viên của tổ mới được gửi báo cáo.</div>'}`, isMem ? 'Lưu báo cáo' : 'Đóng',
    async (root) => { if (!isMem) return; const v = Object.fromEntries(new FormData(root.querySelector('form')).entries());
      const row = { completed_text: v.c.trim() || null, planned_text: v.p.trim() || null, blocker_text: v.b.trim() || null };
      if (mine) await A.run(sb.from('team_weekly_updates').update(row).eq('id', mine.id)); else await A.run(sb.from('team_weekly_updates').insert({ team_id: teamId, user_id: c.me, week_start: wk, ...row })); }, 'Đã lưu báo cáo tuần.');
}

/* ---------- Cán bộ lớp (tối đa 2, quyền như nhau) ---------- */
TABS.officers = (el, c, refresh) => {
  const P = c.perms, main = c.officers.filter((o) => MAIN.includes(o.role)), others = c.officers.filter((o) => !MAIN.includes(o.role));
  el.innerHTML = `<div class="notice">Mỗi lớp có tối đa 2 cán bộ lớp, quyền như nhau: đăng thông báo, xem tình trạng làm bài của cả lớp và xuất dữ liệu để gửi giáo viên.</div>
    ${P.assignOfficers ? '<div class="toolbar"><button id="oset">Chọn / đổi cán bộ lớp</button><button class="secondary" id="onew">+ Bổ nhiệm tổ trưởng</button></div>' : ''}
    <h3>Cán bộ lớp (${main.length}/2)</h3>${main.length ? `<div class="table-wrap"><table><thead><tr><th>Học sinh</th><th>Từ ngày</th></tr></thead><tbody>${main.map((o) => `<tr><td>${nm(c, o.user_id)}</td><td>${SL.fmtDate(o.assigned_at)}</td></tr>`).join('')}</tbody></table></div>` : ui.empty('Lớp chưa có cán bộ lớp.')}
    ${others.length ? `<h3 style="margin-top:16px">Tổ trưởng</h3><div class="table-wrap"><table><thead><tr><th>Học sinh</th><th>Tổ</th><th>Từ ngày</th><th></th></tr></thead><tbody>${others.map((o) => `<tr><td>${nm(c, o.user_id)}</td><td>${esc(c.teams.find((t) => t.id === o.team_id)?.name || '—')}</td><td>${SL.fmtDate(o.assigned_at)}</td><td>${P.assignOfficers ? `<button class="small danger" data-end="${o.id}">Miễn nhiệm</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $('#oset')?.addEventListener('click', () => {
    const sel = (n, cur) => `<select name="${n}"><option value="">— Không chọn —</option>${memberOpts(c, cur)}</select>`;
    ui.form('Chọn cán bộ lớp', `<form><label>Cán bộ lớp thứ nhất</label>${sel('a', main[0]?.user_id)}<label>Cán bộ lớp thứ hai</label>${sel('b', main[1]?.user_id)}<div class="footer-note">Chỉ chọn trong học sinh của lớp. Để trống ô nào thì lớp không có người ở vị trí đó.</div></form>`, 'Lưu',
      async (root) => { const v = Object.fromEntries(new FormData(root.querySelector('form')).entries()), ids = [v.a, v.b].filter(Boolean);
        if (ids.length === 2 && ids[0] === ids[1]) throw new A.ApiError('validation', 'Hai vị trí phải là hai học sinh khác nhau.');
        await A.rpc('set_class_officers', { p_class_id: c.cls.id, p_user_ids: ids }); refresh(); }, 'Đã cập nhật cán bộ lớp.');
  });
  $('#onew')?.addEventListener('click', () => ui.form('Bổ nhiệm tổ trưởng', `<form><label>Học sinh *</label><select name="u" required>${memberOpts(c)}</select><label>Tổ *</label><select name="t" required>${teamOpts(c)}</select></form>`, 'Bổ nhiệm',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      await A.rpc('assign_class_officer', { p_class_id: c.cls.id, p_user_id: v.u, p_role: 'team_leader', p_team_id: v.t }); refresh(); }, 'Đã bổ nhiệm tổ trưởng.'));
  el.querySelectorAll('[data-end]').forEach((b) => (b.onclick = async () => { if (!confirm('Miễn nhiệm tổ trưởng này?')) return; b.disabled = true;
    try { await A.rpc('revoke_class_officer', { p_officer_role_id: b.dataset.end }); SL.toast('Đã miễn nhiệm.'); refresh(); } catch (e) { SL.toast(A.toApiError(e).message); b.disabled = false; } }));
};

/* ---------- Nhiệm vụ cán bộ ---------- */
TABS.otasks = (el, c, refresh) => {
  const P = c.perms;
  el.innerHTML = `${P.createOT ? '<div class="toolbar"><button id="otnew">+ Giao nhiệm vụ</button></div>' : ''}<div id="otList"></div>`;
  ui.load($('#otList'), () => A.rpc('get_officer_tasks', { p_class_id: c.cls.id }), (rows) => {
    $('#otList').innerHTML = rows.length ? rows.map((t) => { const [lb, cl] = OT_STATUS[t.status] || [t.status, ''], mineT = t.assigned_to === c.me;
      return `<div class="item"><div class="item-main"><div class="item-title">${esc(t.title)} <span class="badge ${cl}">${lb}</span> <span class="badge">${CAT[t.category] || ''}</span> <span class="badge">${PRI[t.priority] || ''}</span></div><div class="item-meta">Giao cho: ${t.assigned_to ? nm(c, t.assigned_to) : (t.team_id ? 'Tổ ' + esc(c.teams.find((x) => x.id === t.team_id)?.name || '') : 'Cả lớp')} · Giao bởi ${nm(c, t.assigned_by)}${t.due_at ? ' · Hạn ' + SL.fmtDate(t.due_at) : ''}${t.description ? '<br>' + esc(t.description) : ''}</div></div>
      <div class="actions">${t.status !== 'completed' && (mineT || P.adm || P.home || t.assigned_by === c.me || P.roles.length) ? `<select data-st="${t.id}">${Object.entries(OT_STATUS).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>` : ''}</div></div>`; }).join('') : ui.empty('Chưa có nhiệm vụ cán bộ nào.');
    $('#otList').querySelectorAll('[data-st]').forEach((s) => (s.onchange = async () => { s.disabled = true;
      try { await A.rpc('update_officer_task_status', { p_task_id: s.dataset.st, p_status: s.value }); SL.toast('Đã cập nhật trạng thái.'); refresh(); } catch (e) { SL.toast(A.toApiError(e).message); refresh(); } }));
  });
  $('#otnew')?.addEventListener('click', () => ui.form('Giao nhiệm vụ cán bộ', `<form><div class="form-grid"><div class="full"><label>Tiêu đề *</label><input name="t" required maxlength="120"></div><div class="full"><label>Mô tả</label><textarea name="d" rows="2"></textarea></div>
    <div><label>Nhóm việc</label><select name="cat">${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div><label>Ưu tiên</label><select name="p"><option value="low">Thường</option><option value="normal" selected>Vừa</option><option value="high">Cao</option></select></div>
    <div><label>Giao cho học sinh</label><select name="u"><option value="">— Không chọn —</option>${memberOpts(c)}</select></div><div><label>Hoặc giao cho tổ</label><select name="tm">${teamOpts(c, '— Không chọn —')}</select></div><div><label>Hạn</label><input type="datetime-local" name="due"></div></div></form>`, 'Giao việc',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      if (!v.u && !v.tm) throw new A.ApiError('validation', 'Hãy chọn học sinh hoặc tổ nhận việc.');
      await A.rpc('create_officer_task', { p_class_id: c.cls.id, p_title: v.t.trim(), p_description: v.d.trim() || null, p_category: v.cat, p_assigned_to: v.u || null, p_team_id: v.tm || null, p_priority: v.p, p_due_at: v.due ? toIso(v.due) : null }); refresh(); }, 'Đã giao nhiệm vụ.'));
};

/* ---------- Trực nhật ---------- */
TABS.duty = (el, c, refresh) => {
  const P = c.perms, wk = K.week, end = addDays(wk, 6);
  el.innerHTML = `<div class="toolbar"><button class="small secondary" id="dprev">‹ Tuần trước</button><b>${wk} → ${end}</b><button class="small secondary" id="dnext">Tuần sau ›</button>${P.manageDuty ? '<button id="dnew">+ Xếp lịch trực</button>' : ''}</div><div id="dList"></div>`;
  $('#dprev').onclick = () => { K.week = addDays(wk, -7); refresh(); }; $('#dnext').onclick = () => { K.week = addDays(wk, 7); refresh(); };
  ui.load($('#dList'), () => A.run(sb.from('duty_schedules').select('*').eq('class_id', c.cls.id).gte('duty_date', wk).lte('duty_date', end).order('duty_date')), (rows) => {
    $('#dList').innerHTML = rows.length ? rows.map((d) => { const [lb, cl] = DUTY_STATUS[d.status] || [d.status, ''], own = d.student_id === c.me;
      return `<div class="item"><div class="item-main"><div class="item-title">${esc(d.duty_date)} · ${esc(d.duty_type || '')} <span class="badge ${cl}">${lb}</span></div><div class="item-meta">${d.student_id ? nm(c, d.student_id) : 'Cả tổ'}${d.team_id ? ' · Tổ ' + esc(c.teams.find((t) => t.id === d.team_id)?.name || '') : ''}${d.note ? ' · ' + esc(d.note) : ''}</div></div>
      <div class="actions">${own && (d.status === 'pending' || d.status === 'rejected') ? `<button class="small" data-sub="${d.id}">Nộp minh chứng</button>` : ''}${P.manageDuty || own ? `<button class="small secondary" data-ev="${d.id}">Xem minh chứng</button>` : ''}${P.manageDuty && d.status === 'submitted' ? `<button class="small" data-ok="${d.id}">Duyệt</button><button class="small danger" data-no="${d.id}">Từ chối</button>` : ''}</div></div>`; }).join('') : ui.empty('Tuần này chưa có lịch trực.');
    const L = $('#dList');
    L.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => { const lim = A.evidence.limits('duty');
      ui.form('Nộp minh chứng trực nhật', `<form><label>Ảnh/tệp minh chứng</label><input type="file" name="f" accept="${lim.mime.join(',')}"><label>Ghi chú</label><textarea name="n" rows="2" maxlength="300"></textarea><div class="footer-note">Tối đa ${Math.round(lim.maxBytes / 1048576)} MB. Cần ít nhất ảnh hoặc ghi chú.</div></form>`, 'Nộp',
        async (root) => { const f = root.querySelector('[name=f]').files[0], n = root.querySelector('[name=n]').value; await A.evidence.upload('duty', b.dataset.sub, f, n); refresh(); }, 'Đã nộp minh chứng, chờ duyệt.'); }));
    L.querySelectorAll('[data-ev]').forEach((b) => (b.onclick = async () => { let ev; try { ev = await A.evidence.list('duty', b.dataset.ev); } catch (e) { return SL.toast(A.toApiError(e).message); }
      SL.modal('Minh chứng trực nhật', ev.length ? ev.map((r) => `<div class="ev-item"><span>${r.file_path ? esc(r.file_path.split('/').pop()) : 'Ghi chú'}${r.note ? ' · ' + esc(r.note) : ''} <span class="muted">${SL.fmtDate(r.created_at)}</span></span>${r.file_path ? `<button class="small secondary" data-open="${r.id}">Mở</button>` : ''}</div>`).join('') : ui.empty('Chưa có minh chứng.'), 'Đóng');
      $('#modalSubmit').onclick = () => SL.closeModal();
      document.querySelectorAll('.modal [data-open]').forEach((o) => (o.onclick = async () => { try { window.open(await A.evidence.url('duty', ev.find((r) => r.id === o.dataset.open)), '_blank', 'noopener'); } catch (e) { SL.toast(A.toApiError(e).message); } })); }));
    const review = (id, ok) => ui.form(ok ? 'Duyệt lịch trực' : 'Từ chối minh chứng', `<label>Ghi chú${ok ? ' (không bắt buộc)' : ' (nên nêu lý do)'}</label><textarea name="n" rows="2" maxlength="300"></textarea>`, ok ? 'Duyệt' : 'Từ chối',
      async (root) => { await A.rpc('review_duty_submission', { p_duty_schedule_id: id, p_decision: ok ? 'approved' : 'rejected', p_note: root.querySelector('[name=n]').value.trim() || null }); refresh(); }, ok ? 'Đã duyệt.' : 'Đã từ chối, học sinh có thể nộp lại.');
    L.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => review(b.dataset.ok, true))); L.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => review(b.dataset.no, false)));
  });
  $('#dnew')?.addEventListener('click', () => ui.form('Xếp lịch trực', `<form><div class="form-grid"><div><label>Học sinh *</label><select name="s" required>${memberOpts(c)}</select></div><div><label>Ngày *</label><input type="date" name="d" required value="${wk}"></div><div><label>Công việc *</label><input name="t" required maxlength="60" placeholder="Quét lớp, lau bảng…"></div><div class="full"><label>Ghi chú</label><input name="n" maxlength="200"></div></div></form>`, 'Xếp lịch',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      await A.rpc('create_duty_schedule', { p_class_id: c.cls.id, p_student_id: v.s, p_duty_date: v.d, p_duty_type: v.t.trim(), p_team_id: null, p_note: v.n.trim() || null }); refresh(); }, 'Đã xếp lịch trực.'));
};

/* ---------- Thông báo lớp ---------- */
/* ---------- Gửi thông báo tới học sinh của lớp (giáo viên, cán bộ lớp, admin) ---------- */
const NCOLORS = { default: ['Mặc định', '#5548e8'], blue: ['Xanh dương', '#2563eb'], green: ['Xanh lá', '#16845b'], red: ['Đỏ', '#c62828'], amber: ['Vàng', '#a86600'], purple: ['Tím', '#8b3fd9'], pink: ['Hồng', '#d6336c'], teal: ['Xanh ngọc', '#0f8b8d'] };
TABS.notify = (el, c) => {
  const sel = new Set(); let all = true, q = '';
  const stu = c.members.map((m) => ({ id: m.student_id, name: c.names[m.student_id] || '(không rõ)', code: c.codes[m.student_id] || '' })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  el.innerHTML = `<div class="card"><h2>Gửi thông báo cho lớp ${esc(c.cls.name)}</h2><p class="muted">Thông báo hiện ở góc dưới bên phải màn hình của học sinh trong 1 phút (và trong mục Thông báo). Chỉ gửi được cho học sinh trong lớp này.</p>
  <form id="nf"><label>Tiêu đề *</label><input name="t" required maxlength="100"><label>Nội dung</label><textarea name="b" rows="3" maxlength="300"></textarea>
  <label>Màu thông báo</label><div class="accent-grid">${Object.entries(NCOLORS).map(([k, v]) => `<label class="accent-opt"><input type="radio" name="c" value="${k}" ${k === 'default' ? 'checked' : ''}><span class="accent-dot big" style="background:${v[1]}"></span> ${v[0]}</label>`).join('')}</div>
  <div class="item" id="nPrev" style="margin-top:8px"><div><div class="item-title" id="nPT"></div><div id="nPB"></div><div class="item-meta">Xem trước</div></div></div>
  <label>Người nhận</label><label class="checkrow"><input type="checkbox" id="nAll" checked> Gửi cho <b>cả lớp</b> (${stu.length} học sinh)</label>
  <div id="nPick" class="hidden"><input type="search" id="nQ" placeholder="Tìm học sinh theo tên hoặc mã…" style="margin-top:8px"><label class="checkrow"><input type="checkbox" id="nSel"> Chọn tất cả kết quả đang hiện</label><div id="nList" style="max-height:260px;overflow:auto;border:1px solid var(--line,#ddd);border-radius:8px;padding:4px 8px"></div></div>
  <div class="muted" id="nCount" style="margin:8px 0"></div><button type="submit">Gửi thông báo</button></form></div>`;
  const $c = (x) => el.querySelector(x), f = $c('#nf');
  const prev = () => { $c('#nPT').textContent = f.elements.t.value || '(chưa có tiêu đề)'; $c('#nPB').textContent = f.elements.b.value; $c('#nPrev').style.borderLeft = '4px solid ' + (NCOLORS[(f.querySelector('[name=c]:checked')?.value || 'default')] || NCOLORS.default)[1]; };
  const shown = () => stu.filter((u) => !q || (u.name + ' ' + u.code).toLowerCase().includes(q.toLowerCase()));
  const count = () => { $c('#nCount').textContent = all ? `Sẽ gửi cho cả lớp (${stu.length} học sinh).` : `Đã chọn ${sel.size} học sinh.`; };
  const list = () => { const rows = shown();
    $c('#nList').innerHTML = rows.length ? rows.map((u) => `<label class="checkrow" style="display:flex;gap:8px;padding:6px 0"><input type="checkbox" data-u="${u.id}" ${sel.has(u.id) ? 'checked' : ''}><span><b>${esc(u.name)}</b>${u.code ? ' <span class="muted">· ' + esc(u.code) + '</span>' : ''}</span></label>`).join('') : '<div class="muted" style="padding:8px">Không có học sinh phù hợp.</div>';
    $c('#nSel').checked = rows.length > 0 && rows.every((u) => sel.has(u.id));
    $c('#nList').querySelectorAll('[data-u]').forEach((b) => (b.onchange = () => { b.checked ? sel.add(b.dataset.u) : sel.delete(b.dataset.u); $c('#nSel').checked = shown().every((u) => sel.has(u.id)); count(); })); count(); };
  f.addEventListener('input', prev); prev(); count();
  $c('#nAll').onchange = (e) => { all = e.target.checked; $c('#nPick').classList.toggle('hidden', all); if (!all) list(); count(); };
  $c('#nQ').oninput = (e) => { q = e.target.value; list(); };
  $c('#nSel').onchange = (e) => { shown().forEach((u) => (e.target.checked ? sel.add(u.id) : sel.delete(u.id))); list(); };
  f.onsubmit = async (e) => {
    e.preventDefault(); if (!f.reportValidity()) return;
    if (!all && !sel.size) return SL.toast('Hãy chọn ít nhất một học sinh, hoặc tick "Gửi cho cả lớp".');
    if (all && stu.length > 1 && !confirm(`Gửi thông báo này cho cả lớp ${c.cls.name} (${stu.length} học sinh)?`)) return;
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try { const n = await A.rpc('class_send_notification', { p_class_id: c.cls.id, p_users: all ? null : [...sel], p_all: all, p_title: f.elements.t.value.trim(), p_body: f.elements.b.value.trim(), p_color: (f.querySelector('[name=c]:checked')?.value || 'default') }); SL.toast(`Đã gửi thông báo cho ${n} học sinh.`); f.elements.t.value = ''; f.elements.b.value = ''; prev(); }
    catch (err) { SL.toast(A.toApiError(err).message); }
    btn.disabled = false;
  };
};
TABS.ann = (el, c, refresh) => {
  const P = c.perms;
  el.innerHTML = `${P.postAnn ? '<div class="toolbar"><button id="anew">+ Đăng thông báo</button></div>' : ''}<div id="aList"></div>`;
  ui.load($('#aList'), () => A.rpc('get_class_announcements', { p_class_id: c.cls.id }), (rows) => {
    $('#aList').innerHTML = rows.length ? rows.map((a) => `<div class="item"><div class="item-main"><div class="item-title">${a.is_pinned ? '📌 ' : ''}${esc(a.title)} ${a.is_read ? '' : '<span class="badge amber">Mới</span>'}</div><div class="item-meta">${nm(c, a.posted_by)} · ${SL.fmtDate(a.created_at)}${a.expires_at ? ' · hết hạn ' + SL.fmtDate(a.expires_at) : ''}</div><div style="margin-top:6px;white-space:pre-wrap">${esc(a.content)}</div></div>
      <div class="actions">${!a.is_read && c.members.some((m) => m.student_id === c.me) ? `<button class="small secondary" data-read="${a.id}">Đã đọc</button>` : ''}${P.postAnn ? `<button class="small danger" data-del="${a.id}">Xóa</button>` : ''}</div></div>`).join('') : ui.empty('Chưa có thông báo nào.');
    $('#aList').querySelectorAll('[data-read]').forEach((b) => (b.onclick = async () => { b.disabled = true; try { await A.run(sb.from('announcement_reads').insert({ announcement_id: b.dataset.read, user_id: c.me })); refresh(); } catch (e) { SL.toast(A.toApiError(e).message); b.disabled = false; } }));
    $('#aList').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Xóa thông báo này?')) return; b.disabled = true;
      try { const r = await A.run(sb.from('class_announcements').delete().eq('id', b.dataset.del).select('id')); if (!r.length) throw new A.ApiError('unauthorized', 'Bạn không có quyền xóa thông báo này.'); SL.toast('Đã xóa.'); refresh(); } catch (e) { SL.toast(A.toApiError(e).message); b.disabled = false; } }));
  });
  $('#anew')?.addEventListener('click', () => ui.form('Đăng thông báo', `<form><label>Tiêu đề *</label><input name="t" required maxlength="120"><label>Nội dung *</label><textarea name="b" rows="4" required></textarea><label class="checkrow"><input type="checkbox" name="pin"> Ghim thông báo</label><label>Hết hạn (không bắt buộc)</label><input type="datetime-local" name="exp"></form>`, 'Đăng',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      await A.run(sb.from('class_announcements').insert({ class_id: c.cls.id, title: v.t.trim(), content: v.b.trim(), posted_by: c.me, is_pinned: !!v.pin, expires_at: v.exp ? toIso(v.exp) : null })); refresh(); }, 'Đã đăng thông báo.'));
};

/* ---------- Thống kê tình trạng làm bài (cán bộ lớp / giáo viên) ---------- */
const S = { thr: 240 }, WINDOW_DAYS = 3;
const dm = (d) => { const x = new Date(d); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0'); };
const hm = (min) => (min >= 60 ? Math.floor(min / 60) + 'g' + (min % 60 ? String(min % 60).padStart(2, '0') : '') : min + ' phút');
function analyse(rows, thr) {
  const now = Date.now(), lim = now + WINDOW_DAYS * 864e5, stu = new Map(), asg = new Map();
  rows.forEach((r) => {
    let st = stu.get(r.student_id); if (!st) stu.set(r.student_id, (st = { id: r.student_id, name: r.display_name || '(không rõ)', code: r.student_code || '', undone: 0, late: 0, minutes: 0 }));
    let a = asg.get(r.assignment_id); if (!a) asg.set(r.assignment_id, (a = { id: r.assignment_id, title: r.title, subject: r.subject_name, deadline: r.deadline, total: 0, undone: 0 }));
    a.total++;
    if (r.status !== 'completed') {
      a.undone++; st.undone++;
      const dl = new Date(r.deadline).getTime();
      if (dl < now) st.late++;
      if (dl <= lim) st.minutes += r.estimated_minutes || 0;
    }
  });
  const students = [...stu.values()].map((x) => ({ ...x, over: x.minutes > thr })).sort((a, b) => b.undone - a.undone || a.name.localeCompare(b.name, 'vi'));
  const assignments = [...asg.values()].filter((a) => a.undone > 0).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  return { students, assignments, n: stu.size };
}
function statsText(c, d, thr) {
  const t = new Date(), stamp = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} ${dm(t)}/${t.getFullYear()}`;
  const lines = [`THỐNG KÊ TÌNH TRẠNG LÀM BÀI · Lớp ${c.cls.name} · cập nhật ${stamp}`, ''];
  if (d.assignments.length) d.assignments.forEach((a) => lines.push(`Ngày ${dm(a.deadline)} có ${a.undone} / ${a.total} bạn chưa hoàn thành bài ${a.title}${a.subject ? ' (' + a.subject + ')' : ''}${new Date(a.deadline) < t ? ' – đã quá hạn' : ''}`));
  else lines.push('Hiện không có bài nào còn bạn chưa hoàn thành.');
  lines.push('', `Bảng (quá tải: tổng thời gian còn lại của các bài hạn trong ${WINDOW_DAYS} ngày tới vượt ${thr} phút)`, 'Tên | Số bài chưa hoàn thành | Quá tải');
  d.students.forEach((s) => lines.push(`${s.name} | ${s.undone} | ${s.over ? 'Có (' + s.minutes + ' phút)' : 'Không'}`));
  return lines.join('\n');
}
function statsCsv(c, d, thr) {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"', out = [];
  out.push(['Lớp', c.cls.name].map(q).join(','), '');
  out.push(['Tên', 'Mã học sinh', 'Số bài chưa hoàn thành', 'Số bài trễ hạn', `Phút còn lại (hạn ${WINDOW_DAYS} ngày tới)`, `Quá tải (>${thr} phút)`].map(q).join(','));
  d.students.forEach((s) => out.push([s.name, s.code, s.undone, s.late, s.minutes, s.over ? 'Có' : 'Không'].map(q).join(',')));
  out.push('', ['Bài tập', 'Môn', 'Hạn nộp', 'Chưa hoàn thành', 'Tổng số học sinh'].map(q).join(','));
  d.assignments.forEach((a) => out.push([a.title, a.subject, new Date(a.deadline).toLocaleString('vi-VN'), a.undone, a.total].map(q).join(',')));
  return '﻿' + out.join('\r\n');
}
TABS.stats = (el, c) => {
  el.innerHTML = '<div id="sBody"></div>';
  ui.load($('#sBody'), () => A.rpc('get_class_progress', { p_class_id: c.cls.id }), (rows) => {
    const B = $('#sBody');
    const draw = () => {
      const d = analyse(rows, S.thr), over = d.students.filter((s) => s.over).length;
      B.innerHTML = `<div class="toolbar"><button id="scopy">Sao chép văn bản</button><button class="secondary" id="scsv">Tải CSV (Excel)</button><label style="margin-left:auto">Ngưỡng quá tải (phút) <input id="sthr" type="number" min="30" step="30" value="${S.thr}" style="width:90px"></label></div>
        <div class="footer-note">Chỉ tính các bài giáo viên giao cho lớp. "Quá tải" = tổng thời gian ước tính còn lại của các bài chưa hoàn thành có hạn trong ${WINDOW_DAYS} ngày tới (hoặc đã trễ) vượt ngưỡng.</div>
        <div class="card" style="margin:12px 0"><h3>Bài chưa có đủ người hoàn thành</h3>${d.assignments.length ? d.assignments.map((a) => `<div class="item"><div class="item-main"><div class="item-title">Ngày ${dm(a.deadline)} có ${a.undone} / ${a.total} bạn chưa hoàn thành bài ${esc(a.title)}${a.subject ? ' <span class="muted">(' + esc(a.subject) + ')</span>' : ''}${new Date(a.deadline) < new Date() ? ' <span class="badge red">Quá hạn</span>' : ''}</div></div></div>`).join('') : ui.empty('Tất cả mọi người đã hoàn thành bài.')}</div>
        <div class="card"><h3>Từng học sinh <span class="muted">(${over} bạn quá tải / ${d.n})</span></h3>${d.students.length ? `<div class="table-wrap"><table><thead><tr><th>Tên</th><th>Số bài chưa hoàn thành</th><th>Trễ hạn</th><th>Quá tải</th></tr></thead><tbody>${d.students.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.undone}</td><td>${s.late || '—'}</td><td>${s.over ? `<span class="badge red">Quá tải · ${hm(s.minutes)}</span>` : '<span class="muted">Không</span>'}</td></tr>`).join('')}</tbody></table></div>` : ui.empty('Lớp chưa có học sinh hoặc chưa có bài tập.')}</div>`;
      $('#sthr').onchange = (e) => { const v = Math.max(30, parseInt(e.target.value, 10) || 240); S.thr = v; draw(); };
      $('#scopy').onclick = async () => { const t = statsText(c, d, S.thr);
        try { await navigator.clipboard.writeText(t); SL.toast('Đã sao chép. Hãy dán vào tin nhắn gửi giáo viên.'); }
        catch { SL.modal('Sao chép văn bản', `<textarea rows="12" style="width:100%" readonly id="stxt">${esc(t)}</textarea>`, 'Đóng'); $('#modalSubmit').onclick = () => SL.closeModal(); const ta = $('#stxt'); ta.focus(); ta.select(); } };
      $('#scsv').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([statsCsv(c, d, S.thr)], { type: 'text/csv;charset=utf-8' }));
        a.download = `thong-ke-${c.cls.name.replace(/[^\w\-]+/g, '_')}-${SL.localDay(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    };
    draw();
  });
};

/* ---------- Báo cáo tuần ---------- */
TABS.reports = (el, c, refresh) => {
  const P = c.perms, wk = K.week, end = addDays(wk, 6);
  el.innerHTML = `<div class="toolbar"><button class="small secondary" id="rprev">‹ Tuần trước</button><b>${wk} → ${end}</b><button class="small secondary" id="rnext">Tuần sau ›</button>${P.editReports ? '<button id="rnew">Lập / cập nhật báo cáo tuần này</button>' : ''}</div><div id="rList"></div>`;
  $('#rprev').onclick = () => { K.week = addDays(wk, -7); refresh(); }; $('#rnext').onclick = () => { K.week = addDays(wk, 7); refresh(); };
  const weekData = async () => { // số liệu thật tính từ dữ liệu máy chủ mà người dùng được phép đọc
    const duty = await A.run(sb.from('duty_schedules').select('status').eq('class_id', c.cls.id).gte('duty_date', wk).lte('duty_date', end));
    const asg = SL.state().tasks.filter((t) => t.classId === c.cls.id && t.assignmentId && t.dueAt >= wk && t.dueAt < addDays(end, 1));
    return { homework: { assignments: new Set(asg.map((t) => t.assignmentId)).size, assigned: asg.length, completed: asg.filter((t) => t.status === 'done').length },
      duty: { total: duty.length, approved: duty.filter((d) => d.status === 'approved').length, submitted: duty.filter((d) => d.status === 'submitted').length, pending: duty.filter((d) => d.status === 'pending' || d.status === 'rejected').length } };
  };
  ui.load($('#rList'), () => A.run(sb.from('class_weekly_reports').select('*').eq('class_id', c.cls.id).order('week_start', { ascending: false }).limit(20)), (rows) => {
    $('#rList').innerHTML = rows.length ? rows.map((r) => `<div class="card" style="margin-bottom:10px"><h3>Tuần ${esc(r.week_start)} → ${esc(r.week_end)}</h3><dl class="kv"><dt>Chuyên cần</dt><dd>Có mặt ${r.attendance_summary?.present ?? '—'} · Vắng ${r.attendance_summary?.absent ?? '—'}</dd><dt>Bài tập</dt><dd>${r.homework_summary ? `${r.homework_summary.completed ?? 0}/${r.homework_summary.assigned ?? 0} lượt hoàn thành (${r.homework_summary.assignments ?? 0} bài)` : '—'}</dd><dt>Trực nhật</dt><dd>${r.duty_summary ? `${r.duty_summary.approved ?? 0}/${r.duty_summary.total ?? 0} đã duyệt` : '—'}</dd><dt>Sự kiện</dt><dd>${esc(r.event_summary?.text || '—')}</dd><dt>Nhận xét</dt><dd>${esc(r.comments || '—')}</dd></dl><div class="footer-note">Lập bởi ${nm(c, r.created_by)} · ${SL.fmtDate(r.updated_at || r.created_at)}</div></div>`).join('') : ui.empty('Chưa có báo cáo tuần nào.');
    rows.__ = rows;
    $('#rnew')?.addEventListener('click', async () => {
      let wd; try { wd = await weekData(); } catch (e) { return SL.toast(A.toApiError(e).message); }
      const ex = rows.find((r) => r.week_start === wk);
      ui.form(`Báo cáo tuần ${wk}`, `<form><div class="notice">Số liệu bài tập/trực nhật được tính từ dữ liệu hệ thống: bài tập ${wd.homework.completed}/${wd.homework.assigned} lượt hoàn thành; trực nhật ${wd.duty.approved}/${wd.duty.total} đã duyệt.</div><div class="form-grid"><div><label>Có mặt</label><input type="number" min="0" name="pr" value="${ex?.attendance_summary?.present ?? ''}"></div><div><label>Vắng</label><input type="number" min="0" name="ab" value="${ex?.attendance_summary?.absent ?? ''}"></div><div class="full"><label>Sự kiện trong tuần</label><textarea name="ev" rows="2">${esc(ex?.event_summary?.text || '')}</textarea></div><div class="full"><label>Nhận xét</label><textarea name="cm" rows="3">${esc(ex?.comments || '')}</textarea></div></div></form>`, 'Lưu báo cáo',
        async (root) => { const v = Object.fromEntries(new FormData(root.querySelector('form')).entries());
          const row = { attendance_summary: { present: v.pr === '' ? null : +v.pr, absent: v.ab === '' ? null : +v.ab }, homework_summary: wd.homework, duty_summary: wd.duty, event_summary: { text: v.ev.trim() }, comments: v.cm.trim() || null };
          if (ex) { const r = await A.run(sb.from('class_weekly_reports').update(row).eq('id', ex.id).select('id')); if (!r.length) throw new A.ApiError('unauthorized', 'Bạn không có quyền sửa báo cáo này.'); }
          else await A.run(sb.from('class_weekly_reports').insert({ class_id: c.cls.id, week_start: wk, week_end: end, created_by: c.me, ...row })); refresh(); }, 'Đã lưu báo cáo tuần.');
    });
  });
};

/* ---------- Ủy quyền ---------- */
TABS.deleg = (el, c, refresh) => {
  const P = c.perms, now = Date.now();
  const mineRoles = c.officers.filter((o) => P.adm || P.home || o.user_id === c.me);
  el.innerHTML = `${P.delegate && mineRoles.length ? '<div class="toolbar"><button id="dnew">+ Ủy quyền chức vụ</button></div>' : ''}${c.delegs.length ? c.delegs.map((d) => { const act = !d.revoked_at && new Date(d.starts_at) <= now && now < new Date(d.ends_at), exp = !d.revoked_at && now >= new Date(d.ends_at);
    return `<div class="item"><div class="item-main"><div class="item-title">${ROLE[d.officer_role] || ''}: ${nm(c, d.delegated_from)} → ${nm(c, d.delegated_to)} <span class="badge ${act ? 'green' : d.revoked_at ? 'red' : ''}">${act ? 'Đang hiệu lực' : d.revoked_at ? 'Đã thu hồi' : exp ? 'Hết hạn' : 'Chưa bắt đầu'}</span></div><div class="item-meta">${SL.fmtDate(d.starts_at)} → ${SL.fmtDate(d.ends_at)}${d.reason ? ' · ' + esc(d.reason) : ''}</div></div>${!d.revoked_at && !exp && (P.adm || P.home || d.delegated_from === c.me) ? `<button class="small danger" data-rv="${d.delegation_id}">Thu hồi</button>` : ''}</div>`; }).join('') : ui.empty('Chưa có ủy quyền nào.')}`;
  $('#dnew')?.addEventListener('click', () => ui.form('Ủy quyền chức vụ', `<form><label>Chức vụ *</label><select name="o">${mineRoles.map((o) => `<option value="${o.id}">${ROLE[o.role]} — ${nm(c, o.user_id)}${o.team_id ? ' (' + esc(c.teams.find((t) => t.id === o.team_id)?.name || '') + ')' : ''}</option>`).join('')}</select><label>Người nhận *</label><select name="u" required>${memberOpts(c)}</select><div class="form-grid"><div><label>Từ *</label><input type="datetime-local" name="s" required></div><div><label>Đến *</label><input type="datetime-local" name="e" required></div></div><label>Lý do</label><input name="r" maxlength="200"></form>`, 'Ủy quyền',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      await A.rpc('delegate_class_officer', { p_officer_role_id: v.o, p_delegated_to: v.u, p_starts_at: toIso(v.s), p_ends_at: toIso(v.e), p_reason: v.r.trim() || null }); refresh(); }, 'Đã ủy quyền.'));
  el.querySelectorAll('[data-rv]').forEach((b) => (b.onclick = async () => { if (!confirm('Thu hồi ủy quyền này?')) return; b.disabled = true;
    try { await A.rpc('revoke_officer_delegation', { p_delegation_id: b.dataset.rv }); SL.toast('Đã thu hồi.'); refresh(); } catch (e) { SL.toast(A.toApiError(e).message); b.disabled = false; } }));
};

/* ---------------- Trang Dữ liệu (admin / giáo viên / cán bộ lớp) ---------------- */
const DH = { classId: '', week: null, thr: 240 };
const mondayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const dayStr = (d) => SL.localDay(d);
const WD = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
async function myDataClasses() {
  const me = SL.current(), all = SL.state().classes;
  if (SL.isAdmin()) return all;
  let ids = new Set(all.filter((c) => c.homeroomId === me.id || (c.teacherIds || []).includes(me.id)).map((c) => c.id));
  try { (await A.run(A.sb.from('class_officer_roles').select('class_id,role').eq('user_id', me.id).is('ended_at', null).in('role', ['class_president', 'academic_vp']))).forEach((r) => ids.add(r.class_id)); } catch (e) { /* bỏ qua */ }
  return all.filter((c) => ids.has(c.id));
}
const csvCell = (v) => { const t = String(v ?? ''); return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const csvOf = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
function downloadCsv(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const bar = (label, value, max, color, note) => `<div class="dh-row"><span class="dh-lb">${label}</span><span class="dh-track"><span class="dh-fill" style="width:${max ? Math.max(value ? 2 : 0, Math.round((100 * value) / max)) : 0}%;background:${color}"></span></span><span class="dh-val">${note}</span></div>`;
SL.pages.datahub = {
  title: 'Dữ liệu', sub: 'Biểu đồ học tập, quá tải và bài về nhà — kèm xuất file dữ liệu.',
  async render(el) {
    el.innerHTML = ui.skeleton ? ui.skeleton() : 'Đang tải…';
    const classes = await myDataClasses();
    if (!classes.length && !SL.isAdmin()) { el.innerHTML = '<div class="notice red"><b>Không đủ quyền.</b> Trang này dành cho quản trị viên, giáo viên và cán bộ lớp.</div>'; return; }
    if (!DH.week) DH.week = mondayOf(new Date());
    if (!SL.isAdmin() && !classes.some((c) => c.id === DH.classId)) DH.classId = classes[0].id;
    const draw = () => {
      const ws = dayStr(DH.week), we = new Date(DH.week); we.setDate(we.getDate() + 6);
      el.innerHTML = `<div class="toolbar dh-bar"><select id="dhc">${SL.isAdmin() ? '<option value="">Toàn hệ thống</option>' : ''}${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><span class="dh-week"><button class="small secondary" id="dhp" aria-label="Tuần trước">‹</button><b>${ws.slice(5)} → ${dayStr(we).slice(5)}</b><button class="small secondary" id="dhn" aria-label="Tuần sau">›</button></span><label class="muted" style="display:flex;align-items:center;gap:6px">Quá tải khi còn &gt; <input id="dht" type="number" min="30" max="1440" step="30" value="${DH.thr}" style="width:84px"> phút</label></div><div id="dhBody"></div>`;
      $('#dhc').value = DH.classId;
      $('#dhc').onchange = (e) => { DH.classId = e.target.value; draw(); };
      $('#dhp').onclick = () => { DH.week.setDate(DH.week.getDate() - 7); draw(); };
      $('#dhn').onclick = () => { DH.week.setDate(DH.week.getDate() + 7); draw(); };
      $('#dht').onchange = (e) => { DH.thr = Math.min(1440, Math.max(30, +e.target.value || 240)); draw(); };
      ui.load($('#dhBody'), () => A.rpc('get_analytics', { p_class_id: DH.classId || null, p_week_start: ws, p_overload_minutes: DH.thr }), (d) => {
        const maxMin = Math.max(1, ...d.daily.map((x) => x.minutes)), hw = d.homework, n = d.students || 0, hwMax = Math.max(1, n);
        const best = d.daily.reduce((a, x) => (x.minutes > a.minutes ? x : a), d.daily[0]), low = d.daily.reduce((a, x) => (x.minutes < a.minutes ? x : a), d.daily[0]);
        const total = d.daily.reduce((a, x) => a + x.minutes, 0);
        $('#dhBody').innerHTML = `<div class="grid">
          <div class="card span-4"><div class="stat-label">Số học sinh</div><div class="stat">${n}</div></div>
          <div class="card span-4"><div class="stat-label">Học sinh quá tải</div><div class="stat">${d.overload.count} <span class="muted" style="font-size:16px">(${d.overload.pct}%)</span></div></div>
          <div class="card span-4"><div class="stat-label">Tổng thời gian học tuần này</div><div class="stat">${Math.round(total / 60 * 10) / 10} giờ</div></div>
          <div class="card span-12"><h2>Biểu đồ tuần: ngày nào học nhiều / ít</h2>${total ? `<p class="muted">Nhiều nhất: <b>${WD[d.daily.indexOf(best)]}</b> (${best.minutes} phút) · Ít nhất: <b>${WD[d.daily.indexOf(low)]}</b> (${low.minutes} phút)</p>` : '<p class="muted">Tuần này chưa có thời gian học nào được ghi nhận.</p>'}
            ${d.daily.map((x, i) => bar(`${WD[i]} ${x.day.slice(8)}/${x.day.slice(5, 7)}`, x.minutes, maxMin, 'var(--brand)', `${x.minutes} phút · ${x.active} học sinh`)).join('')}</div>
          <div class="card span-6"><h2>Biểu đồ quá tải</h2><p class="muted">Quá tải = còn hơn ${d.threshold} phút bài chưa xong đến hạn trong 3 ngày tới (hoặc đã quá hạn).</p>
            ${bar('Quá tải', d.overload.count, hwMax, 'var(--red)', `${d.overload.count}/${n} học sinh · ${d.overload.pct}%`)}${bar('Bình thường', n - d.overload.count, hwMax, 'var(--green)', `${n - d.overload.count}/${n}`)}
            <p class="muted">Tổng khối lượng còn lại: <b>${d.overload.total_remaining}</b> phút.</p></div>
          <div class="card span-6"><h2>Bài về nhà</h2>
            ${bar('Quá hạn', hw.overdue, hwMax, 'var(--red)', `${hw.overdue} học sinh`)}${bar('Làm đủ bài', hw.all_done, hwMax, 'var(--green)', `${hw.all_done} học sinh`)}${bar('Đang làm', hw.in_progress, hwMax, 'var(--amber)', `${hw.in_progress} học sinh`)}${bar('Chưa có bài', hw.no_assignments, hwMax, 'var(--line)', `${hw.no_assignments} học sinh`)}</div>
          <div class="card span-12"><div class="section-head"><h2>Chi tiết từng học sinh</h2><div><button class="small" id="dhx1">Xuất CSV học sinh</button> <button class="small secondary" id="dhx2">Xuất CSV theo ngày</button></div></div>
            ${d.per_student.length ? `<div class="table-wrap"><table><thead><tr><th>Học sinh</th><th>Mã HS</th><th>Học tuần này (phút)</th><th>Còn lại (phút)</th><th>Bài giao</th><th>Đã xong</th><th>Quá hạn</th><th></th></tr></thead><tbody>${d.per_student.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.code || '')}</td><td>${s.week_minutes}</td><td>${s.remaining_minutes}</td><td>${s.assigned}</td><td>${s.done}</td><td>${s.overdue}</td><td>${s.overloaded ? '<span class="badge red">Quá tải</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : ui.empty('Chưa có học sinh nào.')}</div></div>`;
        const cname = (classes.find((c) => c.id === DH.classId)?.name || 'he-thong').replace(/[^\w\-]+/g, '_'), tag = `${cname}-${ws}`;
        const exp = async (kind, rows, file) => { try { await A.rpc('log_data_export', { p_class_id: DH.classId || null, p_kind: kind }); } catch (e) { return SL.toast(A.toApiError(e).message); } downloadCsv(file, csvOf(rows)); };
        $('#dhx1').onclick = () => exp('students', [['Học sinh', 'Mã HS', 'Học tuần này (phút)', 'Còn lại (phút)', 'Bài giao', 'Đã xong', 'Quá hạn', 'Quá tải'], ...d.per_student.map((s) => [s.name, s.code, s.week_minutes, s.remaining_minutes, s.assigned, s.done, s.overdue, s.overloaded ? 'có' : 'không'])], `du-lieu-hoc-sinh-${tag}.csv`);
        $('#dhx2').onclick = () => exp('daily', [['Ngày', 'Phút học', 'Số học sinh có học'], ...d.daily.map((x) => [x.day, x.minutes, x.active])], `du-lieu-theo-ngay-${tag}.csv`);
      });
    };
    draw();
  }
};
})();
