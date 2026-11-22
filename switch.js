/* StudyLoad · switch.js — Admin đổi nhanh sang tài khoản khác để kiểm thử, có nút nổi "Về tài khoản admin".
   Máy chủ (Edge Function admin-switch) chỉ cấp phiên khi người gọi là admin; phiên admin được cất tạm trên trình duyệt này. */
(() => {
'use strict';
const SL = window.SL, A = window.SLApi, { esc, ui, $ } = SL, sb = A.sb;
const KEY = 'sl_admin_return';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
const roleName = (u) => (u.role === 'student' && u.is_officer ? 'Cán bộ lớp' : SL.roleLabel(u.role));

async function switchTo(u) {
  const cur = (await sb.auth.getSession()).data.session;
  if (!cur) return SL.toast('Phiên đăng nhập đã hết hạn.');
  const prev = read();
  const { data, error } = await sb.functions.invoke('admin-switch', { body: { user_id: u.user_id } });
  if (error || !data || !data.token_hash) {
    let msg = (data && data.error) || '';
    try { if (!msg && error && error.context && error.context.json) msg = (await error.context.json()).error; } catch (e) { /* bỏ qua */ }
    return SL.toast(msg || 'Không đổi được tài khoản.');
  }
  // chỉ cất phiên admin thật; nếu đang ở tài khoản khác thì giữ phiên admin đã cất từ trước
  if (!prev) localStorage.setItem(KEY, JSON.stringify({ access_token: cur.access_token, refresh_token: cur.refresh_token, name: SL.current().name }));
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

SL.pages.switchacct = {
  title: 'Đổi tài khoản', sub: 'Vào nhanh một tài khoản bất kỳ để kiểm thử. Bấm nút "Về tài khoản admin" ở góc màn hình để quay lại.',
  render(el) {
    if (!SL.isAdmin() && !read()) { el.innerHTML = ui.empty('Chỉ quản trị viên mới dùng được chức năng này.'); return; }
    el.innerHTML = `<div class="card"><div class="toolbar"><input id="swq" type="search" placeholder="Tìm theo tên, mã học sinh, số điện thoại, tên tài khoản…" style="flex:1;min-width:220px"><select id="swr"><option value="all">Mọi vai trò</option><option value="student">Học sinh</option><option value="officer">Cán bộ lớp</option><option value="teacher">Giáo viên</option><option value="admin">Quản trị viên</option></select></div><div id="swList" style="margin-top:12px"></div></div>`;
    const load = () => ui.load($('#swList'), () => A.rpc('admin_search_accounts', { p_q: $('#swq').value.trim(), p_role: $('#swr').value, p_limit: 30, p_offset: 0 }), (rows) => {
      $('#swList').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Tên</th><th>Mã HS / SĐT</th><th>Vai trò</th><th></th></tr></thead><tbody>${rows.map((u, i) => `<tr><td>${esc(u.display_name || u.username || '')}</td><td>${esc(u.student_code || u.phone || '')}</td><td>${esc(roleName(u))}</td><td>${u.is_banned ? '<span class="muted">Đã khóa</span>' : `<button class="small" data-i="${i}">Vào tài khoản</button>`}</td></tr>`).join('')}</tbody></table></div>` : ui.empty('Không có tài khoản phù hợp.');
      $('#swList').querySelectorAll('[data-i]').forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = 'Đang vào…'; try { await switchTo(rows[+b.dataset.i]); } catch (e) { SL.toast(A.toApiError(e).message); } b.disabled = false; b.textContent = 'Vào tài khoản'; }));
    });
    let t; $('#swq').oninput = () => { clearTimeout(t); t = setTimeout(load, 350); };
    $('#swr').onchange = load;
    load();
  },
};

/* Nút nổi quay lại admin: hiện ở mọi trang khi máy này đang ở chế độ đổi tài khoản */
function floatBtn() {
  const s = read(), old = document.getElementById('swBack');
  if (!s) { if (old) old.remove(); return; }
  if (old) return;
  const b = document.createElement('button');
  b.id = 'swBack'; b.type = 'button';
  b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;background:#b71c1c;color:#fff;border:0;border-radius:999px;padding:12px 18px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer';
  b.textContent = '⇦ Về tài khoản admin';
  b.onclick = () => { b.disabled = true; back(); };
  document.body.appendChild(b);
}
setInterval(floatBtn, 1000); floatBtn();
// đăng xuất thủ công thì bỏ phiên admin đã cất
sb && sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && !window.__slSwitching) localStorage.removeItem(KEY); });
})();
