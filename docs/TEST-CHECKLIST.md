# Danh sách kiểm tra dùng thử 0.8.1

## 0.8.1 Gửi liên tục và xếp hàng

- [ ] Khi suy diễn thế giới vòng đầu tiên đang chạy mà tiếp tục gửi nội dung chính vòng thứ hai, vòng thứ hai sẽ hiển thị là đang chờ xử lý; sau khi vòng đầu tiên hoàn thành sẽ tự động tiếp nối vòng thứ hai.
- [ ] Khi gửi liên tục từ ba vòng trở lên, luôn chỉ chạy một yêu cầu suy diễn thế giới, trạng thái trên cùng hiển thị số vòng chờ xử lý còn lại, trạng thái cuối cùng bao gồm toàn bộ nội dung chính mới và đúng thứ tự.
- [ ] Khi vòng sau thực sự bắt đầu sẽ sử dụng trạng thái thế giới đã gửi của vòng trước, thời gian thế giới, thay đổi nhân vật, sự kiện và ký ức sẽ không quay lùi về bản ghi nhanh cũ.
- [ ] Nội dung chính vòng mới gửi trong lúc suy diễn vẫn có thể đọc chèn mặt trái thế giới, không bị sót trạng thái do yêu cầu chạy ngầm tạm thời xóa prompt.
- [ ] Trong thời gian xếp hàng nếu chuyển đổi trò chuyện, rút lại hoặc chỉnh sửa nội dung chính, tác vụ cũ sẽ không ghi vào cuộc trò chuyện mới hoặc nhánh mới; sau khi quay lại cuộc trò chuyện gốc vẫn có thể xử lý nội dung chính chờ đồng bộ.
- [ ] Khi suy diễn hiện tại thất bại nhưng phía sau đã có nội dung chính mới, có thể gộp vòng thất bại với các vòng tiếp theo để bắt kịp; khi chủ động nhấp hủy sẽ không tự động khởi động lại, nội dung chính vẫn giữ nguyên chờ đồng bộ.

## 0.8.0 Khôi phục an toàn, chẩn đoán và nhắc nhở trạng thái

- [ ] Khi mở cuộc trò chuyện cũ từ 0.7.3, tự động tạo điểm khôi phục trước khi nâng cấp cấu trúc dữ liệu, đồng hồ, nhân vật, sự kiện và ký ức ban đầu giữ nguyên không đổi.
- [ ] Sau khi lưu thủ công liên tục 4 điểm khôi phục, chỉ giữ lại 3 lần gần nhất và mỗi cuộc trò chuyện không chia sẻ với nhau.
- [ ] Tự động lưu trạng thái hiện tại trước khi nhập trạng thái thế giới; khi khôi phục bản lưu gần nhất sẽ lưu trạng thái trước khi khôi phục trước, do đó có thể khôi phục lại lần nữa.
- [ ] Sau khi khôi phục hoàn tất, nhánh nội dung chính hiện tại, chèn trạng thái và thống kê trang cài đặt sẽ đồng bộ làm mới, không nhảy sang cuộc trò chuyện khác hoặc swipe.
- [ ] "Sao chép thông tin chẩn đoán" có thể sử dụng trên cả trình duyệt máy tính và điện thoại; nội dung bao gồm phiên bản, thiết bị, chế độ giao diện và lỗi gần nhất.
- [ ] Văn bản chẩn đoán không chứa API Key, địa chỉ API đầy đủ, nội dung trò chuyện, điểm neo thân phận nhân vật hoặc từ nhắc tùy chỉnh.
- [ ] Nhấp "Xem kiểu nhắc nhở", khu vực an toàn trên cùng xuất hiện thẻ nhắc nhở plugin kèm kaomoji, tiêu đề trạng thái và nội dung chính.
- [ ] Các nhắc nhở thành công, thông thường, cảnh báo và thất bại đều hiển thị thẻ kaomoji trong plugin; toastr của Tavern sẽ không bật lên trùng lặp với nó.
- [ ] Thẻ nhắc nhở hiển thị đầy đủ trong khu vực an toàn của điện thoại, ở chế độ chữ lớn văn bản không bị cắt bớt, tự động biến mất sau khoảng 5 giây.
- [ ] Khi "Điểm neo thân phận nhân vật người chơi" phiên bản cũ có nội dung, sau khi nâng cấp nội dung sẽ chuyển vào thẻ nhân vật người chơi, trang cài đặt không còn xuất hiện hộp nhập liệu trùng lặp.
- [ ] Sau khi sửa đổi điểm neo thân phận của thẻ nhân vật người chơi, suy diễn, sắp xếp ký ức và quan sát nhân vật đều sử dụng giá trị mới.

## 0.7.0 Nghiệm thu tính năng mới

- [ ] Sau khi phương thức tự động suy diễn được đặt thành "Thủ công", chỉ tích lũy nội dung chính chờ đồng bộ; trang cài đặt không còn xuất hiện "Tạm dừng tự động suy diễn" trùng lặp.
- [ ] Trong lúc suy diễn đang chạy, thanh bên và nút dưới cùng chuyển thành "Dừng suy diễn"; sau khi nhấp yêu cầu sẽ chấm dứt, thời gian, nhân vật, sự kiện và ký ức đều không được gửi.
- [ ] Khi giao diện độc lập chọn `deepseek-v4-flash`, cả chuyển tiếp qua Tavern và kết nối trực tiếp qua trình duyệt đều sẽ yêu cầu tắt suy nghĩ, và có thể đọc nội dung chính cuối cùng.
- [ ] Khi sắp xếp ký ức trả về JSON bị cắt bớt sẽ thử lại nhỏ gọn trước; khi liên tục thất bại sẽ tự động thu nhỏ lô, tiến độ quét của lô thành công vẫn được giữ lại.
- [ ] Thẻ nhân vật có thể chỉnh sửa điểm neo nhân cách, thói quen nói chuyện và ranh giới hành vi; lần suy diễn tiếp theo và nhắc nhở "Xem người ấy" sẽ mang theo ba nội dung này.
- [ ] Khi mô hình trả về ràng buộc nhân cách khác nhau, thẻ nhân vật người dùng hiện có sẽ không bị tự động ghi đè.
- [ ] Worldbook chỉ quét khi nhấp "Đọc bản xem trước mục"; các mục chưa chọn sẽ không được nhập, nhân vật được nhập vẫn chịu ràng buộc ngân sách NPC chạy ngầm.
- [ ] Ba mức nhỏ gọn, thoải mái, chữ lớn có sự khác biệt rõ rệt về cỡ chữ và khoảng cách dòng; trang cài đặt mức chữ lớn vẫn có thể cuộn đến cuối.
- [ ] Văn bản nhân cách dài trong chi tiết nhân vật trên điện thoại xuống dòng bình thường, nút đóng trên cùng luôn nằm trong khu vực có thể nhìn thấy.
- [ ] Trạng thái trên 220 vòng vẫn chịu giới hạn dung lượng, khi cấu trúc prompt suy diễn tiếp theo không xảy ra phình to vô hạn.

## Thích ứng phiên bản di động

- [ ] Dưới màn hình dọc rộng 320, 390, 430px và màn hình ngang cảm ứng cạnh ngắn, tiêu đề, lịch, ba nút trên cùng và sáu lối vào dưới cùng đều không bị chồng chéo hoặc tràn ngang.
- [ ] Thanh trạng thái hệ thống, tai thỏ và khu vực an toàn trái phải sẽ không che khuất tiêu đề hoặc nút đóng cài đặt, sau khi xoay màn hình bố cục sẽ tự động khớp lại với khu vực hiển thị hiện tại.
- [ ] Trang cài đặt trên điện thoại là bảng điều khiển độc lập hoàn chỉnh, có thể cuộn toàn bộ cài đặt; sau khi chuyển đổi tùy chọn, mở rộng ký ức dài hạn và đóng cài đặt sẽ không chỉ để lại phần cắt trên cùng.
- [ ] Chủ đề Tavern hoặc các điều khiển lơ lửng cấp cao của tiện ích mở rộng khác sẽ không che lấp cửa sổ mặt trái thế giới.
- [ ] Quả cầu lơ lửng trên điện thoại duy trì ở mức 36—42px, sau khi đóng bảng điều khiển vẫn hiển thị, có thể kéo thả, có thể hít cạnh, khi suy diễn vẫn sẽ xoay.

## Độ ổn định JSON của giao diện tương thích

- [ ] Khi nội dung trả về được bọc trong khối mã `````json`` vẫn có thể trích xuất trạng thái.
- [ ] Khi JSON chứa dấu phẩy ở cuối hoặc chuỗi xuống dòng trần có thể sửa chữa bảo thủ; khi thực sự thiếu dấu ngoặc đóng phải từ chối ghi trạng thái.
- [ ] Khi giao diện trả về `finish_reason: MAX_TOKENS` sẽ hiển thị đầu ra đạt giới hạn độ dài, và tăng hạn mức đầu ra tiếp theo theo cài đặt tự động thử lại.
- [ ] Nhắc nhở thử lại không yêu cầu tiếp tục câu bị cắt bớt, và trước khi kết quả hợp lệ xuất hiện, thời gian thế giới, nhân vật và ký ức giữ nguyên bản ghi nhanh trước khi suy diễn.

## Tinh giản thẻ tiếng lòng

- [ ] Danh sách nhân vật, thẻ nhân vật và ngăn kéo chi tiết chỉ hiển thị nội dung chính độc thoại, không hiển thị dấu thời gian giờ phút riêng biệt.
- [ ] Sau khi rút lại hoặc khôi phục bản ghi nhanh, `innerVoiceAt` của nhân vật vẫn được lưu trong trạng thái.

## Độ thoải mái khi chuyển đổi mô-đun

- [ ] Khi mở bảng điều khiển chỉ phát hoạt ảnh vào bảng một lần; khi chuyển đổi bất kỳ mô-đun nào sẽ không thu phóng lại hoặc làm mờ dần toàn bộ bảng điều khiển.
- [ ] Khi liên tục chuyển đổi nhân vật, dòng chảy ngầm, tiếng vang, ký ức và biên niên sử, nội dung chính SillyTavern ở lớp dưới sẽ không bị lộ ra ở khung hình giữa.
- [ ] Chuyển đổi mô-đun giữ lại phản hồi dịch chuyển nhẹ, nhưng độ trong suốt của khu vực nội dung, bảng điều khiển và lớp phủ luôn là 1.

## Hoàn thiện trải nghiệm

- [ ] Trang ký ức khi mở lần đầu chỉ hiển thị 12 mục đầu tiên của mỗi loại; sau khi nhấp "Hiển thị thêm" sẽ tiếp tục tăng, không vẽ toàn bộ ký ức trong một lần.
- [ ] "Đang tiến hành/Sự thật/Phục bút/Trải nghiệm/Tất cả" và tìm kiếm từ khóa sẽ đưa ra số lượng kết quả chính xác, sau khi chuyển đổi bộ lọc sẽ quay lại lô nội dung đầu tiên.
- [ ] Khi suy diễn, quan sát nhân vật, kiểm tra giao diện và sắp xếp ký ức, quả cầu lơ lửng, thanh trạng thái trên cùng và nhắc nhở dưới cùng hiển thị tên tác vụ giống nhau và chính xác.
- [ ] Trang cài đặt chia thành năm khu vực có thể thu gọn; sau khi thay đổi cài đặt dẫn đến vẽ lại, các nhóm đã mở rộng và vị trí cuộn ban đầu vẫn được giữ lại.
- [ ] Nhấp vào khoảng trống ngoài bảng điều khiển sẽ đóng mượt mà, nhấp vào bên trong cửa sổ sẽ không đóng nhầm; Esc vẫn đóng theo thứ tự ngăn kéo nhân vật, biểu mẫu sự kiện, cài đặt, bảng điều khiển chính.
- [ ] Sau khi hiệu chuẩn/tiến hành thời gian, tạo mới dòng chảy ngầm và nhập trạng thái sẽ xuất hiện hoàn tác 9 giây; hoàn tác khôi phục trạng thái trước đó, sau khi chuyển đổi trò chuyện hoặc nhánh nội dung chính sẽ không thể dùng nhầm.
- [ ] Dưới chiều rộng điện thoại 390px, sáu lối vào dưới cùng giữ nguyên một dòng, lịch tháng trên cùng có thể nhìn thấy, trang không có cuộn ngang.

## Giao diện độc lập

- [ ] Chuyển sang "Giao diện độc lập", sau khi điền URL, Key và mô hình, kiểm tra kết nối thành công.
- [ ] Sửa đổi mô hình hiện tại của Tavern, sẽ không thay đổi mô hình độc lập hiển thị trong thẻ cài đặt.
- [ ] Key lỗi sẽ hiển thị lỗi từ nguồn cấp, không âm thầm lùi về API hiện tại của Tavern.

## Ký ức phân tầng và tự động tóm tắt

- [ ] Sau khi nhấp "Tạo hồ sơ ký ức ban đầu" sẽ hiển thị tiến độ theo từng lô, và tạo ra tóm tắt liên tục, sự thật dài hạn, trải nghiệm giai đoạn và phục bút.
- [ ] Phục bút lưu lại tầng tin nhắn nguồn và swipe.
- [ ] Sau khi thất bại giữa chừng nhấp lại, sẽ tiếp tục từ lô thành công cuối cùng.
- [ ] Sau khi tự động sắp xếp được đặt thành mỗi 5 tin, khi thêm nội dung chính AI thứ 5 sẽ kích hoạt sắp xếp một lần, trước tin thứ 4 sẽ không kích hoạt.
- [ ] Sau khi tần suất sắp xếp tùy chỉnh được đặt thành 0, chỉ có thể sắp xếp thủ công; sau khi đặt thành N sẽ đếm theo số lượng nội dung chính AI chứ không phải số lượng tin nhắn người dùng.
- [ ] Khi cùng một sự thật dài hạn xuất hiện giá trị mới được xác định, phiên bản cũ được giữ lại và đánh dấu là "Đã bị thay thế".
- [ ] Khi cùng một sự thật xuất hiện cách nói mới chưa rõ thực hư, cả hai phiên bản đều hiển thị "Có tranh cãi".
- [ ] Khi nội dung chính nói rõ sự thật cũ là sai, sự thật đó sẽ chuyển sang "Đã hết hiệu lực" và hiển thị lý do.
- [ ] Khi nội dung chính hiện tại xuất hiện lại nhân vật hoặc vật phẩm liên quan, prompt suy diễn thế giới chỉ truy xuất ký ức cũ liên quan.
- [ ] Chèn trạng thái nội dung chính có thể nhận được ký ức `known/direct` liên quan, nhưng không nhận được ký ức `hidden/trace`, tóm tắt liên tục hoặc trải nghiệm giai đoạn.

## Quan sát nhân vật ngoài ống kính

- [ ] Chi tiết NPC không xuất hiện trong vòng này hiển thị "Xem người ấy đang làm gì".
- [ ] Nhân vật đã xuất hiện trong vòng này và nhân vật người chơi không hiển thị lối vào này.
- [ ] Đoạn được tạo không vào cuộc trò chuyện chính, không thay đổi đồng hồ thế giới và trạng thái nhân vật.

## Tự động suy diễn và ngân sách NPC

- [ ] Phương thức tự động suy diễn có thể chuyển đổi giữa thủ công, gọn nhẹ, cân bằng, chuyên sâu.
- [ ] Sau khi tần suất được đặt thành mỗi 3 vòng, hai vòng đầu chỉ hiển thị trạng thái tích lũy, vòng thứ ba sẽ gộp ba nội dung chính mới theo thứ tự.
- [ ] Số vòng tích lũy tùy chỉnh chấp nhận từ 1—20, sau khi làm mới trang vẫn được giữ lại.
- [ ] Yêu cầu suy diễn tùy chỉnh sẽ được lưu, và đưa vào prompt suy diễn thế giới.
- [ ] Khi ngân sách NPC chạy ngầm được đặt thành 0, nhân vật trong khung hình vẫn cập nhật, nhân vật ngoài ống kính không chủ động tiến hành.
- [ ] Khi Worldbook chứa lượng lớn NPC, một vòng tối đa chủ động cập nhật số lượng nhân vật ngoài ống kính theo cài đặt.
- [ ] Thay đổi chung của một lượng lớn NPC cùng tổ chức ưu tiên trở thành sự kiện thế lực hoặc địa điểm, thay vì mỗi người một quỹ đạo.
- [ ] Nhân vật đang ngủ có thể được đánh thức lại khi được nhắc đến lại, gần địa điểm, sự kiện liên kết đến hạn hoặc trúng phục bút.

## Thử lại khi thất bại

- [ ] Số lần thử lại có thể chọn 0/1/2/3 hoặc tùy chỉnh 0—5.
- [ ] Khi yêu cầu lần đầu thất bại tạm thời, lần thứ hai thành công, chỉ ghi kết quả một lần và thời gian chỉ tiến hành một lần.
- [ ] Mỗi lần thử lại sẽ hiển thị số lần hiện tại trên thanh trạng thái.
- [ ] Khi cuối cùng vẫn thất bại sẽ giữ lại bản ghi nhanh trước khi suy diễn và hiển thị lỗi cuối cùng.
- [ ] Khi thiếu địa chỉ/Key/mô hình hoặc HTTP 400/401/403/404 sẽ báo lỗi ngay lập tức, không lãng phí số lần thử lại.

## Cài đặt và giao diện

- [ ] Trong cài đặt tiện ích mở rộng xuất hiện "Mặt trái thế giới".
- [ ] Góc dưới bên phải trang xuất hiện quả cầu thế giới.
- [ ] Quả cầu thế giới có thể kéo thả, tự động hít vào mép trái phải, sau khi làm mới trang vị trí không bị mất.
- [ ] Khi suy diễn thế giới, quan sát nhân vật tức thời, kiểm tra kết nối hoặc sắp xếp ký ức đang chạy, quả cầu thế giới xoay liên tục; sau khi hoàn thành hoặc thất bại sẽ dừng lại.
- [ ] Bảng điều khiển có thể mở, đóng, dưới chiều rộng điện thoại có thể cuộn.
- [ ] Ba chủ đề ban ngày, ban đêm, tự động đều có thể chuyển đổi.
- [ ] Chủ đề tự động sử dụng ban ngày vào 06:00—17:59 của thế giới chính, thời gian còn lại sử dụng ban đêm.

## Thời gian và sự kiện

- [ ] Có thể điền tên lịch, năm, tháng, ngày, giờ, phút, sau khi làm mới trang ngày tháng không bị mất.
- [ ] Tiến hành từ cuối tháng sang ngày hôm sau sẽ qua tháng chính xác, tiến hành từ cuối năm sang ngày hôm sau sẽ qua năm chính xác.
- [ ] Sau khi nâng cấp trạng thái phiên bản cũ chỉ có "Ngày thứ mấy", thời gian tuyệt đối và tiến độ sự kiện không thay đổi.
- [ ] Tạo một sự kiện trôi qua tự nhiên 12 giờ.
- [ ] Liên tục tạo ra phản hồi không chứa thay đổi thời gian, tiến độ sự kiện không tăng.
- [ ] Tiến hành thủ công 6 giờ, tiến độ sự kiện khoảng 50%.
- [ ] Tiến hành thêm 6 giờ, sự kiện rời khỏi "Dòng chảy ngầm", tiến vào "Tiếng vang".
- [ ] Sự kiện giờ làm việc hiệu quả chỉ tích lũy khi nội dung chính nói rõ là đang làm việc, không tăng do nghỉ ngơi hoặc đi đường.
- [ ] Sự kiện dự kiến sẽ đến hạn vào thời điểm chỉ định.
- [ ] Sự kiện điều kiện không hiển thị phần trăm ảo.

## Rút lại và chỉnh sửa

- [ ] Để một nội dung chính nói rõ đã qua 3 giờ, ghi lại đồng hồ sau khi kết toán.
- [ ] Rút lại phản hồi đó, đồng hồ bắt đầu của phản hồi mới là trước khi rút lại, chứ không phải đồng hồ đã cộng thêm 3 giờ.
- [ ] Chuyển về swipe gốc, kết quả 3 giờ ban đầu được khôi phục.
- [ ] Sau khi chỉnh sửa tin nhắn cũ hơn, bảng điều khiển quay lại trước điểm chỉnh sửa và hiển thị chờ kết toán.
- [ ] Sau khi xóa phản hồi AI cuối cùng, khôi phục bản ghi nhanh hợp lệ trước đó.

## Độc thoại góc nhìn thứ nhất

- [ ] Sau khi suy diễn thế giới, NPC liên quan xuất hiện độc thoại góc nhìn thứ nhất ở trang "Nhân vật".
- [ ] Khi tắt "Miêu tả nội tâm người chơi", nhân vật người chơi sẽ không hiển thị hoặc lưu độc thoại mới.
- [ ] Mục tiêu dài hạn chỉ cập nhật khi hướng đi thay đổi ổn định, không lặp lại hành động ngắn hạn.
- [ ] Độc thoại sử dụng giọng điệu riêng của NPC đó, chứ không phải tóm tắt của người kể chuyện.
- [ ] Nhân vật không có thay đổi sẽ không làm mới độc thoại một cách máy móc mỗi vòng.
- [ ] Chuyển sang "Những gì nhân vật biết", độc thoại bị ẩn hoàn toàn.
- [ ] Nội dung chính sẽ không thuật lại trực tiếp độc thoại vốn dĩ chưa được biết.
- [ ] Khi chuyển đổi swipe, độc thoại sẽ khôi phục cùng với nhánh tương ứng.

## Kết quả và ranh giới kiến thức

- [ ] Kết quả bị ẩn sẽ không đột nhiên trở thành kiến thức của nhân vật chính.
- [ ] Kết quả có thể hiển thị chỉ khi thực sự đi vào nội dung chính mới hiển thị "Đã được tiếp nối bởi nội dung chính".
- [ ] Kết quả gián tiếp không có thời điểm thích hợp sẽ không liên tục nhồi nhét vào nội dung chính.
- [ ] "Biên niên sử" có thể nhìn thấy hậu quả thế giới chưa đến ống kính nhưng đã hình thành.
- [ ] Sau khi xuất JSON có thể nhập lại, và khôi phục đồng hồ, nhân vật và sự kiện.

## Khôi phục khi thất bại

- [ ] Sau khi tắt tự động suy diễn, phản hồi chỉ hiển thị chờ suy diễn, sẽ không tự ý tiến hành đồng hồ.
- [ ] Nhấp "Suy diễn nội dung chính mới nhất" có thể bù đắp suy diễn.
- [ ] Bảng điều khiển có thể hiển thị trạng thái xếp hàng, đang suy diễn, thành công hoặc thất bại, cũng như API và mô hình thực tế được kế thừa.
- [ ] Dưới thời gian nghiêm ngặt, khi chỉ có mô tả mơ hồ như "Màn đêm buông xuống", đồng hồ giữ nguyên không đổi.
- [ ] Dưới thời gian nghiêm ngặt, khi nội dung chính viết rõ "Sáu giờ sau", đồng hồ cho phép tiến lên sáu giờ.
- [ ] Khi API thất bại tạm thời, đồng hồ giữ nguyên ở trước khi kết toán, không xuất hiện nhảy vọt ngẫu nhiên.
- [ ] Khi API trả về không phải JSON hoặc lỗi trống, bảng điều khiển đưa ra lý do có thể đọc được, thay vì nhấp vào không có phản hồi.
- [ ] Sau khi chuyển đổi trò chuyện, mỗi cuộc trò chuyện hiển thị trạng thái thế giới của riêng nó.