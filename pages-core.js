/* StudyLoad · pages-core.js — Hồ sơ, yêu cầu giáo viên, giao bài cho cả lớp, minh chứng bài tập */
(() => {
'use strict';
const SL = window.SL, A = window.SLApi, { esc, ui, $ } = SL;
const REQ_STATUS = { pending: ['Chờ duyệt', 'amber'], approved: ['Đã chấp nhận', 'green'], rejected: ['Bị từ chối', 'red'] };
const toIso = (local) => new Date(local).toISOString();
const fmtBytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
SL.util = { toIso, fmtBytes, REQ_STATUS };

/* ---------------- Hồ sơ cá nhân ---------------- */
SL.pages.profile = {
  title: 'Hồ sơ cá nhân', sub: 'Thông tin tài khoản và yêu cầu của bạn.',
  render(el) {
    const p = SL.profile();
    el.innerHTML = `<div class="grid"><div class="card span-6"><h2>Thông tin tài khoản</h2>
      <div class="row" style="margin-bottom:12px;gap:14px">${SL.av(p.id, p.display_name, p.role, 72)}<button type="button" class="secondary" id="avBtn">Đổi ảnh đại diện</button></div>
      <dl class="kv"><dt>Email</dt><dd>${esc(p.email)}</dd><dt>Tên tài khoản</dt><dd>${esc(p.username)}</dd><dt>Vai trò</dt><dd><span class="badge">${SL.myRoleText(p)}</span></dd><dt>Ngày tạo</dt><dd>${SL.fmtDate(p.created_at)}</dd></dl>
      <form id="profileForm" style="margin-top:14px"><label>Họ tên / tên hiển thị *</label><input name="display_name" required maxlength="60" value="${esc(p.display_name)}">
      <label>Mã học sinh (4-10 chữ số)</label><input name="student_code" id="pfCode" inputmode="numeric" maxlength="10" value="${esc(p.student_code || '')}">
      <label>Số điện thoại</label><input name="phone" id="pfPhone" maxlength="12" value="${esc(p.phone || '')}">
      <p class="footer-note" id="pfNote">Chỉ dùng <b>một</b> trong hai: mã học sinh hoặc số điện thoại.</p>
      <label>Lớp (khai báo)</label><input name="class_name" maxlength="40" value="${esc(p.class_name || '')}">
      <div id="profileMsg" class="notice red hidden" role="alert" style="margin-top:12px"></div>
      <div id="dupBox" class="hidden" style="margin-top:10px"><button type="button" class="secondary" id="dupBtn">Mã học sinh của bạn bị dùng? Báo cho quản trị viên</button></div>
      <div class="row" style="margin-top:14px"><button type="submit" id="pfSave">Lưu hồ sơ</button><button type="button" class="secondary" data-action="logout">Đăng xuất</button></div></form>
      <p class="footer-note">Vai trò, email và tên tài khoản chỉ quản trị viên được đổi. "Lớp" ở đây chỉ để tham khảo; lớp chính thức do quản trị viên thêm bạn vào.</p></div>
      <div class="card span-6"><div class="section-head"><h2>Yêu cầu của tôi</h2><span id="reqBtn"></span></div><div id="reqList"></div></div></div>`;
    const codeIn = $('#pfCode'), phoneIn = $('#pfPhone'), saveBtn = $('#pfSave'), legacyBoth = !!(p.student_code && p.phone);
    const refreshIdent = () => {
      const c = codeIn.value.trim(), ph = phoneIn.value.trim(), isAdm = p.role === 'admin';
      if (!legacyBoth) { phoneIn.disabled = !!c; codeIn.disabled = !!ph; }
      const bad = (c && !(/^[0-9]{4,10}$/.test(c) && !/^(0[0-9]{8,9}|84[0-9]{8})$/.test(c))) || (ph && !A.auth.validPhone(ph)) || (c && ph) || (!c && !ph && !isAdm);
      saveBtn.disabled = !!bad;
      $('#pfNote').innerHTML = legacyBoth && c && ph ? '<b>Tài khoản cũ đang có cả hai.</b> Hãy xóa một trong hai rồi lưu.' : !c && !ph && !isAdm ? '<b>Cần có mã học sinh hoặc số điện thoại.</b> Hãy nhập một trong hai.' : 'Chỉ dùng <b>một</b> trong hai: mã học sinh hoặc số điện thoại.';
    };
    A.auth.bindIdentInput(codeIn, 'code', refreshIdent); A.auth.bindIdentInput(phoneIn, 'phone', refreshIdent);
    $('#avBtn').onclick = () => SL.avatarEditor(p.id, p.display_name, p.role);
    $('#dupBtn').onclick = () => reportDup(codeIn.value.trim());
    $('#profileForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.currentTarget, v = Object.fromEntries(new FormData(f).entries()), btn = saveBtn, msg = $('#profileMsg');
      msg.classList.add('hidden'); $('#dupBox').classList.add('hidden');
      if (!v.display_name.trim()) { msg.textContent = 'Họ tên không được để trống.'; msg.classList.remove('hidden'); return; }
      btn.disabled = true; btn.textContent = 'Đang lưu…';
      try {
        const newCode = (v.student_code || '').trim(), newPhone = (v.phone || '').trim();
        if (newCode !== (p.student_code || '') || newPhone !== (p.phone || '')) await A.auth.updateMyIdentity(newCode, newPhone);
        const np = await A.auth.updateMyProfile({ display_name: v.display_name.trim(), class_name: v.class_name.trim() });
        SL.refreshProfile(np); const me = SL.current(); me.name = np.display_name || np.username;
        document.querySelector('.side-note').textContent = 'Tài khoản: ' + me.name + ' · ' + SL.myRoleText(np);
        SL.toast('Đã cập nhật hồ sơ.');
      } catch (err) { const m = A.toApiError(err).message; msg.textContent = m; msg.classList.remove('hidden'); if (/Mã học sinh này đã có tài khoản/.test(m)) $('#dupBox').classList.remove('hidden'); }
      btn.textContent = 'Lưu hồ sơ'; refreshIdent();
    };
    if (p.role === 'teacher') { const tc = document.createElement('div'); tc.className = 'card span-12'; el.querySelector('.grid').appendChild(tc); drawTeacherCard(tc); }
    if (p.role === 'admin') { $('#reqList').innerHTML = ui.empty('Quản trị viên không cần gửi yêu cầu.'); return; }
    if (p.role === 'student') { $('#reqBtn').innerHTML = `<button class="small" id="newReq">Yêu cầu quyền giáo viên</button>`; $('#newReq').onclick = () => openRequestForm(drawRequests); }
    drawRequests();
  }
};
function reportDup(code) {
  const p = SL.profile();
  ui.form('Mã học sinh của bạn bị dùng?', `<form><p class="muted">Quản trị viên sẽ đối chiếu và xử lý. Điền thông tin của bạn:</p><label>Họ và tên *</label><input name="name" required maxlength="80" value="${esc(p.display_name || '')}">
    <label>Lớp *</label><input name="cls" required maxlength="40" value="${esc(p.class_name || '')}"><label>Mã học sinh của bạn *</label><input name="code" required maxlength="10" inputmode="numeric" value="${esc(code || '')}">
    <label>Cách liên hệ (email hoặc SĐT, không bắt buộc)</label><input name="contact" maxlength="100"></form>`, 'Gửi yêu cầu',
    async (root) => { const f = root.querySelector('form'); if (!f.reportValidity()) return false; const v = Object.fromEntries(new FormData(f).entries());
      await A.rpc('report_student_code_conflict', { p_name: v.name.trim(), p_class: v.cls.trim(), p_code: v.code.trim(), p_contact: v.contact.trim() || null }); }, 'Đã gửi yêu cầu cho quản trị viên.');
}
/* Giáo viên tự chọn môn dạy, xem lớp chủ nhiệm / lớp dạy, nhận lớp chưa có chủ nhiệm */
function drawTeacherCard(card) {
  ui.load(card, () => A.rpc('my_teacher_info'), (info) => {
    const subs = SL.subjects(), mine = new Set(info.subjects || []);
    card.innerHTML = `<h2>Giáo viên: môn dạy và lớp</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      <div><label>Môn dạy (chọn nhiều)</label><div id="tsubs" style="max-height:200px;overflow:auto;border:1px solid var(--line,#ddd);border-radius:8px;padding:6px 10px">${subs.length ? subs.map((s) => `<label class="checkrow" style="display:flex;gap:8px;padding:4px 0"><input type="checkbox" value="${s.id}" ${mine.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('') : '<span class="muted">Chưa có môn học nào. Hãy nhờ quản trị viên thêm.</span>'}</div><div class="row" style="margin-top:8px"><button class="small" id="tsave">Lưu môn dạy</button></div></div>
      <div><label>Lớp chủ nhiệm</label>${(info.homeroom_classes || []).length ? info.homeroom_classes.map((c) => `<div class="item"><div class="item-title">${esc(c.name)}</div></div>`).join('') : '<div class="muted">Chưa chủ nhiệm lớp nào.</div>'}
        <label style="margin-top:10px">Lớp bạn đang dạy (đã giao bài)</label>${(info.teaching_classes || []).length ? (info.teaching_classes || []).map((c) => `<span class="badge">${esc(c.name)}</span> `).join('') : '<div class="muted">Chưa giao bài cho lớp nào.</div>'}
        <div class="row" style="margin-top:12px"><button class="small secondary" id="tclaim">Nhận lớp chưa có chủ nhiệm</button></div>
        <p class="footer-note">Bạn tự tạo được tối đa 1 lớp (đã tạo: ${info.created_classes}/1). Có thể nhận thêm lớp chưa có chủ nhiệm. Bạn giao bài được cho mọi lớp.</p></div></div>`;
    $('#tsave').onclick = async (e) => { e.target.disabled = true; try { await A.rpc('set_my_subjects', { p_subject_ids: [...card.querySelectorAll('#tsubs input:checked')].map((x) => x.value) }); SL.toast('Đã lưu môn dạy.'); } catch (er) { SL.toast(A.toApiError(er).message); } e.target.disabled = false; };
    $('#tclaim').onclick = () => SL.claimClass(() => drawTeacherCard(card));
  });
}
SL.claimClass = async function (done) {
  let rows; try { rows = await A.rpc('list_unclaimed_classes'); } catch (e) { return SL.toast(A.toApiError(e).message); }
  if (!rows.length) return SL.toast('Hiện không có lớp nào chưa có giáo viên chủ nhiệm.');
  ui.form('Nhận lớp chủ nhiệm', `<form><p class="muted">Các lớp đang chưa có giáo viên chủ nhiệm:</p>${rows.map((c, i) => `<label class="checkrow" style="display:flex;gap:8px;padding:6px 0"><input type="radio" name="cid" value="${c.id}" ${i === 0 ? 'checked' : ''}><span><b>${esc(c.name)}</b> <span class="muted">${esc(c.academic_year || '')} · ${c.student_count} học sinh</span></span></label>`).join('')}</form>`, 'Nhận lớp',
    async (root) => { const id = root.querySelector('[name=cid]:checked')?.value; if (!id) throw new Error('Hãy chọn một lớp.'); await A.rpc('teacher_claim_class', { p_class_id: id }); await SL.reload(); if (done) done(); }, 'Đã nhận lớp. Bạn là giáo viên chủ nhiệm.');
};
/* Giáo viên giao bài cho BẤT KỲ lớp nào: chọn lớp rồi giao */
SL.assignPick = async function () {
  let rows; try { rows = await A.run(A.sb.from('classes').select('id,name,academic_year').order('name')); } catch (e) { return SL.toast(A.toApiError(e).message); }
  if (!rows.length) return SL.toast('Chưa có lớp nào trong hệ thống.');
  ui.form('Giao bài cho lớp', `<form><label>Chọn lớp *</label><select name="cid">${rows.map((c) => `<option value="${c.id}">${esc(c.name)}${c.academic_year ? ' · ' + esc(c.academic_year) : ''}</option>`).join('')}</select></form>`, 'Tiếp tục',
    async (root) => { const id = root.querySelector('[name=cid]').value, nm = rows.find((c) => c.id === id)?.name; setTimeout(() => SL.assignToClass(id, nm), 50); }, '');
};
function drawRequests() {
  const box = $('#reqList'); if (!box) return;
  ui.load(box, () => A.run(A.sb.from('teacher_requests').select('*').eq('user_id', SL.profile().id).order('created_at', { ascending: false }).limit(50)), (rows) => {
    box.innerHTML = rows.length ? rows.map((r) => { const [lb, cl] = REQ_STATUS[r.status] || [r.status, ''];
      return `<div class="item"><div class="item-main"><div class="item-title">Xin quyền giáo viên <span class="badge ${cl}">${lb}</span></div>
      <div class="item-meta">Gửi: ${SL.fmtDate(r.created_at)}${r.message ? ' · ' + esc(r.message) : ''}${r.review_note ? ' · Phản hồi: ' + esc(r.review_note) : ''}</div></div></div>`; }).join('') : ui.empty('Bạn chưa gửi yêu cầu nào.');
  });
}
function openRequestForm(done) {
  ui.form('Yêu cầu quyền giáo viên', `<form><label>Lời nhắn (không bắt buộc)</label><textarea name="message" rows="3" maxlength="500" placeholder="Ví dụ: tôi là giáo viên môn Toán của trường…"></textarea></form>`, 'Gửi yêu cầu',
    async (root) => {
      const v = Object.fromEntries(new FormData(root.querySelector('form')).entries());
      await A.run(A.sb.from('teacher_requests').insert({ user_id: SL.profile().id, message: (v.message || '').trim() || null }));
      done();
    }, 'Đã gửi yêu cầu, đang chờ quản trị viên duyệt.');
}

/* ---------------- Giao bài cho cả lớp (giáo viên bộ môn / cán bộ lớp / admin) ---------------- */
async function assignContext(classId) { // trả về {source, subjects} theo quyền thật; máy chủ vẫn kiểm tra lại bằng RLS
  const me = SL.current(), all = SL.subjects();
  if (SL.isAdmin()) return { source: 'admin', subjects: all };
  const isVp = await A.rpc('has_main_officer_role', { target_class_id: classId });
  if (isVp) return { source: 'academic_vp', subjects: all };
  if (me.role !== 'teacher') return { source: 'teacher', subjects: [] };
  const info = await A.rpc('my_teacher_info'), ids = new Set(info.subjects || []);
  return { source: 'teacher', subjects: all.filter((s) => ids.has(s.id)) };
}
const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
SL.assignToClass = async function (classId, className) {
  const me = SL.current(), cls = SL.state().classes.find((c) => c.id === classId) || { id: classId, name: className || 'lớp', studentIds: null };
  if (!className && !SL.state().classes.find((c) => c.id === classId)) return SL.toast('Không tìm thấy lớp.');
  let ctx;
  try { ctx = await assignContext(classId); } catch (e) { return SL.toast(A.toApiError(e).message); }
  if (!ctx.subjects.length) return SL.toast(SL.isAdmin() || me.role !== 'teacher' ? 'Không có môn học nào để giao.' : 'Hãy chọn môn dạy của bạn trong Hồ sơ trước khi giao bài.');
  if (cls.studentIds && !cls.studentIds.length) return SL.toast('Lớp chưa có học sinh nào để giao bài.');
  ui.form(`Giao nhiệm vụ cho lớp ${esc(cls.name)}`, `<form><div class="form-grid">
    <div class="full"><label>Tên nhiệm vụ *</label><input name="title" required maxlength="150"></div>
    <div class="full"><label>Môn học * (tick vào các môn)</label><div class="subj-ticks">${[...ctx.subjects].sort((x, y) => SL.subjectRank(x.name) - SL.subjectRank(y.name)).map((s, i) => `<label class="checkrow"><input type="checkbox" name="subj" value="${s.id}" ${ctx.subjects.length === 1 ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></div>
    <div><label>Ngày giao bài *</label><input type="datetime-local" name="start" required value="${toLocalInput(new Date())}"></div>
    <div><label>Hạn nộp *</label><input type="datetime-local" name="due" required></div></div></form>`, 'Giao bài',
    async (root) => {
      const f = root.querySelector('form'); if (!f.reportValidity()) return false;
      const v = Object.fromEntries(new FormData(f).entries()), subs = [...f.querySelectorAll('[name=subj]:checked')].map((x) => x.value);
      if (!subs.length) throw new A.ApiError('validation', 'Hãy tick ít nhất một môn học.');
      if (new Date(v.due) <= new Date()) throw new A.ApiError('validation', 'Hạn nộp phải sau thời điểm hiện tại.');
      if (new Date(v.start) > new Date(v.due)) throw new A.ApiError('validation', 'Ngày giao bài phải trước hạn nộp.');
      await A.run(A.sb.from('assignments').insert(subs.map((sid) => ({ start_at: toIso(v.start), title: v.title.trim(), description: null, class_id: classId, subject_id: sid,
        estimated_minutes: 60, deadline: toIso(v.due), priority: A.PRIO_TO_DB[2], created_by: me.id, source: ctx.source, teacher_id: ctx.source === 'teacher' ? me.id : null }))));
      await SL.reload();
    }, 'Đã giao nhiệm vụ cho cả lớp.');
};
SL.editAssignment = async function (t) { // sửa bài đã giao: áp dụng cho cả lớp, quyền do RLS quyết định
  ui.form('Sửa bài đã giao', `<form><div class="notice">Thay đổi này áp dụng cho tất cả học sinh được giao bài.</div><div class="form-grid">
    <div class="full"><label>Tiêu đề *</label><input name="title" required maxlength="150" value="${esc(t.title)}"></div>
    <div class="full"><label>Mô tả</label><textarea name="description" rows="3">${esc(t.description || '')}</textarea></div>
    <div><label>Hạn hoàn thành *</label><input type="datetime-local" name="due" required value="${new Date(new Date(t.dueAt).getTime() - new Date(t.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></div>
    <div><label>Ngày bắt đầu (tùy chọn)</label><input type="datetime-local" name="start" value="${t.startAtSet ? new Date(new Date(t.startAtSet).getTime() - new Date(t.startAtSet).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}"></div>
    <div><label>Thời gian dự kiến (phút) *</label><input type="number" name="est" min="1" value="${t.estimatedMinutes}" required></div>
    <div><label>Ưu tiên</label><select name="priority"><option value="1" ${t.priority === 1 ? 'selected' : ''}>Thường</option><option value="2" ${t.priority === 2 ? 'selected' : ''}>Vừa</option><option value="3" ${t.priority === 3 ? 'selected' : ''}>Cao</option></select></div></div></form>`, 'Lưu thay đổi',
    async (root) => {
      const f = root.querySelector('form'); if (!f.reportValidity()) return false;
      const v = Object.fromEntries(new FormData(f).entries());
      if (v.start && new Date(v.start) > new Date(v.due)) throw new A.ApiError('validation', 'Ngày bắt đầu phải trước hạn hoàn thành.');
      const rows = await A.run(A.sb.from('assignments').update({ start_at: v.start ? toIso(v.start) : null, title: v.title.trim(), description: (v.description || '').trim() || null, deadline: toIso(v.due),
        estimated_minutes: +v.est, priority: A.PRIO_TO_DB[+v.priority] }).eq('id', t.assignmentId).select('id'));
      if (!rows || !rows.length) throw new A.ApiError('unauthorized', 'Bạn không có quyền sửa bài này.');
      await SL.reload();
    }, 'Đã cập nhật bài đã giao.');
};

/* ---------------- Minh chứng trong chi tiết bài tập ---------------- */
SL.afterTaskDetail = function (t) {
  if (!t.assignmentId) return; // nhiệm vụ cá nhân/nhóm không có minh chứng kiểu này
  const modal = document.querySelector('.modal'); if (!modal) return;
  const me = SL.current(), box = document.createElement('div');
  box.className = 'card'; box.style.marginTop = '14px'; box.innerHTML = '<h2>Minh chứng</h2><div id="evBody"></div>';
  modal.insertBefore(box, modal.querySelector('.modal-footer'));
  const body = box.querySelector('#evBody'), owner = t.ownerId === me.id;
  const pid = t.progressId || t.id;
  const draw = () => ui.load(body, () => A.evidence.list('assignment', pid), (rows) => {
    const lim = A.evidence.limits('assignment');
    body.innerHTML = `<div class="ev-list">${rows.length ? rows.map((r) => `<div class="ev-item"><span>${r.file_path ? esc(r.file_path.split('/').pop().replace(/^[0-9a-f-]{36}-/, '')) : 'Ghi chú'}${r.note ? ` <span class="muted">· ${esc(r.note)}</span>` : ''} <span class="muted">${SL.fmtDate(r.created_at)}</span></span><span class="actions">${r.file_path ? `<button class="small secondary" data-open="${r.id}">Mở</button>` : ''}${r.student_id === me.id ? `<button class="small danger" data-del="${r.id}">Xóa</button>` : ''}</span></div>`).join('') : ui.empty('Chưa có minh chứng.')}</div>
      ${owner ? `<input type="file" id="evFile" accept="${lim.mime.join(',')}"><input id="evNote" maxlength="300" placeholder="Ghi chú (không bắt buộc)" style="margin-top:6px"><div class="footer-note">Tối đa ${Math.round(lim.maxBytes / 1048576)} MB · ảnh, PDF hoặc văn bản.</div><div class="row"><button class="small" id="evUp">Nộp minh chứng</button></div>` : ''}`;
    body.querySelectorAll('[data-open]').forEach((b) => (b.onclick = async () => { try { window.open(await A.evidence.url('assignment', rows.find((r) => r.id === b.dataset.open)), '_blank', 'noopener'); } catch (e) { SL.toast(A.toApiError(e).message); } }));
    body.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Xóa minh chứng này?')) return; try { await A.evidence.remove('assignment', rows.find((r) => r.id === b.dataset.del)); draw(); } catch (e) { SL.toast(A.toApiError(e).message); } }));
    $('#evUp')?.addEventListener('click', async (e) => {
      const f = $('#evFile').files[0], note = $('#evNote').value;
      if (!f && !note.trim()) return SL.toast('Hãy chọn tệp hoặc nhập ghi chú.');
      e.target.disabled = true; e.target.textContent = 'Đang nộp…';
      try { await A.evidence.upload('assignment', pid, f, note); SL.toast('Đã nộp minh chứng.'); draw(); } catch (er) { SL.toast(A.toApiError(er).message); e.target.disabled = false; e.target.textContent = 'Nộp minh chứng'; }
    });
  });
  draw();
};
})();
