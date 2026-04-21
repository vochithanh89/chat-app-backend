# Chat App — Feature Scope

Phân chia chức năng backend theo 5 module. Dùng file này để tra cứu scope khi implement / review.

---

## Module 1 — Core Authentication & User Management

Quản lý User, bảo mật và vận hành hạ tầng.

**Auth flow**

- Login / Logout / Refresh Token (JWT).
- Đăng ký tài khoản mới + xác thực qua **OTP Email/SMS**.
- Quên mật khẩu / Đổi mật khẩu.

**Profile**

- Cập nhật hồ sơ cá nhân: name, bio, avatar URL.
- Upload avatar.

**Presence**

- Cập nhật `is_online` và `last_seen_at` mỗi khi user truy cập/thoát app.

---

## Module 2 — Friendship & Notification System

Bạn bè và hệ thống thông báo.

**Friendship APIs**

- Tìm kiếm user (theo số điện thoại, email, tên).
- Gửi lời mời kết bạn (Friend Request).
- Đồng ý / Từ chối lời mời.
- Xem danh sách bạn bè, danh sách lời mời đã gửi/nhận.
- Hủy kết bạn (Unfriend).

**Push Notification**

- Tích hợp **Firebase Cloud Messaging (FCM)**.
- Push khi: có lời mời kết bạn mới, có người nhắc tên (@mention).

---

## Module 3 — Conversation & Group Management

Quản lý nhóm và đoạn chat.

**Conversation**

- Khởi tạo chat 1-1 với bạn bè.
- Tạo group chat với nhiều thành viên.
- Lấy danh sách conversations của user (sắp xếp theo thời gian tin nhắn mới nhất).

**Group management**

- Thêm / Xóa thành viên, Tự rời nhóm.
- Phân quyền: bổ nhiệm phó nhóm, chuyển quyền trưởng nhóm.
- Giải tán nhóm (chỉ trưởng nhóm).

---

## Module 4 — Messaging Core & Media Storage

Lõi nhắn tin realtime và lưu trữ media.

**Realtime transport**

- Cấu hình **WebSocket / STOMP**.
- API gửi/nhận tin nhắn text qua WebSocket.

**Tin nhắn nâng cao**

- Thu hồi tin nhắn (`is_recalled = true`).
- Xóa tin nhắn phía người dùng (`is_deleted = true`).
- Reply — `reply_to_message_id`.
- Forward tin nhắn.
- Reactions (thả tim, haha, ...).

---

## Module 5 — AI Integration & Admin / Statistics

Tích hợp AI và quản trị.

**AI Chatbot Assistant**

- Tích hợp LLM API (**Google Gemini** / **OpenAI ChatGPT**).
- Flow: user chat với AI → backend forward prompt sang LLM → trả response về user.

**Reports**

- API cho user báo cáo user khác hoặc báo cáo tin nhắn vi phạm.

**Admin — Thống kê & Quản trị**

- Thống kê tài khoản đăng ký mới, số lượng group chat.
- Biểu đồ số lượng tin nhắn theo ngày / tuần / tháng.
- Khóa / Mở khóa tài khoản (`account_status` do Admin thao tác).

---

## Trạng thái hiện tại

- [x] Module 1: login, logout (revoke refresh token), refresh, register + OTP email verify, resend OTP, forgot/reset password, change password.
- [x] Module 1: update profile (name, bio), upload avatar (local — TODO: chuyển Cloudinary/S3 ở Module 4), presence (`is_online`, `last_seen_at`) qua middleware + heartbeat/offline endpoints.
- [x] Chuẩn hóa response format (`ApiResponse` helper + global exception handler bắt VineJS / auth / runtime errors).
- [ ] Module 1 còn thiếu: **OTP qua SMS** (cần Twilio/SNS), **CI/CD** deploy hàng tuần (cần Git secrets + cloud account).
- [x] Module 2: tìm kiếm user (name/email/phone), gửi/đồng ý/từ chối/hủy lời mời, danh sách bạn bè & lời mời sent/received, unfriend. NotificationService stub (DeviceToken model + register/unregister endpoint).
- [ ] Module 2 còn thiếu: tích hợp **firebase-admin** thật (cần Firebase service account JSON) — hiện stub log payload.
- [x] Module 3: tạo chat 1-1 / group, list conversations (sort `last_message_at`), add/remove member, leave, role admin/member, transfer ownership, disband.
- [x] Module 4: WebSocket realtime qua **socket.io** (path `/socket.io`, JWT auth trong handshake, auto join `user:{id}` + `conv:{id}`). REST gửi/nhận message, list messages (cursor `before`), recall (sender), delete-for-me, reply (`reply_to_message_id`), forward, reactions add/remove. Upload media → `public/uploads/messages/`, lưu URL DB. Push notification tới các member còn lại khi có tin nhắn mới (qua NotificationService).
- [ ] Module 4 còn lại: chuyển media sang **Cloudinary/S3** (hiện đang lưu local public). Khi cần switch, chỉ thay phần `move()` trong `MessagesController.uploadAttachment` + `UsersController.updateAvatar`.
- [x] Module 5 — AI: ChatbotService wrap **Google Gemini REST** (`gemini-1.5-flash` mặc định, `GEMINI_API_KEY`/`GEMINI_MODEL` env), bot user tự seed (`ai-bot@system.local`). Endpoints: `POST /ai/conversations` (tạo/lấy conv 1-1 với bot), `POST /ai/chat` (gửi message + nhận reply, broadcast WS như message thường). Disabled gracefully → 503 nếu thiếu env.
- [x] Module 5 — Reports: user `POST /reports` báo cáo user/message + `GET /reports/mine`.
- [x] Module 5 — Admin: middleware `admin` (cờ `is_admin`), endpoints `GET /admin/overview` (counts), `GET /admin/stats/messages?period=day|week|month`, `GET/PUT /admin/users` + `users/:id/status` (lock/unlock — login bị chặn nếu `accountStatus=locked`), `GET/PUT /admin/reports`.
