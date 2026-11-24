/* StudyLoad · switch.js — Admin đổi nhanh sang tài khoản khác để kiểm thử.
   Máy chủ (Edge Function admin-switch) chỉ cấp phiên khi người gọi là admin; phiên admin được cất tạm trên trình duyệt này.
   Khi đang ở tài khoản khác, nút nổi có 2 nút: "Về tài khoản admin" và "Đổi tài khoản khác" (dùng phiên admin đã cất). */
(() => {
'use strict';
const SL = window.SL, A = window.SLApi, { esc, ui, $ } = SL, sb = A.sb, cfg = window.STUDYLOAD_CONFIG || {};
const KEY = 'sl_admin_return';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
const roleName = (u) => (u.role === 'student' && u.is_officer ? 'Cán bộ lớp' : SL.roleLabel(u.role));

/* Client riêng chạy bằng phiên admin đã cất (tự làm mới token và cất lại token mới) */
async function adminClient() {
  const s = read(); if (!s) throw new Error('Không còn phiên admin.');
  const c = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const r = await c.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  if (r.error || !r.data.session) { localStorage.removeItem(KEY); throw new Error('Phiên admin đã hết hạn, hãy đăng nhập lại bằng tài khoản admin.'); }
  localStorage.setItem(KEY, JSON.stringify({ ...s, access_token: r.data.session.access_token, refresh_token: r.data.session.refresh_token }));
  return c;
}
// quản trị viên và giáo viên lên đầu, học sinh sau; cùng nhóm thì theo tên
const RU = { RC: {}, roleKey: (u) => u.role, roleBadge: (k) => esc(k), ...(window.SL && SL.roleUi || {}) };
const byRole = (rows) => { const rk = { admin: 0, teacher: 1 }; return rows.slice().sort((a, b) => (rk[a.role] ?? 2) - (rk[b.role] ?? 2) || String(a.display_name || a.username || '').localeCompare(String(b.display_name || b.username || ''), 'vi')); };
async function searchAccounts(q, role) {
  const prev = read();
  if (prev) { const c = await adminClient(); const r = await c.rpc('admin_search_accounts', { p_q: q, p_role: role, p_limit: 100, p_offset: 0 }); if (r.error) throw r.error; return byRole(r.data || []); }
  return byRole(await A.rpc('admin_search_accounts', { p_q: q, p_role: role, p_limit: 100, p_offset: 0 }) || []);
}

async function switchTo(u) {
  const prev = read();
  let client = sb;
  if (prev) client = await adminClient();
  else {
    const cur = (await sb.auth.getSession()).data.session;
    if (!cur) return SL.toast('Phiên đăng nhập đã hết hạn.');
  }
  const { data, error } = await client.functions.invoke('admin-switch', { body: { user_id: u.user_id } });
  if (error || !data || !data.token_hash) {
    let msg = (data && data.error) || '';
    try { if (!msg && error && error.context && error.context.json) msg = (await error.context.json()).error; } catch (e) { /* bỏ qua */ }
    return SL.toast(msg || 'Không đổi được tài khoản.');
  }
  // chỉ cất phiên admin thật; nếu đang ở tài khoản khác thì giữ phiên admin đã cất từ trước
  if (!prev) { const cur = (await sb.auth.getSession()).data.session; localStorage.setItem(KEY, JSON.stringify({ access_token: cur.access_token, refresh_token: cur.refresh_token, name: SL.current().name })); }
  const r = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
  if (r.error) { if (!prev) localStorage.removeItem(KEY); return SL.toast('Không đăng nhập được: ' + r.error.message); }
  location.reload();
}

async function back() {
  const s = read(); if (!s) return;
  const r = await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  if (r.error) { localStorage.removeItem(KEY); SL.toast('Phiên admin đã hết hạn, hãy đăng nhập lại.'); await sb.auth.signOut(); return location.reload(); }
  localStorage.removeItem(KEY);
  location.reload();
}

/* Bảng chọn tài khoản dùng chung (trang "Đổi tài khoản" và nút nổi) */
function pickerHtml() {
  return `<div class="toolbar"><input id="swq" type="search" placeholder="Tìm theo tên, mã học sinh, số điện thoại, tên tài khoản…" style="flex:1;min-width:220px"><select id="swr"><option value="all">Mọi vai trò</option><option value="student">Học sinh</option><option value="officer">Cán bộ lớp</option><option value="teacher">Giáo viên</option><option value="admin">Quản trị viên</option></select></div><div id="swList" style="margin-top:12px"></div>`;
}
function bindPicker(root) {
  const list = root.querySelector('#swList');
  const load = async () => {
    list.innerHTML = '<div class="muted">Đang tải…</div>';
    let rows;
    if (SL.roleUi && !SL.roleUi.loaded()) { try { await SL.roleUi.load(); } catch (e) { /* màu mặc định */ } }
    try { rows = await searchAccounts(root.querySelector('#swq').value.trim(), root.querySelector('#swr').value); } catch (e) { list.innerHTML = ui.empty(esc(e.message || 'Không tải được danh sách.')); return; }
    const me = SL.current().id;
    list.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Tên</th><th>Mã HS / SĐT</th><th>Vai trò</th><th></th></tr></thead><tbody>${rows.map((u, i) => { const k = RU.roleKey(u); return `<tr style="box-shadow:inset 5px 0 0 ${RU.RC[k] || 'transparent'}"><td><span class="row" style="gap:8px;flex-wrap:nowrap">${SL.av ? SL.av(u.user_id, u.display_name, k, 30) : ''}<b>${esc(u.display_name || u.username || '')}</b></span></td><td>${esc(u.student_code || u.phone || '')}</td><td>${RU.roleBadge(k)}</td><td>${u.is_banned ? '<span class="muted">Đã khóa</span>' : u.user_id === me ? '<span class="muted">Đang dùng</span>' : `<button class="small" data-i="${i}">Vào tài khoản</button>`}</td></tr>`; }).join('')}</tbody></table></div>` : ui.empty('Không có tài khoản phù hợp.');
    list.querySelectorAll('[data-i]').forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = 'Đang vào…'; try { await switchTo(rows[+b.dataset.i]); } catch (e) { SL.toast(e.message || A.toApiError(e).message); } b.disabled = false; b.textContent = 'Vào tài khoản'; }));
  };
  let t; root.querySelector('#swq').oninput = () => { clearTimeout(t); t = setTimeout(load, 350); };
  root.querySelector('#swr').onchange = load;
  load();
}

SL.pages.switchacct = {
  title: 'Đổi tài khoản', sub: 'Vào nhanh một tài khoản bất kỳ để kiểm thử. Bấm nút "Về tài khoản admin" ở góc màn hình để quay lại.',
  render(el) {
    if (!SL.isAdmin() && !read()) { el.innerHTML = ui.empty('Chỉ quản trị viên mới dùng được chức năng này.'); return; }
    el.innerHTML = `<div class="card">${pickerHtml()}</div>`;
    bindPicker(el);
  },
};

function openPicker() {
  if (document.getElementById('swPick')) return;
  const o = document.createElement('div');
  o.id = 'swPick'; o.className = 'modal-backdrop'; o.style.zIndex = 10000;
  o.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="between"><h2>Đổi sang tài khoản khác</h2><button class="secondary small" data-close>Đóng</button></div>${pickerHtml()}</div>`;
  document.body.appendChild(o);
  o.querySelector('[data-close]').onclick = () => o.remove();
  o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
  bindPicker(o);
}

/* Nút nổi khi máy này đang ở chế độ đổi tài khoản: [Đổi tài khoản khác] [Về tài khoản admin] */
function floatBtn() {
  const s = read(), old = document.getElementById('swBack');
  if (!s) { if (old) old.remove(); return; }
  if (old) return;
  const box = document.createElement('div');
  box.id = 'swBack'; box.className = 'fab-box';
  box.innerHTML = '<button type="button" class="fab" data-other>⇄ Đổi tài khoản khác</button><button type="button" class="fab back" data-back>⇦ Về tài khoản admin</button>';
  box.querySelector('[data-other]').onclick = openPicker;
  box.querySelector('[data-back]').onclick = (e) => { e.target.disabled = true; back(); };
  document.body.appendChild(box);
}
setInterval(floatBtn, 1000); floatBtn();
// đăng xuất thủ công thì bỏ phiên admin đã cất
sb && sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') localStorage.removeItem(KEY); });
})();
