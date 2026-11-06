// Chỉ dùng publishable (anon) key. TUYỆT ĐỐI KHÔNG dán "service_role" / secret key vào file này.
window.STUDYLOAD_CONFIG = {
  supabaseUrl: "https://wbodoxqobkonkafjhfoh.supabase.co",
  supabaseAnonKey: "sb_publishable_prCS7C7XXLIqY3VRZuGYxg__XLoXtug",
  // Giới hạn phía giao diện (khớp bucket + hàm validate_evidence_file của backend)
  evidence: {
    assignment: { maxBytes: 5 * 1024 * 1024, mime: ["image/jpeg", "image/png", "image/webp", "image/heic", "text/plain", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
    duty:       { maxBytes: 5 * 1024 * 1024, mime: ["image/jpeg", "image/png", "image/webp", "image/heic", "text/plain", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] }
  }
};
