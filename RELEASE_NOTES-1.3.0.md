# World Backstage 1.3.0

## Thay đổi cốt lõi

- Mặt trái thế giới chính thức lấy "Trạng thái thế giới chuẩn" làm trung tâm, thay vì coi nội dung chính là nguồn sự thật duy nhất.
- Thêm lớp quyết toán sự thật thế giới `worldFacts` và bản ghi tính nhất quán `consistencyConflicts`; schema trạng thái nâng cấp lên 14.
- Kết quả chạy ngầm đã quyết toán sẽ ràng buộc tính liên tục của nội dung chính sau này; những thay đổi mới xảy ra rõ ràng trong nội dung chính vẫn sẽ được ghi lại vào trạng thái thế giới. Công tắc hiển thị chỉ kiểm soát xem kết quả có chủ động tiếp cận ống kính hay không, không thể tắt bản thân sự thật thế giới chuẩn.
- Đồng hồ thế giới sẽ tự động hiệu chuẩn theo ngày tháng rõ ràng mới của nội dung chính; giờ giấc rõ ràng muộn hơn trong cùng một ngày ở mục "Thời gian và địa điểm" cũng sẽ được đồng bộ trực tiếp, giờ cũ sẽ không kéo ngược thời gian lại.
- Trách nhiệm của Dòng chảy ngầm / Tiếng vang / Biên niên sử được thu gọn lại: Kết quả chưa hiển thị và đã lưu trữ sẽ không còn đồng thời lưu lại trong Tiếng vang.
- Dư luận hỗ trợ tự động cập nhật trong mô-đun, và chỉ làm mới khi nguồn thông tin công khai thực sự thay đổi.
- Trang cài đặt, trang ký ức và hướng dẫn của các phần được tinh gọn tổng thể, mặc định chỉ giữ lại thông tin sử dụng cần thiết.
- API độc lập sửa lỗi nhận diện và chẩn đoán lỗi 429/hết hạn mức từ thượng nguồn được bọc trong HTTP 200.

## Tương thích

- Bản lưu cũ 1.2.x sẽ tự động di chuyển sang schema 14.
- Vị trí/hành động của nhân vật cũ sẽ không bị cứng hóa trực tiếp thành sự thật chuẩn ngay khoảnh khắc nâng cấp, để tránh khóa cứng sự sai lệch giữa tiền cảnh và chạy ngầm đã tồn tại ở 1.2.x; lần suy diễn 1.3 thành công đầu tiên sẽ kết hợp với nội dung chính mới nhất để điều phối lại trạng thái nhân vật. Sự kiện trạng thái cuối có thể được giữ lại an toàn làm sự thật thế giới, việc di chuyển sẽ không tự dưng bổ sung nhận thức nhân vật hoặc ký ức dài hạn.
- Lối vào chính thức trên GitHub vẫn là `index.js`, không cần `hotfix-entry.js`.