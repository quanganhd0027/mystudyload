/* StudyLoad · pages-class.js — Quản lý lớp: thành viên, tổ, cán bộ, nhiệm vụ cán bộ, trực nhật, thông báo, báo cáo tuần, ủy quyền.
   Mọi kiểm tra quyền thật nằm ở máy chủ (RLS + hàm RPC); giao diện chỉ ẩn/hiện nút cho gọn. */
(() => {
'use strict';
const SL = window.SL, A = window.SLApi, { esc, ui, $ } = SL, { toIso, fmtBytes } = SL.util, sb = A.sb;
const ROLE = { class_president: 'Lớp trưởng', academic_vp: 'Lớp phó học tập', labor_vp: 'Lớp phó lao động', team_leader: 'Tổ trưởng' };
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
  const me = SL.current().id, now = Date.now();
  const members = cls.studentIds.map((s) => ({ student_id: s }));
  const activeDeleg = (delegs || []).filter((d) => !d.revoked_at && new Date(d.starts_at) <= now && now < new Date(d.ends_at));
  const direct = officers.filter((o) => o.user_id === me).map((o) => o.role);
  const delegated = activeDeleg.filter((d) => d.delegated_to === me).map((d) => d.officer_role);
  const roles = [...new Set([...direct, ...delegated])], has = (...r) => r.some((x) => roles.includes(x));
  const adm = SL.isAdmin(), home = cls.homeroomId === me, tch = cls.teacherIds.includes(me);
  const lead = officers.some((o) => o.role === 'team_leader' && o.user_id === me);
  const perms = { adm, home, tch, roles, direct, manageMembers: adm, manageTeams: adm || home || has('class_president'), assignOfficers: adm || home,
    createOT: adm || home || roles.length > 0, manageDuty: adm || home || has('labor_vp'), postAnn: adm || home || has('class_president'),
    viewReports: adm || home || has('class_president'), editReports: adm || home || has('class_president'),
    assign: adm || has('academic_vp') || tch, delegate: adm || home || direct.length > 0, lead };
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
    const list = myClasses();
    if (!list.length) { el.innerHTML = ui.empty(SL.isStudent() ? 'Bạn chưa thuộc lớp nào. Hãy liên hệ quản trị viên để được thêm vào lớp.' : 'Bạn chưa được phân công lớp nào. Hãy liên hệ quản trị viên.'); return; }
    let id = SL.selectedClass || K.classId; SL.selectedClass = null;
    if (!list.find((c) => c.id === id)) id = list[0].id; K.classId = id;
    el.innerHTML = `<div class="toolbar"><select id="kcls">${list.map((c) => `<option value="${c.id}" ${c.id === id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div id="kbody"></div>`;
    $('#kcls').onchange = (e) => { K.classId = e.target.value; K.tab = 'overview'; SL.pages.classmgmt.render(el); };
    drawTab();
  }
};
function drawTab() {
  const body = $('#kbody'); if (!body) return;
  const cls = SL.state().classes.find((c) => c.id === K.classId);
  ui.load(body, () => loadCtx(cls), (ctx) => {
    const P = ctx.perms;
    const tabs = [['overview', 'Tổng quan'], ['members', 'Thành viên'], ['teams', 'Tổ'], ['officers', 'Cán bộ lớp'], ['otasks', 'Nhiệm vụ cán bộ'], ['duty', 'Trực nhật'], ['ann', 'Thông báo lớp'], ...(P.viewReports ? [['reports', 'Báo cáo tuần']] : []), ['deleg', 'Ủy quyền']];
    if (!tabs.find((t) => t[0] === K.tab)) K.tab = 'overview';
    body.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button data-k="${k}" class="${K.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="ktab"></div>`;
    body.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { K.tab = b.dataset.k; drawTab(); }));
    TABS[K.tab]($('#ktab'), ctx, drawTab);
  });
}
const TABS = {};
const formErr = (e) => { throw e; };

/* ---------- Tổng quan ---------- */
TABS.overview = (el, c) => {
  const P = c.perms, subs = SL.subjects(), byT = {}; (c.cls.subjectTeachers || []).forEach((r) => (byT[r.teacherId] ||= []).push(subs.find((s) => s.id === r.subjectId)?.name || ''));
  const myRoles = P.adm ? 'Quản trị viên' : P.home ? 'Giáo viên chủ nhiệm' : P.tch ? 'Giáo viên bộ môn' : P.roles.length ? P.roles.map((r) => ROLE[r]).join(', ') : 'Học sinh';
  el.innerHTML = `<div class="grid"><div class="card span-6"><h2>${esc(c.cls.name)}</h2><dl class="kv"><dt>Năm học</dt><dd>${esc(c.cls.academicYear || '—')}</dd><dt>Mô tả</dt><dd>${esc(c.cls.description || '—')}</dd><dt>Chủ nhiệm</dt><dd>${c.cls.homeroomId ? nm(c, c.cls.homeroomId) : '<span class="muted">Chưa có</span>'}</dd><dt>Sĩ số</dt><dd>${c.members.length}</dd><dt>Số tổ</dt><dd>${c.teams.length}</dd><dt>Vai trò của bạn</dt><dd>${esc(myRoles)}</dd></dl></div>
    <div class="card span-6"><h2>Giáo viên bộ môn</h2>${Object.keys(byT).length ? Object.entries(byT).map(([t, s]) => `<div class="item"><div class="item-title">${nm(c, t)}</div><div class="item-meta">${esc(s.join(', '))}</div></div>`).join('') : ui.empty('Chưa phân công giáo viên bộ môn.')}${P.assign ? `<div style="margin-top:12px"><button class="small" id="asgn">Giao nhiệm vụ cho cả lớp</button></div>` : ''}</div></div>`;
  $('#asgn')?.addEventListener('click', () => SL.assignToClass(c.cls.id));
};

/* ---------- Thành viên (chỉ xem; quản trị viên thêm/xóa ở mục Quản lý lớp học) ---------- */
TABS.members = (el, c) => {
  const q = (document.getElementById('mq') || {}).value || '';
  el.innerHTML = `<div class="toolbar"><input id="mq" placeholder="Tìm học sinh…"></div><div id="mList"></div>${c.perms.manageMembers ? '<p class="footer-note">Thêm/xóa học sinh: vào "Quản lý lớp học" → Học sinh.</p>' : ''}`;
  const draw = () => { const s = $('#mq').value.toLowerCase(), rows = c.members.filter((m) => (c.names[m.student_id] || '').toLowerCase().includes(s));
    $('#mList').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Chức vụ</th><th>Tổ</th></tr></thead><tbody>${rows.map((m) => {
      const o = c.officers.filter((x) => x.user_id === m.student_id).map((x) => ROLE[x.role]).join(', '), t = c.tmembers.filter((x) => x.student_id === m.student_id).map((x) => c.teams.find((tt) => tt.id === x.team_id)?.name).filter(Boolean).join(', ');
      return `<tr><td>${nm(c, m.student_id)}</td><td>${esc(o) || '—'}</td><td>${esc(t) || '—'}</td></tr>`; }).join('')}</tbody></table></div>` : ui.empty('Không có học sinh phù hợp.'); };
  $('#mq').oninput = draw; draw();
};

/* ---------- Tổ ---------- */
TABS.teams = (el, c, refresh) => {
  const P = c.perms;
  el.innerHTML = `${P.manageTeams ? '<div class="toolbar"><button id="tnew">+ Tạo tổ</button></div>' : ''}${c.teams.length ? c.teams.map((t) => {
    const mem = c.tmembers.filter((m) => m.team_id === t.id), lead = c.officers.find((o) => o.role === 'team_leader' && o.team_id === t.id), isMem = mem.some((m) => m.student_id === c.me);
    const canEdit = P.adm || P.home || P.roles.includes('class_president') || (lead && lead.user_id === c.me);
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

/* ---------- Cán bộ lớp ---------- */
TABS.officers = (el, c, refresh) => {
  const P = c.perms;
  el.innerHTML = `${P.assignOfficers ? '<div class="toolbar"><button id="onew">+ Bổ nhiệm cán bộ</button></div>' : ''}${c.officers.length ? `<div class="table-wrap"><table><thead><tr><th>Chức vụ</th><th>Học sinh</th><th>Tổ</th><th>Từ ngày</th><th></th></tr></thead><tbody>${c.officers.map((o) => `<tr><td>${ROLE[o.role]}</td><td>${nm(c, o.user_id)}</td><td>${esc(c.teams.find((t) => t.id === o.team_id)?.name || '—')}</td><td>${SL.fmtDate(o.assigned_at)}</td><td>${P.assignOfficers ? `<button class="small danger" data-end="${o.id}">Miễn nhiệm</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ui.empty('Lớp chưa có cán bộ nào.')}`;
  $('#onew')?.addEventListener('click', () => {
    ui.form('Bổ nhiệm cán bộ', `<form><label>Chức vụ *</label><select name="r" id="orole">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><label>Học sinh *</label><select name="u" required>${memberOpts(c)}</select><div id="otw" class="hidden"><label>Tổ *</label><select name="t">${teamOpts(c)}</select></div></form>`, 'Bổ nhiệm',
      async (root) => { const v = Object.fromEntries(new FormData(root.querySelector('form')).entries());
        if (v.r === 'team_leader' && !v.t) throw new A.ApiError('validation', 'Tổ trưởng cần chọn tổ.');
        await A.rpc('assign_class_officer', { p_class_id: c.cls.id, p_user_id: v.u, p_role: v.r, p_team_id: v.r === 'team_leader' ? v.t : null }); refresh(); }, 'Đã bổ nhiệm.');
    const tg = () => $('#otw').classList.toggle('hidden', $('#orole').value !== 'team_leader'); $('#orole').onchange = tg; tg();
  });
  el.querySelectorAll('[data-end]').forEach((b) => (b.onclick = async () => { if (!confirm('Miễn nhiệm cán bộ này?')) return; b.disabled = true;
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
  $('#dnew')?.addEventListener('click', () => ui.form('Xếp lịch trực', `<form><div class="form-grid"><div><label>Học sinh *</label><select name="s" required>${memberOpts(c)}</select></div><div><label>Ngày *</label><input type="date" name="d" required value="${wk}"></div><div><label>Công việc *</label><input name="t" required maxlength="60" placeholder="Quét lớp, lau bảng…"></div><div><label>Tổ (nếu có)</label><select name="tm">${teamOpts(c, '— Không —')}</select></div><div class="full"><label>Ghi chú</label><input name="n" maxlength="200"></div></div></form>`, 'Xếp lịch',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      await A.rpc('create_duty_schedule', { p_class_id: c.cls.id, p_student_id: v.s, p_duty_date: v.d, p_duty_type: v.t.trim(), p_team_id: v.tm || null, p_note: v.n.trim() || null }); refresh(); }, 'Đã xếp lịch trực.'));
};

/* ---------- Thông báo lớp ---------- */
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
})();
