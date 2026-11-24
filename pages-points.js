/* StudyLoad · pages-points.js — Điểm nề nếp theo học sinh + tab Xếp hạng (theo lớp, theo khối).
   Tải file Excel/CSV → khớp từ khóa với bảng điểm → cộng/trừ điểm. Mỗi tháng mỗi học sinh bắt đầu 100 điểm.
   Tạm thời chỉ tính dòng nhận xét có mã học sinh; dòng nhận xét cả lớp được bỏ qua. Quyền thật nằm ở máy chủ (RPC). */
(() => {
'use strict';
const SL = window.SL, A = window.SLApi, { esc, ui, $ } = SL, sb = A.sb;
const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
const gradeOf = (name) => { const m = /^\s*(\d+)/.exec(name || ''); return m ? +m[1] : null; };
const rankOf = (p) => (p >= 90 ? ['Tốt', 'green'] : p >= 80 ? ['Khá', 'blue'] : p >= 60 ? ['Đạt', 'amber'] : ['Chưa đạt', 'red']);
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const sign = (n) => (n > 0 ? '+' + n : String(n));
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return 'tháng ' + +m + '/' + y; };

/* ============================ Tab Xếp hạng ============================ */
const R = { scope: 'class', classId: '', grade: '', month: thisMonth() };

SL.pages.ranking = {
  title: 'Xếp hạng', sub: 'Điểm rèn luyện nề nếp theo tháng — xếp hạng lớp và xếp hạng khối.',
  render(el) {
    const classes = (SL.state().classes || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi', { numeric: true }));
    const grades = [...new Set(classes.map((c) => gradeOf(c.name)).filter((g) => g != null))].sort((a, b) => a - b);
    if (!classes.length && !grades.length) { el.innerHTML = ui.empty('Bạn chưa thuộc lớp nào nên chưa có bảng xếp hạng. Hãy nhờ giáo viên thêm bạn vào lớp bằng mã học sinh.'); return; }
    if (!classes.some((c) => c.id === R.classId)) R.classId = classes[0] ? classes[0].id : '';
    if (!grades.includes(+R.grade)) R.grade = grades[0] != null ? grades[0] : '';
    const boardHtml = (d, scope) => {
        const rows = d.rows || [], me = d.me, mine = rows.find((r) => r.id === me);
        const top = rows.length ? Math.max(...rows.map((r) => r.points), 100) : 100;
        const table = rows.length ? `<div class="table-wrap"><table><thead><tr><th style="width:64px">Hạng</th><th>Học sinh</th><th>Lớp</th><th>Điểm</th><th>Xếp loại</th><th>Cộng / trừ</th></tr></thead><tbody>${rows.map((r) => {
          const [lab, col] = rankOf(r.points);
          return `<tr class="${r.id === me ? 'rk-me' : ''}"><td><b>${MEDAL[r.rank] || r.rank}</b></td><td>${SL.av ? SL.av(r.id, r.name, 'student', 26) : ''} ${esc(r.name || '(chưa đặt tên)')}${r.id === me ? ' <span class="badge">Bạn</span>' : ''}</td><td>${esc(r.class || '')}</td>
            <td><b>${r.points}</b><div class="bar" style="width:90px;margin-top:4px"><i style="width:${Math.max(2, Math.round(r.points / top * 100))}%"></i></div></td><td><span class="badge ${col}">${lab}</span></td>
            <td class="muted">${r.plus ? `<span style="color:var(--green)">+${r.plus} lần</span>` : ''}${r.plus && r.minus ? ' · ' : ''}${r.minus ? `<span style="color:var(--red)">−${r.minus} lần</span>` : ''}${!r.plus && !r.minus ? '—' : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : ui.empty('Chưa có học sinh nào trong phạm vi này.');
        const cls = (d.classes || []).length > 1 ? `<div class="card" style="margin-top:16px"><h2>Xếp hạng các lớp trong khối ${esc(R.grade)} (điểm trung bình)</h2><div class="table-wrap"><table><thead><tr><th style="width:64px">Hạng</th><th>Lớp</th><th>Điểm TB</th><th>Số học sinh</th></tr></thead><tbody>${d.classes.map((c) => `<tr><td><b>${MEDAL[c.rank] || c.rank}</b></td><td>${esc(c.name)}</td><td><b>${c.avg}</b></td><td>${c.students}</td></tr>`).join('')}</tbody></table></div></div>` : '';
        const head = mine ? `<div class="notice green" style="margin-bottom:14px">Bạn đang đứng hạng <b>${mine.rank}</b> ${scope === 'class' ? 'trong lớp' : 'trong khối'} với <b>${mine.points}</b> điểm (${monthLabel(R.month)}).</div>` : '';
        return head + `<div class="card"><div class="section-head"><h2>${scope === 'class' ? 'Xếp hạng trong lớp' : 'Xếp hạng toàn khối ' + esc(R.grade)} · ${monthLabel(R.month)}</h2><span class="muted">${rows.length} học sinh</span></div>${table}
          <p class="footer-note">Mỗi tháng mỗi học sinh bắt đầu với 100 điểm; điểm cộng/trừ được cộng dồn. Xếp loại: Tốt ≥ 90 · Khá 80–dưới 90 · Đạt 60–dưới 80 · Chưa đạt dưới 60. Hiện chỉ tính nhận xét của từng học sinh, chưa tính nhận xét cả lớp.</p></div>` + cls;
    };
    const draw = () => {
      el.innerHTML = `<div class="toolbar">${classes.length ? `<select id="rkc" aria-label="Lớp">${classes.map((c) => `<option value="${c.id}" ${c.id === R.classId ? 'selected' : ''}>Lớp ${esc(c.name)}</option>`).join('')}</select>` : ''}${grades.length ? `<select id="rkg" aria-label="Khối">${grades.map((g) => `<option value="${g}" ${g === +R.grade ? 'selected' : ''}>Khối ${g}</option>`).join('')}</select>` : ''}
          <input type="month" id="rkm" value="${R.month}" max="${thisMonth()}" aria-label="Tháng"></div>
        <div id="rkClass"></div><div id="rkGrade" style="margin-top:16px"></div><div id="rkMine"></div>`;
      $('#rkc') && ($('#rkc').onchange = (e) => { R.classId = e.target.value; draw(); });
      $('#rkg') && ($('#rkg').onchange = (e) => { R.grade = +e.target.value; draw(); });
      $('#rkm').onchange = (e) => { R.month = e.target.value || thisMonth(); draw(); };
      if (classes.length) ui.load($('#rkClass'), () => A.rpc('get_ranking', { p_scope: 'class', p_class_id: R.classId, p_grade: null, p_month: R.month + '-01' }), (d) => { $('#rkClass').innerHTML = boardHtml(d, 'class'); });
      if (grades.length) ui.load($('#rkGrade'), () => A.rpc('get_ranking', { p_scope: 'grade', p_class_id: null, p_grade: +R.grade, p_month: R.month + '-01' }), (d) => { $('#rkGrade').innerHTML = boardHtml(d, 'grade'); });
      if (SL.isStudent()) loadMine();
    };
    const loadMine = async () => {
      let ev = []; try { ev = await A.rpc('my_point_events', { p_month: R.month + '-01' }); } catch (e) { return; }
      const box = $('#rkMine'); if (!box) return;
      box.innerHTML = `<div class="card" style="margin-top:16px"><h2>Điểm của tôi · ${monthLabel(R.month)}</h2>${ev.length ? `<div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Nội dung</th><th>Điểm</th></tr></thead><tbody>${ev.map((e) => `<tr><td>${esc(String(e.date).slice(8, 10) + '/' + String(e.date).slice(5, 7))}</td><td>${esc(e.rule || e.text || '')}</td><td><b style="color:${e.points > 0 ? 'var(--green)' : 'var(--red)'}">${sign(e.points)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Tháng này bạn chưa có điểm cộng hay trừ nào.</p>'}</div>`;
    };
    draw();
  }
};

/* ====================== Điểm nề nếp: tải file (GV / cán bộ / admin) ====================== */
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let xlsxP = null;
const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : (xlsxP = xlsxP || new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => ok(window.XLSX); s.onerror = () => { xlsxP = null; no(new Error('Không tải được bộ đọc Excel. Hãy kiểm tra mạng rồi thử lại.')); }; document.head.appendChild(s);
}));
const nz = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const COLS = { date: ['ngay'], code: ['ma hs', 'ma hoc sinh', 'ma so hoc sinh', 'mhs'], name: ['hoc sinh', 'ho ten', 'ho va ten'], text: ['loi', 'noi dung', 'nhan xet', 'vi pham', 'noi dung loi'], time: ['thoi gian'], points: ['diem'], note: ['ghi chu'], cls: ['lop'] };
function isoDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12 * 3600e3); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  const s = String(v).trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(s))) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  return null;
}
async function parseFile(file) {
  const X = await loadXlsx();
  const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  for (const name of wb.SheetNames) {
    const grid = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    for (let h = 0; h < Math.min(grid.length, 12); h++) {
      const heads = (grid[h] || []).map(nz), idx = {};
      Object.entries(COLS).forEach(([k, names]) => { const i = heads.findIndex((x) => x && names.includes(x)); if (i >= 0) idx[k] = i; });
      if (idx.text == null) continue;
      const rows = grid.slice(h + 1).map((r) => ({
        date: isoDate(idx.date != null ? r[idx.date] : null), code: idx.code != null && r[idx.code] != null ? String(r[idx.code]) : '',
        name: idx.name != null && r[idx.name] != null ? String(r[idx.name]) : '', text: r[idx.text] != null ? String(r[idx.text]) : '',
        note: idx.note != null && r[idx.note] != null ? String(r[idx.note]) : '', points: idx.points != null && r[idx.points] != null ? r[idx.points] : null,
        cls: idx.cls != null && r[idx.cls] != null ? String(r[idx.cls]) : '' })).filter((r) => r.text.trim());
      return { sheet: name, hasCode: idx.code != null, rows };
    }
  }
  throw new Error('Không thấy cột nội dung lỗi/nhận xét. File cần có hàng tiêu đề với cột “Lỗi” (hoặc “Nội dung”, “Nhận xét”) và cột “Mã HS”.');
}

const D = { parsed: null, fname: '' };
SL.pages.discipline = {
  title: 'Điểm nề nếp', sub: 'Tải file nề nếp của học sinh để tự cộng/trừ điểm và cập nhật bảng xếp hạng.',
  render(el) {
    el.innerHTML = `<div class="card"><div class="section-head"><h2>Tải file nề nếp</h2></div>
      <p class="muted">File Excel (.xlsx) hoặc .csv có hàng tiêu đề, gồm các cột <b>Mã HS</b>, <b>Lỗi</b> (hoặc Nội dung/Nhận xét) và nên có <b>Ngày</b>, <b>Ghi chú</b>. Hệ thống so từng dòng với bảng điểm, khớp từ khóa nào thì tự cộng hoặc trừ điểm cho đúng học sinh, không cần duyệt. Dòng nhận xét cả lớp (không có mã học sinh) và dòng nghỉ/có phép được bỏ qua.</p>
      <div class="toolbar"><input type="file" id="dfile" accept=".xlsx,.xls,.csv"><button id="dgo" disabled>Tải lên &amp; tính điểm</button></div>
      <div id="dprev"></div><div id="dres"></div></div>
      <div id="dfiles" style="margin-top:16px"></div><div id="dun" style="margin-top:16px"></div><div id="drules" style="margin-top:16px"></div>`;
    D.parsed = null;
    $('#dfile').onchange = async (e) => {
      const f = e.target.files[0]; D.parsed = null; $('#dgo').disabled = true; $('#dres').innerHTML = ''; $('#dprev').innerHTML = '';
      if (!f) return; D.fname = f.name;
      if (f.size > 5 * 1024 * 1024) { $('#dprev').innerHTML = '<div class="notice red">File quá lớn (tối đa 5MB).</div>'; return; }
      $('#dprev').innerHTML = '<p class="muted">Đang đọc file…</p>';
      try {
        const p = await parseFile(f);
        if (p.rows.length > 3000) throw new Error('File có ' + p.rows.length + ' dòng, vượt giới hạn 3000 dòng mỗi lần. Hãy chia nhỏ file.');
        const withCode = p.rows.filter((r) => String(r.code).replace(/\D/g, '')).length, noCode = p.rows.length - withCode;
        D.parsed = p;
        $('#dprev').innerHTML = `<div class="notice ${withCode ? 'green' : 'red'}">Đọc được <b>${p.rows.length}</b> dòng (sheet “${esc(p.sheet)}”): <b>${withCode}</b> dòng có mã học sinh sẽ được tính, <b>${noCode}</b> dòng không có mã (nhận xét cả lớp) sẽ bỏ qua.${p.hasCode ? '' : ' <b>File chưa có cột “Mã HS”</b> nên chưa có dòng nào được tính.'}</div>
          <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Mã HS</th><th>Lỗi / nhận xét</th><th>Ghi chú</th></tr></thead><tbody>${p.rows.slice(0, 6).map((r) => `<tr><td>${esc(r.date || '')}</td><td>${esc(r.code)}</td><td>${esc(r.text)}</td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table></div>`;
        $('#dgo').disabled = !withCode;
      } catch (err) { $('#dprev').innerHTML = `<div class="notice red">${esc(err.message || 'Không đọc được file.')}</div>`; }
    };
    $('#dgo').onclick = async () => {
      if (!D.parsed) return; const btn = $('#dgo'); btn.disabled = true; btn.textContent = 'Đang tính điểm…';
      try {
        const r = await A.rpc('import_point_file', { p_name: D.fname, p_rows: D.parsed.rows.map((x) => ({ date: x.date, code: x.code, text: x.text, note: x.note, points: x.points })) });
        $('#dres').innerHTML = `<div class="notice green" style="margin-top:12px"><b>Đã tính xong.</b> Cộng/trừ ${r.applied} lượt (tổng ${sign(r.points_sum)} điểm).${r.unmatched ? ` ${r.unmatched} lượt có cụm từ lạ, đã báo quản trị viên xếp loại.` : ''}<br>Bỏ qua: ${r.class_level} dòng cả lớp · ${r.excused} dòng nghỉ/có phép · ${r.unknown_student} dòng không tìm thấy mã học sinh · ${r.out_of_scope} dòng ngoài lớp bạn phụ trách · ${r.blank} dòng trống.</div>`;
        D.parsed = null; $('#dfile').value = ''; $('#dprev').innerHTML = ''; SL.toast('Đã cập nhật điểm nề nếp.'); loadFiles(); if (SL.isAdmin()) loadUn();
      } catch (e) { $('#dres').innerHTML = `<div class="notice red" style="margin-top:12px">${esc(A.toApiError(e).message)}</div>`; }
      btn.textContent = 'Tải lên & tính điểm'; btn.disabled = !D.parsed;
    };
    loadFiles();
    if (SL.isAdmin()) { loadUn(); loadRules(); }
  }
};

function loadFiles() {
  const box = $('#dfiles'); if (!box) return;
  ui.load(box, () => A.rpc('list_point_files'), (files) => {
    box.innerHTML = `<div class="card"><div class="section-head"><h2>File đã tải lên</h2></div>${files.length ? `<div class="table-wrap"><table><thead><tr><th>File</th>${SL.isAdmin() ? '<th>Người tải</th>' : ''}<th>Ngày tải</th><th>Đã tính</th><th>Chờ xếp loại</th><th>Bỏ qua</th><th>Tổng điểm</th><th></th></tr></thead><tbody>${files.map((f) => `<tr><td>${esc(f.name)}</td>${SL.isAdmin() ? `<td>${esc(f.by)}</td>` : ''}<td>${esc(SL.fmtDate ? SL.fmtDate(f.created_at) : String(f.created_at).slice(0, 10))}</td><td>${f.applied}</td><td>${f.unmatched ? `<span class="badge amber">${f.unmatched}</span>` : '0'}</td><td>${f.skipped}</td><td><b style="color:${f.points_sum < 0 ? 'var(--red)' : 'var(--green)'}">${sign(f.points_sum)}</b></td><td><button class="small danger" data-del="${f.id}" data-name="${esc(f.name)}">Xóa &amp; thu hồi điểm</button></td></tr>`).join('')}</tbody></table></div>` : ui.empty('Chưa có file nào được tải lên.')}
      <p class="footer-note">Xóa một file sẽ thu hồi toàn bộ điểm mà file đó đã cộng/trừ.</p></div>`;
    box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Xóa file “' + b.dataset.name + '” và thu hồi toàn bộ điểm của file này?')) return;
      b.disabled = true;
      try { const r = await A.rpc('delete_point_file', { p_id: b.dataset.del }); SL.toast('Đã xóa file, thu hồi ' + (r.revoked || 0) + ' lượt điểm.'); loadFiles(); if (SL.isAdmin()) loadUn(); }
      catch (e) { b.disabled = false; SL.toast(A.toApiError(e).message); }
    }));
  });
}

let RULES = [];
const ruleOpts = () => { const g = {}; RULES.forEach((r) => (g[r.grp || 'Khác'] = g[r.grp || 'Khác'] || []).push(r));
  return Object.entries(g).map(([k, v]) => `<optgroup label="${esc(k)}">${v.map((r) => `<option value="${r.id}">${esc(r.name)} (${sign(r.points)})</option>`).join('')}</optgroup>`).join(''); };

async function loadUn() {
  const box = $('#dun'); if (!box) return;
  try { if (!RULES.length) RULES = await A.run(sb.from('point_rules').select('*').eq('active', true).order('sort')); } catch (e) { /* bảng điểm sẽ báo lỗi riêng */ }
  ui.load(box, () => A.rpc('list_unmatched_points'), (list) => {
    box.innerHTML = `<div class="card"><div class="section-head"><h2>Cụm từ lạ chờ xếp loại</h2><span class="muted">${list.length} cụm</span></div>${list.length ? `<p class="muted">Chọn mục điểm phù hợp: hệ thống nhớ cụm này cho các lần sau và cộng/trừ điểm ngay cho các dòng đang chờ.</p><div class="table-wrap"><table><thead><tr><th>Cụm từ</th><th>Số dòng</th><th>Điểm trong file</th><th>Xếp vào mục</th><th></th></tr></thead><tbody>${list.map((u, i) => `<tr><td>${esc(u.sample)}</td><td>${u.count}</td><td>${u.hint == null ? '—' : sign(u.hint)}</td><td><select data-u="${i}" style="min-width:260px"><option value="">— chọn mục điểm —</option>${ruleOpts()}</select></td><td class="actions"><button class="small" data-ok="${i}">Xếp loại</button><button class="small secondary" data-no="${i}">Bỏ qua</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Không còn cụm từ nào chờ xếp loại.</p>'}</div>`;
    const done = (msg) => { SL.toast(msg); loadUn(); loadFiles(); };
    box.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = async () => {
      const i = +b.dataset.ok, rule = box.querySelector('[data-u="' + i + '"]').value; if (!rule) return SL.toast('Hãy chọn mục điểm trước.');
      b.disabled = true; try { const r = await A.rpc('resolve_point_unmatched', { p_norm: list[i].norm, p_rule: rule, p_dismiss: false }); done('Đã xếp loại, tính ' + (r.applied || 0) + ' lượt điểm.'); } catch (e) { b.disabled = false; SL.toast(A.toApiError(e).message); }
    }));
    box.querySelectorAll('[data-no]').forEach((b) => (b.onclick = async () => {
      const i = +b.dataset.no; b.disabled = true; try { await A.rpc('resolve_point_unmatched', { p_norm: list[i].norm, p_rule: null, p_dismiss: true }); done('Đã bỏ qua cụm từ này.'); } catch (e) { b.disabled = false; SL.toast(A.toApiError(e).message); }
    }));
  });
}

async function loadRules() {
  const box = $('#drules'); if (!box) return;
  ui.load(box, () => A.run(sb.from('point_rules').select('*').order('sort')), (rules) => {
    RULES = rules.filter((r) => r.active);
    box.innerHTML = `<div class="card"><div class="section-head"><h2>Bảng điểm cộng/trừ</h2><span class="muted">Sửa điểm chỉ áp dụng cho các file tải lên sau này</span></div>
      <div class="table-wrap"><table><thead><tr><th>Nội dung</th><th style="width:90px">Điểm</th><th>Từ khóa tự khớp (cách nhau dấu phẩy, không cần dấu)</th><th></th></tr></thead><tbody>${rules.map((r) => `<tr><td>${esc(r.name)}<div class="muted" style="font-size:11px">${esc(r.grp || '')}</div></td><td><input type="number" data-p="${r.id}" value="${r.points}"></td><td><input data-k="${r.id}" value="${esc((r.keywords || []).join(', '))}" placeholder="để trống = chỉ xếp tay"></td><td><button class="small" data-s="${r.id}">Lưu</button></td></tr>`).join('')}</tbody></table></div></div>`;
    box.querySelectorAll('[data-s]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.s; b.disabled = true;
      try { await A.rpc('admin_update_point_rule', { p_id: id, p_points: parseInt(box.querySelector('[data-p="' + id + '"]').value, 10) || 0, p_keywords: box.querySelector('[data-k="' + id + '"]').value }); SL.toast('Đã lưu.'); RULES = []; } catch (e) { SL.toast(A.toApiError(e).message); }
      b.disabled = false;
    }));
  });
}
})();
