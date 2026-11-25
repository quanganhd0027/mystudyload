(() => {
  "use strict";
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)];
  const now = () => new Date(),
    iso = (d) => new Date(d).toISOString(),
    localDay = (d) => {
      let x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    };
  const uid = () => window.SLApi.uuid();
  const fmtDate = (d) =>
    d
      ? new Date(d).toLocaleString("vi-VN", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "Chưa đặt";
  const fmtMinutes = (m) =>
    `${Math.floor(Math.max(0, m) / 60)} giờ ${Math.round(Math.max(0, m) % 60)} phút`;
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const DAY = 86400000;
  const emptyState = () => ({
    version: 1,
    users: [],
    currentUserId: "",
    tasks: [],
    busy: [],
    classes: [],
    projects: [],
    libraries: {},
    notifications: [],
    reminderSettings: { hours: [24, 2], studyOnly: false },
    cycleHistory: [],
    activeCycle: null,
    viewDate: localDay(now()),
    weekMode: "week",
  });
  let state = emptyState();
  // TẠM THỜI: học sinh chỉ thấy Nhiệm vụ + Hồ sơ (đặt false để bật lại các mục khác)
  const HIDE_TODO_CARD = true; // TẠM THỜI: ẩn thẻ "việc cần làm" ở Tổng quan của học sinh (đặt false để bật lại)
  const STUDENT_LITE = true; let STUDENT_KEEP = ["tasks", "profile"], liteOfficer = false;
  const isLite = () => STUDENT_LITE && current().role === "student";
  let page = "dashboard",
    timer = {
      taskId: null,
      status: "idle",
      accum: 0,
      startedAt: null,
      autoPausePrompted: false,
    },
    timerInterval = null,
    calendarMode = "week",
    libraryTab = "personal",
    extraStudyChooser = false,
    extraPromptDismissedDay = null,
    extraOverloadNotice = "",
    taskShown = 20;
  function save() {
    window.SLApi.sync.markDirty(); // ghi lên Supabase (debounce); không còn lưu localStorage
  }
  function current() {
    return (
      state.users.find((u) => u.id === state.currentUserId) ||
      state.users[0] || { id: "", name: "", role: "student", classIds: [] }
    );
  }
  function isStudent(u = current()) {
    return u.role === "student";
  }
  function isTeacher(u = current()) {
    return u.role === "teacher" || u.role === "admin";
  }
  function isAdmin(u = current()) {
    return u.role === "admin";
  }
  /* ===================== Xác thực & phiên (Supabase Auth) ===================== */
  const A = window.SLApi;
  const roleLabel = (r) => (r === "admin" ? "Quản trị viên" : r === "teacher" ? "Giáo viên" : "Học sinh");
  let myOfficer = []; // các lớp mà tài khoản học sinh này đang là cán bộ lớp
  const myRoleText = (p) => (p && p.role === "student" && myOfficer.length ? "Cán bộ lớp · " + myOfficer.join(", ") : roleLabel(p && p.role));
  const world = { subjects: [], profile: null };
  let toastTimer = null;
  function showToast(s) {
    $("#toastRoot").innerHTML = `<div class="toast">${esc(s)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("#toastRoot").innerHTML = ""), 3200);
  }
  function authShell(inner) {
    document.querySelector(".app").classList.add("hidden");
    const root = $("#authRoot");
    root.classList.remove("hidden");
    root.innerHTML = `<div class="auth-shell"><section class="auth-brand"><div class="auth-logo">Study<span>Load</span></div><p class="auth-kicker">HỌC TẬP CÓ KẾ HOẠCH</p><h1>Học đúng việc.<br>Đúng thời điểm.</h1><p>Theo dõi nhiệm vụ, sắp xếp thời gian và cùng giáo viên tiến bộ mỗi ngày.</p><div class="auth-decoration"><span>✓</span><span>◷</span><span>↗</span></div></section><section class="auth-panel"><div class="auth-card">${inner}</div></section></div>`;
  }
  function showLoading(msg) {
    authShell(`<h2>${esc(msg)}</h2><div class="skeleton"></div><div class="skeleton short"></div>`);
  }
  function showFatal(msg) {
    authShell(`<h2>Không tải được dữ liệu</h2><div class="notice red">${esc(msg)}</div><div class="row"><button id="fatalRetry">Thử lại</button><button class="secondary" id="fatalOut">Đăng xuất</button></div>`);
    $("#fatalRetry").onclick = bootAuth;
    $("#fatalOut").onclick = logout;
  }
  function showSetup() {
    authShell(`<h2>Chưa kết nối Supabase</h2><div class="notice">Mở file <b>config.js</b> và điền <b>supabaseUrl</b> + <b>supabaseAnonKey</b> (Supabase → Project Settings → API). Xem HUONG_DAN_SUPABASE.md.</div><p class="auth-legal">Không dán khóa service_role vào giao diện.</p>`);
  }
  const authTabs = (mode) => `<div class="auth-tabs">${[["login", "Đăng nhập"], ["register", "Đăng kí"]].map(([k, l]) => `<button type="button" data-auth-mode="${k}" class="${mode === k ? "selected" : ""}">${l}</button>`).join("")}</div>`;
  function showTeacherAuth(message = "", v = {}) {
    const val = (k) => esc(v[k] || "");
    authShell(`${authTabs("teacher")}<h2>Đăng ký giáo viên</h2><p class="muted">Điền thông tin để gửi yêu cầu tạo tài khoản giáo viên. Quản trị viên sẽ duyệt; trong lúc chờ bạn đăng nhập như học sinh.</p>${message ? `<div class="notice ${/^Lỗi/.test(message) ? "red" : "green"}" role="alert">${esc(message)}</div>` : ""}<form id="authForm" novalidate><label for="tName">Họ và tên *</label><input id="tName" name="displayName" required maxlength="60" autocomplete="name" value="${val("displayName")}"><label for="tPhone">Số điện thoại *</label><input id="tPhone" name="phone" type="tel" required maxlength="20" autocomplete="tel" placeholder="vd: 0912345678" value="${val("phone")}"><label for="authPassword">Mật khẩu *</label><input id="authPassword" name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Ít nhất 8 ký tự"><label class="checkrow"><input type="checkbox" id="tShow"> Hiện mật khẩu</label><button class="auth-submit" type="submit">Gửi đăng ký giáo viên</button><p class="auth-hint">Sau khi được duyệt, đăng nhập bằng email và mật khẩu ở tab Đăng nhập.</p></form>`);
    $("#authRoot").querySelectorAll("[data-auth-mode]").forEach((b) => (b.onclick = () => showAuth(b.dataset.authMode)));
    $("#tShow").onchange = (e) => ($("#authPassword").type = e.target.checked ? "text" : "password");
    $("#authForm").onsubmit = registerTeacher;
  }
  async function registerTeacher(e) {
    e.preventDefault();
    const form = e.currentTarget, v = formVals(form);
    v.password = String(new FormData(form).get("password") || "");
    const errs = A.auth.validateTeacher(v);
    if (Object.keys(errs).length) return showTeacherAuth("Lỗi: " + Object.values(errs).join(" "), v);
    busy(form, true);
    try {
      const r = await A.auth.signUpTeacher(v);
      if (r === "signed_in") { await bootAuth(); showToast("Đã gửi đăng ký giáo viên. Quản trị viên sẽ duyệt yêu cầu của bạn."); return; }
      showAuth("login", "Đã gửi đăng ký giáo viên. Hãy đăng nhập bằng số điện thoại và mật khẩu.", { login: v.phone });
    } catch (err) { showTeacherAuth("Lỗi: " + A.toApiError(err).message, { ...v, password: "" }); }
  }
  function showAuth(mode = "login", message = "", v = {}) {
    if (!A.configured) return showSetup();
    if (mode === "teacher") return showTeacherAuth(message, v);
    const register = mode === "register", val = (k) => esc(v[k] || "");
    authShell(`${authTabs(mode)}<h2>${register ? "Tạo tài khoản mới" : "Chào mừng bạn quay lại"}</h2><p class="muted">${register ? "Điền thông tin để bắt đầu sử dụng StudyLoad." : "Nhập mã học sinh hoặc số điện thoại và mật khẩu."}</p>${message ? `<div class="notice ${/^Lỗi/.test(message) ? "red" : "green"}" role="alert">${esc(message)}</div>` : ""}${register && v.dupCode ? '<button type="button" class="secondary" id="codeReportBtn" style="width:100%;margin-top:10px">Mã học sinh của bạn bị dùng?</button>' : ""}<form id="authForm" novalidate>${register ? `<label for="authName">Họ và tên *</label><input id="authName" name="displayName" required maxlength="60" autocomplete="name" value="${val("displayName")}"><label for="authIdent">Mã học sinh hoặc số điện thoại *</label><input id="authIdent" name="ident" required maxlength="40" autocomplete="username" placeholder="Mã học sinh (4-10 số) hoặc số điện thoại" value="${val("ident")}"><p class="auth-hint">Chỉ dùng <b>một</b> trong hai: mã học sinh gồm 4 đến 10 chữ số, hoặc số điện thoại. Đây là thông tin bạn dùng để đăng nhập.</p><label for="authClass">Lớp (nếu có)</label><input id="authClass" name="className" maxlength="40" value="${val("className")}">` : `<label for="authLogin">Mã học sinh hoặc số điện thoại</label><input id="authLogin" name="login" required autocomplete="username" placeholder="Mã học sinh hoặc số điện thoại" value="${val("login")}"><p class="auth-hint">Giáo viên đăng nhập bằng số điện thoại.</p>`}<label for="authPassword">Mật khẩu *</label><input id="authPassword" name="password" type="password" required ${register ? 'minlength="8"' : ""} autocomplete="${register ? "new-password" : "current-password"}" placeholder="${register ? "Ít nhất 8 ký tự" : "Mật khẩu"}">${register ? '<label for="authConfirm">Xác nhận mật khẩu *</label><input id="authConfirm" name="confirm" type="password" required autocomplete="new-password"><p class="auth-hint">Tài khoản mới mặc định là học sinh. Giáo viên hãy dùng tab "Đăng ký giáo viên".</p>' : ""}<button class="auth-submit" type="submit">${register ? "Tạo tài khoản" : "Đăng nhập"}</button></form>`);
    $("#authRoot").querySelectorAll("[data-auth-mode]").forEach((b) => (b.onclick = () => showAuth(b.dataset.authMode)));
    $("#authForm").onsubmit = register ? registerAccount : loginAccount;
    if (register && $("#authIdent")) A.auth.bindIdentInput($("#authIdent"), "both");
    if (!register && $("#authLogin")) { const li = $("#authLogin"); A.auth.bindIdentInput(li, "both"); li.setAttribute("autocomplete", "username"); }
    const rb = $("#codeReportBtn"); if (rb) rb.onclick = () => showCodeReport(v);
  }
  function showCodeReport(v = {}, message = "") {
    const val = (k) => esc(v[k] || "");
    authShell(`<h2>Mã học sinh của bạn bị dùng?</h2><p class="muted">Điền thông tin của bạn để quản trị viên kiểm tra và xử lý.</p>${message ? `<div class="notice red" role="alert">${esc(message)}</div>` : ""}<form id="codeForm" novalidate><label for="rName">Họ và tên *</label><input id="rName" name="name" required maxlength="80" value="${val("displayName")}"><label for="rClass">Lớp *</label><input id="rClass" name="cls" required maxlength="40" value="${val("className")}"><label for="rCode">Mã học sinh *</label><input id="rCode" name="code" required maxlength="40" value="${val("studentCode")}"><label for="rContact">Cách liên hệ (email hoặc SĐT, không bắt buộc)</label><input id="rContact" name="contact" maxlength="100"><button class="auth-submit" type="submit">Gửi yêu cầu</button><button type="button" class="secondary" id="rBack" style="width:100%;margin-top:10px">Quay lại đăng ký</button></form>`);
    $("#rBack").onclick = () => showAuth("register", "", v);
    $("#codeForm").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget, f = formVals(form);
      if (!f.name || !f.cls || !f.code) return showCodeReport({ displayName: f.name, className: f.cls, studentCode: f.code }, "Hãy điền đủ họ tên, lớp và mã học sinh.");
      busy(form, true);
      try {
        await A.rpc("report_student_code_conflict", { p_name: f.name, p_class: f.cls, p_code: f.code, p_contact: f.contact || null });
        authShell(`<h2>Đã gửi yêu cầu</h2><div class="notice green" role="status">Yêu cầu của bạn đã được gửi, vui lòng chờ quản trị viên xử lý.</div><button class="auth-submit" type="button" id="rDone">Về trang đăng nhập</button>`);
        $("#rDone").onclick = () => showAuth("login");
      } catch (err) { showCodeReport({ displayName: f.name, className: f.cls, studentCode: f.code }, A.toApiError(err).message); }
    };
  }
  const formVals = (form) => Object.fromEntries([...new FormData(form).entries()].map(([k, x]) => [k, String(x).trim()]));
  function busy(form, on) {
    const b = form.querySelector(".auth-submit");
    b.disabled = on;
    b.dataset.t = b.dataset.t || b.textContent;
    b.textContent = on ? "Đang xử lý…" : b.dataset.t;
  }
  async function registerAccount(e) {
    e.preventDefault();
    const form = e.currentTarget, raw = new FormData(form), v = formVals(form);
    v.password = String(raw.get("password") || "");
    v.confirm = String(raw.get("confirm") || "");
    const errs = A.auth.validateRegister(v);
    const id = A.auth.parseIdent(v.ident);
    if (Object.keys(errs).length) return showAuth("register", "Lỗi: " + Object.values(errs).join(" "), v);
    if (id.kind === "code") {
      try { if (!(await A.rpc("student_code_available", { p_code: id.value }))) return showAuth("register", "Lỗi: Mã học sinh này đã có tài khoản sử dụng.", { ...v, studentCode: id.value, dupCode: "1" }); }
      catch (err) { return showAuth("register", "Lỗi: " + A.toApiError(err).message, v); }
    }
    busy(form, true);
    try {
      const r = await A.auth.signUp(v);
      if (r === "signed_in") return bootAuth();
      showAuth("login", "Đăng ký thành công. Hãy đăng nhập.", { login: id.value });
    } catch (err) {
      showAuth("register", "Lỗi: " + A.toApiError(err).message, { ...v, password: "", confirm: "" });
    }
  }
  async function loginAccount(e) {
    e.preventDefault();
    const form = e.currentTarget, v = formVals(form), pw = String(new FormData(form).get("password") || "");
    if (!v.login || !pw) return showAuth("login", "Lỗi: Nhập mã học sinh/số điện thoại và mật khẩu.", v);
    busy(form, true);
    let profile;
    try { profile = await A.auth.signIn(v.login, pw); }
    catch (err) { if (A.toApiError(err).kind === "locked") return showLock(A.toApiError(err).message); return showAuth("login", "Lỗi: " + A.toApiError(err).message, { login: v.login }); }
    await enterApp(profile);
  }
  function applyWorld(w, profile) {
    state = Object.assign(emptyState(), { users: w.users, currentUserId: profile.id, tasks: w.tasks, busy: w.busy, classes: w.classes,
      projects: w.projects, libraries: w.libraries, reminderSettings: w.reminderSettings, cycleHistory: w.cycleHistory });
    world.subjects = w.subjects;
    world.profile = profile;
    document.documentElement.dataset.theme = profile.theme || "light";
    A.rpc("my_accent").then((a) => { document.documentElement.dataset.accent = a || "default"; }).catch(() => {});
  }
  async function enterApp(profile) {
    showLoading("Đang tải dữ liệu…");
    try {
      applyWorld(await A.loadWorld(profile), profile);
    } catch (err) { return showFatal(A.toApiError(err).message); }
    A.sync.init({ getState: () => state, me: () => state.currentUserId, isAdmin: () => isAdmin(), onStatus: updateSaveChip,
      onRejected: () => reloadWorld("Máy chủ từ chối thay đổi, đã tải lại dữ liệu chuẩn.") });
    $("#authRoot").classList.add("hidden");
    document.querySelector(".app").classList.remove("hidden");
    document.querySelector(".side-note").textContent = "Tài khoản: " + profile.display_name + " · " + roleLabel(profile.role);
    buildNav();
    page = !isAdmin() && isLite() ? "tasks" : "dashboard";
    init();
    schedule(profile.id);
    render();
    afterLoginChecks(profile);
    try { dailyHomework(); } catch (e) { /* bỏ qua */ }
    window.SLPush?.sync();
  }
  /* Sau khi đăng nhập: (1) nếu mã HS bị gỡ thì bắt nhập lại; (2) báo "mã học sinh của bạn đã được lấy lại" */
  /* Học sinh chưa chọn khối (6–12): hỏi ngay khi vào app, không thể đóng cho tới khi chọn */
  async function gradeCheck(profile) {
    try {
      if (profile.role !== "student" || localStorage.getItem("sl_admin_return")) return;
      if ((await A.rpc("my_grade")) != null) return;
      const m = (state.classes || []).map((c) => parseInt(String(c.name).trim(), 10)).find((g) => g >= 6 && g <= 12) || "";
      const root = $("#modalRoot");
      root.innerHTML = `<div class="modal-backdrop"><form class="modal" id="gradeForm" role="dialog" aria-modal="true"><h2>Bạn học khối mấy?</h2><p class="muted">Chọn khối để xem bảng xếp hạng khối của bạn.</p><label>Khối<select name="g" required><option value="">— Chọn khối —</option>${[6, 7, 8, 9, 10, 11, 12].map((g) => `<option value="${g}" ${g === m ? "selected" : ""}>Khối ${g}</option>`).join("")}</select></label><div class="notice red" id="gradeErr" hidden></div><div class="actions"><button type="submit">Lưu</button></div></form></div>`;
      const f = $("#gradeForm");
      f.onsubmit = async (ev) => {
        ev.preventDefault(); const g = +f.g.value, e = $("#gradeErr");
        if (!g) { e.textContent = "Hãy chọn khối."; e.hidden = false; return; }
        f.querySelector("button").disabled = true; e.hidden = true;
        try { await A.rpc("set_my_grade", { p_grade: g }); root.innerHTML = ""; showToast("Đã lưu: khối " + g + "."); }
        catch (e2) { f.querySelector("button").disabled = false; e.textContent = (A.toApiError(e2) || {}).message || "Không lưu được, thử lại."; e.hidden = false; }
      };
    } catch (e) { /* bỏ qua */ }
  }
  /* Tài khoản tạo sẵn: bắt đặt mật khẩu mới ở lần đăng nhập đầu, không thể đóng cho tới khi đổi xong */
  function pwGate(profile) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-backdrop"><form class="modal" id="pwForm" role="dialog" aria-modal="true"><h2>Tạo mật khẩu mới</h2><p class="muted">Đây là lần đăng nhập đầu tiên. Hãy tạo mật khẩu của riêng bạn (ít nhất 8 ký tự) để tiếp tục.</p><label>Mật khẩu mới<input type="password" name="p1" autocomplete="new-password" minlength="8" required></label><label>Nhập lại mật khẩu mới<input type="password" name="p2" autocomplete="new-password" minlength="8" required></label><div class="notice red" id="pwErr" hidden></div><div class="actions"><button type="submit">Lưu mật khẩu</button></div></form></div>`;
    const f = $("#pwForm"), err = (m) => { const e = $("#pwErr"); e.textContent = m; e.hidden = !m; };
    f.onsubmit = async (ev) => {
      ev.preventDefault(); const p1 = f.p1.value, p2 = f.p2.value;
      if (p1.length < 8) return err("Mật khẩu tối thiểu 8 ký tự.");
      if (p1 !== p2) return err("Hai mật khẩu chưa khớp.");
      if (p1 === (profile.student_id || "")) return err("Mật khẩu mới không được trùng mã học sinh.");
      f.querySelector("button").disabled = true; err("");
      try {
        const r = await A.sb.auth.updateUser({ password: p1 });
        if (r.error) throw r.error;
        await A.rpc("clear_must_change_password");
        root.innerHTML = ""; showToast("Đã đổi mật khẩu. Lần sau hãy đăng nhập bằng mật khẩu mới."); gradeCheck(profile);
      } catch (e2) { f.querySelector("button").disabled = false; err((e2 && e2.message) || "Không đổi được mật khẩu, thử lại."); }
    };
  }
  async function afterLoginChecks(profile) {
    try {
      if (profile.role === "admin") {
        const n = await A.rpc("admin_code_report_count");
        if (n > 0) showToast(`Có ${n} yêu cầu "mã học sinh bị trùng" đang chờ bạn xử lý (Người dùng → Mã HS bị trùng).`);
        return;
      }
      try { if (!localStorage.getItem("sl_admin_return") && (await A.rpc("my_must_change_password"))) return pwGate(profile); } catch (e) { /* chưa có chức năng này: bỏ qua */ }
      gradeCheck(profile);
      { const why = await A.rpc("my_code_prompt_reason"); if (why) return codeGate(profile, "", false, false, why); }
      if (profile.role === "student" && (await A.rpc("consume_code_recovery_notice"))) {
        showToast("Mã học sinh của bạn đã được lấy lại.");
        $("#modalRoot").innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal" role="dialog" aria-modal="true"><h2>Mã học sinh của bạn đã được lấy lại</h2><p>Quản trị viên đã xác nhận yêu cầu của bạn. Mã học sinh <b>${esc(profile.student_code || "")}</b> hiện thuộc về tài khoản này.</p><button id="recOk">Đã hiểu</button></div></div>`;
        $("#recOk").onclick = closeModal;
      }
    } catch (e) { /* không chặn người dùng nếu kiểm tra thất bại */ }
  }
  function codeGate(profile, msg = "", dup = false, sent = false, why = profile._gateWhy || "") {
    profile._gateWhy = why;
    $("#modalRoot").innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal" role="dialog" aria-modal="true"><h2>${why === "missing_id" ? "Nhập mã học sinh hoặc số điện thoại để tiếp tục" : "Nhập mã học sinh của bạn để tiếp tục"}</h2>${sent
      ? `<div class="notice green" role="status">Yêu cầu của bạn đã được gửi, vui lòng chờ quản trị viên xử lý.</div><div class="row"><button class="secondary" id="gOut">Đăng xuất</button></div>`
      : `<p class="muted">${why === "missing_id" ? "Tài khoản này chưa có mã học sinh hoặc số điện thoại. Chỉ cần nhập <b>một trong hai</b>: mã học sinh gồm 4 đến 10 chữ số, hoặc số điện thoại." : why === "not_teacher" ? "Quản trị viên chưa xác minh được số điện thoại này là giáo viên. Hãy nhập mã học sinh của bạn để tiếp tục sử dụng." : "Mã học sinh trên tài khoản này đã được quản trị viên gỡ do bị trùng. Hãy nhập đúng mã học sinh của bạn."}</p>${msg ? `<div class="notice red" role="alert">${esc(msg)}</div>` : ""}<form id="gForm" novalidate><label for="gCode">${why === "missing_id" ? "Mã học sinh hoặc số điện thoại *" : "Mã học sinh *"}</label><input id="gCode" name="code" required maxlength="13" autocomplete="off" placeholder="${why === "missing_id" ? "4-10 chữ số hoặc số điện thoại" : "4-10 chữ số"}"><div class="row" style="margin-top:14px"><button type="submit" id="gSubmit" disabled>Tiếp tục</button><button type="button" class="secondary" id="gOut">Đăng xuất</button></div></form>${dup ? '<button type="button" class="secondary" id="gDup" style="width:100%;margin-top:10px">Mã học sinh của bạn bị dùng?</button>' : ""}`}</div></div>`;
    $("#gOut").onclick = () => { closeModal(); logout(); };
    if (sent) return;
    const f = $("#gForm"), code = $("#gCode"); code.focus();
    A.auth.bindIdentInput(code, why === "missing_id" ? "both" : "code", (ok) => { $("#gSubmit").disabled = !ok; });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = code.value.trim(); if (!v) return;
      $("#gSubmit").disabled = true;
      try {
        const idv = why === "missing_id" ? A.auth.parseIdent(v) : { kind: "code" };
        if (idv.kind === "phone") await A.rpc("submit_my_phone", { p_phone: v }); else await A.rpc("submit_my_student_code", { p_code: v });
        closeModal(); showToast(idv.kind === "phone" ? "Đã lưu số điện thoại, quản trị viên sẽ xác minh." : "Đã cập nhật mã học sinh."); reloadWorld();
      } catch (err) {
        const m = A.toApiError(err).message;
        codeGate(profile, m, /đã có tài khoản/.test(m), false); const c2 = $("#gCode"); if (c2) { c2.value = v; c2.dispatchEvent(new Event("input")); } if ($("#gDup")) $("#gDup").dataset.code = v;
      }
    };
    const d = $("#gDup");
    if (d) d.onclick = async () => {
      d.disabled = true;
      try {
        await A.rpc("report_student_code_conflict", { p_name: profile.display_name || profile.username, p_class: profile.class_name || "(chưa khai)", p_code: d.dataset.code || "", p_contact: profile.email || null });
        codeGate(profile, "", false, true);
      } catch (err) { codeGate(profile, A.toApiError(err).message, true, false); }
    };
  }
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !world.profile || world.profile.role === "admin" || document.querySelector("#modalRoot .modal h2")?.textContent.match(/để tiếp tục/)) return;
    try { const li = await A.rpc("my_lock_info"); if (li && li.locked) return showLock((li.note || "").trim()); } catch (e) { /* bỏ qua */ }
    try { const why = await A.rpc("my_code_prompt_reason"); if (why) codeGate(world.profile, "", false, false, why); } catch (e) { /* bỏ qua */ }
  });
  async function reloadWorld(msg) {
    try {
      const p = await A.auth.loadProfile();
      if (p.is_locked) return logout("Tài khoản đã bị khóa.");
      applyWorld(await A.loadWorld(p), p);
      A.sync.init({ getState: () => state, me: () => state.currentUserId, isAdmin: () => isAdmin(), onStatus: updateSaveChip,
        onRejected: () => reloadWorld("Máy chủ từ chối thay đổi, đã tải lại dữ liệu chuẩn.") });
      buildNav();
      render();
      if (msg) showToast(msg);
    } catch (err) { const e3 = A.toApiError(err); if (e3.kind === "locked") return showLock(e3.message); showToast("Không tải lại được: " + e3.message); }
  }
  /* Màn hình khóa: nền đỏ, chỉ có dòng chữ và ghi chú của admin, không có nút nào */
  let lockTimer = null;
  function showLock(note) {
    try { A.sync.stop(); } catch (e) {}
    clearInterval(timerInterval); $("#modalRoot").innerHTML = "";
    document.querySelector(".app")?.classList.add("hidden");
    const r = $("#authRoot"); r.classList.remove("hidden");
    r.innerHTML = `<div id="lockScreen" role="alert" style="position:fixed;inset:0;z-index:99999;background:#b71c1c;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px"><h1 style="margin:0;font-size:clamp(28px,6vw,56px);line-height:1.2">Tài khoản của bạn đã bị khoá</h1>${note ? `<p style="margin:24px 0 0;font-size:clamp(16px,2.4vw,22px);max-width:680px;white-space:pre-wrap">${esc(note)}</p>` : ""}</div>`;
    clearInterval(lockTimer);
    lockTimer = setInterval(async () => { try { const li = await A.rpc("my_lock_info"); if (li && !li.locked) location.reload(); } catch (e) { /* bỏ qua */ } }, 30000);
  }
  async function logout(message) {
    A.sync.stop();
    try { await A.auth.signOut(); } catch (e) {}
    clearInterval(timerInterval);
    timer = { taskId: null, status: "idle", accum: 0, startedAt: null, autoPausePrompted: false };
    state = emptyState();
    showAuth("login", typeof message === "string" ? message : "");
  }
  async function bootAuth() {
    if (!A.configured) return showSetup();
    showLoading("Đang kiểm tra phiên đăng nhập…");
    try {
      if (!(await A.auth.session())) return showAuth("login");
      const p = await A.auth.loadProfile();
      if (p.is_locked) { await A.auth.signOut(); return showAuth("login", "Lỗi: Tài khoản đã bị khóa."); }
      await enterApp(p);
    } catch (err) {
      const e2 = A.toApiError(err);
      if (e2.kind === "locked") return showLock(e2.message);
      if (e2.kind === "auth") return showAuth("login", e2.message);
      showFatal(e2.message);
    }
  }
  function updateSaveChip(status, err) {
    const c = $("#saveChip");
    if (!c) return;
    c.className = "save-chip " + status;
    c.textContent = status === "saving" ? "Đang lưu…" : status === "saved" ? "✓ Đã lưu" : status === "error" ? "⚠ Lỗi lưu — bấm để thử lại" : "";
    c.title = err ? err.message : "";
  }
  function buildNav() {
    const items = [["dashboard", "◫ Tổng quan"], ["tasks", "☷ Nhiệm vụ"], ["calendar", "▦ Lịch cá nhân"], ["classes", "♧ Lớp học & dự án"],
      ["classmgmt", "⚑ Quản lý lớp"], ["reports", "◷ Báo cáo"], ["ranking", "★ Xếp hạng"], ["notifications", "✉ Thông báo"], ["profile", "☺ Hồ sơ"]];
    if (isAdmin()) {
      // Quản trị viên không học: bỏ Nhiệm vụ, Lịch cá nhân, Lớp học & dự án, Thư viện (và Quản lý lớp của giáo viên – đã có "Lớp học (Admin)")
      const hide = new Set(["tasks", "calendar", "classes", "classmgmt"]);
      items.splice(0, items.length, ...items.filter(([p]) => !hide.has(p)));
      items.splice(1, 0, ["users", "☰ Người dùng"], ["adminclasses", "⌂ Lớp học (Admin)"], ["subjects", "✎ Môn học"], ["audit", "⛨ Nhật ký kiểm toán"], ["switchacct", "⇄ Đổi tài khoản"]);
      const qa = $("#quickAdd"); if (qa) qa.classList.add("hidden");
    } else { const qa = $("#quickAdd"); if (qa) { qa.classList.remove("hidden"); qa.textContent = isStudent() ? "+ Nhiệm vụ" : "+ Giao bài"; } }
    // Rút gọn menu: Thư viện chỉ là bản demo → ẩn với mọi vai trò (mã trang vẫn còn)
    { const hideAll = new Set();
      if (!isAdmin() && current().role === "student") {
        // học sinh: ẩn Quản lý lớp (chỉ cán bộ lớp), Lớp học & dự án (chỉ khi thuộc dự án nhóm), Báo cáo
        const u0 = current(), inProj = state.projects.some((p) => (p.memberIds || []).includes(u0.id) || (p.groups || []).some((g) => (g.memberIds || []).includes(u0.id)));
        hideAll.add("classmgmt"); hideAll.add("reports"); if (!inProj) hideAll.add("classes");
        const ci = items.find(([p]) => p === "classes"); if (ci) ci[1] = "♧ Dự án nhóm";
      }
      const ca = items.find(([p]) => p === "calendar"); if (ca && !isTeacher()) ca[1] = "▦ Xếp lịch";
      items.splice(0, items.length, ...items.filter(([p]) => !hideAll.has(p))); }
    const dataItem = ["datahub", "▥ Dữ liệu"];
    if (isAdmin() || current().role === "teacher") items.push(dataItem);
    if (isAdmin() || current().role === "teacher") items.push(["discipline", "✎ Điểm nề nếp"]);
    items.push(["settings", "⚙ Cài đặt"]);
    if (!isAdmin() && isLite()) {
      STUDENT_KEEP = liteOfficer ? ["dashboard", "tasks", "classmgmt", "profile"] : ["tasks", "profile"];
      const lab = { dashboard: "◫ Tổng quan", tasks: "☷ Nhiệm vụ", classmgmt: "⚑ Quản lý lớp", profile: "☺ Hồ sơ" };
      items.splice(0, items.length, ...STUDENT_KEEP.map((p) => [p, lab[p]]));
      if (!liteOfficer) A.sb.from("class_officer_roles").select("role").eq("user_id", current().id).is("ended_at", null).in("role", ["class_president", "academic_vp"])
        .then((r) => { if (r.data && r.data.length) { liteOfficer = true; buildNav(); $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === page)); } }, () => {});
    }
    $("#nav").innerHTML = items.map(([p, l]) => `<button data-page="${p}">${l}</button>`).join("");
    if (!isAdmin() && current().role === "student" && !isLite()) { // cán bộ lớp (học sinh) cũng có trang Dữ liệu
      const meId = current().id;
      A.sb.from("class_officer_roles").select("id,role,classes(name)").eq("user_id", meId).is("ended_at", null)
        .then((rAll) => { const r = { data: (rAll.data || []).filter((x) => x.role === "class_president" || x.role === "academic_vp") };
          if (rAll.data && rAll.data.length && !$("#nav [data-page=classmgmt]")) { const stc = $("#nav [data-page=settings]"); const bc = document.createElement("button"); bc.dataset.page = "classmgmt"; bc.textContent = "⚑ Quản lý lớp"; stc.before(bc); bc.classList.toggle("active", page === "classmgmt"); }
          if (r.data && r.data.length) { myOfficer = [...new Set(r.data.map((x) => x.classes && x.classes.name).filter(Boolean))]; const sn = document.querySelector(".side-note"); if (sn) sn.textContent = "Tài khoản: " + current().name + " · " + myRoleText(world.profile || current()); } if (r.data && r.data.length && !$("#nav [data-page=datahub]")) { const st = $("#nav [data-page=settings]"); const b = document.createElement("button"); b.dataset.page = "datahub"; b.textContent = dataItem[1]; st.before(b); b.classList.toggle("active", page === "datahub"); }
          if (r.data && r.data.length && !$("#nav [data-page=discipline]")) { const st2 = $("#nav [data-page=settings]"); const b2 = document.createElement("button"); b2.dataset.page = "discipline"; b2.textContent = "✎ Điểm nề nếp"; st2.before(b2); b2.classList.toggle("active", page === "discipline"); } }, () => {});
    }
  }
  /* Giao diện ngoại tuyến + tiện ích trạng thái (Loading / Empty / Error / Unauthorized / Saving) */
  function netBanner() {
    const b = $("#netBanner");
    if (b) b.classList.toggle("hidden", navigator.onLine);
  }
  window.addEventListener("online", () => { netBanner(); if (A.sync.status === "error") A.sync.retry(); });
  window.addEventListener("offline", netBanner);
  const ui = {
    skeleton: () => '<div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div>',
    empty: (m) => `<div class="empty">${esc(m)}</div>`,
    errorHtml(e) {
      e = A.toApiError(e);
      const cls = e.kind === "unauthorized" ? "red" : "red";
      const head = e.kind === "unauthorized" ? "Không đủ quyền. " : e.kind === "offline" ? "Mất kết nối. " : "";
      return `<div class="notice ${cls}" role="alert"><b>${head}</b>${esc(e.message)}</div><button class="secondary small" data-retry>Thử lại</button>`;
    },
    async load(el, fetcher, draw) {
      el.innerHTML = ui.skeleton();
      try { draw(await fetcher()); }
      catch (e) { el.innerHTML = ui.errorHtml(e); el.querySelector("[data-retry]")?.addEventListener("click", () => ui.load(el, fetcher, draw)); }
    },
    /* Modal có trạng thái Đang lưu + lỗi xác thực dữ liệu; chỉ báo thành công SAU khi máy chủ xác nhận */
    form(title, body, submitText, onSubmit, okMsg) {
      modal(title, body + '<div id="modalErr" class="notice red hidden" role="alert"></div>', submitText);
      $("#modalSubmit").onclick = async () => {
        const btn = $("#modalSubmit"), err = $("#modalErr");
        err.classList.add("hidden");
        btn.disabled = true;
        btn.textContent = "Đang lưu…";
        try {
          const r = await onSubmit($("#modalRoot"));
          if (r === false) { btn.disabled = false; btn.textContent = submitText; return; }
          closeModal();
          if (okMsg) showToast(okMsg);
        } catch (e) {
          err.textContent = A.toApiError(e).message;
          err.classList.remove("hidden");
          btn.disabled = false;
          btn.textContent = submitText;
        }
      };
    },
  };
  function toast(s) {
    // Không báo "đã lưu" trước khi máy chủ xác nhận
    if (/^(Đã|Tạo) /.test(s) && A.sync.pending())
      A.sync.afterFlush((err) => showToast(err ? "Chưa lưu được: " + err.message : s));
    else showToast(s);
  }
  function taskStatus(t) {
    if (t.status === "done") return "Hoàn thành";
    if (new Date(t.dueAt) < now()) return "Chưa hoàn thành – Quá hạn";
    return isRunning(t) ? "Đang làm" : "Chưa làm";
  }
  // "Đang làm/Đang học" chỉ khi đồng hồ của chính bài này đang chạy
  function isRunning(t) { return !!t && timer.status === "running" && timer.taskId === t.id; }
  function activeTasks(owner = current().id) {
    return state.tasks.filter(
      (t) =>
        t.ownerId === owner &&
        t.status !== "done" &&
        new Date(t.dueAt) >= now(),
    );
  }
  function overdueTasks(owner = current().id) {
    return state.tasks.filter(
      (t) =>
        t.ownerId === owner && t.status !== "done" && new Date(t.dueAt) < now(),
    );
  }
  function sessionsFor(t) {
    return (t.sessions || []).filter((s) => s.endAt && s.minutes > 0);
  }
  function actualFor(t) {
    return (t.sessions || []).reduce((a, s) => a + (+s.minutes || 0), 0);
  }
  function futureSession(s) {
    return !s.completed && new Date(s.startAt) > now();
  }
  function addMinutes(d, m) {
    return new Date(new Date(d).getTime() + m * 60000);
  }
  function dayStart(d) {
    let x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function rangesForDay(date, ownerId, keepPast = true) {
    let start = dayStart(date),
      end = new Date(start.getTime() + DAY),
      free = [];
    // Mặc định khi chưa khai báo: rảnh 3 tiếng, 19:00-22:00 mỗi ngày; trừ các khoảng bận đã khai báo.
    let dow = start.getDay(),
      baseStart = new Date(start),
      baseEnd = new Date(start);
    baseStart.setHours(19, 0, 0, 0);
    baseEnd.setHours(22, 0, 0, 0);
    free.push([baseStart, baseEnd]);
    for (let b of state.busy.filter((x) => x.ownerId === ownerId)) {
      if (!b.days?.includes(dow)) continue;
      let [sh, sm] = b.start.split(":").map(Number),
        [eh, em] = b.end.split(":").map(Number);
      let bs = new Date(start);
      bs.setHours(sh, sm, 0, 0);
      let be = new Date(start);
      be.setHours(eh, em, 0, 0);
      if (be <= bs) be = new Date(be.getTime() + DAY);
      for (let offset of [0, 1]) {
        let a = new Date(bs.getTime() + offset * DAY),
          z = new Date(be.getTime() + offset * DAY);
        if (a < end && z > start) {
          let aa = new Date(Math.max(a, start)),
            zz = new Date(Math.min(z, end));
          free = subtractRange(free, aa, zz);
        }
      }
    }
    // Subtract completed/past time and all fixed past sessions; future scheduled sessions get regenerated by scheduler.
    if (keepPast) return free; // giờ rảnh đã qua trong hôm nay vẫn tính: bài của hôm nay vẫn được nhắc
    let cutStart = new Date(Math.max(start.getTime(), now().getTime()));
    free = free
      .map(([a, b]) => [new Date(Math.max(a, cutStart)), b])
      .filter(([a, b]) => b > a);
    return free;
  }
  function subtractRange(ranges, a, b) {
    let out = [];
    for (let [s, e] of ranges) {
      if (b <= s || a >= e) {
        out.push([s, e]);
        continue;
      }
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
    }
    return out;
  }
  function scheduledMinutes(t) {
    return (t.sessions || [])
      .filter((s) => !s.completed && new Date(s.startAt) > now())
      .reduce((n, s) => n + s.minutes, 0);
  }
  function schedule(ownerId = current().id) {
    let ts = state.tasks.filter(
      (t) => t.ownerId === ownerId && t.status !== "done",
    );
    // Giữ buổi đã học thật (completed / không phải kế hoạch); mọi buổi kế hoạch chưa học (kể cả đã trôi qua) đều xếp lại
    // từ phần "còn cần học", nếu không sẽ bị tính trùng.
    ts.forEach((t) => (t.sessions = (t.sessions || []).filter((s) => s.completed || !s.planned)));
    let pending = ts
      .filter((t) => new Date(t.dueAt) >= now())
      .sort(
        (a, b) =>
          new Date(a.dueAt) - new Date(b.dueAt) ||
          (b.priority || 0) - (a.priority || 0),
      );
    let days = {};
    let first = dayStart(now());
    let last = Math.max(
      ...pending.map((t) => dayStart(new Date(t.dueAt)).getTime()),
      first.getTime(),
    );
    for (let stamp = first.getTime(); stamp <= last; stamp += DAY) {
      let d = new Date(stamp);
      days[localDay(d)] = rangesForDay(d, ownerId);
    }
    // đặt tối đa `want` phút của bài t vào ngày `day`; trả về số phút đã đặt
    let place = (t, day, want, due) => {
      let key = localDay(day), ranges = days[key] || rangesForDay(day, ownerId), placed = 0;
      for (let i = 0; i < ranges.length && placed < want; i++) {
        let [a, b] = ranges[i];
        b = new Date(Math.min(b, due));
        if (b <= a) continue;
        let take = Math.min(want - placed, Math.floor((b - a) / 60000), 90);
        if (take <= 0) continue;
        t.sessions.push({ id: uid("s"), startAt: iso(a), endAt: iso(addMinutes(a, take)), minutes: take, completed: false, planned: true });
        placed += take;
        ranges[i] = [addMinutes(a, take), b];
      }
      days[key] = ranges;
      return placed;
    };
    for (let t of pending) {
      let remaining = Math.max(0, Number(t.remainingWorkMinutes) || 0),
        due = new Date(t.dueAt),
        from = Math.max(first.getTime(), t.startAtSet ? dayStart(new Date(t.startAtSet)).getTime() : 0),
        dueDay = dayStart(due).getTime(),
        stamps = [];
      if (from > dueDay) from = first.getTime();
      for (let st = from; st <= dueDay; st += DAY) {
        // chỉ chia cho những ngày còn chỗ trống trước hạn nộp
        let rg = days[localDay(new Date(st))] || rangesForDay(new Date(st), ownerId);
        if (rg.some(([a, b]) => Math.min(b, due) > a)) stamps.push(st);
      }
      if (!stamps.length) stamps.push(from);
      // Lượt 1: chia đều số phút cho các ngày từ ngày bắt đầu đến hạn nộp (không dồn hết vào một ngày)
      let per = Math.ceil(remaining / Math.max(1, stamps.length));
      for (let st of stamps) {
        if (remaining <= 0) break;
        remaining -= place(t, new Date(st), Math.min(per, remaining), due);
      }
      // Lượt 2: phần còn thiếu (ngày kín lịch) lấp vào chỗ trống sớm nhất
      for (let st of stamps) {
        if (remaining <= 0) break;
        remaining -= place(t, new Date(st), remaining, due);
      }
      t.unscheduledMinutes = remaining;
    }
    state.tasks
      .filter(
        (t) =>
          t.ownerId === ownerId &&
          new Date(t.dueAt) < now() &&
          t.status !== "done",
      )
      .forEach((t) => {
        t.status = "overdue";
        t.unscheduledMinutes = t.remainingWorkMinutes || 0;
      });
    save();
  }
  function capacityForDay(date, ownerId = current().id) {
    return rangesForDay(date, ownerId).reduce(
      (n, [a, b]) => n + Math.max(0, Math.floor((b - a) / 60000)),
      0,
    );
  }
  function loadForDay(date, ownerId = current().id) {
    let k = localDay(date);
    return state.tasks
      .filter((t) => t.ownerId === ownerId && t.status !== "done")
      .reduce(
        (n, t) =>
          n +
          (t.sessions || [])
            .filter(
              (s) =>
                localDay(s.startAt) === k &&
                !s.completed,
            )
            .reduce((a, s) => a + s.minutes, 0),
        0,
      );
  }
  function riskTasks(ownerId = current().id) {
    return activeTasks(ownerId).filter((t) => (t.unscheduledMinutes || 0) > 0);
  }
  function taskCard(t) {
    let risk = (t.unscheduledMinutes || 0) > 0,
      studyMinutes =
        t.status === "done"
          ? Number(t.actualMinutes) || 0
          : Number(t.remainingWorkMinutes ?? t.estimatedMinutes) || 0;
    return `<div class="item"><div class="item-main"><div class="item-title">${esc(t.title)}</div><div class="item-meta"><b>Học ${fmtMinutes(studyMinutes)}</b></div><div class="item-meta">${esc(t.subject)} · Hạn nộp: ${fmtDate(t.dueAt)} · Còn cần học: ${fmtMinutes(t.remainingWorkMinutes)} · Đã học: ${fmtMinutes(t.actualMinutes)}</div><div class="item-meta"><span class="badge ${t.status === "done" ? "green" : risk ? "red" : " "}">${esc(taskStatus(t))}</span> <span class="badge">Mức ưu tiên: ${esc(t.priority === 3 ? "Cao" : t.priority === 2 ? "Vừa" : "Thường")}</span></div></div><div class="actions"><button class="small" data-action="detail" data-id="${t.id}">Xem chi tiết</button>${isStudent() && t.status !== "done" ? `<button class="small secondary" data-action="study" data-id="${t.id}">Bắt đầu học</button><button class="small secondary" data-action="complete" data-id="${t.id}">Đánh dấu hoàn thành</button>` : ""}${isTeacher() ? `<button class="small secondary" data-action="edit-task" data-id="${t.id}">Sửa nhiệm vụ</button>` : ""}</div></div>`;
  }
  function pageHead(title, sub) {
    $("#pageTitle").textContent = title;
    $("#subtitle").textContent = sub;
  }
  function render() {
    const u = current();
    if (!isAdmin() && isLite() && !STUDENT_KEEP.includes(page)) page = "tasks";
    $$("#nav button").forEach((b) =>
      b.classList.toggle("active", b.dataset.page === page),
    );
    if (page === "dashboard") renderDashboard();
    if (page === "tasks") renderTasks();
    if (page !== "calendar") calDay = null;
    if (page === "calendar") renderCalendar();
    if (page === "classes") renderClasses();
    if (page === "reports") renderReports();
    if (page === "notifications") renderNotifications();
    if (page === "settings") renderSettings();
    const ext = SL.pages[page];
    if (ext) { pageHead(ext.title, ext.sub || ""); ext.render($("#content")); }
  }
  function renderDashboard() {
    let u = current();
    if (isAdmin() && SL.adminDashboard) {
      pageHead("Tổng quan quản trị", "Tài khoản, lớp học và hoạt động quản trị gần đây.");
      SL.adminDashboard($("#content"));
      return;
    }
    pageHead(
      "Tổng quan",
      isTeacher()
        ? "Theo dõi nhiệm vụ đã giao, hạn nộp và tiến độ của học sinh."
        : "Xem việc cần làm, lịch học và thời gian đã học.",
    );
    let tasks = isStudent() ? activeTasks(u.id) : teacherTasks(u);
    let risks = isStudent()
      ? riskTasks(u.id)
      : tasks.filter((t) => (t.unscheduledMinutes || 0) > 0);
    let dueSoon = tasks.filter((t) => new Date(t.dueAt) - now() < DAY);
    let mins = state.tasks
      .filter((t) =>
        isStudent() ? t.ownerId === u.id : allowedTaskIds(u).has(t.id),
      )
      .reduce((n, t) => n + (+t.actualMinutes || 0), 0);
    $("#content").innerHTML = `<div class="grid">
 ${helloBanner(u)}
 <div class="card span-4"><div class="stat-label">Nhiệm vụ chưa hoàn thành</div><div class="stat">${tasks.length}</div><div class="muted">${isTeacher() ? `Đang theo dõi ${tasks.length} nhiệm vụ đã giao` : `Còn ${tasks.length} nhiệm vụ chưa làm`}</div></div>
 <div class="card span-4"><div class="stat-label">Thời gian học đã xác nhận</div><div class="stat">${Math.round((mins / 60) * 10) / 10}h</div><div class="muted">Tổng thời gian đã xác nhận</div></div>
 <div class="card span-4"><div class="stat-label">Hạn nộp trong 24 giờ</div><div class="stat">${dueSoon.length}</div><div class="muted">Cần ưu tiên kiểm tra</div></div>
 ${!isTeacher() && HIDE_TODO_CARD ? "" : `<div class="card span-7">${isTeacher() ? `<div class="section-head"><h2>Nhiệm vụ cần chú ý</h2><button class="secondary small" data-goto="tasks">Xem tất cả</button></div>${risks.length ? '<div class="notice red">Có nhiệm vụ có nguy cơ trễ hạn.</div>' + risks.map(taskCard).join("") : '<div class="notice green">Chưa phát hiện nhiệm vụ thiếu sức chứa trước hạn trong dữ liệu hiện tại.</div>'}${tasks.filter((t) => !risks.includes(t)).slice(0, 3).map(taskCard).join("") || ""}` : todayTasksHtml(u, risks)}</div>`}
 <div class="card ${isTeacher() || HIDE_TODO_CARD ? "span-12" : "span-5"}"><h2>${isTeacher() ? "Tiến độ từng học sinh" : "Khối lượng học trong 7 ngày tới"}</h2>${isTeacher() ? classProgress(state.classes.filter((c) => isAdmin() || c.teacherIds.includes(u.id))) : loadChart(u.id, 7)}<div class="footer-note">${isTeacher() ? "Số liệu dựa trên các nhiệm vụ thuộc lớp bạn phụ trách." : "Số phút học đã xếp lịch cho từng ngày. Chiều cao cột so với thời gian rảnh trong ngày; cột đỏ là vượt thời gian rảnh."}</div></div>
 ${isTeacher() ? `<div class="card span-6"><h2>Nhiệm vụ sắp đến hạn</h2>${
   tasks
         .slice()
         .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
         .slice(0, 5)
         .map(taskCard)
         .join("") || '<div class="empty">Chưa có nhiệm vụ cần theo dõi.</div>'
 }</div>` : ""}
 <div class="card ${isTeacher() ? "span-6" : "span-12"}"><h2>Thông báo gần đây</h2>${notificationList(
   state.notifications
     .filter((n) => n.userId === u.id)
     .slice(-4)
     .reverse(),
 )}</div>
 </div>`;
    SL.afterDashboard?.($("#content"));
  }
  function helloBanner(u) {
    let hr = now().getHours(), part = hr < 11 ? "buổi sáng" : hr < 14 ? "buổi trưa" : hr < 18 ? "buổi chiều" : "buổi tối";
    let msg;
    if (isStudent()) {
      let k = localDay(now()), ids = new Set(calDayItems(u, k).filter((x) => !x.done).map((x) => x.t.id));
      state.tasks.filter((t) => t.ownerId === u.id && t.status !== "done" && localDay(t.dueAt) === k).forEach((t) => ids.add(t.id));
      msg = ids.size ? `Hôm nay bạn có ${ids.size} bài tập cần làm. Cố lên nhé!` : "Hôm nay bạn không có bài tập nào cần làm. Nghỉ ngơi nhé!";
    } else msg = "Theo dõi nhiệm vụ đã giao, hạn nộp và tiến độ của học sinh.";
    return `<div class="hello-banner"><h2>Chào ${part}, ${esc(u.name || "bạn")}! 👋</h2><p>${msg}</p></div>`;
  }
  function todayTasksHtml(u, risks) {
    let k = localDay(now()), items = calDayItems(u, k), byTask = new Map();
    items.forEach((x) => { let e = byTask.get(x.t.id) || { t: x.t, m: 0, first: x.at, done: true }; e.m += x.m; if (new Date(x.at) < new Date(e.first)) e.first = x.at; if (!x.done) e.done = false; byTask.set(x.t.id, e); });
    // bài có hạn nộp trong hôm nay cũng là việc của hôm nay
    state.tasks.filter((t) => t.ownerId === u.id && t.status !== "done" && localDay(t.dueAt) === k && !byTask.has(t.id)).forEach((t) => byTask.set(t.id, { t, m: 0, first: t.dueAt, done: false, dueToday: true }));
    let list = [...byTask.values()].sort((a, b) => new Date(a.first) - new Date(b.first));
    let hm = (v) => { let d = new Date(v); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
    let head = `<div class="section-head"><h2>Nhiệm vụ hôm nay</h2><button class="secondary small" data-action="open-day" data-day="${k}">Xem lịch hôm nay</button></div>`;
    let risk = risks.length ? '<div class="notice red">Có nhiệm vụ có nguy cơ trễ hạn.</div>' : "";
    if (!list.length) return head + risk + '<div class="notice green">Hôm nay bạn không có bài tập nào cần làm.</div>';
    let total = list.reduce((a, e) => a + e.m, 0);
    return head + risk + list.map((e) => {
      let t = e.t, isRisk = (t.unscheduledMinutes || 0) > 0;
      return `<div class="item"><div class="item-main"><div class="item-title">${esc(t.title)} ${e.done && e.m ? '<span class="badge green">Đã học xong</span>' : ""}</div><div class="item-meta"><b>${e.m ? "Hôm nay học " + fmtMin(e.m) + " · từ " + hm(e.first) : "Hạn nộp hôm nay lúc " + hm(t.dueAt)}</b></div><div class="item-meta">${esc(t.subject)} · Hạn nộp: ${fmtDate(t.dueAt)} · Còn cần học: ${fmtMinutes(t.remainingWorkMinutes)}</div></div><div class="actions"><button class="small" data-action="detail" data-id="${t.id}">Xem chi tiết</button>${t.status !== "done" ? `<button class="small secondary" data-action="study" data-id="${t.id}">Bắt đầu học</button>` : ""}</div></div>`;
    }).join("") + `<div class="day-total" style="margin-top:10px"><span>Tổng hôm nay</span><b>${total ? fmtMin(total) : "—"}</b></div>`;
  }
  function teacherTasks(u) {
    let allowed = allowedTaskIds(u);
    return state.tasks.filter(
      (t) =>
        allowed.has(t.id) && t.status !== "done" && new Date(t.dueAt) >= now(),
    );
  }
  function allowedTaskIds(u) {
    // RLS đã giới hạn dữ liệu tải về; ở đây chỉ chặn thêm theo vai trò.
    let mine = new Set(
      state.classes.filter((c) => (c.teacherIds || []).includes(u.id)).map((c) => c.id),
    );
    let ids = new Set();
    state.tasks.forEach((t) => {
      if (
        u.role === "admin" ||
        (u.role === "teacher" &&
          (t.teacherId === u.id || t.createdBy === u.id || (t.classId && mine.has(t.classId))))
      )
        ids.add(t.id);
    });
    return ids;
  }
  function loadChart(owner, days) {
    let start = dayStart(now()),
      arr = [];
    for (let i = 0; i < days; i++) {
      let d = new Date(start.getTime() + i * DAY),
        cap = capacityForDay(d, owner),
        load = loadForDay(d, owner),
        pct = cap ? Math.min(150, (load / cap) * 100) : 0;
      arr.push({ d, cap, load, pct });
    }
    return `<div class="chart">${arr.map((x) => `<div class="chart-col"><div class="chart-val">${x.load >= 60 ? Math.floor(x.load / 60) + "h" + (x.load % 60 ? String(Math.round(x.load % 60)).padStart(2, "0") : "") : Math.round(x.load) + "p"}</div><div class="chart-bar ${x.pct > 100 ? "over" : ""}" style="height:${Math.max(2, (x.pct / 150) * 135)}px" title="Đã phân bổ ${x.load} phút / sức chứa ${x.cap} phút"></div><div class="chart-label">${x.d.toLocaleDateString("vi-VN", { weekday: "short", day: "numeric" })}</div></div>`).join("")}</div>`;
  }
  function dayLabel(key) {
    let today = localDay(now()),
      tomorrow = localDay(new Date(dayStart(now()).getTime() + DAY));
    if (key === today) return "HÔM NAY";
    if (key === tomorrow) return "NGÀY MAI";
    let d = new Date(key + "T12:00:00");
    return d
      .toLocaleDateString("vi-VN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
      .toLocaleUpperCase("vi-VN");
  }
  function extraStudyAvailability(ownerId = current().id) {
    let cap = capacityForDay(now(), ownerId),
      load = loadForDay(now(), ownerId);
    return Math.max(0, cap - load);
  }
  function extraStudyPrompt(tasks) {
    if (!isStudent()) return "";
    let today = localDay(now()),
      tomorrow = localDay(new Date(dayStart(now()).getTime() + DAY)),
      todayTasks = tasks.filter((t) => localDay(t.dueAt) === today),
      tomorrowTasks = tasks.filter(
        (t) => localDay(t.dueAt) === tomorrow && t.status !== "done",
      ),
      available = extraStudyAvailability(current().id);
    if (
      !todayTasks.length ||
      !todayTasks.every((t) => t.status === "done") ||
      !tomorrowTasks.length ||
      available <= 0 ||
      extraPromptDismissedDay === today
    )
      return "";
    if (extraStudyChooser) {
      let selected = tomorrowTasks.filter((t) => t.status !== "done"),
        total = selected
          .filter(
            (t) => $('#taskList input[data-extra-id="' + t.id + '"]')?.checked,
          )
          .reduce(
            (n, t) =>
              n +
              (Number(t.remainingWorkMinutes) ||
                Number(t.estimatedMinutes) ||
                0),
            0,
          );
      return `<div class="card" style="margin-top:12px"><h2>Bạn đã hoàn thành xong nhiệm vụ hôm nay</h2><p>Bạn có muốn làm bài tập của ngày mai không?</p><p>Chọn những nhiệm vụ muốn làm trước. Thời gian còn trống hôm nay: <b>${available} phút</b>.</p><div class="stack">${selected.map((t) => `<label class="checkrow"><input type="checkbox" data-extra-id="${t.id}" data-minutes="${Number(t.remainingWorkMinutes) || Number(t.estimatedMinutes) || 0}"> <span>${esc(t.subject)} — ${esc(t.title)} <span class="muted">(${Number(t.remainingWorkMinutes) || Number(t.estimatedMinutes) || 0} phút)</span></span></label>`).join("")}</div><div id="extraOverload" class="notice red ${total > available ? "" : "hidden"}" style="margin-top:10px">Cảnh báo quá tải: bạn chọn ${total} phút nhưng hôm nay chỉ còn ${available} phút.</div><div class="row" style="margin-top:12px"><button data-action="confirm-extra-study">Xếp lịch và học</button><button class="secondary" data-action="extra-study-no">Không</button></div></div>`;
    }
    return `<div class="card" style="margin-top:12px"><p style="margin:0 0 8px"><b>Bạn đã hoàn thành xong nhiệm vụ hôm nay</b></p><p style="margin:0 0 12px">Bạn có muốn làm bài tập của ngày mai không?</p><div class="row"><button data-action="extra-study-yes">Có</button><button class="secondary" data-action="extra-study-no">Không</button></div></div>`;
  }
  function renderTasks() {
    let u = current();
    pageHead(
      isTeacher() ? "Nhiệm vụ đã giao" : "Nhiệm vụ của tôi",
      isTeacher()
        ? "Theo dõi hạn nộp, tiến độ và những nhiệm vụ cần hỗ trợ."
        : "Nhiệm vụ được chia theo ngày để bạn dễ theo dõi.",
    );
    let tasks = isStudent()
      ? state.tasks.filter((t) => t.ownerId === u.id)
      : state.tasks.filter((t) => allowedTaskIds(u).has(t.id));
    $("#content").innerHTML =
      `<div class="section-head"><div class="row"><input id="taskSearch" placeholder="Tìm theo tên nhiệm vụ hoặc môn học…" style="width:240px"><select id="taskFilter" style="width:170px"><option value="all">Tất cả</option><option value="todo">Chưa bắt đầu</option><option value="doing">Đang làm</option><option value="done">Hoàn thành</option><option value="overdue">Quá hạn</option><option value="risk">Có nguy cơ trễ hạn</option></select><select id="taskClass" style="width:150px"><option value="all">Mọi lớp</option><option value="personal">Cá nhân</option>${state.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><select id="taskSubject" style="width:150px"><option value="all">Mọi môn</option>${[...new Set(tasks.map((t) => t.subject).filter(Boolean))].sort().map((x) => `<option>${esc(x)}</option>`).join("")}</select><button class="secondary small" id="taskClear">Xóa bộ lọc</button></div>${isStudent() ? '<button data-action="new-task">${isStudent() ? "+ Tạo nhiệm vụ cá nhân" : "+ Giao bài cho lớp"}</button>' : ""}</div><div id="taskList" class="stack"></div>`;
    function draw() {
      let q = $("#taskSearch").value.toLowerCase(),
        f = $("#taskFilter").value;
      let arr = tasks.filter((t) =>
        (t.title + " " + t.subject).toLowerCase().includes(q),
      );
      if (f === "done") arr = arr.filter((t) => t.status === "done");
      if (f === "todo") arr = arr.filter((t) => t.status !== "done" && !isRunning(t));
      if (f === "doing") arr = arr.filter((t) => isRunning(t));
      if (f === "overdue")
        arr = arr.filter(
          (t) => t.status !== "done" && new Date(t.dueAt) < now(),
        );
      if (f === "risk")
        arr = arr.filter((t) => (t.unscheduledMinutes || 0) > 0);
      let cf = $("#taskClass").value, sf = $("#taskSubject").value;
      if (cf !== "all") arr = arr.filter((t) => (t.classId || "personal") === cf);
      if (sf !== "all") arr = arr.filter((t) => t.subject === sf);
      arr.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
      let total = arr.length;
      arr = arr.slice(0, taskShown);
      let groups = {};
      arr.forEach((t) => {
        let k = localDay(t.dueAt);
        (groups[k] ??= []).push(t);
      });
      let grouped = Object.entries(groups)
        .map(
          ([k, items]) =>
            `<section class="day-task-group"><h2 class="day-task-heading">${dayLabel(k)} <span class="muted" style="font-size:12px;font-weight:500">· ${items.length} nhiệm vụ</span></h2><div class="stack">${items.map(taskCard).join("")}</div></section>`,
        )
        .join("");
      let prompt = extraStudyPrompt(tasks);
      $("#taskList").innerHTML =
        (extraOverloadNotice
          ? `<div class="notice red">${esc(extraOverloadNotice)}</div>`
          : "") +
        (grouped ||
          '<div class="empty">Không tìm thấy nhiệm vụ phù hợp.</div>') +
        (total > taskShown ? `<button class="secondary" id="taskMore">Xem thêm (${total - taskShown})</button>` : "") +
        prompt;
      $("#taskMore")?.addEventListener("click", () => { taskShown += 20; draw(); });
      let boxes = $$("#taskList input[data-extra-id]");
      if (boxes.length) {
        let updateWarning = () => {
          let total = boxes
              .filter((x) => x.checked)
              .reduce((n, x) => n + (Number(x.dataset.minutes) || 0), 0),
            avail = extraStudyAvailability(u.id),
            warning = $("#extraOverload");
          if (warning) {
            warning.classList.toggle("hidden", total <= avail);
            warning.textContent = `Cảnh báo quá tải: bạn chọn ${total} phút nhưng hôm nay chỉ còn ${avail} phút.`;
          }
        };
        boxes.forEach((x) => x.addEventListener("change", updateWarning));
        updateWarning();
      }
    }
    taskShown = 20;
    $("#taskSearch").oninput = draw;
    $("#taskClass").onchange = $("#taskSubject").onchange = () => { taskShown = 20; draw(); };
    $("#taskClear").onclick = () => { $("#taskSearch").value = ""; $("#taskFilter").value = "all"; $("#taskClass").value = "all"; $("#taskSubject").value = "all"; taskShown = 20; draw(); };
    $("#taskFilter").onchange = draw;
    draw();
  }
  let calTab = "todo", calDay = null;
  const SUBJ_FIXED = { toan: "#ef4444", van: "#eab308", "ngu van": "#eab308", anh: "#84cc16", "tieng anh": "#84cc16", dia: "#0ea5e9", "dia li": "#0ea5e9", "dia ly": "#0ea5e9", su: "#f472b6", "lich su": "#f472b6", ly: "#6366f1", "vat li": "#6366f1", "vat ly": "#6366f1", hoa: "#14b8a6", "hoa hoc": "#14b8a6", sinh: "#22c55e", "sinh hoc": "#22c55e", tin: "#8b5cf6", "tin hoc": "#8b5cf6", gdcd: "#f97316" };
  const SUBJ_EXTRA = ["#3b4fd1", "#f97316", "#06b6d4", "#a855f7", "#64748b", "#d946ef", "#0d9488", "#b45309"];
  function subjColor(name) {
    let k = String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();
    if (SUBJ_FIXED[k]) return SUBJ_FIXED[k];
    let h = 0;
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    return SUBJ_EXTRA[h % SUBJ_EXTRA.length];
  }
  function inkOn(hex) {
    let n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1b2238" : "#fff";
  }
  function calWeeks() {
    let t0 = dayStart(now()),
      mon = new Date(t0.getTime() - ((t0.getDay() + 6) % 7) * DAY);
    return [0, 1].map((w) => {
      let s = new Date(mon.getTime() + w * 7 * DAY);
      return { start: s, days: Array.from({ length: 7 }, (_, i) => new Date(s.getTime() + i * DAY)) };
    });
  }
  function fmtMin(m) {
    m = Math.round(m);
    return m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? String(m % 60).padStart(2, "0") : "") : m + "p";
  }
  function calLegend(subjects) {
    return `<div class="cal-legend">${subjects.map((s) => `<div><i style="background:${subjColor(s)}"></i>${esc(s)}</div>`).join("") || '<div class="muted">Chưa có môn nào</div>'}</div>`;
  }
  function calUserTasks(u) {
    if (!isTeacher()) return state.tasks.filter((t) => t.ownerId === u.id);
    let seen = new Set();
    return state.tasks.filter((t) => {
      let k = t.assignmentId || t.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  function calTodoHtml(u, weeks) {
    let tasks = calUserTasks(u),
      byDay = {};
    // học sinh: phút của các buổi app đã xếp (và đã học); giáo viên: bài đã giao tính vào ngày hạn nộp
    tasks.forEach((t) => {
      if (isTeacher()) {
        if (t.status === "done" && !t.assignmentId) return;
        let k = localDay(t.dueAt);
        (byDay[k] ||= []).push({ t, m: Number(t.estimatedMinutes) || 0, done: false });
      } else
        (t.sessions || []).forEach((s) => {
          let m = Number(s.minutes) || 0;
          if (m > 0) (byDay[localDay(s.startAt)] ||= []).push({ t, m, done: !!s.completed || t.status === "done" });
        });
    });
    let all = weeks.flatMap((w) => w.days),
      totals = all.map((d) => (byDay[localDay(d)] || []).reduce((a, x) => a + x.m, 0)),
      max = Math.max(60, ...totals),
      subs = [...new Set(all.flatMap((d) => (byDay[localDay(d)] || []).map((x) => x.t.subject || "Chưa rõ môn")))].sort(),
      today = localDay(now()),
      names = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
    let rows = weeks
      .map(
        (w, wi) =>
          `<div class="wk-label">${wi === 0 ? "Tuần này" : "Tuần sau"} · ${w.days[0].getDate()}/${w.days[0].getMonth() + 1} – ${w.days[6].getDate()}/${w.days[6].getMonth() + 1}</div><div class="wk-row">${w.days
            .map((d, i) => {
              let k = localDay(d),
                items = (byDay[k] || []).slice().sort((a, b) => String(a.t.subject).localeCompare(String(b.t.subject), "vi")),
                tot = items.reduce((a, x) => a + x.m, 0),
                past = k < today;
              return `<div class="wk-cell ${k === today ? "today" : ""} ${past ? "past" : ""}"><div class="wk-head"><b>${names[i]}</b><span>${d.getDate()}/${d.getMonth() + 1}</span></div><div class="wk-plot"><div class="wk-stack">${items.length ? "" : '<i class="wk-seg ghost" title="Không có việc"></i>'}${items
                .map(
                  (x) =>
                    { let exp = new Date(x.t.dueAt) < now();
                    return `<i class="wk-seg ${x.done ? "done" : ""} ${exp ? "exp" : ""}" style="height:${(x.m / max) * 100}%;background:${subjColor(x.t.subject)}" data-action="detail" data-id="${x.t.id}" title="${esc(x.t.subject || "")} — ${esc(x.t.title)}: ${fmtMin(x.m)}${x.done ? " (đã học)" : ""}${exp ? " · đã hết hạn nộp" : ""}">${exp ? "Hết hạn" : ""}</i>`; },
                )
                .join("")}</div></div><div class="wk-total">${tot ? fmtMin(tot) : "—"}</div>${tot && !isTeacher() ? `<button class="small secondary wk-more" data-action="cal-day" data-day="${k}">Chi tiết</button>` : ""}</div>`;
            })
            .join("")}</div>`,
      )
      .join("");
    return `<div class="cal-layout"><div class="cal-main">${rows}</div>${calLegend(subs)}</div><div class="footer-note">${isTeacher() ? "Cột thể hiện tổng thời gian dự kiến của các bài đã giao, tính vào ngày hạn nộp." : "Cột thể hiện thời gian học app đã xếp cho từng ngày; cùng một thang chiều cao cho cả hai tuần. Chạm vào một đoạn màu để xem bài."}</div>`;
  }
  function calLoadHtml(u, weeks) {
    let tasks = calUserTasks(u),
      today = localDay(now()),
      names = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"],
      items = tasks.map((t) => {
        let end = new Date(t.dueAt).getTime(),
          st = t.assignedAt ? new Date(t.assignedAt).getTime() : NaN;
        if (isNaN(st) || st > end) st = Math.min(dayStart(now()).getTime(), dayStart(end).getTime());
        return { t, st, end };
      }),
      subs = new Set();
    let rows = weeks
      .map((w, wi) => {
        let rs = w.start.getTime(),
          re = rs + 7 * DAY,
          inRow = items.filter((x) => x.end > rs && x.st < re).sort((a, b) => a.st - b.st || a.end - b.end),
          lanes = [],
          bars = inRow
            .map((x) => {
              subs.add(x.t.subject || "Chưa rõ môn");
              let a = Math.max(x.st, rs), b = Math.min(x.end, re);
              let left = ((a - rs) / (7 * DAY)) * 100, width = Math.max(((b - a) / (7 * DAY)) * 100, 3);
              let lane = lanes.findIndex((e) => e <= a);
              if (lane < 0) lane = lanes.length;
              lanes[lane] = a + (width / 100) * 7 * DAY;
              let col = subjColor(x.t.subject),
                done = x.t.status === "done",
                over = !done && x.end < now().getTime();
              return `<div class="ld-bar ${done ? "done" : ""} ${over ? "over" : ""} ${x.st < rs ? "cont-l" : ""} ${x.end > re ? "cont-r" : ""}" style="left:${left}%;width:${Math.min(width, 100 - left)}%;top:${lane * 26}px;background:${col};color:${inkOn(col)}" data-action="detail" data-id="${x.t.id}" title="${esc(x.t.subject || "")} — ${esc(x.t.title)} · hạn ${fmtDate(x.t.dueAt)}">${done ? "✓ " : ""}${esc(x.t.subject || "")}: ${esc(x.t.title)}</div>`;
            })
            .join("");
        return `<div class="wk-label">${wi === 0 ? "Tuần này" : "Tuần sau"} · ${w.days[0].getDate()}/${w.days[0].getMonth() + 1} – ${w.days[6].getDate()}/${w.days[6].getMonth() + 1}</div><div class="ld-row"><div class="ld-cols">${w.days.map((d, i) => `<div class="ld-col ${localDay(d) === today ? "today" : ""} ${localDay(d) < today ? "past" : ""}"><b>${names[i]}</b><span>${d.getDate()}/${d.getMonth() + 1}</span></div>`).join("")}</div><div class="ld-bars" style="min-height:${Math.max(lanes.length, 2) * 26 + 8}px">${bars}</div></div>`;
      })
      .join("");
    return `<div class="cal-layout"><div class="cal-main">${rows}</div>${calLegend([...subs].sort())}</div><div class="footer-note">Mỗi thanh là một bài tập, kéo từ lúc được giao đến hạn nộp. Thanh viền đỏ là bài quá hạn; bài đã xong thì mờ và có dấu ✓. Bài kéo qua cuối tuần sẽ nối sang hàng dưới.</div>`;
  }
  function calDayLabel(k) {
    let d = new Date(k + "T00:00:00"), n = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
    return n[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1);
  }
  function calDayItems(u, k) {
    let out = [];
    state.tasks.filter((t) => t.ownerId === u.id).forEach((t) =>
      (t.sessions || []).forEach((x) => {
        let m = Number(x.minutes) || 0;
        if (m > 0 && localDay(x.startAt) === k) out.push({ t, m, done: !!x.completed || t.status === "done", at: x.startAt });
      }),
    );
    return out;
  }
  function calDayHtml(u, k) {
    let items = calDayItems(u, k), bySub = {};
    items.forEach((x) => (bySub[x.t.subject || "Chưa rõ môn"] ||= []).push(x));
    let subs = Object.keys(bySub).sort((a, b) => a.localeCompare(b, "vi")), total = items.reduce((a, x) => a + x.m, 0);
    let hm = (v) => { let d = new Date(v); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
    let blocks = subs.map((sj) => {
      let list = bySub[sj].sort((a, b) => new Date(a.at) - new Date(b.at)), sum = list.reduce((a, x) => a + x.m, 0);
      return `<div class="day-subj" style="background:${subjColor(sj)}"><div class="day-subj-head"><b>${esc(sj)}</b><b>${fmtMin(sum)}</b></div>${list.map((x) => `<div class="day-task"><div><div class="day-task-title">${esc(x.t.title)}${x.done ? " ✓" : ""}</div><div class="day-task-meta">${hm(x.at)} · ${fmtMin(x.m)} · hạn ${fmtDate(x.t.dueAt)} · ${x.t.status === "done" ? "đã xong" : x.t.status === "doing" ? "đang làm" : "chưa bắt đầu"}</div></div><button class="small" data-action="detail" data-id="${x.t.id}">Chi tiết</button></div>`).join("")}</div>`;
    }).join("");
    let ks = Object.keys(Object.fromEntries(calWeeks().flatMap((w) => w.days).map((d) => [localDay(d), 1])));
    let i = ks.indexOf(k);
    return `<div class="card"><div class="section-head"><button class="secondary small" data-action="cal-back">← Về lịch tuần</button><div class="row" style="gap:6px"><button class="small secondary" data-action="cal-day" data-day="${ks[i - 1] || k}" ${i <= 0 ? "disabled" : ""}>‹ Hôm trước</button><button class="small secondary" data-action="cal-day" data-day="${ks[i + 1] || k}" ${i < 0 || i >= ks.length - 1 ? "disabled" : ""}>Hôm sau ›</button></div></div><h2 style="margin:8px 0 12px">${calDayLabel(k)}</h2>${blocks || '<div class="empty">Ngày này không có bài tập nào được xếp.</div>'}${total ? `<div class="day-total"><span>Tổng</span><b>${fmtMin(total)}</b></div>` : ""}</div>`;
  }
  /* Thông báo mỗi ngày: "Hôm nay bạn có bài tập" → bấm Chi tiết mở thẳng Xếp lịch hôm nay */
  function dailyHomework() {
    let u = current();
    if (!u || isTeacher() || isAdmin()) return;
    let k = localDay(now()), items = calDayItems(u, k).filter((x) => x.t.status !== "done" && !x.done);
    if (!items.length) return;
    notifyUser(u.id, "Hôm nay bạn có bài tập", "Ngày " + calDayLabel(k), "daily", "day-" + k);
    let pk = "sl_daily_" + u.id + "_" + k;
    try { if (localStorage.getItem(pk)) return; localStorage.setItem(pk, "1"); } catch (e) { /* vẫn hiện */ }
    let root = $("#toastRoot");
    if (!root) return;
    let n = new Set(items.map((x) => x.t.subject)).size, tot = items.reduce((a, x) => a + x.m, 0);
    let pop = document.createElement("div");
    pop.className = "daily-pop"; pop.setAttribute("role", "alert");
    pop.innerHTML = `<b>Thông báo</b><p>Hôm nay bạn có bài tập · ${n} môn · ${fmtMin(tot)}</p><div class="daily-pop-act"><button class="small secondary" data-x>Để sau</button><button class="small" data-open>Chi tiết</button></div>`;
    document.body.appendChild(pop);
    pop.style.cursor = "pointer";
    pop.onclick = () => { pop.remove(); openDay(k); };
    pop.querySelector("[data-x]").onclick = (e) => { e.stopPropagation(); pop.remove(); };
  }
  function openDay(k) { calTab = "todo"; calDay = k; page = "calendar"; render(); }
  function renderCalendar() {
    let u = current(),
      weeks = calWeeks();
    if (calDay && !isTeacher()) {
      pageHead("Xếp lịch hôm nay".replace("hôm nay", calDay === localDay(now()) ? "hôm nay" : calDayLabel(calDay)), "Các môn app đã xếp cho ngày này. Bấm một bài để xem chi tiết và bắt đầu học.");
      $("#content").innerHTML = calDayHtml(u, calDay);
      return;
    }
    pageHead(
      isTeacher() ? "Lịch nhiệm vụ" : "Lịch học cá nhân",
      isTeacher() ? "Xem khối lượng và hạn nộp các bài đã giao: tuần này và tuần sau." : "Xem lịch học app đã xếp và bài tập được giao: tuần này và tuần sau.",
    );
    let busyCard = isTeacher()
      ? ""
      : `<div class="card" style="margin-top:16px"><div class="section-head"><h2>Thời gian bận lặp lại</h2><button class="secondary" data-action="busy">+ Thời gian bận</button></div>${
          state.busy
            .filter((b) => b.ownerId === u.id)
            .map((b) => `<div class="item"><div><div class="item-title">${esc(b.label)}</div><div class="item-meta">${b.start}–${b.end} · ${b.days.map((d) => ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d]).join(", ")}</div></div><button class="small danger" data-action="delete-busy" data-id="${b.id}">Xóa</button></div>`)
            .join("") || '<div class="empty">Chưa khai báo thời gian bận.</div>'
        }</div>`;
    $("#content").innerHTML = `<div class="card"><div class="pill-tabs"><button class="${calTab === "todo" ? "active" : ""}" data-action="cal-tab" data-tab="todo">Lịch việc cần làm</button><button class="${calTab === "load" ? "active" : ""}" data-action="cal-tab" data-tab="load">Lịch khối lượng công việc</button></div>${calTab === "todo" ? calTodoHtml(u, weeks) : calLoadHtml(u, weeks)}</div>${calTab === "todo" ? busyCard : ""}`;
  }
  function renderClasses() {
    let u = current();
    pageHead(
      "Lớp học & dự án",
      "Giao nhiệm vụ, tổ chức nhóm và quản lý minh chứng.",
    );
    let classes = state.classes.filter(
      (c) =>
        isAdmin() ||
        (u.role === "teacher"
          ? c.teacherIds.includes(u.id)
          : c.studentIds.includes(u.id)),
    );
    $("#content").innerHTML =
      `<div class="grid"><div class="card span-5"><div class="section-head"><h2>Lớp học</h2>${isAdmin() ? '<button class="small" data-goto="adminclasses">+ Quản lý lớp</button>' : ""}</div>${classes.map((c) => `<div class="item"><div><div class="item-title">${esc(c.name)}</div><div class="item-meta">${c.studentIds.length} học sinh · ${c.teacherIds.length} giáo viên</div><div class="item-meta">${c.studentIds.map((id) => esc(state.users.find((x) => x.id === id)?.name || "")).join(", ")}</div></div>${isTeacher() ? `<button class="small secondary" data-action="assign" data-id="${c.id}">Giao nhiệm vụ</button>` : ""}</div>`).join("") || '<div class="empty">Chưa có lớp trong phạm vi tài khoản này.</div>'}</div><div class="card span-7"><div class="section-head"><h2>Dự án nhóm</h2>${isTeacher() ? '<button data-action="new-project">+ Tạo dự án</button>' : ""}</div>${
        state.projects
          .filter(
            (p) =>
              classes.some((c) => c.id === p.classId) ||
              p.memberIds?.includes(u.id) ||
              p.teacherIds?.includes(u.id),
          )
          .map(projectCard)
          .join("") ||
        '<div class="empty">Chưa có dự án. Giáo viên có thể tạo dự án cho lớp.</div>'
      }</div><div class="card span-12"><h2>Báo cáo tiến độ lớp</h2>${classProgress(classes)}</div></div>`;
  }
  function projectCard(p) {
    return `<div class="item"><div><div class="item-title">${esc(p.name)}</div><div class="item-meta">${esc(state.classes.find((c) => c.id === p.classId)?.name || "")} · ${p.groups.length} nhóm · ${p.tasks.length} nhiệm vụ</div><div class="item-meta">${p.groups.map((g) => esc(g.name) + " (" + g.memberIds.length + ")").join(" · ")}</div></div><div class="actions"><button class="small secondary" data-action="project-detail" data-id="${p.id}">Mở dự án</button></div></div>`;
  }
  function classProgress(classes) {
    let viewer = current(),
      visibleTask = (t) =>
        t.classId === undefined
          ? false
          : viewer.role !== "teacher" ||
            (t.teacherId === viewer.id &&
              (!viewer.subject || t.subject === viewer.subject));
    let cs = classes.flatMap((c) =>
      state.tasks.filter((t) => t.classId === c.id && visibleTask(t)),
    );
    if (!classes.some((c) => c.studentIds.length) || !cs.length)
      return '<div class="empty">Chưa có dữ liệu nhiệm vụ của lớp.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>Lớp</th><th>Học sinh</th><th>Đã giao</th><th>Đã hoàn thành</th><th>Đang làm</th><th>Chưa bắt đầu</th><th>Tiến độ</th><th>Thời gian đã học</th></tr></thead><tbody>${classes
      .flatMap((c) =>
        c.studentIds.map((id) => {
          let ts = state.tasks.filter(
              (t) => t.ownerId === id && t.classId === c.id && visibleTask(t),
            ),
            done = ts.filter((t) => t.status === "done").length,
            doing = ts.filter((t) => t.status === "doing").length,
            todo = ts.filter((t) => t.status === "todo").length,
            mins = ts.reduce((n, t) => n + (+t.actualMinutes || 0), 0),
            pct = ts.length ? Math.round((done / ts.length) * 100) : 0;
          return `<tr><td>${esc(c.name)}</td><td>${esc(state.users.find((u) => u.id === id)?.name || "Học sinh")}</td><td>${ts.length}</td><td>${done}</td><td>${doing}</td><td>${todo}</td><td>${pct}%</td><td>${mins} phút</td></tr>`;
        }),
      )
      .join("")}</tbody></table></div>`;
  }
  /* Nhiệm vụ nằm trong báo cáo: học sinh = của mình; admin = tất cả; giáo viên = học sinh thuộc lớp mình được phân công */
  function reportTasks(u) {
    return isStudent()
      ? state.tasks.filter((t) => t.ownerId === u.id)
      : isAdmin()
      ? state.tasks.slice()
      : state.tasks.filter((t) => state.classes.filter((c) => c.teacherIds.includes(u.id) && c.studentIds.includes(t.ownerId)).length);
  }
  const cycleNums = (ts) => ({
    taskCount: ts.length,
    actualMinutes: ts.reduce((n, t) => n + (+t.actualMinutes || 0), 0),
    deviationMinutes: ts.filter((t) => t.status === "done").reduce((n, t) => n + ((+t.estimatedMinutes || 0) - (+t.actualMinutes || 0)), 0),
  });
  function renderReports() {
    let u = current();
    pageHead(
      "Báo cáo",
      "Thống kê dựa trên thời gian xác nhận, tiến độ và lịch sử nhiệm vụ.",
    );
    if (isTeacher() && !isAdmin() && !u.homeroom) {
      let allowed = allowedTaskIds(u),
        ts = state.tasks.filter((t) => allowed.has(t.id));
      $("#content").innerHTML =
        `<div class="notice">Báo cáo giáo viên bộ môn chỉ bao gồm lớp, môn học và nhiệm vụ được phân công. Không hiển thị báo cáo thói quen liên môn.</div><div class="grid"><div class="card span-6"><h2>Thời gian thực tế theo nhiệm vụ</h2>${teacherReport(ts)}</div><div class="card span-6"><h2>Gợi ý thời lượng</h2>${teacherSuggestions(ts)}</div><div class="card span-12"><h2>Báo cáo lớp</h2>${classProgress(state.classes.filter((c) => isAdmin() || c.teacherIds.includes(u.id)))}</div></div>`;
      return;
    }
    let ts = reportTasks(u);
    let completed = ts.filter((t) => t.status === "done"),
      actual = ts.reduce((n, t) => n + (+t.actualMinutes || 0), 0),
      estimated = ts.reduce((n, t) => n + (+t.estimatedMinutes || 0), 0),
      dev = completed.reduce((n, t) => n + ((+t.estimatedMinutes || 0) - (+t.actualMinutes || 0)), 0);
    $("#content").innerHTML =
      `<div class="grid"><div class="card span-3"><div class="stat-label">Tổng thời gian thực tế</div><div class="stat">${Math.round((actual / 60) * 10) / 10}h</div></div><div class="card span-3"><div class="stat-label">Thời gian dự kiến</div><div class="stat">${Math.round((estimated / 60) * 10) / 10}h</div></div><div class="card span-3"><div class="stat-label">Sai lệch (bài đã hoàn thành)</div><div class="stat">${completed.length ? (dev > 0 ? "+" : "") + dev + " phút" : "—"}</div><div class="muted">${!completed.length ? "Chưa có bài hoàn thành" : dev > 0 ? "Học sinh làm nhanh hơn dự kiến " + dev + " phút" : dev < 0 ? "Học sinh làm chậm hơn dự kiến " + -dev + " phút" : "Đúng dự kiến"}</div></div><div class="card span-3"><div class="stat-label">Đã hoàn thành</div><div class="stat">${completed.length}/${ts.length}</div></div><div class="card span-7"><h2>Thời gian học theo ngày trong tuần</h2>${weekdayChart(ts)}</div><div class="card span-5"><h2>Phân tích thói quen</h2>${habitAdvice(ts)}</div><div class="card span-12"><div class="section-head"><h2>Lịch sử chu kỳ nửa tuần</h2><button class="secondary" data-action="close-cycle">Chốt chu kỳ hiện tại</button></div>${cycleHistory(ts)}</div><div class="card span-12"><h2>Sai lệch theo nhiệm vụ</h2>${deviationTable(ts)}</div></div>`;
  }
  function teacherReport(ts) {
    return `<div class="stat">${ts.reduce((n, t) => n + (+t.actualMinutes || 0), 0)} phút</div><p class="muted">Tổng thời gian thực tế đã xác nhận trong phạm vi nhiệm vụ được phân công.</p>${deviationTable(ts)}`;
  }
  function halfWeekRange(date = now()) {
    let d = new Date(date);
    d.setHours(0, 0, 0, 0);
    let dow = d.getDay(),
      daysFromMonday = (dow + 6) % 7;
    let monday = new Date(d);
    monday.setDate(d.getDate() - daysFromMonday);
    let thursday = new Date(monday);
    thursday.setDate(monday.getDate() + 3);
    let start = d < thursday ? monday : thursday;
    let end = new Date(start);
    end.setDate(
      start.getDate() + (start.getTime() === monday.getTime() ? 3 : 4),
    );
    return {
      start,
      end,
      label:
        (start.getTime() === monday.getTime()
          ? "Thứ Hai – Thứ Tư"
          : "Thứ Năm – Chủ Nhật") +
        " · " +
        start.toLocaleDateString("vi-VN") +
        "–" +
        new Date(end.getTime() - 1).toLocaleDateString("vi-VN"),
    };
  }
  function completionDate(t) {
    if (t.completedAt && Number.isFinite(Date.parse(t.completedAt)))
      return new Date(t.completedAt);
    let h = (t.history || [])
      .filter((x) => x.field === "complete")
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (h && Number.isFinite(Date.parse(h.at))) return new Date(h.at);
    let ss = (t.sessions || [])
      .filter((x) => x.completed && Number.isFinite(Date.parse(x.startAt)))
      .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0];
    return ss ? new Date(ss.startAt) : null;
  }
  function teacherSuggestions(ts) {
    let range = halfWeekRange(),
      completed = ts
        .filter((t) => t.status === "done" && Number(t.actualMinutes) > 0)
        .map((t) => ({ t, date: completionDate(t) }))
        .filter((x) => x.date && x.date >= range.start && x.date < range.end)
        .map((x) => x.t);
    if (!completed.length)
      return `<div class="notice"><b>Không có bài hoàn thành trong chu kỳ này.</b><p>Chu kỳ hiện tại: ${esc(range.label)}. Khi có ít nhất một bài hoàn thành và ghi nhận thời gian thực tế, hệ thống sẽ tính gợi ý ngay, kể cả chỉ có 1 bài.</p><p>Dữ liệu gợi ý được làm mới theo chu kỳ nửa tuần; lịch sử nhiệm vụ vẫn được giữ nguyên.</p></div>`;
    let groups = {};
    completed.forEach((t) => {
      let k = (t.subject || "Chưa rõ môn") + " · " + (t.kind || "Nhiệm vụ");
      (groups[k] ??= []).push(Number(t.actualMinutes));
    });
    let rows = Object.entries(groups).map(
      ([k, a]) =>
        `<div class="item"><div><div class="item-title">${esc(k)}</div><div class="item-meta">${a.length} ${a.length === 1 ? "bài" : "bài"} hoàn thành trong chu kỳ · thời gian trung bình ${Math.round(a.reduce((n, v) => n + v, 0) / a.length)} phút</div></div><span class="badge green">${a.length === 1 ? "Ước tính ban đầu" : "Có dữ liệu"}</span></div>`,
    );
    return `<p class="muted">Dữ liệu chu kỳ: ${esc(range.label)}. Gợi ý được tính ngay từ bài hoàn thành; chỉ có 1 bài thì lấy thời gian bài đó làm mức trung bình.</p>${rows.join("")}<div class="footer-note">Gợi ý chỉ tham khảo, không tự thay đổi thời lượng giáo viên đặt. Sang chu kỳ nửa tuần mới, phép tính bắt đầu lại; dữ liệu cũ không bị xóa.</div>`;
  }
  function median(a) {
    let x = [...a].sort((a, b) => a - b);
    return Math.round(x[Math.floor(x.length / 2)]);
  }
  function weekdayChart(ts) {
    let a = Array(7).fill(0);
    ts.forEach((t) => {
      let rec = 0;
      (t.sessions || []).forEach((s) => {
        if (s.minutes > 0 && s.endAt) {
          a[new Date(s.startAt).getDay()] += s.minutes;
          rec += s.minutes;
        }
      });
      // thời gian thực tế chưa có phiên học ghi ngày: tính vào ngày hoàn thành bài
      let rest = (+t.actualMinutes || 0) - rec, cd = rest > 0 && t.status === "done" ? completionDate(t) : null;
      if (cd) a[cd.getDay()] += rest;
    });
    let max = Math.max(1, ...a);
    return `<div class="chart">${a.map((n, i) => `<div class="chart-col"><div class="chart-val">${n}m</div><div class="chart-bar" style="height:${Math.max(2, (n / max) * 130)}px"></div><div class="chart-label">${["CN", "T2", "T3", "T4", "T5", "T6", "T7"][i]}</div></div>`).join("")}</div><div class="footer-note">Chỉ cộng phiên có ngày học ghi nhận; thời gian nhập thủ công không có ngày học được ghi vào ngày hoàn thành.</div>`;
  }
  function habitAdvice(ts) {
    let completed = ts.filter((t) => t.status === "done"),
      range = halfWeekRange(),
      recent = ts
        .filter((t) => t.status === "done" && Number(t.actualMinutes) > 0)
        .map((t) => ({ t, date: completionDate(t) }))
        .filter((x) => x.date && x.date >= range.start && x.date < range.end)
        .map((x) => x.t),
      avg = recent.length
        ? Math.round(
            recent.reduce((n, t) => n + (+t.actualMinutes || 0), 0) /
              recent.length,
          )
        : null,
      over = ts.filter(
        (t) =>
          t.status === "overdue" ||
          (t.status !== "done" && new Date(t.dueAt) < now()),
      ),
      long = ts.filter(
        (t) => t.actualMinutes > t.estimatedMinutes && t.actualMinutes > 0,
      );
    let hours = {};
    ts.forEach((t) =>
      (t.sessions || []).forEach((s) => {
        if (s.minutes > 0) {
          let h = new Date(s.startAt).getHours(),
            key = h < 12 ? "Buổi sáng" : h < 17 ? "Buổi chiều" : "Buổi tối";
          hours[key] = (hours[key] || 0) + s.minutes;
        }
      }),
    );
    let best = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
    return `<p>Hoàn thành ${completed.length}/${ts.length} nhiệm vụ có dữ liệu.</p><p><b>Gợi ý thời gian thực tế trong chu kỳ nửa tuần (${esc(range.label)}):</b> ${recent.length ? `${avg} phút/bài trung bình từ ${recent.length} bài hoàn thành${recent.length === 1 ? " (ước tính ban đầu)" : ""}.` : "Không có bài hoàn thành trong chu kỳ này."}</p><p>${over.length ? `Có ${over.length} nhiệm vụ quá hạn hoặc chưa hoàn thành sau hạn.` : "Chưa ghi nhận nhiệm vụ quá hạn trong tập dữ liệu này."}</p><p>${long.length ? `${long.length} nhiệm vụ mất nhiều thời gian hơn dự kiến.` : "Chưa thấy nhiệm vụ vượt dự kiến trong dữ liệu đã xác nhận."}</p><p>${best ? `Khung giờ có nhiều phút học ghi nhận nhất: <b>${best[0]}</b> (${best[1]} phút).` : "Chưa đủ phiên học có dấu thời gian để phân tích khung giờ."}</p><div class="footer-note">Phân tích mô tả, không dùng điểm số và không tự điều chỉnh lịch.</div>`;
  }
  function deviationTable(ts) {
    return `<div class="table-wrap"><table><thead><tr><th>Nhiệm vụ</th><th>Môn / dạng</th><th>Dự kiến</th><th>Thực tế</th><th>Sai lệch</th></tr></thead><tbody>${ts.map((t) => {
      let done = t.status === "done", d = (+t.estimatedMinutes || 0) - (+t.actualMinutes || 0),
        txt = !done ? (isRunning(t) ? "Đang làm" : (+t.actualMinutes || 0) > 0 ? "Chưa hoàn thành" : "Chưa làm") : d > 0 ? "Làm nhanh hơn " + d + " phút (+" + d + ")" : d < 0 ? "Làm chậm hơn " + -d + " phút (" + d + ")" : "Đúng dự kiến";
      return `<tr><td>${esc(t.title)}</td><td>${esc(t.subject)} / ${esc(t.kind || "Khác")}</td><td>${t.estimatedMinutes} phút</td><td>${done || (+t.actualMinutes || 0) > 0 ? t.actualMinutes + " phút" : "—"}</td><td>${txt}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  function cycleHistory(ts) {
    let hist = state.cycleHistory || [],
      dv = (v) => (v > 0 ? "+" : "") + v,
      line = (c) => `${c.taskCount} nhiệm vụ · ${c.actualMinutes} phút thực tế · sai lệch ${dv(c.deviationMinutes)} phút (bài đã hoàn thành)`,
      live = cycleNums(ts || []),
      liveRow = `<div class="item"><div><div class="item-title">Hiện tại · chưa chốt</div><div class="item-meta">${line(live)}</div></div><span class="badge amber">Đang tính</span></div>`;
    return liveRow + (hist.length
      ? hist
          .slice()
          .reverse()
          .map(
            (c) =>
              `<div class="item"><div><div class="item-title">${esc(c.label)}</div><div class="item-meta">${line(c)}</div></div><span class="badge">Đã lưu</span></div>`,
          )
          .join("")
      : '<div class="empty">Chưa có chu kỳ nào được chốt. Bấm "Chốt chu kỳ hiện tại" để lưu lại số liệu hiện tại.</div>');
  }
  function renderNotifications() {
    let u = current(),
      ns = state.notifications
        .filter((n) => n.userId === u.id)
        .slice()
        .reverse();
    pageHead("Thông báo", "Nhắc hạn cục bộ, cảnh báo và hoạt động dự án.");
    $("#content").innerHTML =
      `<div class="section-head"><div class="muted">Nhắc hạn mặc định: 24 giờ và 2 giờ trước hạn. Bật “Thông báo trên màn hình máy tính” bên dưới để nhận cả khi đã đóng tab.</div><button class="secondary" data-action="mark-read">Đánh dấu đã đọc</button></div><div class="card"><h2>Hộp thư thông báo</h2>${notificationList(ns)}</div>`;
    SL.afterNotifications?.($("#content"));
  }
  function notificationList(ns) {
    return ns.length
      ? ns
          .map(
            (n) =>
              `<div class="item" ${n.type === "daily" ? `data-action="open-day" data-day="${String(n.taskId || "").slice(4)}" style="cursor:pointer"` : ""}><div><div class="item-title">${esc(n.title)} ${n.read ? "" : '<span class="badge">Mới</span>'}</div><div>${esc(n.body)}</div><div class="item-meta">${fmtDate(n.createdAt)}</div></div><div class="actions">${n.type === "daily" ? `<button class="small" data-action="open-day" data-day="${String(n.taskId || "").slice(4)}">Chi tiết</button>` : ""}${n.read ? "" : `<button class="small secondary" data-action="read-notice" data-id="${n.id}">Đã đọc</button>`}</div></div>`,
          )
          .join("")
      : '<div class="empty">Không có thông báo.</div>';
  }
  function renderSettings() {
    let u = current();
    pageHead("Cài đặt & dữ liệu", "Thiết lập lịch học và quản lý tài khoản.");
    $("#content").innerHTML =
      `<div class="grid"><div class="card span-6"><h2>Thời gian rảnh và bận</h2><p class="muted">Mặc định có 3 tiếng học mỗi ngày, từ 19:00 đến 22:00. Các khoảng bận bên dưới được trừ khỏi sức chứa.</p><button data-action="busy">+ Thêm khoảng bận lặp lại</button><div class="stack" style="margin-top:12px">${
        state.busy
          .filter((b) => b.ownerId === u.id)
          .map(
            (b) =>
              `<div class="item"><div><div class="item-title">${esc(b.label)}</div><div class="item-meta">${b.start}–${b.end} · ${b.days.map((d) => ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d]).join(", ")}</div></div><button class="small danger" data-action="delete-busy" data-id="${b.id}">Xóa</button></div>`,
          )
          .join("") || '<div class="empty">Chưa khai báo.</div>'
      }</div></div><div class="card span-6"><h2>Nhắc hạn</h2><label class="checkrow"><input id="studyOnly" type="checkbox" ${state.reminderSettings.studyOnly ? "checked" : ""}> Chỉ nhắc trong thời gian học / rảnh đã khai báo</label><label>Mốc nhắc (giờ trước hạn, phân cách bằng dấu phẩy)</label><input id="reminderHours" value="${esc(state.reminderSettings.hours.join(", "))}"><div style="margin-top:12px"><button data-action="save-reminders">Lưu thay đổi</button></div><p class="footer-note">Nhắc hạn được kiểm tra khi ứng dụng đang mở.</p></div><div class="card span-6"><h2>Tài khoản</h2><p>Đang đăng nhập: <b>${esc(u.name)}</b> (${isAdmin() ? "quản trị viên" : isTeacher() ? "giáo viên" : "học sinh"}).</p><button data-goto="profile">Hồ sơ & yêu cầu</button><button class="secondary" data-action="logout" style="margin-left:8px">Đăng xuất</button><p class="footer-note">Dữ liệu được lưu trên máy chủ Supabase và đồng bộ giữa các thiết bị.</p></div></div>`;
  }
  function modal(title, body, submitText = "Lưu") {
    $("#modalRoot").innerHTML =
      `<div class="modal-backdrop" id="backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="between"><h2>${title}</h2><button class="secondary small" data-close>Đóng</button></div>${body}<div class="modal-footer"><button class="secondary" data-close>Hủy</button><button id="modalSubmit">${submitText}</button></div></div></div>`;
    // không đóng khi bấm ra ngoài thẻ (tránh bấm nhầm); chỉ đóng bằng nút Đóng/Hủy
    $$("[data-close]").forEach((b) => (b.onclick = closeModal));
  }
  function closeModal() {
    // đóng cửa sổ bấm giờ = tạm dừng đồng hồ (không để đồng hồ chạy ngầm)
    if ($("#timerSeconds") && timer.status === "running") {
      pauseTimer(false);
      toast("Đã tạm dừng đồng hồ. Bấm \"Bắt đầu học\" để học tiếp.");
    }
    $("#modalRoot").innerHTML = "";
  }
  function taskForm(t = {}, ownerId = current().id) {
    return `<form id="taskForm"><div class="form-grid"><div class="full"><label>Tên nhiệm vụ *</label><input name="title" required value="${esc(t.title || "")}"></div><div><label>Môn học *</label><input name="subject" required value="${esc(t.subject || "")}"></div><div><label>Loại nhiệm vụ</label><input name="kind" value="${esc(t.kind || "Nhiệm vụ")}"></div><div><label>Thời gian dự kiến (phút) *</label><input type="number" name="estimatedMinutes" min="1" required value="${t.estimatedMinutes ?? 60}"></div><div><label>Thời gian cần học thêm (phút) *</label><input type="number" name="remainingWorkMinutes" min="0" required value="${t.remainingWorkMinutes ?? t.estimatedMinutes ?? 60}"></div><div><label>Hạn nộp *</label><input type="datetime-local" name="dueAt" required value="${esc(t.dueAt ? new Date(new Date(t.dueAt).getTime() - new Date(t.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "")}"></div><div><label>Ngày bắt đầu (tùy chọn)</label><input type="datetime-local" name="startAt" value="${esc(t.assignedAt ? new Date(new Date(t.assignedAt).getTime() - new Date(t.assignedAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "")}"></div><div><label>Ưu tiên</label><select name="priority"><option value="1" ${t.priority === 1 ? "selected" : ""}>Thường</option><option value="2" ${!t.priority || t.priority === 2 ? "selected" : ""}>Vừa</option><option value="3" ${t.priority === 3 ? "selected" : ""}>Cao</option></select></div><input type="hidden" name="ownerId" value="${ownerId}"></div></form>`;
  }
  function openTask(t) {
    if (t && t.assignmentId) return SL.editAssignment(t); // bài do lớp giao: sửa ở máy chủ, áp dụng cho cả lớp
    modal(
      t ? "Sửa nhiệm vụ đã giao" : "Tạo nhiệm vụ mới",
      taskForm(t || {}, t?.ownerId || current().id),
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#taskForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f),
        data = Object.fromEntries(d.entries());
      let due = new Date(data.dueAt);
      if (!Number.isFinite(+due)) {
        toast("Hạn nộp không hợp lệ.");
        return;
      }
      if (!t && data.ownerId !== current().id) {
        toast("Muốn giao bài cho học sinh, hãy dùng nút “Giao nhiệm vụ” ở trang lớp.");
        return;
      }
      let startD = data.startAt ? new Date(data.startAt) : null;
      if (startD && startD > due) {
        toast("Ngày bắt đầu phải trước hạn nộp.");
        return;
      }
      let est = Number(data.estimatedMinutes),
        rem = Number(data.remainingWorkMinutes);
      if (est < 1 || rem < 0) {
        toast("Thời lượng không hợp lệ.");
        return;
      }
      if (t) {
        Object.assign(t, {
          title: data.title,
          subject: data.subject,
          kind: data.kind,
          estimatedMinutes: est,
          remainingWorkMinutes: rem,
          dueAt: due.toISOString(),
          assignedAt: startD ? startD.toISOString() : t.assignedAt || iso(now()),
          priority: +data.priority,
          teacherId: data.teacherId || null,
        });
        t.history.push({
          at: iso(now()),
          field: "task",
          note: "Thông tin nhiệm vụ được chỉnh sửa",
        });
      } else
        state.tasks.push({
          id: uid("t"),
          ownerId: data.ownerId,
          title: data.title,
          subject: data.subject,
          kind: data.kind,
          estimatedMinutes: est,
          actualMinutes: 0,
          remainingWorkMinutes: rem,
          dueAt: due.toISOString(),
          assignedAt: startD ? startD.toISOString() : iso(now()),
          
          priority: +data.priority,
          status: "todo",
          sessions: [],
          history: [],
          teacherId: data.teacherId || null,
          classId: null, // nhiệm vụ cá nhân; giao cho cả lớp dùng "Giao nhiệm vụ" ở từng lớp
          createdBy: current().id,
          source: "user",
        });
      closeModal();
      state.tasks.forEach((x) => {
        if (x.status !== "done" && new Date(x.dueAt) < now())
          x.status = "overdue";
      });
      schedule(data.ownerId);
      notifyUser(
        data.ownerId,
        "Nhiệm vụ mới hoặc đã cập nhật",
        `${data.title} · hạn ${fmtDate(due)}`,
        "task",
      );
      render();
      toast("Đã lưu nhiệm vụ và tính lại lịch.");
    };
  }
  function taskDetail(id) {
    let t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    let u = current();
    if (isStudent() && t.ownerId !== u.id) {
      toast("Bạn không có quyền xem nhiệm vụ này.");
      return;
    }
    if (isTeacher() && !allowedTaskIds(u).has(t.id)) {
      toast("Ngoài phạm vi quyền truy cập.");
      return;
    }
    let risk = (t.unscheduledMinutes || 0) > 0,
      logs = (t.sessions || []).slice().reverse();
    modal(
      "Chi tiết nhiệm vụ",
      `<div class="stack"><div class="item-title">${esc(t.title)}</div><div class="item-meta">${esc(t.subject)} · ${esc(t.kind || "")}</div>${risk ? `<div class="notice red">Có nhiệm vụ có nguy cơ trễ hạn. Thời gian còn lại: ${t.remainingWorkMinutes} phút; thời gian chưa thể xếp lịch: ${t.unscheduledMinutes} phút. Hạn: ${fmtDate(t.dueAt)}.</div>` : ""}<div class="grid"><div class="card span-6"><div class="stat-label">Thời gian dự kiến ban đầu</div><div class="stat">${t.estimatedMinutes}m</div></div><div class="card span-6"><div class="stat-label">Thực tế đã xác nhận</div><div class="stat">${t.actualMinutes}m</div></div><div class="card span-6"><div class="stat-label">Thời gian cần học thêm</div><div class="stat">${t.remainingWorkMinutes}m</div></div><div class="card span-6"><div class="stat-label">Hạn nộp</div><b>${fmtDate(t.dueAt)}</b></div></div><p>Trạng thái: <b>${esc(taskStatus(t))}</b> · Ưu tiên: ${t.priority === 3 ? "Cao" : t.priority === 2 ? "Vừa" : "Thường"}</p><div class="row">${isStudent() && t.status !== "done" ? `<button data-action="study" data-id="${t.id}">Bắt đầu học</button><button class="secondary" data-action="complete" data-id="${t.id}">Đánh dấu hoàn thành</button><button class="secondary" data-action="edit-progress" data-id="${t.id}">Cập nhật tiến độ</button>` : ""}${isTeacher() ? `<button class="secondary" data-action="edit-task" data-id="${t.id}">Sửa thông tin đã giao</button>` : ""}</div><h3>Phiên học và lịch sử</h3>${logs.map((s) => `<div class="item"><div><div class="item-title">${s.completed ? "✓ Phiên đã ghi nhận" : "Phiên dự kiến"}</div><div class="item-meta">${fmtDate(s.startAt)} · ${s.minutes} phút ${s.paused ? "· Có tạm dừng" : ""}</div></div></div>`).join("") || '<div class="empty">Chưa có phiên học.</div>'}<h3>Lịch sử tiến độ</h3>${(t.history || []).map((h) => `<div class="item"><div><div>${esc(h.note || h.field || "Cập nhật")}</div><div class="item-meta">${fmtDate(h.at)}</div></div></div>`).join("") || '<div class="muted">Chưa có cập nhật nào.</div>'}</div>`,
      "Đóng",
    );
    SL.afterTaskDetail?.(t);
    $("#modalSubmit").onclick = closeModal;
  }
  function editProgress(t) {
    modal(
      "Cập nhật tiến độ",
      `<form id="progressForm"><p class="muted">Thời gian dự kiến ban đầu (${t.estimatedMinutes} phút) không thay đổi. Tiến độ không được suy ra tự động từ thời gian đã học.</p><label>Thời gian thực tế đã học được xác nhận (phút)</label><input type="number" min="0" name="actual" required value="${t.actualMinutes}"><label>Thời gian cần học thêm (phút)</label><input type="number" min="0" name="remaining" required value="${t.remainingWorkMinutes}"><label>Ghi chú tiến độ (không bắt buộc)</label><textarea name="note" rows="2" placeholder="Ví dụ: đã hoàn thành phần 1, còn phần 2"></textarea></form>`,
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#progressForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f),
        a = +d.get("actual"),
        r = +d.get("remaining");
      if (a < 0 || r < 0) return;
      t.actualMinutes = a;
      t.remainingWorkMinutes = r;
      t.history.push({
        at: iso(now()),
        field: "progress",
        note:
          d.get("note") ||
          `Cập nhật tiến độ: thực tế ${a} phút, còn lại ${r} phút`,
      });
      closeModal();
      schedule(t.ownerId);
      render();
      toast("Đã cập nhật tiến độ và lịch tương lai.");
    };
  }
  function startStudy(t) {
    if (timer.status !== "idle") {
      if (timer.taskId === t.id) {
        showTimer(t);
        return;
      }
      if (
        !confirm(
          "Một đồng hồ khác đang hoạt động. Tạm dừng và chuyển nhiệm vụ?",
        )
      )
        return;
      pauseTimer(false);
    }
    timer = {
      taskId: t.id,
      status: "running",
      accum: 0,
      startedAt: Date.now(),
      autoPausePrompted: false,
    };
    t.status = "doing";
    save();
    showTimer(t);
    timerInterval = setInterval(tick, 1000);
  }
  function elapsed() {
    return (
      timer.accum +
      (timer.status === "running" && timer.startedAt
        ? Math.floor((Date.now() - timer.startedAt) / 1000)
        : 0)
    );
  }
  function tick() {
    let t = state.tasks.find((x) => x.id === timer.taskId);
    if (!t) {
      clearInterval(timerInterval);
      return;
    }
    let sec = elapsed();
    if (
      sec >= Math.max(1, t.estimatedMinutes) * 120 &&
      !timer.autoPausePrompted
    ) {
      timer.autoPausePrompted = true;
      modal(
        "Bạn còn học không?",
        `<p>Đồng hồ đã chạy đạt hai lần thời gian dự kiến (${t.estimatedMinutes * 2} phút). Bạn còn học không?</p><p class="muted">Nếu không phản hồi trong 30 giây, đồng hồ tự tạm dừng.</p>`,
        "Tiếp tục học",
      );
      let decided = false;
      $("#modalSubmit").onclick = () => {
        decided = true;
        closeModal();
        timer.autoPausePrompted = false;
      };
      window.__autoPauseTimeout = setTimeout(() => {
        if (!decided && timer.status === "running") {
          pauseTimer(false);
          closeModal();
          toast("Bạn đã tạm dừng.");
          showTimer(t);
        }
      }, 30000);
      $("#backdrop").querySelector("[data-close]").onclick = () => {
        decided = true;
        closeModal();
        pauseTimer(false);
        showTimer(t);
      };
    }
    if ($("#timerSeconds")) $("#timerSeconds").textContent = clock(sec);
  }
  function clock(s) {
    return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  function pauseTimer(rerender = true) {
    if (timer.status !== "running") return;
    timer.accum = elapsed();
    timer.startedAt = null;
    timer.status = "paused";
    clearInterval(timerInterval);
    save();
    if (rerender) showTimer(state.tasks.find((t) => t.id === timer.taskId));
  }
  function resumeTimer() {
    if (timer.status !== "paused") return;
    clearInterval(timerInterval);
    timer.status = "running";
    timer.startedAt = Date.now();
    timer.autoPausePrompted = false;
    timerInterval = setInterval(tick, 1000);
    showTimer(state.tasks.find((t) => t.id === timer.taskId));
  }
  function showTimer(t) {
    let seconds = elapsed();
    modal(
      "Bấm giờ học",
      `<div class="stack"><div class="item-title">${esc(t.title)}</div><div class="timer-readout" id="timerSeconds">${clock(seconds)}</div><div class="muted">Thời gian tạm dừng không được tính. Thời gian sẽ chỉ được lưu sau khi xác nhận hoàn thành.</div><div class="row">${timer.status === "running" ? '<button class="secondary" id="pauseTimer">Tạm dừng</button>' : '<button id="resumeTimer">Học tiếp</button>'}<button class="secondary" id="finishTimer">Hoàn thành</button></div></div>`,
      "Đóng",
    );
    $("#modalSubmit").onclick = closeModal;
    $("#pauseTimer")?.addEventListener("click", () => {
      pauseTimer(false);
      showTimer(t);
    });
    $("#resumeTimer")?.addEventListener("click", resumeTimer);
    $("#finishTimer")?.addEventListener("click", () =>
      confirmCompletion(t, Math.ceil(elapsed() / 60), true),
    );
  }
  function confirmCompletion(t, minutes, fromTimer = false) {
    modal(
      "Xác nhận hoàn thành",
      `<p>Bạn xác nhận đã hoàn thành nhiệm vụ <b>${esc(t.title)}</b>?</p><form id="completeForm"><label>Thời gian thực tế đã học (phút) *</label><input type="number" name="minutes" min="0" required value="${fromTimer ? minutes : ""}" ${fromTimer ? "" : 'placeholder="Nhập số phút thực tế"'}><label>Ngày học thực tế (nếu biết)</label><input type="date" name="studyDate" value="${fromTimer ? localDay(now()) : ""}"><p class="muted">${fromTimer ? "Kiểm tra hoặc chỉnh sửa số phút trước khi lưu." : "Không bấm giờ: bắt buộc nhập thời gian thực tế. Nếu không biết ngày học, hệ thống ghi nhận ngày hoàn thành."}</p></form>`,
      "Xác nhận và lưu",
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#completeForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f),
        m = Number(d.get("minutes"));
      if (!Number.isFinite(m) || m < 0) {
        toast("Thời gian thực tế không hợp lệ.");
        return;
      }
      let studyDate = d.get("studyDate");
      let start = studyDate ? new Date(studyDate + "T12:00:00") : now();
      t.actualMinutes = (+t.actualMinutes || 0) + m;
      t.remainingWorkMinutes = 0;
      t.status = "done";
      t.sessions.push({
        id: uid("s"),
        startAt: iso(start),
        endAt: iso(now()),
        minutes: m,
        completed: true,
        planned: false,
        manual: !fromTimer,
        studyDateKnown: !!studyDate,
        paused: fromTimer && timer.status === "paused",
      });
      t.history.push({
        at: iso(now()),
        field: "complete",
        note: `Học sinh xác nhận hoàn thành; thêm ${m} phút thực tế`,
      });
      if (timer.taskId === t.id) {
        timer = {
          taskId: null,
          status: "idle",
          accum: 0,
          startedAt: null,
          autoPausePrompted: false,
        };
        clearInterval(timerInterval);
        clearTimeout(window.__autoPauseTimeout);
      }
      closeModal();
      schedule(t.ownerId);
      cancelTaskReminders(t.id);
      render();
      toast("Đã xác nhận hoàn thành và cập nhật lịch.");
    };
  }
  function notifyUser(userId, title, body, type, taskId) {
    let key = type + "_" + (taskId || "") + "_" + title + "_" + body;
    let exists = state.notifications.some(
      (n) => n.userId === userId && n.key === key && !n.dismissed,
    );
    if (exists) return;
    state.notifications.push({
      id: uid("n"),
      userId,
      title,
      body,
      type,
      taskId,
      key,
      createdAt: iso(now()),
      read: false,
    });
    save();
  }
  function cancelTaskReminders(id) {
    state.notifications = state.notifications.filter(
      (n) => n.taskId !== id || n.type === "project",
    );
    save();
  }
  function checkReminders() {
    let u = current(),
      count = 0;
    for (let t of state.tasks.filter(
      (t) => t.ownerId === u.id && t.status !== "done",
    )) {
      let due = new Date(t.dueAt),
        hours = (due - now()) / 3600000;
      if (hours < 0) {
        cancelTaskReminders(t.id);
        continue;
      }
      for (let h of state.reminderSettings.hours) {
        if (hours <= h && hours > h - 0.15) {
          if (state.reminderSettings.studyOnly && !isFreeNow(u.id)) {
            continue;
          }
          let title = `Nhắc hạn còn ${h} giờ`,
            key = `reminder_${t.id}_${h}_${t.dueAt}`;
          if (!state.notifications.some((n) => n.key === key)) {
            notifyUser(
              u.id,
              title,
              `${t.title} · còn ${Math.max(0, Math.round(hours * 60))} phút tới hạn.`,
              "reminder",
              t.id,
            );
            count++;
          }
        }
      }
    }
    save();
    render();
    toast(
      count
        ? `Đã tạo ${count} nhắc hạn phù hợp.`
        : "Không có nhắc hạn mới cần hiển thị.",
    );
  }
  function isFreeNow(owner) {
    let d = now(),
      ranges = rangesForDay(d, owner);
    return ranges.some(([a, b]) => d >= a && d < b);
  }
  function openBusy() {
    let u = current();
    modal(
      "Thêm thời gian bận",
      `<form id="busyForm"><label>Tên khoảng bận *</label><input name="label" required placeholder="Học thêm, nghỉ ngơi…"><div class="form-grid"><div><label>Bắt đầu *</label><input type="time" name="start" required value="19:00"></div><div><label>Kết thúc *</label><input type="time" name="end" required value="20:00"></div></div><label>Ngày lặp lại</label><div class="member-grid">${["CN", "T2", "T3", "T4", "T5", "T6", "T7"].map((d, i) => `<label class="checkrow"><input type="checkbox" name="days" value="${i}" ${i > 0 && i < 6 ? "checked" : ""}>${d}</label>`).join("")}</div></form>`,
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#busyForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f),
        days = d.getAll("days").map(Number);
      if (!days.length) {
        toast("Chọn ít nhất một ngày.");
        return;
      }
      let [sh, sm] = d.get("start").split(":").map(Number),
        [eh, em] = d.get("end").split(":").map(Number);
      if (sh === eh && sm === em) {
        toast("Khoảng bận không thể dài 0 phút.");
        return;
      }
      if (eh * 60 + em < sh * 60 + sm || eh * 60 + em > 23 * 60) {
        toast(
          "Cảnh báo: khoảng bận kết thúc sau 11:00 PM hoặc qua nửa đêm. Vui lòng xác nhận cách khai báo.",
        );
        if (
          !confirm(
            "Khoảng thời gian kết thúc muộn hoặc qua nửa đêm. Vẫn lưu như đã nhập?",
          )
        )
          return;
      }
      state.busy.push({
        id: uid("b"),
        ownerId: u.id,
        label: d.get("label"),
        start: d.get("start"),
        end: d.get("end"),
        days,
        source: "user",
      });
      closeModal();
      schedule(u.id);
      render();
      toast("Đã lưu thời gian bận và tính lại lịch.");
    };
  }
  function assignTask(classId) {
    SL.assignToClass(classId);
  }
  function newProject() {
    let classes = state.classes.filter((c) =>
      c.teacherIds.includes(current().id),
    );
    if (!classes.length) {
      toast("Bạn cần là giáo viên phụ trách một lớp để tạo dự án.");
      return;
    }
    modal(
      "Tạo dự án nhóm",
      `<form id="projectForm"><label>Tên dự án *</label><input name="name" required><label>Lớp *</label><select name="classId">${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><label>Chia nhóm</label><select name="mode" id="groupMode"><option value="auto">Tự động ngẫu nhiên</option><option value="manual">Thủ công</option></select><div class="form-grid"><div><label>Số nhóm</label><input type="number" min="1" name="groupCount" value="2"></div><div><label>Số thành viên/nhóm (ưu tiên)</label><input type="number" min="1" name="groupSize" value="3"></div></div><p class="muted">Giáo viên xem trước và có thể điều chỉnh thành viên sau khi tạo.</p></form>`,
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#projectForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f),
        c = state.classes.find((c) => c.id === d.get("classId")),
        members = [...c.studentIds];
      if (!members.length) {
        toast("Lớp chưa có học sinh.");
        return;
      }
      let groups = [];
      if (d.get("mode") === "auto") {
        members.sort(() => Math.random() - 0.5);
        let gc = Math.max(
          1,
          Math.min(members.length, +d.get("groupCount") || 1),
        );
        groups = Array.from({ length: gc }, (_, i) => ({
          id: uid("g"),
          name: `Nhóm ${i + 1}`,
          memberIds: [],
          leaderId: null,
        }));
        members.forEach((m, i) => groups[i % gc].memberIds.push(m));
      } else
        groups = [
          { id: uid("g"), name: "Nhóm 1", memberIds: [], leaderId: null },
        ];
      let p = {
        id: uid("p"),
        name: d.get("name"),
        classId: c.id,
        teacherIds: [current().id],
        memberIds: members,
        groups,
        tasks: [],
        resources: [],
        evidence: [],
        source: "user",
        history: [],
      };
      state.projects.push(p);
      closeModal();
      save();
      render();
      projectDetail(p.id);
    };
  }
  function projectDetail(id) {
    let p = state.projects.find((x) => x.id === id);
    if (!p) return;
    let u = current(),
      canTeacher = isTeacher() && p.teacherIds.includes(u.id),
      group = p.groups.find((g) => g.memberIds.includes(u.id)),
      canView = canTeacher || !!group || p.memberIds.includes(u.id);
    if (!canView) {
      toast("Bạn không có quyền xem dự án này.");
      return;
    }
    let body = `<div class="stack"><p class="muted">${esc(state.classes.find((c) => c.id === p.classId)?.name || "")} · Thành viên dự án: ${p.memberIds.length}</p><div class="between"><h3>Nhóm</h3>${canTeacher ? '<button class="small secondary" id="addGroup">+ Nhóm thủ công</button>' : ""}</div>${p.groups.map((g) => `<div class="item"><div><div class="item-title">${esc(g.name)} ${g.leaderId === u.id ? '<span class="badge blue">Bạn là trưởng nhóm</span> ' : ""}${g.leaderId ? "· Trưởng nhóm: " + esc(state.users.find((x) => x.id === g.leaderId)?.name || "") : "· Không có trưởng nhóm"}</div><div class="item-meta">${g.memberIds.map((mid) => esc(state.users.find((x) => x.id === mid)?.name || "")).join(", ") || "Chưa có thành viên"}</div></div>${canTeacher ? `<button class="small secondary" data-action="edit-group" data-id="${g.id}" data-project="${p.id}">Sửa nhóm</button>` : ""}</div>`).join("")}<div class="between"><h3>Nhiệm vụ dự án</h3>${canTeacher || group ? '<button class="small" id="addProjectTask">+ Nhiệm vụ</button>' : ""}</div>${
      p.tasks
        .map((t) => {
          let taskGroup = p.groups.find((g) =>
              g.memberIds.includes(t.assigneeId),
            ),
            canLeaderComplete =
              !!group &&
              group.leaderId === u.id &&
              group.id === taskGroup?.id &&
              t.status !== "Hoàn thành";
          return `<div class="item"><div><div class="item-title">${esc(t.title)}</div><div class="item-meta">Giao: ${esc(state.users.find((x) => x.id === t.assigneeId)?.name || "Chưa giao")} · ${t.estimatedMinutes} phút · ${fmtDate(t.dueAt)} · ${esc(t.status)}</div><div class="item-meta">Đóng góp: ${(t.contributors || []).map((x) => esc(state.users.find((u) => u.id === x)?.name || "")).join(", ") || "Chưa ghi nhận"}</div></div>${canLeaderComplete ? `<button class="small" data-action="complete-project-task" data-id="${t.id}" data-project="${p.id}">Đánh dấu hoàn thành</button>` : ""}</div>`;
        })
        .join("") || '<div class="empty">Chưa có nhiệm vụ dự án.</div>'
    }<div class="between"><h3>Minh chứng</h3>${group ? '<button class="small" id="submitEvidence">+ Nộp minh chứng</button>' : ""}</div>${
      p.evidence
        .filter((e) => canTeacher || e.groupId === group?.id)
        .map(
          (e) =>
            `<div class="item"><div><div class="item-title">${esc(e.title)} <span class="badge ${e.status === "Đã xác nhận" ? "green" : e.status === "Yêu cầu sửa" ? "red" : "amber"}">${esc(e.status)}</span></div><div class="item-meta">Nhóm: ${esc(p.groups.find((g) => g.id === e.groupId)?.name || "")} · Nộp bởi ${esc(state.users.find((x) => x.id === e.submittedBy)?.name || "")} · ${esc(e.text || "")} ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">Mở liên kết</a>` : ""}</div></div><div class="actions">${canTeacher ? `<button class="small secondary" data-action="evidence-status" data-id="${e.id}" data-project="${p.id}" data-status="Đã xác nhận">Xác nhận</button><button class="small secondary" data-action="evidence-status" data-id="${e.id}" data-project="${p.id}" data-status="Yêu cầu sửa">Yêu cầu sửa</button>` : ""}${group?.id === e.groupId && (group.leaderId === u.id || !group.leaderId) ? `<button class="small danger" data-action="delete-evidence" data-id="${e.id}" data-project="${p.id}">Xóa</button>` : ""}</div></div>`,
        )
        .join("") ||
      '<div class="empty">Không có minh chứng trong phạm vi quyền truy cập.</div>'
    }<h3>Tài liệu dự án</h3>${
      p.resources
        .filter(
          (r) => canTeacher || r.groupId == null || r.groupId === group?.id,
        )
        .map(
          (r) =>
            `<div class="item"><div><div class="item-title">${esc(r.name)}</div><div class="item-meta">${esc(r.description || "")} ${r.url ? `· <a href="${esc(r.url)}" target="_blank" rel="noopener">Mở</a>` : ""} · Người tải: ${esc(state.users.find((x) => x.id === r.ownerId)?.name || "")}</div></div>${canTeacher || r.ownerId === u.id ? `<button class="small danger" data-action="delete-resource" data-id="${r.id}" data-project="${p.id}">Xóa</button>` : ""}</div>`,
        )
        .join("") || '<div class="muted">Chưa có tài liệu dự án.</div>'
    }<button class="secondary" id="addResource">+ Tài liệu dự án</button></div>`;
    modal(`Dự án: ${esc(p.name)}`, body, "Đóng");
    $("#modalSubmit").onclick = closeModal;
    $("#addGroup")?.addEventListener("click", () => editGroup(p, null));
    $$('[data-action="edit-group"]').forEach(
      (b) =>
        (b.onclick = () => {
          closeModal();
          editGroup(
            p,
            p.groups.find((g) => g.id === b.dataset.id),
          );
        }),
    );
    $("#addProjectTask")?.addEventListener("click", () => {
      closeModal();
      projectTaskForm(p, group || p.groups[0]);
    });
    $("#submitEvidence")?.addEventListener("click", () => {
      closeModal();
      evidenceForm(p, group);
    });
    $("#addResource")?.addEventListener("click", () => {
      closeModal();
      resourceForm(p, group);
    });
  }
  function editGroup(p, g) {
    let c = state.classes.find((c) => c.id === p.classId),
      members = c.studentIds.filter(
        (id) =>
          !p.groups.some((x) => x.id !== g?.id && x.memberIds.includes(id)),
      );
    modal(
      g ? "Sửa nhóm" : "Thêm nhóm",
      `<form id="groupForm"><label>Tên nhóm *</label><input name="name" required value="${esc(g?.name || "Nhóm mới")}"><label>Thành viên (mỗi học sinh chỉ thuộc một nhóm trong dự án)</label>${members.map((id) => `<label class="checkrow"><input type="checkbox" name="members" value="${id}" ${(g?.memberIds || []).includes(id) ? "checked" : ""}>${esc(state.users.find((u) => u.id === id)?.name || "")}</label>`).join("")}<label>Trưởng nhóm (không bắt buộc)</label><select name="leader"><option value="">Không có trưởng nhóm</option>${members
        .filter(
          (id) =>
            (g?.memberIds || []).includes(id) ||
            !p.groups.some((x) => x.memberIds.includes(id)),
        )
        .map(
          (id) =>
            `<option value="${id}" ${g?.leaderId === id ? "selected" : ""}>${esc(state.users.find((u) => u.id === id)?.name || "")}</option>`,
        )
        .join("")}</select></form>`,
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#groupForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f),
        ids = d.getAll("members"),
        leader = d.get("leader") || null;
      if (leader && !ids.includes(leader)) {
        toast("Trưởng nhóm phải là thành viên nhóm.");
        return;
      }
      if (g) {
        let removed = g.memberIds.filter((id) => !ids.includes(id));
        if (
          removed.length &&
          p.tasks.some(
            (t) => removed.includes(t.assigneeId) && t.status !== "done",
          ) &&
          !confirm(
            "Có nhiệm vụ chưa hoàn thành. Lưu thay đổi và giữ lịch sử phân công?",
          )
        )
          return;
        g.name = d.get("name");
        g.memberIds = ids;
        g.leaderId = leader;
        removed.forEach((id) =>
          p.history.push({
            at: iso(now()),
            note: `${id} rời ${g.name}; lịch sử nhiệm vụ được giữ`,
          }),
        );
      } else
        p.groups.push({
          id: uid("g"),
          name: d.get("name"),
          memberIds: ids,
          leaderId: leader,
        });
      p.memberIds = [...new Set(p.groups.flatMap((x) => x.memberIds))];
      save();
      closeModal();
      render();
      projectDetail(p.id);
    };
  }
  function projectTaskForm(p, g) {
    let canCreate = isTeacher() || g?.leaderId === current().id;
    if (!canCreate && !g) {
      toast("Không có nhóm để tạo nhiệm vụ.");
      return;
    }
    modal(
      "Tạo nhiệm vụ dự án",
      `<form id="ptForm"><label>Tên nhiệm vụ *</label><input name="title" required><label>Người thực hiện *</label><select name="assignee">${(g?.memberIds || p.memberIds).map((id) => `<option value="${id}">${esc(state.users.find((u) => u.id === id)?.name || "")}</option>`).join("")}</select><div class="form-grid"><div><label>Thời lượng dự kiến (phút)</label><input type="number" min="1" name="minutes" value="60" required></div><div><label>Hạn nộp *</label><input type="datetime-local" name="due" required></div></div></form>`,
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#ptForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f),
        assignee = d.get("assignee");
      p.tasks.push({
        id: uid("pt"),
        title: d.get("title"),
        assigneeId: assignee,
        estimatedMinutes: +d.get("minutes"),
        dueAt: new Date(d.get("due")).toISOString(),
        status: "Chưa làm",
        contributors: [],
        assignmentHistory: [{ userId: assignee, at: iso(now()) }],
        createdBy: current().id,
      });
      let c = state.classes.find((c) => c.id === p.classId);
      state.tasks.push({
        id: uid("t"),
        ownerId: assignee,
        title: d.get("title"),
        subject: "Dự án nhóm",
        kind: "Nhiệm vụ nhóm",
        estimatedMinutes: +d.get("minutes"),
        actualMinutes: 0,
        remainingWorkMinutes: +d.get("minutes"),
        dueAt: new Date(d.get("due")).toISOString(),
        priority: 2,
        status: "todo",
        sessions: [],
        history: [],
        teacherId: p.teacherIds[0],
        classId: p.classId,
        projectId: p.id,
        source: "user",
      });
      closeModal();
      schedule(assignee);
      notifyUser(assignee, "Nhiệm vụ nhóm mới", d.get("title"), "project");
      save();
      render();
      projectDetail(p.id);
    };
  }
  function evidenceForm(p, g) {
    modal(
      "Nộp minh chứng",
      `<form id="evForm"><label>Tiêu đề *</label><input name="title" required><label>Văn bản / mô tả</label><textarea name="text" rows="3"></textarea><label>Liên kết (nếu có)</label><input type="url" name="url" placeholder="https://…"><label>Đóng góp của thành viên</label>${g.memberIds.map((id) => `<label class="checkrow"><input type="checkbox" name="contributors" value="${id}" ${id === current().id ? "checked" : ""}>${esc(state.users.find((u) => u.id === id)?.name || "")}</label>`).join("")}</form>`,
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#evForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f),
        ev = {
          id: uid("ev"),
          groupId: g.id,
          title: d.get("title"),
          text: d.get("text"),
          url: d.get("url"),
          submittedBy: current().id,
          contributors: d.getAll("contributors"),
          status: g.leaderId ? "Chờ xác minh" : "Chờ xác minh",
          createdAt: iso(now()),
        };
      p.evidence.push(ev);
      if (g.leaderId === current().id) ev.status = "Chờ xác minh";
      p.history.push({ at: iso(now()), note: "Nộp minh chứng" });
      closeModal();
      save();
      g.memberIds
        .filter((id) => id !== current().id)
        .forEach((id) =>
          notifyUser(id, "Minh chứng nhóm mới", ev.title, "project"),
        );
      p.teacherIds.forEach((id) =>
        notifyUser(id, "Minh chứng chờ xác minh", ev.title, "project"),
      );
      render();
      projectDetail(p.id);
    };
  }
  function resourceForm(p, g) {
    modal(
      "Thêm tài liệu dự án",
      `<form id="resForm"><label>Tên tài liệu *</label><input name="name" required><label>Mô tả</label><textarea name="description" rows="2"></textarea><label>Liên kết</label><input type="url" name="url"></form>`,
    );
    $("#modalSubmit").onclick = () => {
      let f = $("#resForm");
      if (!f.reportValidity()) return;
      let d = new FormData(f);
      p.resources.push({
        id: uid("r"),
        name: d.get("name"),
        description: d.get("description"),
        url: d.get("url"),
        ownerId: current().id,
        groupId: g?.id || null,
        createdAt: iso(now()),
      });
      closeModal();
      save();
      render();
      projectDetail(p.id);
    };
  }
  function closeCycle() {
    let n = cycleNums(reportTasks(current())),
      d = now(),
      label = `${d.toLocaleDateString("vi-VN")} · chu kỳ nửa tuần`;
    state.cycleHistory.push({
      id: uid("cy"),
      label,
      taskCount: n.taskCount,
      actualMinutes: n.actualMinutes,
      deviationMinutes: n.deviationMinutes,
      closedAt: iso(d),
    });
    save();
    render();
    toast("Đã lưu lịch sử chu kỳ; không xóa dữ liệu cũ.");
  }
  function handleAction(action, id, el) {
    let t = state.tasks.find((x) => x.id === id),
      u = current();
    switch (action) {
      case "request-teacher":
        page = "profile";
        render();
        break;
      case "logout":
        logout();
        break;
      case "extra-study-yes":
        extraStudyChooser = true;
        extraOverloadNotice = "";
        render();
        break;
      case "extra-study-no":
        extraStudyChooser = false;
        extraPromptDismissedDay = localDay(now());
        render();
        break;
      case "confirm-extra-study": {
        let boxes = $$("#taskList input[data-extra-id]:checked"),
          chosen = boxes
            .map((b) => state.tasks.find((x) => x.id === b.dataset.extraId))
            .filter(Boolean);
        if (!chosen.length) {
          toast("Hãy chọn ít nhất một nhiệm vụ.");
          break;
        }
        let available = extraStudyAvailability(u.id),
          total = chosen.reduce(
            (n, x) =>
              n +
              (Number(x.remainingWorkMinutes) ||
                Number(x.estimatedMinutes) ||
                0),
            0,
          );
        extraOverloadNotice =
          total > available
            ? `Cảnh báo quá tải: bạn chọn ${total} phút nhưng hôm nay chỉ còn ${available} phút. Hệ thống đã tính lại lịch; nếu không đủ thời gian hôm nay, phần còn lại sẽ được xếp sang ngày khác khi còn sức chứa trước hạn.`
            : "";
        extraStudyChooser = false;
        extraPromptDismissedDay = localDay(now());
        schedule(u.id);
        save();
        render();
        toast(
          total > available
            ? "Đã xếp lại lịch. Có nhiệm vụ quá tải; kiểm tra gợi ý chuyển sang ngày khác."
            : "Đã xếp các nhiệm vụ đã chọn vào lịch học.",
        );
        break;
      }
      case "detail":
        taskDetail(id);
        break;
      case "new-task":
        if (isStudent()) openTask(); else SL.assignPick();
        break;
      case "edit-task":
        closeModal();
        if (t) openTask(t);
        break;
      case "edit-progress":
        closeModal();
        if (t) editProgress(t);
        break;
      case "study":
        closeModal();
        if (t) startStudy(t);
        break;
      case "complete":
        closeModal();
        if (t) confirmCompletion(t, 0, false);
        break;
      case "busy":
        openBusy();
        break;
      case "delete-busy":
        if (confirm("Xóa khoảng bận này?")) {
          state.busy = state.busy.filter((b) => b.id !== id);
          schedule(u.id);
          render();
        }
        break;
      case "cal-tab":
        calTab = el.dataset.tab === "load" ? "load" : "todo";
        calDay = null;
        render();
        break;
      case "cal-day":
        calDay = el.dataset.day;
        render();
        break;
      case "cal-back":
        calDay = null;
        render();
        break;
      case "open-day":
        openDay(el.dataset.day);
        break;
      case "cal-prev":
        shiftCalendar(-1);
        break;
      case "cal-next":
        shiftCalendar(1);
        break;
      case "cal-week":
        calendarMode = "week";
        render();
        break;
      case "cal-month":
        calendarMode = "month";
        render();
        break;
      case "new-class":
        page = "adminclasses";
        render();
        break;
      case "assign":
        assignTask(id);
        break;
      case "new-project":
        newProject();
        break;
      case "project-detail":
        closeModal();
        projectDetail(id);
        break;
      case "read-notice": {
        let n = state.notifications.find((n) => n.id === id);
        if (n) n.read = true;
        save();
        render();
        break;
      }
      case "mark-read":
        state.notifications
          .filter((n) => n.userId === u.id)
          .forEach((n) => (n.read = true));
        save();
        render();
        break;
      case "save-reminders":
        saveReminders();
        break;
      case "close-cycle":
        closeCycle();
        break;
      case "evidence-status":
        evidenceStatus(el.dataset.project, id, el.dataset.status);
        break;
      case "complete-project-task":
        completeProjectTask(el.dataset.project, id);
        break;
      case "delete-evidence":
        deleteEvidence(el.dataset.project, id);
        break;
      case "delete-resource":
        deleteResource(el.dataset.project, id);
        break;
      case "edit-group": {
        let p = state.projects.find((x) => x.id === el.dataset.project);
        if (p)
          editGroup(
            p,
            p.groups.find((g) => g.id === id),
          );
        break;
      }
    }
  }
  function shiftCalendar(n) {
    let d = new Date(state.viewDate || localDay(now()));
    d.setDate(d.getDate() + n * (calendarMode === "week" ? 7 : 30));
    state.viewDate = localDay(d);
    save();
    render();
  }
  function saveReminders() {
    let vals = $("#reminderHours")
      .value.split(",")
      .map((x) => Number(x.trim()));
    if (
      !vals.length ||
      vals.some((x) => !Number.isFinite(x) || x < 1 || x > 168)
    ) {
      toast("Nhập các mốc giờ hợp lệ từ 1 đến 168.");
      return;
    }
    state.reminderSettings = {
      hours: [...new Set(vals)].sort((a, b) => b - a),
      studyOnly: $("#studyOnly").checked,
    };
    save();
    render();
    toast("Đã lưu cài đặt nhắc hạn.");
  }
  function completeProjectTask(pid, tid) {
    let p = state.projects.find((x) => x.id === pid),
      t = p?.tasks.find((x) => x.id === tid),
      u = current(),
      g = p?.groups.find((g) => g.memberIds.includes(t?.assigneeId));
    if (!p || !t || !g || g.leaderId !== u.id || !g.memberIds.includes(u.id)) {
      toast("Chỉ trưởng nhóm được đánh dấu hoàn thành nhiệm vụ của nhóm mình.");
      return;
    }
    if (t.status === "Hoàn thành") return;
    t.status = "Hoàn thành";
    t.completedAt = iso(now());
    t.completedBy = u.id;
    t.contributors = [...new Set([...(t.contributors || []), u.id])];
    p.history.push({
      at: iso(now()),
      note: `${u.name} (trưởng nhóm) đánh dấu hoàn thành: ${t.title}`,
    });
    save();
    render();
    projectDetail(pid);
    toast("Đã đánh dấu nhiệm vụ dự án hoàn thành.");
  }
  function evidenceStatus(pid, eid, status) {
    let p = state.projects.find((p) => p.id === pid),
      e = p?.evidence.find((e) => e.id === eid);
    if (!p || !e || !isTeacher() || !p.teacherIds.includes(current().id)) {
      toast("Không có quyền xác minh minh chứng.");
      return;
    }
    e.status = status;
    p.history.push({
      at: iso(now()),
      note: `Minh chứng ${e.title}: ${status}`,
    });
    p.memberIds.forEach((id) =>
      notifyUser(
        id,
        status === "Đã xác nhận"
          ? "Minh chứng được xác nhận"
          : "Minh chứng cần sửa",
        e.title,
        "project",
      ),
    );
    save();
    render();
    projectDetail(pid);
  }
  function deleteEvidence(pid, eid) {
    let p = state.projects.find((p) => p.id === pid),
      e = p?.evidence.find((e) => e.id === eid),
      g = p?.groups.find((g) => g.id === e?.groupId);
    if (
      !g ||
      !(
        g.leaderId === current().id ||
        (!g.leaderId && g.memberIds.includes(current().id))
      )
    ) {
      toast("Không có quyền xóa minh chứng này.");
      return;
    }
    if (confirm("Xóa minh chứng khỏi dự án?")) {
      p.evidence = p.evidence.filter((x) => x.id !== eid);
      save();
      render();
      projectDetail(pid);
    }
  }
  function deleteResource(pid, rid) {
    let p = state.projects.find((p) => p.id === pid),
      r = p?.resources.find((r) => r.id === rid);
    if (
      !r ||
      (!(isTeacher() && p.teacherIds.includes(current().id)) &&
        r.ownerId !== current().id)
    ) {
      toast("Chỉ người tải lên hoặc giáo viên phụ trách được xóa tài liệu.");
      return;
    }
    if (confirm("Xóa tài liệu dự án?")) {
      p.resources = p.resources.filter((x) => x.id !== rid);
      save();
      render();
      projectDetail(pid);
    }
  }
  $("#nav").addEventListener("click", (e) => {
    let b = e.target.closest("[data-page]");
    if (b) {
      page = b.dataset.page;
      render();
    }
  });
  $("#content").addEventListener("click", (e) => {
    let a = e.target.closest("[data-action]");
    if (a) handleAction(a.dataset.action, a.dataset.id, a);
    let g = e.target.closest("[data-goto]");
    if (g) {
      page = g.dataset.goto;
      render();
    }
  });
  $("#quickAdd").onclick = () => {
    if (isStudent()) openTask();
    else SL.assignPick(); // giáo viên: chọn lớp rồi giao
  };
  $("#profileButton").addEventListener("click", () => { page = "profile"; render(); });
  $("#saveChip").addEventListener("click", () => { if (A.sync.status === "error") A.sync.retry(); });
  $("#modalRoot").addEventListener("click", (e) => {
    let a = e.target.closest("[data-action]");
    if (a) handleAction(a.dataset.action, a.dataset.id, a);
  });
  let appInitialized = false;
  function init() {
    if (appInitialized) return;
    appInitialized = true;
    state.users.forEach((u) => {
      u.classIds = u.classIds || [];
    });
    state.tasks.forEach((t) => {
      t.sessions = t.sessions || [];
      t.history = t.history || [];
      t.actualMinutes = Number(t.actualMinutes) || 0;
      t.remainingWorkMinutes =
        Number(t.remainingWorkMinutes ?? t.estimatedMinutes) || 0;
    });
    schedule(current().id);
    render();
    setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !$("#authRoot").classList.contains("hidden")
      )
        return;
      if (document.visibilityState === "visible") checkRemindersQuiet();
    }, 60000);
  }
  function checkRemindersQuiet() {
    let u = current();
    try {
      if (isStudent() && state.tasks.some((t) => t.ownerId === u.id && t.status !== "done" && (t.sessions || []).some((x) => x.planned && !x.completed && localDay(x.startAt) < localDay(now())))) {
        schedule(u.id);
        if (["dashboard", "calendar"].includes(page) && !document.querySelector(".modal-backdrop")) render();
      }
    } catch (e) { /* bỏ qua */ }
    try { dailyHomework(); } catch (e) { /* bỏ qua */ }
    for (let t of state.tasks.filter(
      (t) => t.ownerId === u.id && t.status !== "done",
    )) {
      let due = new Date(t.dueAt),
        hours = (due - now()) / 3600000;
      if (hours < 0) continue;
      for (let h of state.reminderSettings.hours) {
        if (hours <= h && hours > h - 1 / 60) {
          if (state.reminderSettings.studyOnly && !isFreeNow(u.id)) continue;
          let key = `reminder_${t.id}_${h}_${t.dueAt}`;
          if (!state.notifications.some((n) => n.key === key)) {
            notifyUser(
              u.id,
              `Nhắc hạn còn ${h} giờ`,
              `${t.title} · hạn ${fmtDate(t.dueAt)}`,
              "reminder",
              t.id,
            );
          }
        }
      }
    }
  }
  window.SL = { $, $$, esc, toast: showToast, modal, closeModal, fmtDate, localDay, ui, roleLabel, myRoleText,
    pages: {}, current, isAdmin, isTeacher, isStudent, state: () => state, subjects: () => world.subjects, profile: () => world.profile,
    render, reload: reloadWorld, go: (p) => { page = p; render(); }, refreshProfile: (pr) => { world.profile = pr; } };
  netBanner();
  bootAuth();
})();
