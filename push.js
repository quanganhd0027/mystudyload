/* StudyLoad · push.js — bật/tắt thông báo đẩy trên thiết bị này + hộp thư thông báo từ máy chủ */
(() => {
'use strict';
const SL = window.SL, A = window.SLApi;
const VAPID_PUBLIC = 'BAj1vKcm4GFHUk6Zwov7CQfqW7SFQcU6amrG0gLp_VUFbBxfat6G-p-mzv9ggmTV768fY5OGJL-eaQD55mwMO_I';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), r = (s + p).replace(/-/g, '+').replace(/_/g, '/'), raw = atob(r); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
const buf64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const reg = async () => (await navigator.serviceWorker.getRegistration('/')) || navigator.serviceWorker.register('/sw.js', { scope: '/' });
const current = async () => { if (!supported()) return null; const r = await navigator.serviceWorker.getRegistration('/'); return r ? r.pushManager.getSubscription() : null; };
const save = async (sub) => { const j = sub.toJSON(); await A.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_device: String(navigator.platform || '').slice(0, 60) }); };

async function enable() {
  if (!supported()) throw new Error('Trình duyệt này không hỗ trợ thông báo đẩy.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bạn chưa cho phép thông báo. Hãy bấm "Cho phép" khi trình duyệt hỏi.');
  await reg(); const r = await navigator.serviceWorker.ready;
  const sub = (await r.pushManager.getSubscription()) || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) }));
  await save(sub);
}
async function disable() {
  const sub = await current(); if (!sub) return;
  try { await A.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); } catch (_) { /* vẫn hủy đăng ký ở trình duyệt */ }
  await sub.unsubscribe();
}
/* Gọi sau khi đăng nhập: nếu thiết bị đã cho phép thì gắn lại đăng ký với tài khoản đang dùng. */
async function sync() {
  try { if (!supported() || Notification.permission !== 'granted') return; const sub = await current(); if (sub) await save(sub); } catch (_) { /* bỏ qua */ }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'go' && e.data.page) SL.go?.(e.data.page); });

const COLORS = { default: '#5548e8', blue: '#2563eb', green: '#16845b', red: '#c62828', amber: '#a86600', purple: '#8b3fd9', pink: '#d6336c', teal: '#0f8b8d' };
const fmt = (d) => (SL.fmtDate ? SL.fmtDate(d) : new Date(d).toLocaleString('vi-VN'));
async function draw(root) {
  const card = root.querySelector('#pushCard'); if (!card) return;
  const msg = card.querySelector('#pushMsg'), acts = card.querySelector('#pushActs');
  const sub = await current().catch(() => null);
  const btn = (id, t, cls = '') => `<button id="${id}" class="${cls}">${t}</button>`;
  if (!supported()) { msg.textContent = 'Trình duyệt này không hỗ trợ thông báo đẩy. Hãy dùng Chrome, Edge, Firefox hoặc Safari bản mới (trên iPhone cần thêm StudyLoad vào màn hình chính).'; acts.innerHTML = ''; return; }
  if (Notification.permission === 'denied') { msg.textContent = 'Trình duyệt đang chặn thông báo của trang này. Bấm biểu tượng ổ khóa cạnh địa chỉ web → Thông báo → Cho phép, rồi tải lại trang.'; acts.innerHTML = ''; return; }
  if (sub) { msg.textContent = 'Đang BẬT trên thiết bị này. Thông báo vẫn hiện ở góc màn hình khi bạn đã đóng hoặc chuyển sang tab khác (miễn là trình duyệt còn chạy).'; acts.innerHTML = btn('pushTest', 'Gửi thông báo thử', 'secondary') + ' ' + btn('pushOff', 'Tắt trên thiết bị này', 'secondary'); }
  else { msg.textContent = 'Đang TẮT trên thiết bị này. Bật để nhận thông báo kể cả khi không mở StudyLoad.'; acts.innerHTML = btn('pushOn', 'Bật thông báo trên màn hình'); }
  const run = (id, fn, ok) => { const b = card.querySelector('#' + id); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); if (ok) SL.toast(ok); } catch (e) { SL.toast(A.toApiError ? A.toApiError(e).message : e.message); } draw(root); }; };
  run('pushOn', enable, 'Đã bật thông báo trên thiết bị này.');
  run('pushOff', disable, 'Đã tắt thông báo trên thiết bị này.');
  run('pushTest', () => A.rpc('send_test_notification'), 'Đã gửi. Thông báo sẽ hiện trong vài giây.');
}
async function drawInbox(root) {
  const box = root.querySelector('#srvNotes'); if (!box) return;
  try {
    const rows = await A.rpc('my_notifications', { p_limit: 50 });
    box.innerHTML = '<h2>Thông báo từ hệ thống</h2>' + (rows.length ? rows.map((n) => `<div class="item" style="border-left:4px solid ${COLORS[n.color] || COLORS.default}"><div><div class="item-title">${SL.esc(n.title)} ${n.read_at ? '' : '<span class="badge">Mới</span>'}</div><div>${SL.esc(n.body || '')}</div><div class="item-meta">${fmt(n.created_at)}</div></div></div>`).join('') + '<div style="margin-top:8px"><button class="small secondary" id="srvRead">Đánh dấu đã đọc</button></div>' : '<div class="empty">Chưa có thông báo nào từ hệ thống.</div>');
    const r = box.querySelector('#srvRead'); if (r) r.onclick = async () => { await A.rpc('mark_my_notifications_read'); drawInbox(root); };
  } catch (_) { box.innerHTML = ''; }
}
SL.afterNotifications = (root) => {
  const host = document.createElement('div');
  host.innerHTML = '<div class="card" id="pushCard" style="margin-top:16px"><h2>Thông báo trên màn hình máy tính</h2><p class="muted" id="pushMsg"></p><div id="pushActs"></div></div><div class="card" id="srvNotes" style="margin-top:16px"></div>';
  while (host.firstChild) root.appendChild(host.firstChild);
  draw(root); drawInbox(root);
};
window.SLPush = { supported, enable, disable, sync };
})();
