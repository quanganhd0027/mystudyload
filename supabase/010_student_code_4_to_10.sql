-- 010: Mã học sinh 4-10 chữ số (trước đây đúng 5). Dãy số trùng dạng số điện thoại (0xxxxxxxx(x) hoặc 84xxxxxxxx) luôn là số điện thoại.
-- Đã áp dụng trên Supabase qua apply_migration "student_code_4_to_10_digits": tạo is_valid_student_code(c) và thay các hàm
-- enforce_identity_rules, submit_my_student_code, update_my_identity, admin_update_account (chỉ đổi điều kiện kiểm tra mã từ {5} sang is_valid_student_code).
create or replace function public.is_valid_student_code(c text) returns boolean
language sql immutable set search_path='' as $$
  select c ~ '^[0-9]{4,10}$' and c !~ '^(0[0-9]{8,9}|84[0-9]{8})$'
$$;
-- Đặt mã 0027 cho admin "Quang Anh_dev" (đã chạy một lần):
-- update public.profiles set student_id='0027' where display_name='Quang Anh_dev' and role='admin' and student_id is null;
