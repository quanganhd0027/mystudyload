/* StudyLoad · avatar.js — ảnh đại diện (công khai, tối đa 2MB, tự cắt vuông 256px) */
(function () {
  const A = window.SLApi, SL = window.SL;
  if (!A || !SL) return;
  const AV = new Map(), asked = new Set();
  const DEF = { student: '#f59e0b', officer: '#8b5cf6', teacher: '#0ea5e9', admin: '#ef4444' };
  const MAX = 2 * 1024 * 1024, OK = ['image/jpeg', 'image/png', 'image/webp'];
  const esc = SL.esc;
  const initials = (n) => { const w = String(n || '?').trim().split(/\s+/).filter(Boolean); return ((w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '?').slice(0, 2)) || '?').toUpperCase(); };
  const imgUrl = (id, ts) => A.sb.storage.from('avatars').getPublicUrl(id + '.jpg').data.publicUrl + '?v=' + ts;
  SL.av = (id, name, role, size = 32) =>
    `<span class="av" data-av="${esc(id)}" data-ini="${esc(initials(name))}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${DEF[role] || '#64748b'}" title="${esc(name || '')}">${esc(initials(name))}</span>`;
  function paint(el) {
    const ts = AV.get(el.dataset.av);
    if (!ts) { el.textContent = el.dataset.ini; return; }
    const img = new Image(); img.alt = ''; img.src = imgUrl(el.dataset.av, ts);
    img.onerror = () => { el.textContent = el.dataset.ini; };
    el.textContent = ''; el.appendChild(img);
  }
  const repaintId = (id) => document.querySelectorAll('.av[data-av="' + id + '"]').forEach(paint);
  let timer = null;
  async function fetchAsked() {
    const ids = [...asked].filter((i) => !AV.has(i)); if (!ids.length) return;
    try {
      const rows = await A.rpc('get_avatars', { p_ids: ids });
      const got = new Map((rows || []).map((r) => [r.user_id, Date.parse(r.avatar_at) || 1]));
      ids.forEach((i) => AV.set(i, got.get(i) || 0));
      ids.forEach(repaintId);
    } catch (e) { ids.forEach((i) => asked.delete(i)); }
  }
  function scan() {
    let need = false;
    document.querySelectorAll('.av[data-av]:not([data-p])').forEach((el) => {
      el.dataset.p = '1';
      if (AV.has(el.dataset.av)) paint(el); else { asked.add(el.dataset.av); need = true; }
    });
    if (need) { clearTimeout(timer); timer = setTimeout(fetchAsked, 60); }
    side();
  }
  function side() { // ảnh của chính mình: nút tài khoản trên đầu trang + thanh bên
    let me; try { me = SL.current(); } catch (e) { return; }
    if (!me || !me.id) return;
    const role = /^Cán bộ/.test(SL.myRoleText ? SL.myRoleText(SL.profile()) : '') ? 'officer' : me.role;
    const pb = document.getElementById('profileButton');
    if (pb && pb.dataset.avFor !== me.id + role) {
      pb.dataset.avFor = me.id + role; pb.innerHTML = SL.av(me.id, me.name, role, 30); pb.style.padding = '3px';
    }
    const sn = document.querySelector('.side-note');
    if (sn && !document.getElementById('sideAv')) { const d = document.createElement('div'); d.id = 'sideAv'; d.className = 'side-av'; sn.before(d); }
    const sa = document.getElementById('sideAv');
    if (sa && sa.dataset.avFor !== me.id + role) { sa.dataset.avFor = me.id + role; sa.innerHTML = SL.av(me.id, me.name, role, 44); }
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });

  function toBlob(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const s = Math.min(im.naturalWidth, im.naturalHeight), c = document.createElement('canvas'); c.width = c.height = 256;
        c.getContext('2d').drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
        URL.revokeObjectURL(url); c.toBlob((b) => (b ? res(b) : rej(new Error('Không xử lý được ảnh'))), 'image/jpeg', 0.88);
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Không đọc được ảnh này')); };
      im.src = url;
    });
  }
  SL.avatarEditor = function (id, name, role, onDone) {
    const mine = SL.current().id === id;
    SL.modal(mine ? 'Ảnh đại diện của bạn' : 'Ảnh đại diện: ' + esc(name),
      `<div class="row" style="gap:18px;align-items:center"><div id="avPrev">${SL.av(id, name, role, 96)}</div><div style="flex:1;min-width:0"><input type="file" id="avFile" accept="image/jpeg,image/png,image/webp"><p class="footer-note">JPG, PNG hoặc WebP, tối đa 2MB. Ảnh được cắt vuông ở giữa. Ảnh đại diện công khai với mọi tài khoản.</p><div id="avErr" class="notice red hidden" role="alert"></div></div></div>
       <div class="row" style="margin-top:12px"><button type="button" class="small danger" id="avDel">Xóa ảnh</button></div>`, 'Lưu ảnh');
    const err = (m) => { const e = document.getElementById('avErr'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };
    const file = document.getElementById('avFile'), sub = document.getElementById('modalSubmit'), del = document.getElementById('avDel');
    sub.disabled = true;
    file.onchange = () => {
      err(''); const f = file.files[0]; sub.disabled = true; if (!f) return;
      if (!OK.includes(f.type)) return err('Chỉ nhận ảnh JPG, PNG hoặc WebP.');
      if (f.size > MAX) return err('Ảnh quá lớn (' + (f.size / 1048576).toFixed(1) + 'MB). Tối đa 2MB.');
      const u = URL.createObjectURL(f); document.getElementById('avPrev').innerHTML = `<span class="av" style="width:96px;height:96px"><img src="${u}" alt=""></span>`; sub.disabled = false;
    };
    const done = (ts) => { AV.set(id, ts); repaintId(id); document.querySelector('[data-close]')?.click(); SL.toast(ts ? 'Đã cập nhật ảnh đại diện.' : 'Đã xóa ảnh đại diện.'); if (onDone) onDone(); };
    sub.onclick = async () => {
      const f = file.files[0]; if (!f) return; sub.disabled = true; sub.textContent = 'Đang lưu…'; err('');
      try {
        const b = await toBlob(f);
        const up = await A.sb.storage.from('avatars').upload(id + '.jpg', b, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
        if (up.error) throw up.error;
        const ts = await A.rpc('set_avatar', { p_user: id, p_has: true });
        done(Date.parse(ts) || Date.now());
      } catch (e) { err((A.toApiError ? A.toApiError(e).message : e.message) || 'Không lưu được ảnh'); sub.disabled = false; sub.textContent = 'Lưu ảnh'; }
    };
    del.onclick = async () => {
      del.disabled = true; err('');
      try { await A.sb.storage.from('avatars').remove([id + '.jpg']); await A.rpc('set_avatar', { p_user: id, p_has: false }); done(0); }
      catch (e) { err((A.toApiError ? A.toApiError(e).message : e.message) || 'Không xóa được ảnh'); del.disabled = false; }
    };
  };
  scan();
})();
