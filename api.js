/* StudyLoad · api.js — toàn bộ giao tiếp với Supabase nằm ở đây. */
(() => {
'use strict';
const cfg = window.STUDYLOAD_CONFIG || {};
const configured = !!(window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey && !/YOUR_/.test(cfg.supabaseUrl + cfg.supabaseAnonKey));
const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

/* ---------- Lỗi ---------- */
class ApiError extends Error { constructor(kind, msg, raw) { super(msg); this.kind = kind; this.raw = raw; } }
function toApiError(e) {
  if (e instanceof ApiError) return e;
  const m = String(e?.message || e || ''), code = e?.code || '';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m) || (typeof navigator !== 'undefined' && !navigator.onLine))
    return new ApiError('offline', 'Mất kết nối mạng. Dữ liệu chưa được lưu.', e);
  if (code === '42501' || /row-level security|permission denied/i.test(m)) return new ApiError('unauthorized', 'Bạn không đủ quyền thực hiện thao tác này.', e);
  if (code === '23505') return new ApiError('conflict', 'Dữ liệu bị trùng với bản ghi đã có.', e);
  if (code === '23503') return new ApiError('conflict', 'Dữ liệu đang được dùng ở nơi khác hoặc tham chiếu không tồn tại.', e);
  if (code === '23514' || code === '23502' || code === '22P02') return new ApiError('validation', 'Dữ liệu không hợp lệ.', e);
  if (/JWT|token|PGRST30/i.test(m + code)) return new ApiError('auth', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', e);
  // Hàm nghiệp vụ của backend dùng RAISE EXCEPTION với thông báo tiếng Việt/Anh → hiển thị nguyên văn
  if (code === 'P0001') return new ApiError(/quyền|permission|authorized/i.test(m) ? 'unauthorized' : 'validation', m, e);
  return new ApiError('server', 'Lỗi máy chủ: ' + m, e);
}
async function run(q) {
  if (!sb) throw new ApiError('config', 'Chưa cấu hình Supabase (xem config.js).');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ApiError('offline', 'Mất kết nối mạng.');
  let r; try { r = await q; } catch (e) { throw toApiError(e); }
  if (r.error) throw toApiError(r.error);
  return r.data;
}
async function runPage(q) { // như run() nhưng trả {data, count} cho phân trang phía máy chủ
  if (!sb) throw new ApiError('config', 'Chưa cấu hình Supabase (xem config.js).');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ApiError('offline', 'Mất kết nối mạng.');
  let r; try { r = await q; } catch (e) { throw toApiError(e); }
  if (r.error) throw toApiError(r.error);
  return { data: r.data || [], count: r.count ?? 0 };
}
const rpc = (fn, args) => run(sb.rpc(fn, args || {}));
async function all(make) { // lấy hết dữ liệu theo trang 1000 dòng
  let out = [], from = 0; const step = 1000;
  for (;;) { const rows = await run(make(from, from + step - 1)); out = out.concat(rows || []); if (!rows || rows.length < step) break; from += step; }
  return out;
}

/* ---------- Xác thực ---------- */
const USER_RE = /^[a-z0-9_]{3,30}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = v => typeof v === 'string' && UUID_RE.test(v);
const auth = {
  /* Một ô duy nhất "mã học sinh hoặc số điện thoại": số điện thoại Việt Nam → kind 'phone', còn lại → mã học sinh */
  parseIdent(raw) {
    const t = String(raw || '').trim(), p = t.replace(/[\s.\-()]/g, '');
    if (/^(\+?84|0)[0-9]{8,10}$/.test(p)) { const d = p.replace(/^\+/, ''), n = d.startsWith('84') ? d : '84' + d.slice(1); return { kind: 'phone', value: p, norm: n, email: `p_${n}@mystudyload.vercel.app` }; }
    const hex = Array.from(new TextEncoder().encode(t.toLowerCase())).map(b => b.toString(16).padStart(2, '0')).join('');
    return { kind: 'code', value: t, email: `c_${hex}@mystudyload.vercel.app` };
  },
  validateRegister(f) {
    const e = {}, id = auth.parseIdent(f.ident);
    if (!(f.displayName || '').trim()) e.displayName = 'Họ tên không được để trống.';
    if (!id.value) e.ident = 'Hãy nhập mã học sinh hoặc số điện thoại.';
    else if (id.kind === 'code' && !/^[\p{L}\p{N}._\-]{2,40}$/u.test(id.value)) e.ident = 'Mã học sinh chỉ gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới (2–40 ký tự).';
    if (f.password.length < 8) e.password = 'Mật khẩu tối thiểu 8 ký tự.';
    if (f.password !== f.confirm) e.confirm = 'Mật khẩu xác nhận không khớp.';
    return e;
  },
  async signUp(f) {
    const id = auth.parseIdent(f.ident), phone = id.kind === 'phone' ? id.value : (f.phone || '').replace(/[\s.\-()]/g, '');
    let r;
    try {
      r = await sb.auth.signUp({ email: id.email, password: f.password, options: {
        data: { display_name: f.displayName.trim(), student_id: id.kind === 'code' ? id.value : '', class_name: (f.className || '').trim(),
          ...(f.wantTeacher ? { teacher_signup: 'true', phone } : {}) } } });
    } catch (e) { throw toApiError(e); }
    if (r.error) {
      if (/already|registered/i.test(r.error.message)) throw new ApiError('conflict', id.kind === 'phone' ? 'Số điện thoại này đã có tài khoản sử dụng.' : 'Mã học sinh này đã có tài khoản sử dụng.');
      if (/Database error/i.test(r.error.message)) throw new ApiError('conflict', 'Không tạo được hồ sơ (mã học sinh hoặc số điện thoại có thể đã được dùng).');
      throw toApiError(r.error);
    }
    if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) throw new ApiError('conflict', 'Tài khoản đã tồn tại.');
    return r.data.session ? 'signed_in' : 'confirm_email';
  },
  validPhone: (p) => /^(\+?84|0)[0-9]{8,10}$/.test(p || ''),
  validateTeacher(f) {
    const e = {};
    if (!f.displayName.trim()) e.displayName = 'Họ tên không được để trống.';
    if (!EMAIL_RE.test(f.email)) e.email = 'Email không hợp lệ.';
    if (!/^(\+?84|0)[0-9]{8,10}$/.test((f.phone || '').replace(/[\s.\-()]/g, ''))) e.phone = 'Số điện thoại không hợp lệ.';
    if (f.password.length < 8) e.password = 'Mật khẩu tối thiểu 8 ký tự.';
    return e;
  },
  async signUpTeacher(f) {
    const local = (f.email.split('@')[0] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]/g, '_').slice(0, 22) || 'gv';
    let username = null;
    for (let i = 0; i < 6 && !username; i++) {
      const cand = (local.length < 3 ? local + '_gv' : local) + '_' + String(Math.floor(1000 + Math.random() * 9000));
      if (await rpc('username_available', { p_username: cand })) username = cand;
    }
    if (!username) throw new ApiError('conflict', 'Không tạo được tên tài khoản, hãy thử lại.');
    let r;
    try {
      r = await sb.auth.signUp({ email: f.email, password: f.password, options: {
        emailRedirectTo: location.origin + location.pathname,
        data: { username, display_name: f.displayName.trim(), teacher_signup: 'true', phone: f.phone.replace(/[\s.\-()]/g, '') } } });
    } catch (e) { throw toApiError(e); }
    if (r.error) {
      if (/already|registered/i.test(r.error.message)) throw new ApiError('conflict', 'Email đã tồn tại.');
      if (/Database error/i.test(r.error.message)) throw new ApiError('conflict', 'Không tạo được hồ sơ (email hoặc số điện thoại có thể không hợp lệ).');
      throw toApiError(r.error);
    }
    if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) throw new ApiError('conflict', 'Email đã tồn tại.');
    return r.data.session ? 'signed_in' : 'confirm_email';
  },
  async signIn(identifier, password) {
    identifier = identifier.trim();
    let email = identifier.toLowerCase();
    if (!identifier.includes('@')) {
      email = await rpc('resolve_login', { p_username: identifier });
      if (!email) throw new ApiError('auth', 'Mã học sinh/số điện thoại hoặc mật khẩu không đúng.');
    }
    let r; try { r = await sb.auth.signInWithPassword({ email, password }); } catch (e) { throw toApiError(e); }
    if (r.error) {
      if (/not confirmed/i.test(r.error.message)) throw new ApiError('auth', 'Email chưa được xác nhận. Hãy mở thư xác nhận rồi đăng nhập lại.');
      if (/Invalid login/i.test(r.error.message)) throw new ApiError('auth', 'Mã học sinh/số điện thoại hoặc mật khẩu không đúng.');
      throw toApiError(r.error);
    }
    try { return await auth.loadProfile(); }
    catch (e) { await sb.auth.signOut(); throw e; }
  },
  signOut: () => sb.auth.signOut(),
  async session() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; },
  onChange(cb) { return sb.auth.onAuthStateChange((ev, s) => cb(ev, s)); },
  _norm(p, s) { // backend: student_id/is_banned, không có email/settings → chuẩn hóa tên trường cho giao diện
    return { ...p, email: s.user.email || '', student_code: p.student_id || '', class_name: p.class_name || '', is_locked: !!p.is_banned,
      theme: p.theme === 'dark' ? 'dark' : 'light', settings: {} };
  },
  async loadProfile() {
    const s = await auth.session(); if (!s) throw new ApiError('auth', 'Chưa đăng nhập.');
    const p = await run(sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle());
    // RLS chỉ cho đọc hồ sơ khi tài khoản còn hoạt động → rỗng nghĩa là bị khóa hoặc chưa có hồ sơ
    if (!p) throw new ApiError('auth', 'Tài khoản đã bị khóa hoặc chưa có hồ sơ. Hãy liên hệ quản trị viên.');
    return auth._norm(p, s);
  },
  async updateMyProfile(patch) {
    const s = await auth.session(), row = {};
    if ('display_name' in patch) row.display_name = (patch.display_name || '').trim() || null;
    if ('student_code' in patch) row.student_id = (patch.student_code || '').trim() || null;
    if ('class_name' in patch) row.class_name = (patch.class_name || '').trim() || null;
    if ('theme' in patch) row.theme = patch.theme;
    if (!Object.keys(row).length) return null;
    const p = await run(sb.from('profiles').update(row).eq('id', s.user.id).select().single());
    return auth._norm(p, s);
  }
};

/* ---------- Ánh xạ giá trị giữa giao diện và backend ---------- */
const STATUS_TO_DB = { todo: 'not_started', doing: 'in_progress', done: 'completed', overdue: 'not_started' };
const STATUS_FROM_DB = { not_started: 'todo', in_progress: 'doing', completed: 'done' };
const PRIO_FROM_DB = { low: 1, normal: 2, high: 3 }, PRIO_TO_DB = { 1: 'low', 2: 'normal', 3: 'high' };
const PT_FROM = { not_started: 'Chưa làm', in_progress: 'Đang làm', completed: 'Hoàn thành' };
const PT_TO = { 'Chưa làm': 'not_started', 'Đang làm': 'in_progress', 'Hoàn thành': 'completed', 'Đã hoàn thành': 'completed' };
const EV_FROM = { pending: 'Chờ xác minh', approved: 'Đã xác nhận', needs_revision: 'Yêu cầu sửa' };
const EV_TO = { 'Chờ xác minh': 'pending', 'Đã xác nhận': 'approved', 'Yêu cầu sửa': 'needs_revision' };

function taskFromRow(p, extra, sessions) {
  const a = p.assignments || {}; extra = extra || {};
  return { id: p.id, progressId: p.id, assignmentId: a.id, ownerId: p.student_id, title: a.title, description: a.description || '',
    subject: a.subjects?.name || '', subjectId: a.subject_id, kind: 'Bài tập', estimatedMinutes: a.estimated_minutes, actualMinutes: p.actual_minutes || 0,
    remainingWorkMinutes: extra.remaining ?? (p.status === 'completed' ? 0 : a.estimated_minutes), dueAt: a.deadline, priority: PRIO_FROM_DB[a.priority] || 2,
    status: STATUS_FROM_DB[p.status] || 'todo', dbStatus: p.status, sessions: sessions || [], history: Array.isArray(extra.history) ? extra.history : [],
    teacherId: a.teacher_id, classId: a.class_id, createdBy: a.created_by, source: a.source || 'teacher',
    startedAt: p.started_at, completedAt: p.completed_at, synced: true };
}

async function loadWorld(profile) {
  const isAdmin = profile.role === 'admin';
  let [classes, members, subjects, prog, sess, projs, appState] = await Promise.all([
    run(sb.from('classes').select('*').order('name')),
    isAdmin ? all((a, b) => sb.from('class_members').select('class_id,student_id').order('class_id').order('student_id').range(a, b)) : Promise.resolve([]),
    run(sb.from('subjects').select('*').order('name')),
    all((a, b) => sb.from('assignment_progress').select('*, assignments(*, subjects(name))').order('id').range(a, b)),
    all((a, b) => sb.from('study_sessions').select('*').eq('student_id', profile.id).order('id').range(a, b)),
    all((a, b) => sb.from('projects').select('*, project_members(user_id,member_role), project_tasks(*), project_resources(*), project_evidence(*)').order('id').range(a, b)),
    run(sb.from('user_app_state').select('state').eq('user_id', profile.id).maybeSingle())
  ]);
  const st = (appState && appState.state) || {};

  /* thư mục người dùng: admin xem được tất cả, người khác chỉ thấy người cùng lớp */
  const dirMap = new Map();
  const put = (id, o) => { if (id) dirMap.set(id, { ...(dirMap.get(id) || {}), ...o }); };
  const staffBy = {};
  const soft = pr => pr.catch(e => { const k = toApiError(e); if (k.kind === 'unauthorized' || /not authorized/i.test(k.message)) return null; throw e; });
  let staffRows = await Promise.all(classes.map(c => soft(rpc('get_class_staff', { p_class_id: c.id }))));
  if (!isAdmin) { // 'classes' đọc được với mọi tài khoản; chỉ giữ lớp mà tôi thực sự thuộc về (học sinh/giáo viên/chủ nhiệm)
    const keep = classes.map((c, i) => staffRows[i] !== null);
    classes = classes.filter((c, i) => keep[i]); staffRows = staffRows.filter((r, i) => keep[i]);
  }
  staffRows = staffRows.map(r => r || []);
  classes.forEach((c, i) => (staffBy[c.id] = staffRows[i]));
  if (isAdmin) {
    for (let off = 0; ; off += 100) {
      const rows = await rpc('admin_list_users', { search_text: '', page_size: 100, page_offset: off });
      (rows || []).forEach(r => put(r.user_id, { name: r.display_name || r.username, username: r.username, role: r.role, email: r.email, banned: r.is_banned }));
      if (!rows || rows.length < 100) break;
    }
  } else {
    const ros = await Promise.all(classes.map(c => rpc('get_class_roster', { target_class_id: c.id }).then(r => r || [])));
    ros.forEach((ro, i) => ro.forEach(r => { put(r.user_id, { name: r.display_name || r.username, username: r.username, role: 'student' }); members.push({ class_id: classes[i].id, student_id: r.user_id }); }));
    staffRows.forEach(sf => sf.forEach(r => put(r.user_id, { name: r.display_name, role: 'teacher' })));
  }
  put(profile.id, { name: profile.display_name || profile.username, username: profile.username, role: profile.role, email: profile.email });
  const users = [...dirMap].map(([id, d]) => ({ id, name: d.name || '', username: d.username || '', role: d.role || 'student', email: d.email || '',
    subject: '', classIds: [], studentCode: id === profile.id ? profile.student_code : '', className: id === profile.id ? profile.class_name : '', banned: !!d.banned }));
  const byId = Object.fromEntries(users.map(u => [u.id, u]));

  const cls = classes.map(c => ({ id: c.id, name: c.name, academicYear: c.academic_year || '', description: c.description || '',
    teacherIds: [], homeroomId: null, studentIds: [], source: 'server' }));
  const cmap = Object.fromEntries(cls.map(c => [c.id, c]));
  members.forEach(m => { const c = cmap[m.class_id]; if (!c) return; c.studentIds.push(m.student_id); byId[m.student_id]?.classIds.push(c.id); });
  classes.forEach(c => { const k = cmap[c.id]; k.subjectTeachers = [];
    (staffBy[c.id] || []).forEach(r => { if (!k.teacherIds.includes(r.user_id)) k.teacherIds.push(r.user_id);
      const t = byId[r.user_id]; if (t && !t.classIds.includes(c.id)) t.classIds.push(c.id);
      if (r.kind === 'homeroom') { k.homeroomId = r.user_id; if (t) t.homeroom = true; } else k.subjectTeachers.push({ teacherId: r.user_id, subjectId: r.subject_id }); }); });
  const me = byId[profile.id]; if (!me.classIds.length && !isAdmin) { /* giáo viên/hs chưa vào lớp */ }

  const extras = st.extras || {};
  const sessBy = {};
  sess.forEach(s => { (sessBy[s.progress_id] ||= []).push({ id: s.id, startAt: s.started_at, endAt: s.ended_at, minutes: s.duration_minutes || 0, completed: !!s.ended_at, planned: false, synced: true }); });
  Object.entries(extras).forEach(([pid, e]) => (e.sessions || []).forEach(s => { const a = (sessBy[pid] ||= []); if (!a.some(x => x.id === s.id)) a.push({ ...s, synced: true }); }));
  const tasks = prog.map(p => taskFromRow(p, p.student_id === profile.id ? extras[p.id] : null, p.student_id === profile.id ? (sessBy[p.id] || []) : []));
  (st.personal || []).forEach(t => tasks.push({ ...t, ownerId: profile.id, synced: true, source: t.source || 'user' }));

  const projects = projs.map(r => {
    const meta = r.meta || {}, mem = r.project_members || [], groups = meta.groups || [];
    const grpOf = uid => groups.find(g => (g.memberIds || []).includes(uid))?.id || null;
    const homeroomIds = r.class_id && cmap[r.class_id] ? [cmap[r.class_id].homeroomId].filter(Boolean) : [];
    return { id: r.id, name: r.name, description: r.description || '', classId: r.class_id, createdBy: r.created_by, deadline: r.deadline, status: r.status,
      teacherIds: [...new Set([...homeroomIds, ...(byId[r.created_by] && byId[r.created_by].role !== 'student' ? [r.created_by] : [])])],
      memberIds: mem.map(m => m.user_id), groups, history: meta.history || [],
      tasks: (r.project_tasks || []).map(t => ({ id: t.id, title: t.title, description: t.description || '', assigneeId: t.assigned_to, estimatedMinutes: t.estimated_minutes || 0,
        dueAt: t.deadline, status: PT_FROM[t.status] || 'Chưa làm', contributors: [], assignmentHistory: [], createdBy: r.created_by })),
      resources: (r.project_resources || []).map(x => ({ id: x.id, name: x.name, description: x.description || '', url: x.external_url || '', filePath: x.file_path, ownerId: x.owner_id,
        groupId: grpOf(x.owner_id), createdAt: x.created_at })),
      evidence: (r.project_evidence || []).map(x => ({ id: x.id, groupId: grpOf(x.submitted_by), title: x.title, text: x.description || '', url: x.external_url || '', filePath: x.file_path,
        submittedBy: x.submitted_by, contributors: x.contributors || [], status: EV_FROM[x.status] || 'Chờ xác minh', createdAt: x.created_at })),
      synced: true, source: 'server' };
  });
  /* nhiệm vụ nhóm được giao cho tôi → hiện trong danh sách nhiệm vụ của tôi */
  projects.forEach(p => p.tasks.filter(t => t.assigneeId === profile.id).forEach(t => tasks.push({
    id: 'pt-' + t.id, projectTaskId: t.id, projectId: p.id, ownerId: profile.id, title: t.title, description: t.description, subject: 'Dự án nhóm', kind: 'Nhiệm vụ nhóm',
    estimatedMinutes: t.estimatedMinutes || 30, actualMinutes: 0, remainingWorkMinutes: t.status === 'Hoàn thành' ? 0 : (t.estimatedMinutes || 30), dueAt: t.dueAt, priority: 2,
    status: t.status === 'Hoàn thành' ? 'done' : t.status === 'Đang làm' ? 'doing' : 'todo', sessions: [], history: [], classId: p.classId, teacherId: p.teacherIds[0], synced: true, source: 'server' })));

  return { users, classes: cls, subjects, tasks, projects,
    busy: (st.busy || []).map(b => ({ ...b, ownerId: profile.id })),
    reminderSettings: st.reminderSettings || { hours: [24, 2], studyOnly: false },
    libraries: st.library ? { [profile.id]: st.library } : {}, cycleHistory: st.cycleHistory || [] };
}

/* ---------- Đồng bộ ghi (debounce, hiển thị trạng thái Đang lưu/Đã lưu/Lỗi) ---------- */
const sync = (() => {
  let ctx = null, dirty = false, running = false, timer = null, status = 'idle', lastError = null;
  const tSig = new Map(), pSig = new Map(), pSnap = new Map(); let sSig = '', waiters = [];
  const isPersonal = (t, me) => t.ownerId === me && !t.assignmentId && !t.projectTaskId && !t.projectId;
  const isServerTask = (t, me) => t.ownerId === me && !!t.assignmentId;
  const effStatus = t => t.status === 'overdue' ? (t.dbStatus || 'not_started') : (STATUS_TO_DB[t.status] || 'not_started');
  const taskSig = t => JSON.stringify([t.title, t.subject, t.kind, t.estimatedMinutes, t.dueAt, t.priority, t.assignmentId ? effStatus(t) : t.status, t.actualMinutes, t.remainingWorkMinutes,
    (t.history || []).length, t.description, (t.sessions || []).map(s => s.id + (s.completed ? 1 : 0) + (s.synced ? 1 : 0)).join()]);
  const projSig = p => JSON.stringify([p.name, p.description, p.classId, p.memberIds, p.groups, p.history, p.tasks, p.resources, p.evidence]);
  const stateDoc = (st, me) => ({ v: 1,
    busy: st.busy.filter(b => b.ownerId === me).map(({ ownerId, source, ...r }) => r),
    reminderSettings: st.reminderSettings, library: st.libraries[me] || [], cycleHistory: st.cycleHistory || [],
    personal: st.tasks.filter(t => isPersonal(t, me)).map(({ synced, ...t }) => t),
    extras: Object.fromEntries(st.tasks.filter(t => isServerTask(t, me)).map(t => [t.progressId || t.id, { remaining: t.remainingWorkMinutes, history: t.history || [], sessions: (t.sessions || []).map(({ synced, ...s }) => s) }])) });
  const setStatus = (s, err) => { status = s; lastError = err || null; ctx?.onStatus?.(s, err); };

  async function pushServerTask(t) { // học sinh chỉ cập nhật tiến độ của chính mình; RLS + trigger của máy chủ kiểm tra lại
    const now = new Date().toISOString();
    if (effStatus(t) !== 'not_started' && !t.startedAt) t.startedAt = now;
    if (t.status === 'done' && !t.completedAt) t.completedAt = now;
    const dbs = effStatus(t); t.dbStatus = dbs;
    const row = { status: dbs, actual_minutes: Math.max(0, Math.round(+t.actualMinutes || 0)),
      started_at: dbs === 'not_started' ? null : t.startedAt, completed_at: dbs === 'completed' ? t.completedAt : null };
    if (row.completed_at && row.started_at && row.completed_at < row.started_at) row.started_at = row.completed_at;
    await run(sb.from('assignment_progress').update(row).eq('id', t.progressId || t.id));
  }
  async function pushProjectTaskStatus(t) {
    const want = t.status === 'done' ? 'completed' : t.status === 'doing' ? 'in_progress' : 'not_started';
    await rpc('update_project_task_status', { p_task_id: t.projectTaskId, p_status: want });
  }
  async function pushProject(p, me) {
    const snap = pSnap.get(p.id) || { tasks: new Map(), res: new Set(), ev: new Map(), mem: new Set() };
    const meta = { groups: p.groups || [], history: p.history || [] };
    const leaders = new Set((p.groups || []).map(g => g.leaderId).filter(Boolean));
    if (!p.synced) {
      p.createdBy = me;
      const row = await run(sb.from('projects').insert({ name: p.name, description: p.description || null, class_id: p.classId || null, created_by: me, meta }).select('id').single());
      const old = p.id; p.id = row.id; pSig.delete(old); pSnap.delete(old);
      ctx.getState().tasks.forEach(t => { if (t.projectId === old) t.projectId = p.id; });
    } else if (p.createdBy === me || ctx.isAdmin() || (p.teacherIds || []).includes(me)) {
      await run(sb.from('projects').update({ name: p.name, description: p.description || null, meta }).eq('id', p.id));
    }
    const wantMem = new Set(p.memberIds || []);
    for (const u of wantMem) if (!snap.mem.has(u)) await run(sb.from('project_members').insert({ project_id: p.id, user_id: u, member_role: leaders.has(u) ? 'leader' : 'member' }));
    for (const u of snap.mem) if (!wantMem.has(u)) await run(sb.from('project_members').delete().eq('project_id', p.id).eq('user_id', u));
    for (const t of p.tasks || []) {
      const want = PT_TO[t.status] || 'not_started';
      if (!isUuid(t.id) || !snap.tasks.has(t.id)) {
        const id = await rpc('create_project_task', { p_project_id: p.id, p_title: t.title, p_description: t.description || null, p_assigned_to: t.assigneeId || null,
          p_estimated_minutes: Math.max(1, Math.round(+t.estimatedMinutes || 30)), p_deadline: t.dueAt || null });
        t.id = id; if (want !== 'not_started') await rpc('update_project_task_status', { p_task_id: id, p_status: want });
      } else if (snap.tasks.get(t.id) !== want) await rpc('update_project_task_status', { p_task_id: t.id, p_status: want });
    }
    for (const id of snap.tasks.keys()) if (!(p.tasks || []).some(t => t.id === id)) await run(sb.from('project_tasks').delete().eq('id', id));
    for (const r of p.resources || []) if (!isUuid(r.id) || !snap.res.has(r.id)) {
      if (!isUuid(r.id)) r.id = uuid();
      await run(sb.from('project_resources').insert({ id: r.id, project_id: p.id, name: r.name, description: r.description || null, external_url: r.url || null, owner_id: me }));
    }
    for (const id of snap.res) if (!(p.resources || []).some(r => r.id === id)) await run(sb.from('project_resources').delete().eq('id', id));
    for (const e of p.evidence || []) {
      const want = EV_TO[e.status] || 'pending';
      if (!isUuid(e.id) || !snap.ev.has(e.id)) {
        if (!isUuid(e.id)) e.id = uuid();
        await run(sb.from('project_evidence').insert({ id: e.id, project_id: p.id, title: e.title, description: e.text || null, external_url: e.url || null, submitted_by: me,
          contributors: (e.contributors || []).filter(isUuid), status: 'pending' }));
        if (want !== 'pending') await run(sb.from('project_evidence').update({ status: want, reviewed_by: me, reviewed_at: new Date().toISOString() }).eq('id', e.id));
      } else if (snap.ev.get(e.id) !== want) await run(sb.from('project_evidence').update({ status: want, reviewed_by: me, reviewed_at: new Date().toISOString() }).eq('id', e.id));
    }
    for (const id of snap.ev.keys()) if (!(p.evidence || []).some(e => e.id === id)) await run(sb.from('project_evidence').delete().eq('id', id));
    p.synced = true; takeSnap(p);
  }
  function takeSnap(p) {
    pSnap.set(p.id, { tasks: new Map((p.tasks || []).filter(t => isUuid(t.id)).map(t => [t.id, PT_TO[t.status] || 'not_started'])),
      res: new Set((p.resources || []).filter(r => isUuid(r.id)).map(r => r.id)), ev: new Map((p.evidence || []).filter(e => isUuid(e.id)).map(e => [e.id, EV_TO[e.status] || 'pending'])),
      mem: new Set(p.memberIds || []) });
  }
  async function flushOnce() {
    const st = ctx.getState(), me = ctx.me();
    for (const t of st.tasks) {
      if (t.ownerId !== me) continue;
      if (tSig.get(t.id) === taskSig(t)) continue;
      if (t.assignmentId) await pushServerTask(t);
      else if (t.projectTaskId) await pushProjectTaskStatus(t);
      tSig.set(t.id, taskSig(t));
    }
    for (const p of st.projects) {
      if (pSig.get(p.id) === projSig(p)) continue;
      await pushProject(p, me); pSig.set(p.id, projSig(p));
    }
    const sj = JSON.stringify(stateDoc(st, me));
    if (sj !== sSig) { await run(sb.from('user_app_state').upsert({ user_id: me, state: JSON.parse(sj) }, { onConflict: 'user_id' })); sSig = sj; }
  }
  async function flush() {
    if (!ctx || running) return; running = true; clearTimeout(timer);
    try {
      while (dirty) { dirty = false; setStatus('saving'); await flushOnce(); }
      setStatus('saved'); const w = waiters; waiters = []; w.forEach(f => f(null));
    } catch (e) {
      const err = toApiError(e); setStatus('error', err); const w = waiters; waiters = []; w.forEach(f => f(err));
      if (err.kind === 'unauthorized' || err.kind === 'conflict' || err.kind === 'validation') ctx.onRejected?.(err); // giao diện đã đi trước máy chủ → tải lại từ máy chủ
    } finally { running = false; }
  }
  return {
    init(c) { ctx = c; dirty = false; running = false; waiters = []; tSig.clear(); pSig.clear(); pSnap.clear(); const st = c.getState(), me = c.me();
      st.tasks.forEach(t => tSig.set(t.id, taskSig(t))); st.projects.forEach(p => { pSig.set(p.id, projSig(p)); takeSnap(p); }); sSig = JSON.stringify(stateDoc(st, me)); setStatus('idle'); },
    markDirty() { if (!ctx) return; dirty = true; setStatus('saving'); clearTimeout(timer); timer = setTimeout(flush, 500); },
    retry() { dirty = true; return flush(); },
    pending: () => dirty || running,
    afterFlush(cb) { waiters.push(cb); },
    stop() { ctx = null; clearTimeout(timer); dirty = false; },
    get status() { return status; }, get lastError() { return lastError; }
  };
})();

/* ---------- Tệp minh chứng (bucket riêng tư; đường dẫn bắt buộc bắt đầu bằng <user_id>/) ---------- */
const EV = { assignment: { table: 'assignment_evidence', bucket: 'assignment-evidence', fk: 'progress_id' },
             duty: { table: 'duty_evidence', bucket: 'duty-evidence', fk: 'duty_schedule_id' } };
const evidence = {
  list: (kind, id) => run(sb.from(EV[kind].table).select('*').eq(EV[kind].fk, id).order('created_at')),
  limits: kind => (cfg.evidence || {})[kind] || { maxBytes: 5 * 1024 * 1024, mime: [] },
  async upload(kind, id, file, note) {
    const e = EV[kind], lim = evidence.limits(kind);
    if (!file && !(note || '').trim()) throw new ApiError('validation', 'Hãy chọn tệp hoặc nhập ghi chú.');
    let path = null;
    if (file) {
      if (file.size > lim.maxBytes) throw new ApiError('validation', `Tệp quá lớn (tối đa ${Math.round(lim.maxBytes / 1048576)} MB).`);
      if (lim.mime.length && !lim.mime.includes(file.type)) throw new ApiError('validation', 'Loại tệp không được phép.');
      const s = await auth.session(), safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80); path = `${s.user.id}/${id}/${uuid()}-${safe}`;
      const up = await sb.storage.from(e.bucket).upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw toApiError(up.error);
    }
    try {
      if (kind === 'duty') { await rpc('submit_duty_evidence', { p_duty_schedule_id: id, p_file_path: path, p_note: (note || '').trim() || null }); return true; }
      const s = await auth.session();
      return await run(sb.from(e.table).insert({ progress_id: id, student_id: s.user.id, file_path: path, note: (note || '').trim() || null }).select().single());
    } catch (err) { if (path) await sb.storage.from(e.bucket).remove([path]); throw err; }
  },
  async url(kind, row) { if (!row.file_path) return null; const r = await sb.storage.from(EV[kind].bucket).createSignedUrl(row.file_path, 120); if (r.error) throw toApiError(r.error); return r.data.signedUrl; },
  async remove(kind, row) {
    if (kind === 'duty') throw new ApiError('unauthorized', 'Minh chứng trực nhật đã nộp không thể xóa. Hãy nộp lại bản mới.');
    await run(sb.from(EV[kind].table).delete().eq('id', row.id));
  }
};

window.SLApi = { configured, sb, uuid, isUuid, ApiError, toApiError, run, runPage, rpc, all, auth, loadWorld, sync, evidence, STATUS_TO_DB, PRIO_TO_DB, PRIO_FROM_DB };
})();
