# Case: Parsec P2P Connection Failed [-6023 / -6024 / -11010]

## Triệu chứng
- Parsec hiển thị lỗi "The peer-to-peer network connection between you and the other computer failed [-6023 / -6024 / -11010]".
- Lỗi tái phát sau khi restart/update Windows, hoặc đang chơi thì bị văng và không kết nối lại được.
- Nguyên nhân phổ biến nhất: Parsec service (`pservice.exe`) bị stopped im lặng hoặc firewall block.

## Cách dùng nhanh

Để khắc phục triệt để, chạy các script sau theo thứ tự:

1. **Chẩn đoán (An toàn, Read-only)**
   Chạy `.\scripts\1-chan-doan-parsec.ps1` để tự động kiểm tra 15 hạng mục (Service, Firewall, VPN, STUN, config). Đọc log để xác định tầng nào bị lỗi.

2. **Fix Tầng 1: Service (Nguyên nhân gốc)**
   Chạy `.\scripts\2-fix-service-layer.ps1` (Script sẽ tự xin quyền Admin). 
   - Đảm bảo service tự động chạy (Automatic).
   - Thiết lập Recovery để tự restart nếu service bị crash.

3. **Fix Tầng 2: Firewall**
   Chạy `.\scripts\3-fix-firewall-layer.ps1` (Script sẽ tự xin quyền Admin).
   - Tạo các rules cần thiết (TCP 443, UDP 3478, UDP 8000-8010) cho tất cả profiles (Public/Private/Domain).

4. **Kiểm tra Tầng 3: NAT/STUN (Nếu vẫn lỗi)**
   Chạy `.\scripts\4-fix-nat-stun-check.ps1` để phát hiện Double NAT hoặc CGNAT. Script sẽ cung cấp hướng dẫn fix thủ công trên Router.

5. **Cài đặt Watchdog (Phòng ngừa tái phát)**
   Chạy `.\scripts\6-install-watchdog-task.ps1` (Script sẽ tự xin quyền Admin).
   - Cài 1 Scheduled Task chạy ngầm mỗi 5 phút. Nếu phát hiện Parsec service chết, nó sẽ tự start lại.
   - Để gỡ bỏ, chạy `.\scripts\7-uninstall-watchdog-task.ps1`.
