# Quy tắc giao diện StudyLoad

Bộ quy tắc này được thực thi trong `styles.css` (lớp **v3** và **v4** ở cuối file). Thêm giao diện mới thì làm theo đây, không tự đặt màu hay kích thước riêng.

## 1. Nguyên tắc
1. **Rõ ràng trước, đẹp sau.** Mỗi màn hình có một việc chính. Chỉ một nút chính (màu nhấn) trong một vùng; các nút còn lại là nút phụ (`.secondary`).
2. **Ít viền, ít bóng.** Khối (`.card`) có một viền mảnh, không bóng. Danh sách trong khối chỉ ngăn bằng một đường kẻ, không đóng khung từng dòng. Bóng đổ chỉ dùng cho thứ **nổi trên trang** (cửa sổ, hộp thông báo, nút nổi).
3. **Màu có nghĩa.** Màu nhấn (`--brand`) dành cho hành động chính và mục đang chọn. Xanh lá là tốt/hoàn thành, đỏ là lỗi/quá hạn, vàng là cảnh báo. Không dùng màu chỉ để trang trí.
4. **Chữ trước, biểu tượng sau.** Nút và nhãn luôn có chữ. Không bao giờ chỉ truyền đạt bằng màu: kèm chữ hoặc biểu tượng.
5. **Dùng được trên điện thoại.** Thiết kế từ 390px; vùng bấm tối thiểu 40px (44px trên điện thoại).
6. **Hai giao diện sáng/tối.** Không viết mã màu cứng cho nền hoặc chữ; dùng biến bên dưới.

## 2. Biến thiết kế (design tokens)
| Nhóm | Biến | Dùng cho |
|---|---|---|
| Màu nền | `--bg`, `--panel` | nền trang, mặt khối |
| Màu chữ | `--ink`, `--muted` | chữ chính, chữ phụ (ghi chú, nhãn) |
| Viền | `--line` | mọi đường viền và đường kẻ |
| Nhấn | `--brand`, `--brand-soft` | nút chính, mục đang chọn, dòng của bạn |
| Trạng thái | `--green`, `--red`, `--amber` | thành công, lỗi, cảnh báo |
| Bo góc | `--r1` = 8px, `--r2` = 12px, `--pill` | điều khiển và ô nhỏ / khối / thẻ tròn |
| Khoảng cách | `--s1`…`--s7` = 4, 8, 12, 16, 24, 32, 48px | mọi margin, padding, gap |
| Nổi | `--pop` | bóng cho hộp nổi, cửa sổ, nút nổi |

Màu nhấn do admin chọn cho từng tài khoản (`html[data-accent]`), nên **không** dùng mã màu cố định cho thứ thuộc về thương hiệu: luôn dùng `--brand`.

## 3. Chữ
Phông hệ thống. Cỡ chữ: 12 (nhãn nhỏ, huy hiệu) · 13 (chữ phụ, bảng) · 14 (nội dung) · 16 (tiêu đề khối) · 20/24 (tiêu đề trang) · 28 (số liệu lớn). Không dùng cỡ dưới 12. Tiêu đề đậm 650–700, nội dung 400–500. Không viết hoa toàn bộ.

## 4. Thành phần
- **Khối `.card`:** nền `--panel`, viền `--line`, bo `--r2`, đệm `--s5` (`--s4` trên điện thoại). Tiêu đề khối `h2` cỡ 16.
- **Chỉ số `.card` chứa `.stat`:** không viền, chỉ một đường kẻ trên cùng, số lớn 28. Không đặt bốn thẻ nặng cạnh nhau.
- **Nút:** `button` là nút chính; `.secondary` nút phụ; `.danger` hành động xóa/nguy hiểm; `.small` cho nút trong dòng. Cao tối thiểu 40px (nút nhỏ 32px).
- **Ô nhập:** cao 40px, bo `--r1`, viền khi hover đậm hơn, viền `--brand` khi focus kèm vòng focus. Nhãn nằm trên ô, cỡ 13, đậm.
- **Bảng `.table-wrap table`:** tiêu đề cột cỡ 12, màu `--muted`; số liệu căn nhất quán; có thanh cuộn ngang trên điện thoại.
- **Huy hiệu `.badge`:** viên thuốc, cỡ 12. `green` hoàn thành, `red` quá hạn/lỗi, `amber` chờ, `blue` thông tin.
- **Thông báo trong trang `.notice`:** nền nhạt, vạch màu bên trái, chữ `--ink`. Luôn có chữ giải thích.
- **Hộp nổi (`.daily-pop`, `.modal`, `.fab`):** `--pop`, bo `--r2` (nút nổi `--pill`). Chỉ một hộp nổi cùng lúc ở một vị trí; trên điện thoại hộp thông báo dàn ngang theo màn hình.
- **Khối màu theo môn (`.day-subj`):** nền màu môn, chữ trắng; nút trong khối nền trắng, chữ đậm.
- **Trạng thái rỗng `.empty`:** một câu nói rõ vì sao trống và bước tiếp theo.

## 5. Bố cục
Trang gồm thanh bên 240px, thanh tiêu đề, và nội dung tối đa 1280px. Lưới 12 cột (`.span-N`), khoảng cách `--s4`. Dưới 950px thanh bên chuyển thành thanh ngang cuộn; dưới 520px các cột xếp một hàng.

## 6. Chuyển động
Chỉ chuyển màu 120ms. Không nhấc, không phóng to khi hover. Tôn trọng `prefers-reduced-motion`.

## 7. Trước khi thêm giao diện mới
- [ ] Màu, cỡ chữ, bo góc, khoảng cách đều lấy từ bảng trên.
- [ ] Xem được ở giao diện tối và ở 390px.
- [ ] Nút có chữ; trạng thái không chỉ dựa vào màu.
- [ ] Không dùng `style="..."` cho thứ sẽ lặp lại: tạo lớp trong `styles.css`.
