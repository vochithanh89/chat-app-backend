# Project Conventions

## Stack

- Framework: **AdonisJS v6** (TypeScript, ESM).
- ORM: Lucid. Auth: `@adonisjs/auth` (JWT + refresh tokens).
- Mail: `@adonisjs/mail`. Validation: VineJS validators in `app/validators/`.

## API Rules (bắt buộc)

### 1. Swagger documentation

Mọi API endpoint mới **bắt buộc** phải có JSDoc block theo format của `adonis-autoswagger` ngay phía trên method controller:

```ts
/**
 * @<actionName>
 * @operationId <camelCaseOperationId>
 * @description <mô tả ngắn gọn>
 * @requestBody {"field": "type"}
 * @responseBody 200 - {"data": "..."}
 */
public async handler({ request, response }: HttpContext) { ... }
```

- Dùng `@paramQuery`, `@paramPath` khi cần.
- `@responseBody` phải liệt kê cả success và các error code chính (400, 401, 422).
- Sau khi thêm route, kiểm tra `/docs` vẫn render được.

### 2. Migrations

- Nếu thay đổi schema (thêm cột, bảng, index...), **luôn tạo migration mới** trong `database/migrations/`.
- Không sửa migration cũ đã commit. Đặt tên mô tả rõ: `add_<column>_to_<table>_table.ts`.
- Model phải được cập nhật đồng bộ với migration.

### 3. Response format chuẩn

**Success response** — mọi endpoint trả về cùng shape:

```json
{
  "success": true,
  "message": "string",
  "data": { ... }
}
```

**Error response** (validation + runtime + auth) — shape duy nhất:

```json
{
  "success": false,
  "message": "string",
  "errors": [{ "field": "email", "message": "The email field must be a valid email" }]
}
```

- `errors` là mảng. Với lỗi không phải validation, trả về mảng rỗng `[]` hoặc 1 phần tử `{ "field": null, "message": "..." }`.
- HTTP status code vẫn set đúng (400/401/403/404/422/500), không nhét status vào body.
- Validation errors (VineJS) phải được map về shape này trong global exception handler (`app/exceptions/handler.ts`), **không** để format mặc định của Adonis lọt ra ngoài.
- Controller nên dùng helper thống nhất (ví dụ `response.ok({ success: true, message, data })`) thay vì tự bịa shape mới.

### 4. Controller conventions

- Validate bằng `request.validateUsing(<validator>)` — không validate thủ công.
- Không trả raw model khi có field nhạy cảm; model đã đánh dấu `serializeAs: null` cho `password`.
- Secret/token sinh bằng `@adonisjs/core/helpers` (`cuid`) hoặc `crypto.randomBytes`. OTP dùng số 6 chữ số.

## Khi Claude thêm/sửa API

Checklist bắt buộc trước khi kết thúc task:

1. Đã thêm Swagger JSDoc block?
2. Có migration mới nếu schema đổi?
3. Response (success + error) đã đúng format chuẩn?
4. Validator đã được dùng cho mọi input từ client?
