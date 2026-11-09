/* StudyLoad · pages-admin.js — Quản trị: tổng quan, người dùng, yêu cầu giáo viên, lớp, môn học, nhật ký kiểm toán */
(() => {
'use strict';
const SL = window.SL, A = window.SLApi, { esc, ui, $ } = SL, { REQ_STATUS } = SL.util;
const PAGE = 20;
const norm = (s) => String(s || '').toLowerCase();
const pager = (el, page, total, size, go) => {
  const pages = Math.max(1, Math.ceil(total / size));
  el.innerHTML = `<span>Trang ${page + 1}/${pages} · ${total} bản ghi</span><button class="small secondary" ${page <= 0 ? 'disabled' : ''} data-p="-1">‹ Trước</button><button class="small secondary" ${page + 1 >= pages ? 'disabled' : ''} data-p="1">Sau ›</button>`;
  el.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => go(page + +b.dataset.p)));
};
const guardAdmin = (el) => { if (SL.isAdmin()) return true; el.innerHTML = '<div class="notice red"><b>Không đủ quyền.</b> Chỉ quản trị viên được xem trang này.</div>'; return false; };
const listUsers = async (q) => { let out = []; for (let off = 0; ; off += 100) { const r = await A.rpc('admin_list_users', { search_text: q || '', page_size: 100, page_offset: off }); out = out.concat(r || []); if (!r || r.length < 100) break; } return out; };
const userMap = async (ids) => { const m = {}; if (ids.length) (await A.rpc('admin_user_lookup', { p_ids: ids })).forEach((u) => (m[u.user_id] = u)); return m; };

/* ---------------- Tổng quan quản trị ---------------- */
SL.adminDashboard = (el) => ui.load(el, async () => {
  const [st, logs] = await Promise.all([A.rpc('admin_stats'), A.run(A.sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(8))]);
  return { st, logs };
}, ({ st, logs }) => {
  const card = (n, l, go) => `<div class="card span-3"><div class="stat-label">${l}</div><div class="stat">${n}</div>${go ? `<button class="small secondary" data-goto="${go}">Xem</button>` : ''}</div>`;
  el.innerHTML = `<div class="grid">${card(st.accounts, 'Tổng tài khoản', 'users')}${card(st.students, 'Học sinh')}${card(st.teachers, 'Giáo viên')}${card(st.admins, 'Quản trị viên')}
    ${card(st.banned, 'Tài khoản bị khóa', 'users')}${card(st.classes, 'Lớp học', 'adminclasses')}${card(st.subjects, 'Môn học', 'subjects')}${card(st.pending_requests, 'Yêu cầu giáo viên chờ duyệt', 'users')}
    <div class="card span-12"><div class="section-head"><h2>Hoạt động gần đây</h2><button class="small secondary" data-goto="audit">Xem toàn bộ</button></div>
    ${logs.length ? logs.map((l) => `<div class="item"><div class="item-main"><div class="item-title">${esc(l.action)} · ${esc(l.target_table || '')}</div><div class="item-meta">${SL.fmtDate(l.created_at)}</div></div></div>`).join('') : ui.empty('Chưa có hoạt động nào.')}</div></div>`;
  el.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => SL.go(b.dataset.goto)));
});

/* ---------------- Người dùng + yêu cầu giáo viên ---------------- */
const U = { tab: 'accounts', page: 0, q: '', role: 'all', status: 'all', rstatus: 'pending', rpage: 0 };
SL.pages.users = {
  title: 'Quản lý người dùng', sub: 'Tìm kiếm, đổi vai trò, khóa/mở khóa tài khoản và duyệt yêu cầu giáo viên.',
  render(el) {
    if (!guardAdmin(el)) return;
    el.innerHTML = `<div class="subtabs"><button data-t="accounts" class="${U.tab === 'accounts' ? 'active' : ''}">Tài khoản</button><button data-t="requests" class="${U.tab === 'requests' ? 'active' : ''}">Yêu cầu giáo viên</button></div><div id="uBody"></div>`;
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { U.tab = b.dataset.t; SL.pages.users.render(el); }));
    (U.tab === 'accounts' ? drawAccounts : drawRequests)($('#uBody'));
  }
};
function drawAccounts(el) {
  el.innerHTML = `<div class="toolbar"><input id="uq" placeholder="Tìm tên, tài khoản, email…" value="${esc(U.q)}"><select id="ur"><option value="all">Mọi vai trò</option><option value="student">Học sinh</option><option value="teacher">Giáo viên</option><option value="admin">Quản trị viên</option></select><select id="us"><option value="all">Mọi trạng thái</option><option value="active">Đang hoạt động</option><option value="banned">Bị khóa</option></select><button class="secondary" id="uclear">Xóa lọc</button></div><div id="uList"></div><div class="pager" id="uPager"></div>`;
  $('#ur').value = U.role; $('#us').value = U.status;
  let t; $('#uq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { U.q = e.target.value; U.page = 0; load(); }, 350); };
  $('#ur').onchange = (e) => { U.role = e.target.value; U.page = 0; load(); };
  $('#us').onchange = (e) => { U.status = e.target.value; U.page = 0; load(); };
  $('#uclear').onclick = () => { Object.assign(U, { q: '', role: 'all', status: 'all', page: 0 }); drawAccounts(el); };
  const load = () => ui.load($('#uList'), async () => {
    let rows = await listUsers(U.q.trim());
    if (U.role !== 'all') rows = rows.filter((u) => u.role === U.role);
    if (U.status !== 'all') rows = rows.filter((u) => u.is_banned === (U.status === 'banned'));
    return rows;
  }, (rows) => {
    const me = SL.profile().id, data = rows.slice(U.page * PAGE, U.page * PAGE + PAGE);
    $('#uList').innerHTML = data.length ? `<div class="table-wrap"><table><thead><tr><th>Tên</th><th>Tài khoản / Email</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${data.map((u) => `<tr><td>${esc(u.display_name || '')}</td><td>${esc(u.username)}<div class="muted">${esc(u.email || '')}</div></td><td><span class="badge">${SL.roleLabel(u.role)}</span></td><td>${u.is_banned ? '<span class="badge red">Bị khóa</span>' : '<span class="badge green">Hoạt động</span>'}</td><td class="actions"><button class="small secondary" data-edit="${u.user_id}">Sửa</button> <button class="small secondary" data-role="${u.user_id}" ${u.user_id === me ? 'disabled title="Không thể tự đổi vai trò của chính mình"' : ''}>Đổi vai trò</button> <button class="small ${u.is_banned ? '' : 'danger'}" data-lock="${u.user_id}" ${u.user_id === me ? 'disabled' : ''}>${u.is_banned ? 'Mở khóa' : 'Khóa'}</button></td></tr>`).join('')}</tbody></table></div>` : ui.empty('Không có tài khoản phù hợp bộ lọc.');
    pager($('#uPager'), U.page, rows.length, PAGE, (p) => { U.page = p; load(); });
    const find = (id) => rows.find((x) => x.user_id === id);
    el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => editUser(find(b.dataset.edit), load)));
    el.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => changeRole(find(b.dataset.role), load)));
    el.querySelectorAll('[data-lock]').forEach((b) => (b.onclick = () => toggleLock(find(b.dataset.lock), load)));
  });
  load();
}
function editUser(u, reload) {
  ui.form('Sửa tài khoản', `<form><label>Họ tên *</label><input name="n" required maxlength="60" value="${esc(u.display_name || '')}"><label>Tên tài khoản *</label><input name="u" required pattern="[a-z0-9_]{3,30}" value="${esc(u.username)}"><label>Giao diện</label><select name="t"><option value="system" ${u.theme === 'system' ? 'selected' : ''}>Theo hệ thống</option><option value="light" ${u.theme === 'light' ? 'selected' : ''}>Sáng</option><option value="dark" ${u.theme === 'dark' ? 'selected' : ''}>Tối</option></select></form>`, 'Lưu',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      await A.rpc('admin_update_user_profile', { target_user_id: u.user_id, new_username: v.u.toLowerCase(), new_display_name: v.n.trim(), new_theme: v.t }); reload(); }, 'Đã cập nhật tài khoản.');
}
function changeRole(u, reload) {
  ui.form('Đổi vai trò', `<p>Tài khoản: <b>${esc(u.display_name || u.username)}</b> (hiện là ${SL.roleLabel(u.role)})</p><label>Vai trò mới</label><select name="r">${['student', 'teacher', 'admin'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${SL.roleLabel(r)}</option>`).join('')}</select>`, 'Đổi vai trò',
    async (root) => { const r = root.querySelector('[name=r]').value; if (r === u.role) throw new Error('Tài khoản đang có vai trò này. Hãy chọn vai trò khác.'); await A.rpc('admin_set_user_role', { target_user_id: u.user_id, new_role: r }); reload(); }, 'Đã đổi vai trò.');
}
function toggleLock(u, reload) {
  const lock = !u.is_banned;
  ui.form(lock ? 'Khóa tài khoản' : 'Mở khóa tài khoản', `<p>${lock ? 'Người dùng sẽ không thể đăng nhập hay truy cập dữ liệu. Dữ liệu cũ vẫn được giữ.' : 'Người dùng sẽ đăng nhập lại được.'}</p><p><b>${esc(u.display_name || u.username)}</b> (${esc(u.username)})</p>`, lock ? 'Khóa' : 'Mở khóa',
    async () => { await A.rpc('admin_set_user_banned', { target_user_id: u.user_id, ban_status: lock }); reload(); }, lock ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.');
}
function drawRequests(el) {
  el.innerHTML = `<div class="toolbar"><select id="rs"><option value="all">Mọi trạng thái</option>${Object.entries(REQ_STATUS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div><div id="rList"></div><div class="pager" id="rPager"></div>`;
  $('#rs').value = U.rstatus; $('#rs').onchange = (e) => { U.rstatus = e.target.value; U.rpage = 0; load(); };
  const load = () => ui.load($('#rList'), async () => {
    let q = A.sb.from('teacher_requests').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (U.rstatus !== 'all') q = q.eq('status', U.rstatus);
    const r = await A.runPage(q.range(U.rpage * PAGE, U.rpage * PAGE + PAGE - 1));
    return { ...r, names: await userMap([...new Set(r.data.map((x) => x.user_id))]) };
  }, ({ data, count, names }) => {
    $('#rList').innerHTML = data.length ? data.map((r) => { const [lb, cl] = REQ_STATUS[r.status] || [r.status, ''], u = names[r.user_id] || {};
      return `<div class="item"><div class="item-main"><div class="item-title">${esc(u.display_name || u.username || '?')} · xin quyền giáo viên <span class="badge ${cl}">${lb}</span></div><div class="item-meta">${esc(u.email || '')} · Gửi: ${SL.fmtDate(r.created_at)}${r.message ? ' · ' + esc(r.message) : ''}${r.review_note ? ' · Ghi chú: ' + esc(r.review_note) : ''}</div></div>${r.status === 'pending' ? `<div class="actions"><button class="small" data-ok="${r.id}">Chấp nhận</button><button class="small danger" data-no="${r.id}">Từ chối</button></div>` : ''}</div>`; }).join('') : ui.empty('Không có yêu cầu nào.');
    pager($('#rPager'), U.rpage, count, PAGE, (p) => { U.rpage = p; load(); });
    const decide = (id, approve) => ui.form(approve ? 'Chấp nhận yêu cầu' : 'Từ chối yêu cầu', `<label>Ghi chú (không bắt buộc)</label><textarea name="n" rows="2" maxlength="300"></textarea>`, approve ? 'Chấp nhận' : 'Từ chối',
      async (root) => { await A.rpc('admin_review_teacher_request', { target_request_id: id, decision: approve ? 'approved' : 'rejected', note: root.querySelector('[name=n]').value.trim() || null }); load(); }, approve ? 'Đã chấp nhận yêu cầu.' : 'Đã từ chối yêu cầu.');
    el.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => decide(b.dataset.ok, true)));
    el.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => decide(b.dataset.no, false)));
  });
  load();
}

/* ---------------- Quản lý lớp (Admin) ---------------- */
const C = { q: '', page: 0 };
SL.pages.adminclasses = {
  title: 'Quản lý lớp học', sub: 'Tạo lớp, sửa thông tin, thêm học sinh và phân công giáo viên.',
  render(el) {
    if (!guardAdmin(el)) return;
    el.innerHTML = `<div class="toolbar"><input id="cq" placeholder="Tìm tên lớp…" value="${esc(C.q)}"><button id="cnew">+ Tạo lớp</button></div><div id="cList"></div><div class="pager" id="cPager"></div>`;
    let t; $('#cq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { C.q = e.target.value; C.page = 0; draw(); }, 300); };
    $('#cnew').onclick = () => classForm(null);
    const draw = () => {
      const all = SL.state().classes.filter((c) => norm(c.name).includes(norm(C.q))), data = all.slice(C.page * PAGE, C.page * PAGE + PAGE), nm = (id) => SL.state().users.find((u) => u.id === id)?.name || '';
      $('#cList').innerHTML = data.length ? `<div class="table-wrap"><table><thead><tr><th>Lớp</th><th>Chủ nhiệm</th><th>Sĩ số</th><th>Thao tác</th></tr></thead><tbody>${data.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="muted">${esc(c.academicYear || '')} ${esc(c.description || '')}</div></td><td>${c.homeroomId ? esc(nm(c.homeroomId)) : '<span class="muted">Chưa có</span>'}</td><td>${c.studentIds.length}</td><td class="actions"><button class="small secondary" data-open="${c.id}">Mở lớp</button> <button class="small secondary" data-edit="${c.id}">Sửa</button> <button class="small secondary" data-assign="${c.id}">Giáo viên</button> <button class="small secondary" data-mem="${c.id}">Học sinh</button></td></tr>`).join('')}</tbody></table></div>` : ui.empty('Chưa có lớp nào. Bấm "Tạo lớp" để bắt đầu.');
      pager($('#cPager'), C.page, all.length, PAGE, (p) => { C.page = p; draw(); });
      const find = (id) => SL.state().classes.find((x) => x.id === id);
      el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { SL.selectedClass = b.dataset.open; SL.go('classmgmt'); }));
      el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => classForm(find(b.dataset.edit))));
      el.querySelectorAll('[data-assign]').forEach((b) => (b.onclick = () => assignTeachers(find(b.dataset.assign))));
      el.querySelectorAll('[data-mem]').forEach((b) => (b.onclick = () => classMembers(find(b.dataset.mem))));
    };
    draw();
  }
};
function classForm(c) {
  ui.form(c ? 'Sửa lớp' : 'Tạo lớp mới', `<form><label>Tên lớp *</label><input name="n" required maxlength="60" value="${esc(c?.name || '')}"><label>Năm học</label><input name="y" maxlength="20" placeholder="2026-2027" value="${esc(c?.academicYear || '')}"><label>Mô tả</label><textarea name="d" rows="2">${esc(c?.description || '')}</textarea></form>`, 'Lưu',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      if (c) await A.rpc('admin_update_class', { p_class_id: c.id, p_name: v.n.trim(), p_academic_year: v.y.trim() || null, p_description: v.d.trim() || null });
      else await A.rpc('admin_create_class', { p_name: v.n.trim(), p_academic_year: v.y.trim() || null, p_description: v.d.trim() || null });
      await SL.reload(); }, c ? 'Đã cập nhật lớp.' : 'Đã tạo lớp.');
}
async function assignTeachers(c) {
  let teachers; try { teachers = (await listUsers('')).filter((u) => u.role === 'teacher' && !u.is_banned); } catch (e) { return SL.toast(A.toApiError(e).message); }
  const subs = SL.subjects(), nm = (id) => teachers.find((t) => t.user_id === id)?.display_name || SL.state().users.find((u) => u.id === id)?.name || '';
  const cur = () => SL.state().classes.find((x) => x.id === c.id) || c;
  const draw = () => {
    const k = cur(), box = $('#asgBody');
    box.innerHTML = `<label>Giáo viên chủ nhiệm</label><div class="row"><select id="hrSel">${teachers.map((t) => `<option value="${t.user_id}" ${k.homeroomId === t.user_id ? 'selected' : ''}>${esc(t.display_name || t.username)} (${esc(t.username)})</option>`).join('')}</select><button class="small" id="hrSave">Đặt chủ nhiệm</button></div>
      <label style="margin-top:16px">Giáo viên bộ môn</label>${(k.subjectTeachers || []).length ? k.subjectTeachers.map((r) => `<div class="ev-item"><span>${esc(subs.find((s) => s.id === r.subjectId)?.name || '')} — ${esc(nm(r.teacherId))}</span></div>`).join('') : '<div class="muted">Chưa phân công môn nào.</div>'}
      <div class="inline-form" style="margin-top:10px"><div><label>Môn</label><select id="sSel">${subs.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div><div><label>Giáo viên</label><select id="tSel">${teachers.map((t) => `<option value="${t.user_id}">${esc(t.display_name || t.username)}</option>`).join('')}</select></div><button class="small" id="addCst" ${subs.length && teachers.length ? '' : 'disabled'}>Phân công</button></div>
      ${!teachers.length ? '<div class="notice">Chưa có tài khoản giáo viên. Hãy duyệt yêu cầu hoặc đổi vai trò ở mục "Người dùng".</div>' : ''}${!subs.length ? '<div class="notice">Chưa có môn học. Hãy tạo ở mục "Môn học".</div>' : ''}<div id="asgErr" class="notice red hidden"></div>`;
    const err = (e) => { const x = $('#asgErr'); x.textContent = A.toApiError(e).message; x.classList.remove('hidden'); };
    const after = async (msg) => { await SL.reload(); SL.toast(msg); SL.modalRedraw?.(); draw(); };
    $('#hrSave')?.addEventListener('click', async () => { try { await A.rpc('admin_assign_homeroom_teacher', { p_class_id: c.id, p_teacher_id: $('#hrSel').value }); await after('Đã đặt giáo viên chủ nhiệm.'); } catch (e) { err(e); } });
    $('#addCst')?.addEventListener('click', async () => { try { await A.rpc('admin_assign_subject_teacher', { p_class_id: c.id, p_subject_id: $('#sSel').value, p_teacher_id: $('#tSel').value }); await after('Đã phân công giáo viên bộ môn.'); } catch (e) { err(e); } });
  };
  SL.modal(`Phân công giáo viên · ${esc(c.name)}`, '<div id="asgBody"></div>', 'Xong');
  $('#modalSubmit').onclick = () => SL.closeModal();
  draw();
}
async function classMembers(c) {
  let students; try { students = (await listUsers('')).filter((u) => u.role === 'student' && !u.is_banned); } catch (e) { return SL.toast(A.toApiError(e).message); }
  const cur = () => SL.state().classes.find((x) => x.id === c.id) || c;
  const draw = () => {
    const k = cur(), inClass = new Set(k.studentIds), nm = (id) => SL.state().users.find((u) => u.id === id)?.name || id, free = students.filter((s) => !inClass.has(s.user_id)), box = $('#memBody');
    box.innerHTML = `<label>Học sinh trong lớp (${k.studentIds.length})</label>${k.studentIds.length ? k.studentIds.map((id) => `<div class="ev-item"><span>${esc(nm(id))}</span><button class="small danger" data-rm="${id}">Xóa khỏi lớp</button></div>`).join('') : '<div class="muted">Lớp chưa có học sinh.</div>'}
      <div class="inline-form" style="margin-top:10px"><div><label>Thêm học sinh</label><select id="stSel">${free.map((s) => `<option value="${s.user_id}">${esc(s.display_name || s.username)} (${esc(s.username)})</option>`).join('')}</select></div><button class="small" id="addMem" ${free.length ? '' : 'disabled'}>Thêm</button></div><div id="memErr" class="notice red hidden"></div>`;
    const err = (e) => { const x = $('#memErr'); x.textContent = A.toApiError(e).message; x.classList.remove('hidden'); };
    $('#addMem')?.addEventListener('click', async () => { try { await A.rpc('admin_add_class_member', { p_class_id: c.id, p_student_id: $('#stSel').value }); await SL.reload(); SL.toast('Đã thêm học sinh.'); draw(); } catch (e) { err(e); } });
    box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { if (!confirm('Xóa học sinh này khỏi lớp?')) return; try { const r = await A.run(A.sb.from('class_members').delete().eq('class_id', c.id).eq('student_id', b.dataset.rm).select('student_id')); if (!r.length) throw new A.ApiError('unauthorized', 'Không xóa được học sinh.'); await SL.reload(); draw(); } catch (e) { err(e); } }));
  };
  SL.modal(`Học sinh · ${esc(c.name)}`, '<div id="memBody"></div>', 'Xong');
  $('#modalSubmit').onclick = () => SL.closeModal();
  draw();
}

/* ---------------- Môn học ---------------- */
SL.pages.subjects = {
  title: 'Quản lý môn học', sub: 'Danh mục môn học dùng để gán giáo viên và giao bài.',
  render(el) {
    if (!guardAdmin(el)) return;
    el.innerHTML = '<div class="toolbar"><button id="snew">+ Thêm môn học</button></div><div id="sList"></div>';
    $('#snew').onclick = () => subjectForm(null, load);
    const load = () => ui.load($('#sList'), () => A.run(A.sb.from('subjects').select('*').order('name')), (rows) => {
      $('#sList').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Môn</th><th>Mô tả</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.description || '')}</td><td><button class="small secondary" data-e="${s.id}">Sửa</button></td></tr>`).join('')}</tbody></table></div>` : ui.empty('Chưa có môn học nào.');
      el.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => subjectForm(rows.find((r) => r.id === b.dataset.e), load)));
    });
    load();
  }
};
function subjectForm(s, reload) {
  ui.form(s ? 'Sửa môn học' : 'Thêm môn học', `<form><label>Tên môn *</label><input name="n" required maxlength="60" value="${esc(s?.name || '')}"><label>Mô tả</label><textarea name="d" rows="2">${esc(s?.description || '')}</textarea></form>`, 'Lưu',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      if (s) await A.rpc('admin_update_subject', { p_subject_id: s.id, p_name: v.n.trim(), p_description: v.d.trim() || null });
      else await A.rpc('admin_create_subject', { p_name: v.n.trim(), p_description: v.d.trim() || null });
      reload(); SL.reload(); }, 'Đã lưu môn học.');
}

/* ---------------- Nhật ký kiểm toán ---------------- */
const L = { page: 0, table: 'all', action: '', from: '', to: '' };
SL.pages.audit = {
  title: 'Nhật ký kiểm toán', sub: 'Ai đã thay đổi gì, vào lúc nào. Chỉ quản trị viên được xem; không thể sửa hoặc xóa.',
  render(el) {
    if (!guardAdmin(el)) return;
    el.innerHTML = `<div class="toolbar"><input id="la" placeholder="Hành động (vd: role_changed)" value="${esc(L.action)}"><input id="le" placeholder="Bảng (vd: profiles)" value="${L.table === 'all' ? '' : esc(L.table)}"><input type="date" id="lf" value="${esc(L.from)}"><input type="date" id="lt" value="${esc(L.to)}"><button class="secondary" id="lclear">Xóa lọc</button></div><div id="lList"></div><div class="pager" id="lPager"></div>`;
    let t; const ch = () => { clearTimeout(t); t = setTimeout(() => { L.action = $('#la').value.trim(); L.table = $('#le').value.trim() || 'all'; L.from = $('#lf').value; L.to = $('#lt').value; L.page = 0; load(); }, 350); };
    ['la', 'le', 'lf', 'lt'].forEach((i) => ($('#' + i).oninput = ch));
    $('#lclear').onclick = () => { Object.assign(L, { page: 0, table: 'all', action: '', from: '', to: '' }); SL.pages.audit.render(el); };
    const load = () => ui.load($('#lList'), async () => {
      let q = A.sb.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false });
      if (L.table !== 'all') q = q.eq('target_table', L.table); if (L.action) q = q.ilike('action', '%' + L.action.replace(/[%,()*\\]/g, ' ') + '%');
      if (L.from) q = q.gte('created_at', new Date(L.from).toISOString()); if (L.to) q = q.lt('created_at', new Date(new Date(L.to).getTime() + 86400000).toISOString());
      const r = await A.runPage(q.range(L.page * PAGE, L.page * PAGE + PAGE - 1));
      return { ...r, names: await userMap([...new Set(r.data.map((x) => x.actor_id).filter(Boolean))]) };
    }, ({ data, count, names }) => {
      $('#lList').innerHTML = data.length ? `<div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>${data.map((l) => `<tr><td>${SL.fmtDate(l.created_at)}</td><td>${esc(names[l.actor_id]?.display_name || names[l.actor_id]?.username || (l.actor_id ? l.actor_id.slice(0, 8) : 'Hệ thống'))}</td><td>${esc(l.action)}</td><td>${esc(l.target_table || '')}<div class="muted">${esc(l.target_id || '')}</div></td><td><code>${esc(JSON.stringify(l.details || {}).slice(0, 160))}</code></td></tr>`).join('')}</tbody></table></div>` : ui.empty('Chưa có nhật ký phù hợp.');
      pager($('#lPager'), L.page, count, PAGE, (p) => { L.page = p; load(); });
    });
    load();
  }
};
})();
