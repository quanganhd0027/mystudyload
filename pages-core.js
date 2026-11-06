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
      <dl class="kv"><dt>Email</dt><dd>${esc(p.email)}</dd><dt>Tên tài khoản</dt><dd>${esc(p.username)}</dd><dt>Vai trò</dt><dd><span class="badge">${SL.roleLabel(p.role)}</span></dd><dt>Ngày tạo</dt><dd>${SL.fmtDate(p.created_at)}</dd></dl>
      <form id="profileForm" style="margin-top:14px"><label>Họ tên / tên hiển thị *</label><input name="display_name" required maxlength="60" value="${esc(p.display_name)}">
      <label>Mã học sinh</label><input name="student_code" maxlength="40" value="${esc(p.student_code || '')}">
      <label>Lớp (khai báo)</label><input name="class_name" maxlength="40" value="${esc(p.class_name || '')}">
      <div id="profileMsg" class="notice red hidden" role="alert" style="margin-top:12px"></div>
      <div class="row" style="margin-top:14px"><button type="submit">Lưu hồ sơ</button></div></form>
      <p class="footer-note">Vai trò, email và tên tài khoản chỉ quản trị viên được đổi. "Lớp" ở đây chỉ để tham khảo; lớp chính thức do quản trị viên thêm bạn vào.</p></div>
      <div class="card span-6"><div class="section-head"><h2>Yêu cầu của tôi</h2><span id="reqBtn"></span></div><div id="reqList"></div></div></div>`;
    $('#profileForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.currentTarget, v = Object.fromEntries(new FormData(f).entries()), btn = f.querySelector('button'), msg = $('#profileMsg');
      msg.classList.add('hidden');
      if (!v.display_name.trim()) { msg.textContent = 'Họ tên không được để trống.'; msg.classList.remove('hidden'); return; }
      btn.disabled = true; btn.textContent = 'Đang lưu…';
      try {
        const np = await A.auth.updateMyProfile({ display_name: v.display_name.trim(), student_code: v.student_code.trim(), class_name: v.class_name.trim() });
        SL.refreshProfile(np); const me = SL.current(); me.name = np.display_name || np.username;
        document.querySelector('.side-note').textContent = 'Tài khoản: ' + me.name + ' · ' + SL.roleLabel(np.role);
        SL.toast('Đã cập nhật hồ sơ.');
      } catch (err) { msg.textContent = A.toApiError(err).message.replace(/duplicate key.*student_id.*/i, 'Mã học sinh đã được dùng.'); msg.classList.remove('hidden'); }
      btn.disabled = false; btn.textContent = 'Lưu hồ sơ';
    };
    if (p.role === 'admin') { $('#reqList').innerHTML = ui.empty('Quản trị viên không cần gửi yêu cầu.'); return; }
    if (p.role === 'student') { $('#reqBtn').innerHTML = `<button class="small" id="newReq">Yêu cầu quyền giáo viên</button>`; $('#newReq').onclick = () => openRequestForm(drawRequests); }
    drawRequests();
  }
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

/* ---------------- Giao bài cho cả lớp (giáo viên bộ môn / lớp phó học tập / admin) ---------------- */
async function assignContext(classId) { // trả về {source, subjects} theo quyền thật; máy chủ vẫn kiểm tra lại bằng RLS
  const me = SL.current(), all = SL.subjects();
  if (SL.isAdmin()) return { source: 'admin', subjects: all };
  const isVp = await A.rpc('has_class_officer_role', { target_class_id: classId, target_role: 'academic_vp' });
  if (isVp) return { source: 'academic_vp', subjects: all };
  const rows = await A.run(A.sb.from('class_subject_teachers').select('subject_id').eq('class_id', classId).eq('teacher_id', me.id));
  const ids = new Set(rows.map((r) => r.subject_id));
  return { source: 'teacher', subjects: all.filter((s) => ids.has(s.id)) };
}
SL.assignToClass = async function (classId) {
  const me = SL.current(), cls = SL.state().classes.find((c) => c.id === classId);
  if (!cls) return SL.toast('Không tìm thấy lớp.');
  let ctx;
  try { ctx = await assignContext(classId); } catch (e) { return SL.toast(A.toApiError(e).message); }
  if (!ctx.subjects.length) return SL.toast('Bạn chưa được phân công môn nào trong lớp này nên chưa thể giao bài.');
  if (!cls.studentIds.length) return SL.toast('Lớp chưa có học sinh nào để giao bài.');
  ui.form(`Giao nhiệm vụ cho lớp ${esc(cls.name)}`, `<form><p class="muted">Nhiệm vụ sẽ được giao cho ${cls.studentIds.length} học sinh của lớp.</p><div class="form-grid">
    <div class="full"><label>Tiêu đề *</label><input name="title" required maxlength="150"></div>
    <div class="full"><label>Mô tả</label><textarea name="description" rows="3"></textarea></div>
    <div><label>Môn học *</label><select name="subject_id" required>${ctx.subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div><label>Hạn hoàn thành *</label><input type="datetime-local" name="due" required></div>
    <div><label>Thời gian dự kiến (phút) *</label><input type="number" name="est" min="1" value="60" required></div>
    <div><label>Ưu tiên</label><select name="priority"><option value="1">Thường</option><option value="2" selected>Vừa</option><option value="3">Cao</option></select></div></div></form>`, 'Giao bài',
    async (root) => {
      const f = root.querySelector('form'); if (!f.reportValidity()) return false;
      const v = Object.fromEntries(new FormData(f).entries());
      if (new Date(v.due) <= new Date()) throw new A.ApiError('validation', 'Hạn hoàn thành phải sau thời điểm hiện tại.');
      await A.run(A.sb.from('assignments').insert({ title: v.title.trim(), description: (v.description || '').trim() || null, class_id: classId, subject_id: v.subject_id,
        estimated_minutes: +v.est, deadline: toIso(v.due), priority: A.PRIO_TO_DB[+v.priority], created_by: me.id, source: ctx.source, teacher_id: ctx.source === 'teacher' ? me.id : null }));
      await SL.reload();
    }, 'Đã giao nhiệm vụ cho cả lớp.');
};
SL.editAssignment = async function (t) { // sửa bài đã giao: áp dụng cho cả lớp, quyền do RLS quyết định
  ui.form('Sửa bài đã giao', `<form><div class="notice">Thay đổi này áp dụng cho tất cả học sinh được giao bài.</div><div class="form-grid">
    <div class="full"><label>Tiêu đề *</label><input name="title" required maxlength="150" value="${esc(t.title)}"></div>
    <div class="full"><label>Mô tả</label><textarea name="description" rows="3">${esc(t.description || '')}</textarea></div>
    <div><label>Hạn hoàn thành *</label><input type="datetime-local" name="due" required value="${new Date(new Date(t.dueAt).getTime() - new Date(t.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></div>
    <div><label>Thời gian dự kiến (phút) *</label><input type="number" name="est" min="1" value="${t.estimatedMinutes}" required></div>
    <div><label>Ưu tiên</label><select name="priority"><option value="1" ${t.priority === 1 ? 'selected' : ''}>Thường</option><option value="2" ${t.priority === 2 ? 'selected' : ''}>Vừa</option><option value="3" ${t.priority === 3 ? 'selected' : ''}>Cao</option></select></div></div></form>`, 'Lưu thay đổi',
    async (root) => {
      const f = root.querySelector('form'); if (!f.reportValidity()) return false;
      const v = Object.fromEntries(new FormData(f).entries());
      const rows = await A.run(A.sb.from('assignments').update({ title: v.title.trim(), description: (v.description || '').trim() || null, deadline: toIso(v.due),
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
