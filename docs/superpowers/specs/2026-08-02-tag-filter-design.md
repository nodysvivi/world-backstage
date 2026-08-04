# Thiết kế Lọc thẻ (Tag Filter)

Ngày: 2026-08-02  
Phạm vi: `world-backstage` Cài đặt quan sát thêm mô-đun "Lọc thẻ"; khi suy diễn / ký ức / quan sát nhân vật đọc nội dung chính sẽ loại bỏ các thẻ rác và chú thích HTML.  
Trạng thái: Đã được xác nhận bởi sản phẩm, chờ kế hoạch thực hiện

## Vấn đề

Khi plugin trích xuất nội dung trò chuyện để làm suy diễn thế giới, sắp xếp ký ức dài hạn và quan sát nhân vật, nó trực tiếp sử dụng văn bản `mes` / swipe gốc, không loại bỏ:

- Bản nháp tự sửa lỗi trong chú thích HTML, ví dụ `<!-- ... -->`
- Khối thẻ chức năng, ví dụ `<options>...</options>`
- Thẻ ranh giới định dạng, ví dụ chỉ xuất hiện `</dream_body>`

Những nội dung này sẽ làm ô nhiễm đầu vào mô hình suy diễn và ký ức.

## Mục tiêu

1. Cài đặt quan sát thêm nhóm "Lọc thẻ", người dùng có thể cấu hình quy tắc thẻ cần loại bỏ.
2. `<!-- ... -->` luôn xóa toàn bộ khối, không thể tắt.
3. Quy tắc người dùng phân biệt "Thẻ mở đầu" và "Thẻ kết thúc"; phần mở đầu có thể để trống.
4. Việc lọc chỉ ảnh hưởng đến văn bản đưa vào suy diễn / ký ức / quan sát; văn bản trò chuyện gốc, băm nhánh, phán đoán hàng đợi chờ suy diễn không thay đổi.
5. Mặc định cài sẵn các quy tắc theo cặp phổ biến, có thể thêm bớt.

## Không phải mục tiêu

- Không sửa đổi văn bản trò chuyện gốc hoặc hiển thị của SillyTavern.
- Không thực hiện khớp mờ / khớp tùy chỉnh regex (giai đoạn này là khớp chữ nghiêm ngặt).
- Không ghi quy tắc lọc vào metadata trò chuyện hoặc xuất trạng thái thế giới.
- Không triển khai riêng một logic lọc bên trong trình tạo prompt.

## Phương án

Sử dụng **lọc thống nhất ở lớp trích xuất**:

```text
Văn bản trò chuyện gốc (mes / swipes)
        │
        ├─ selectedMessageText() (Giữ nguyên văn bản gốc)
        │     └─ branchSourceKey / hash / Hàng đợi / hasUsableAssistantText
        │
        └─ narrativeMessageText()
                = filterNarrativeText(selectedMessageText(), settings)
                        ├─ Suy diễn thế giới narrativeContext
                        ├─ Sắp xếp ký ức nextHistoryBatch
                        ├─ Quan sát nhân vật narrativeTurns
                        └─ recentChatText (Dùng cho truy xuất tính liên quan)
```

- Hàm thuần `filterNarrativeText(text, settings)` đặt trong `core.js`, thuận tiện cho unit test.
- `selectedMessageText` tiếp tục trả về văn bản gốc, dùng cho băm và phán đoán tính khả dụng.
- Thêm mới `narrativeMessageText` (`index.js`) chuyên dùng cho chuỗi tự sự; không gọi lọc ở key nhánh, hash, phán đoán tính khả dụng.
- `hasUsableAssistantText` tiếp tục dựa trên **văn bản gốc trước khi lọc**, tránh việc lọc xong trống rỗng dẫn đến sót hàng đợi.
- Trong `narrativeContext`, `latestTurn.user` hiện tại đọc trực tiếp `chat[i].mes`; `recentChatText` hiện tại đọc trực tiếp `message.mes`. Khi thực hiện, hai chỗ này phải đổi thành `narrativeMessageText(message)`, không được chỉ thay thế điểm gọi `selectedMessageText(...)`. Do đó `recentChatText` đồng thời đổi thành lấy văn bản theo swipe hiện tại (nhất quán với `selectedMessageText`), sau đó mới lọc.
- Tất cả đầu vào tự sự thống nhất là: lấy văn bản lọc hoàn chỉnh `narrativeMessageText(message)` trước, sau đó bên gọi mới `slice` / tính vào ngân sách ký tự. Cấm cắt bớt trước rồi mới lọc, để tránh cắt đứt cặp thẻ và làm sai lệch độ dài lô.
- `recentChatText` đồng thời dùng cho truy xuất tính liên quan chèn nội dung chính (`buildInjectionPackage`); nó đi qua văn bản sau khi lọc, nhưng không ghi đè bản thân nội dung trạng thái thế giới được chèn vào cuộc trò chuyện chính.

## Mô hình cài đặt

Cài đặt mở rộng (`extensionSettings[MODULE_ID]`) thêm trường dữ liệu mới:

```js
{
  tagFilterEnabled: true,
  tagFilterRules: [
    { open: '<options>', close: '</options>' },
    { open: '<thinking>', close: '</thinking>' },
    { open: '<think>', close: '</think>' },
  ],
}
```

Ràng buộc:

| Trường dữ liệu | Quy tắc |
|---|---|
| `tagFilterEnabled` | Boolean; khi tắt vẫn xóa chú thích HTML, nhưng bỏ qua quy tắc người dùng |
| `tagFilterRules` | Mảng; tối đa 30 mục |
| `open` / `close` | Chuỗi, lưu sau khi trim; mỗi cái dài tối đa 80 ký tự |
| Quy tắc trống | `open` và `close` đều trống → loại bỏ khi lưu |
| Giá trị mặc định | Xem ba quy tắc theo cặp ở bảng trên; lần đầu `getSettings` sau khi nâng cấp sẽ điền lại giá trị mặc định cho các trường bị thiếu |
| `settingsVersion` | `13` (hiện tại là `12`) |

Nhập / xuất trạng thái thế giới không bao gồm các trường này (chúng thuộc cài đặt plugin, không phải store thế giới).

## Ngữ nghĩa lọc

Đối với văn bản tin nhắn đơn:

1. **Luôn** xóa toàn bộ chú thích HTML: `<!-- ... -->` (bao gồm nội dung bên trong, cho phép ngắt dòng).
2. Nếu `tagFilterEnabled === false`, kết thúc tại đây.
3. Nếu không, áp dụng lần lượt theo `tagFilterRules` **từ trên xuống dưới**; mỗi quy tắc khớp lặp đi lặp lại cho đến khi không còn trúng.

| Mở đầu | Kết thúc | Hành vi |
|---|---|---|
| Có | Có | Xóa toàn bộ khối chữ `open … close`; không tham lam; cùng một quy tắc có thể xóa nhiều đoạn |
| Trống | Có | Tìm chữ `close` **đầu tiên**, xóa toàn bộ nội dung từ đầu văn bản đến `close` đó (bao gồm cả nó); vì quy tắc sẽ áp dụng lặp lại, nếu sau đó vẫn còn cùng một `close`, sẽ tiếp tục cắt đến cái tiếp theo |
| Có | Trống | Tìm chữ `open` **đầu tiên**, xóa toàn bộ nội dung từ `open` đó đến cuối văn bản |
| Trống | Trống | Bỏ qua |

Cách khớp: **Chữ nghiêm ngặt, phân biệt chữ hoa chữ thường**. Điền `<options>` sẽ không khớp với `<options type="x">`, cũng không khớp với `<Options>`.  
Thoát (Escape): Thực hiện thoát regex cho `open`/`close` do người dùng điền trước khi tìm kiếm, để tránh đầu vào của người dùng bị coi là ký tự meta regex.  
`<!--` chưa đóng (không tìm thấy `-->` tương ứng): Giữ nguyên văn bản gốc, không xóa đến cuối văn bản.

Phạm vi tác dụng: Suy diễn thế giới, sắp xếp ký ức, quan sát nhân vật (ba chuỗi dùng chung một đầu vào lọc); `recentChatText` dùng cho tính liên quan chèn cũng đồng bộ đi qua lọc.

## UI

Cài đặt quan sát thêm nhóm thu gọn:

- Tiêu đề: `Lọc thẻ`
- Phụ đề: `Loại bỏ thẻ rác và chú thích trước khi suy diễn / ký ức`
- Vị trí: Giữa `Tự động suy diễn` và `Nhân vật Worldbook`
- `data-settings-group="tagfilter"`

Nội dung nhóm:

1. Công tắc **Bật lọc thẻ** (`tagFilterEnabled`). Văn bản giải thích: Vẫn sẽ xóa chú thích HTML sau khi đóng.
2. Giải thích cố định: `<!-- ... -->` luôn xóa toàn bộ khối; khớp là chữ nghiêm ngặt.
3. Danh sách thẻ quy tắc: Mỗi mục gồm "Thẻ mở đầu (có thể để trống)", "Thẻ kết thúc", nút xóa.
4. Nút **＋ Thêm quy tắc**.
5. Hộp nhập liệu sử dụng màu nội dung chính của biểu mẫu hiện có của plugin (độ tương phản cao), không dùng màu giữ chỗ quá nhạt để chứa giá trị đã điền.

Quy ước tương tác:

- Công tắc và trường quy tắc tiếp tục sử dụng phương thức ghi tức thời của điều khiển cài đặt hiện có (cùng loại với `data-wb-setting`: thay đổi là `saveSettings`).
- Khi thêm quy tắc sẽ thêm một thẻ trống vào **lớp nháp UI**, không ghi ngay vào `tagFilterRules`. Chỉ khi `open` hoặc `close` có ít nhất một bên không trống mới ghi vào mục mảng tương ứng; chuẩn hóa `getSettings` chỉ loại bỏ các mục trống kép trong mảng được lưu trữ, không được xóa thẻ nháp UI chưa được gửi.
- Nhập quy tắc khi `change` / `blur`: Nếu ít nhất một bên không trống thì ghi lại / chèn vào mảng được lưu trữ; nếu cả hai bên đều trống thì xóa mục đó khỏi mảng được lưu trữ (thẻ nháp vẫn có thể hiển thị cho đến lần đóng cài đặt tiếp theo).
- Xóa quy tắc sẽ xóa ngay khỏi mảng được lưu trữ và lưu lại.
- Giới hạn số lượng quy tắc là 30 dựa trên các quy tắc không trống đã được lưu trữ.
- Trạng thái mở rộng đi vào tập hợp vòng đời `openSettingsGroups` hiện có, không lưu trữ vào metadata.

## Xử lý lỗi và ranh giới

- Lọc một mục xong bị trống: Bỏ qua mục đó khi xây dựng prompt / lô lịch sử (hiện có `filter(turn => turn.content)` v.v.), nhưng không ảnh hưởng đến tính khả dụng của văn bản gốc và việc xếp hàng.
- Nội dung chính của assistant chờ xử lý trong một lần suy diễn sau khi lọc **hoàn toàn trống** (sau khi trim): Bỏ qua việc gọi mô hình, hoàn thành lần suy diễn đó theo "không có thay đổi thế giới" (không báo lỗi, không sửa trạng thái thế giới; tiến trình hàng đợi / đường dẫn thành công căn chỉnh với ngữ nghĩa "không thay đổi" hiện có).
- Bỏ qua mục đơn bị trống sau khi lọc trong lô ký ức; nếu toàn bộ lô `messages` trống thì tiến cursor, không gọi mô hình.
- Quan sát nhân vật vẫn cho phép gọi mô hình khi `narrative.turns` hoàn toàn trống sau khi lọc, ngữ cảnh nội dung chính trong prompt được xử lý theo chỗ giữ chỗ ngữ cảnh trống hiện có (ví dụ "Không").
- Quy tắc chỉ phần cuối và trong nội dung chính không có phần cuối đó: Văn bản không đổi.
- Quy tắc chỉ phần đầu và trong nội dung chính không có phần đầu đó: Văn bản không đổi.
- Quy tắc theo cặp không tìm thấy close theo cặp: Lần khớp đó thất bại, không xóa (tránh xóa nhầm đến cuối văn bản); khi thực hiện dùng tìm kiếm theo cặp không tham lam, không tìm thấy close thì dừng quy tắc đó.
- Lồng các thẻ cùng chữ: Xử lý theo "mở trước đóng sau, không tham lam", không cố gắng phân tích cú pháp XML hoàn chỉnh.
- Quy tắc siêu dài ác ý: Cắt bớt đến 80 ký tự; giới hạn số lượng quy tắc là 30.

## Kiểm thử

Thêm test case cho `filterNarrativeText` trong `tests/`, ít nhất bao phủ:

1. Xóa chú thích HTML ngắt dòng.
2. Quy tắc theo cặp xóa toàn bộ khối nội dung.
3. Chỉ phần cuối: Xóa phần cuối và toàn bộ trước đó.
4. Chỉ phần đầu: Xóa từ phần đầu đến cuối văn bản.
5. Chữ nghiêm ngặt: `<options>` không khớp `<options x>`.
6. Khi `tagFilterEnabled: false` vẫn xóa chú thích, không chạy quy tắc người dùng.
7. Áp dụng tuần tự nhiều quy tắc.
8. Quy tắc chỉ phần cuối cắt xén lặp đi lặp lại nhiều đoạn.
9. `<!--` chưa đóng giữ nguyên.
10. Lọc trước rồi cắt bớt: Lọc văn bản hoàn chỉnh xong mới `slice`, điểm cắt không được rơi vào bên trong cặp thẻ dẫn đến sót xóa (dùng văn bản dài có thẻ đóng để assert).
11. Đường dẫn văn bản gốc: `hasUsableAssistantText` / branch key không phụ thuộc vào kết quả lọc (kiểm thử hợp đồng hoặc assert được tài liệu hóa).

## Dự kiến thay đổi tệp

| Tệp | Thay đổi |
|---|---|
| `core.js` | Thêm mới `filterNarrativeText` (và các hỗ trợ chuẩn hóa quy tắc cần thiết) |
| `index.js` | Cài đặt mặc định, chuẩn hóa `getSettings`, thêm mới `narrativeMessageText`, đầu vào tự sự đổi sang đi qua kết quả lọc |
| `ui.js` | Cài đặt quan sát nhóm "Lọc thẻ" và tương tác chỉnh sửa quy tắc |
| `style.css` | Chỉ bổ sung một lượng nhỏ kiểu thẻ quy tắc khi kiểu cài đặt hiện có không đủ dùng |
| `tests/*.test.mjs` | Unit test ngữ nghĩa lọc |
| `docs/ARCHITECTURE.md` | Sau khi thực hiện xong bổ sung một câu giải thích lọc lớp trích xuất (tùy chọn, theo thực tế) |

## Tiêu chuẩn nghiệm thu

1. Bảng cài đặt có thể thấy nhóm "Lọc thẻ", mặc định có thể chỉnh sửa ba quy tắc cài sẵn.
2. Nội dung chính chứa `<!-- Bản nháp -->` và `<options>...</options>` khi đi vào suy diễn / ký ức / quan sát, các đoạn trên đã bị loại bỏ.
3. Khi chỉ cấu hình `close: '</dream_body>'`, thẻ đóng đó và nội dung trước nó bị loại bỏ.
4. Sau khi tắt "Bật lọc thẻ", quy tắc người dùng không có hiệu lực, nhưng chú thích vẫn bị xóa.
5. Sửa đổi cài đặt lọc sẽ không ghi đè văn bản tin nhắn trò chuyện gốc, cũng không thay đổi source key của nhánh đã có.
6. Nội dung chính chờ suy diễn sau khi lọc hoàn toàn trống sẽ không gọi mô hình, và không ghi đè sai trạng thái thế giới.