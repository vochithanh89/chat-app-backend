# Chat App Backend

Backend cho ứng dụng chat realtime, xây dựng trên **AdonisJS v6** + **TypeScript**.
Bao phủ 5 module: Auth/User, Friendship, Conversation/Group, Messaging realtime + Media, AI Chatbot + Admin.

Chi tiết scope từng module: [.claude/FEATURES.md](.claude/FEATURES.md)
Quy ước code & API format: [.claude/CLAUDE.md](.claude/CLAUDE.md)

---

## 1. Yêu cầu

- **Node.js** >= 20
- **MySQL** >= 8 (project hiện dùng `mysql2`)
- **npm** (hoặc pnpm/yarn — lệnh dưới dùng npm)
- (Tuỳ chọn) Tài khoản **SMTP** để gửi mail (OTP, reset password)
- (Tuỳ chọn) **Firebase service account** để bật push notification (FCM)
- (Tuỳ chọn) **Google Gemini API key** để bật AI Chatbot

---

## 2. Cài đặt

```bash
git clone <repo-url>
cd chat-app-backend
npm install
```

Tạo file `.env` từ template:

```bash
cp .env.example .env
```

Sinh `APP_KEY` (bắt buộc):

```bash
node ace generate:key
```

Copy giá trị vào `APP_KEY` trong `.env`.

---

## 3. Cấu hình `.env`

### Bắt buộc

```env
TZ=UTC
PORT=3333
HOST=localhost
NODE_ENV=development
LOG_LEVEL=info
APP_KEY=<sinh từ ace generate:key>

# MySQL
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_DATABASE=chat_app

# SMTP — dùng để gửi OTP verify email + reset password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your@gmail.com
SMTP_PASSWORD=<app password>
```

### Tuỳ chọn

```env
# JWT — bỏ trống thì dùng APP_KEY
JWT_SECRET=

# Firebase Cloud Messaging (push notifications)
# Bỏ trống → NotificationService chỉ log payload, không gửi push thật.
# FIREBASE_PRIVATE_KEY: paste full PEM 1 dòng, escape newline thành \n
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# AI Chatbot — Google Gemini
# Lấy key tại https://aistudio.google.com/apikey
# Bỏ trống → /ai/* trả 503, các endpoint khác vẫn chạy.
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
```

---

## 4. Khởi tạo database

Tạo database trong MySQL:

```sql
CREATE DATABASE chat_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Chạy migrations:

```bash
node ace migration:run
```

(Khi cần reset toàn bộ schema trong môi trường dev)

```bash
node ace migration:rollback --batch=0
node ace migration:run
```

---

## 5. Chạy server

**Dev mode** (HMR):

```bash
npm run dev
```

Server lắng nghe tại `http://localhost:3333`.

**Production**:

```bash
npm run build
node build/bin/server.js
```

**Typecheck / Lint / Format**:

```bash
npm run typecheck
npm run lint
npm run format
```

---

## 6. Tài khoản admin đầu tiên

Project không seed admin tự động. Sau khi register tài khoản qua API:

```sql
UPDATE users SET is_admin = 1 WHERE email = 'you@example.com';
```

Các endpoint `/api/v1/admin/*` yêu cầu `is_admin = 1`.

---

## 7. API documentation (Swagger)

Sau khi server chạy, truy cập:

- **Swagger UI**: http://localhost:3333/docs
- **OpenAPI spec (YAML)**: http://localhost:3333/swagger

Tất cả endpoint đều prefix `/api/v1`.

### Response format chuẩn

Mọi endpoint trả về 1 trong 2 shape sau (chi tiết: [.claude/CLAUDE.md](.claude/CLAUDE.md)):

**Success**
```json
{ "success": true, "message": "...", "data": { ... } }
```

**Error / Validation**
```json
{
  "success": false,
  "message": "...",
  "errors": [{ "field": "email", "message": "..." }]
}
```

---

## 8. WebSocket (Socket.IO)

Realtime messaging dùng **Socket.IO**, attach cùng HTTP server tại path `/socket.io`.

**Client connect:**

```js
import { io } from 'socket.io-client'

const socket = io('http://localhost:3333', {
  auth: { token: '<JWT access token>' },
})

socket.on('message:new', (msg) => { ... })
socket.on('message:recalled', ({ id }) => { ... })
socket.on('message:reaction:added', (payload) => { ... })
socket.on('message:reaction:removed', (payload) => { ... })
```

Khi connect, server tự động join các room:
- `user:{userId}` — kênh riêng của user
- `conv:{conversationId}` — cho mọi conversation user là thành viên

Token JWT dùng chung với REST API. Login → lấy `token` → truyền vào `auth.token`.

---

## 9. Static files (avatar, attachments)

Tất cả file upload (avatar, ảnh/video/file đính kèm message) được lưu vào thư mục `public/uploads/` và phục vụ tĩnh qua `@adonisjs/static`.

- Avatar: `public/uploads/avatars/`
- Message attachments: `public/uploads/messages/`

URL trả về cho client là URL tuyệt đối, ví dụ: `http://localhost:3333/uploads/avatars/12_1696848000000.png`.

> **Lưu ý production**: thư mục `public/uploads/` cần persistent volume hoặc chuyển sang Cloudinary/S3.

---

## 10. Cấu trúc thư mục

```
app/
├── controllers/        # HTTP controllers (auth, users, friends, conversations, messages, ai, reports, admin)
├── exceptions/         # Global exception handler — chuẩn hoá error response
├── mails/              # Mail templates (verify email, forgot password)
├── middleware/         # auth, email_verified, track_presence, admin
├── models/             # Lucid models
├── services/           # chatbot, notification (FCM), realtime (socket.io), message
├── utils/              # api_response helper
└── validators/         # VineJS validators
config/                 # Adonis config
database/migrations/    # Migrations (chạy theo thứ tự timestamp)
providers/              # realtime_provider — bootstrap socket.io khi server ready
public/uploads/         # Static uploaded files
start/
├── env.ts              # Env schema
├── kernel.ts           # Server + named middleware registration
└── routes.ts           # Tất cả routes
.claude/
├── CLAUDE.md           # Quy ước project (Swagger, response format, migration)
└── FEATURES.md         # Feature scope theo 5 module
```

---

## 11. Tích hợp ngoài (chưa enable mặc định)

| Tính năng       | Cần                                  | Trạng thái khi thiếu                          |
| --------------- | ------------------------------------ | --------------------------------------------- |
| FCM Push        | `FIREBASE_*` env                     | Log payload, không gửi push                   |
| AI Chatbot      | `GEMINI_API_KEY`                     | `/ai/*` trả 503                               |
| SMS OTP         | (Chưa implement) Twilio / AWS SNS    | Chỉ có Email OTP                              |
| Cloud storage   | (Chưa implement) Cloudinary / S3     | File lưu local `public/uploads/`              |
| CI/CD deploy    | GitHub Actions + cloud credentials   | Chưa cấu hình                                 |

---

## 12. Troubleshooting

**`/docs` báo `Cannot convert undefined or null to object`**
→ Có annotation `@responseBody` chứa `null` literal. Thay bằng `{}`. Quy ước này đã ghi trong [.claude/CLAUDE.md](.claude/CLAUDE.md).

**Socket.IO không emit gì**
→ Kiểm tra `RealtimeProvider` đã được đăng ký trong [adonisrc.ts](adonisrc.ts). Restart server (không hot-reload provider).

**Login luôn 401 dù password đúng**
→ Tài khoản có thể bị `account_status = 'locked'`. Check DB hoặc dùng admin endpoint mở khoá.

**Email OTP không gửi**
→ Kiểm tra log SMTP. Với Gmail cần dùng **App Password**, không phải mật khẩu thường.
