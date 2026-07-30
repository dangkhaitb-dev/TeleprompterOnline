# SolPrompter

## Build test qua ngrok

Chế độ test dùng để kiểm tra SolPrompter trên thiết bị Android qua HTTPS của
ngrok. Toàn bộ HTML trong bản build này được gắn `noindex, nofollow`; preview
cũng trả về header `X-Robots-Tag: noindex, nofollow` để công cụ tìm kiếm không
lập chỉ mục URL test.

Build và chạy preview test:

```bash
npm run build:test
npm run preview:test
```

Preview chạy tại `http://127.0.0.1:4173`. Mở terminal khác và tạo tunnel:

```bash
ngrok http 4173
```

Mở URL HTTPS do ngrok cung cấp trên Android. Các hostname thuộc
`*.ngrok-free.app` và `*.ngrok-free.dev` đã được cho phép riêng trong chế độ
test.

> [!WARNING]
> Không deploy thư mục `dist` ngay sau khi chạy `npm run build:test`, vì đây là
> artifact có `noindex`. Trước mọi lần deploy production, luôn build lại bằng:

```bash
npm run build
```

Build production không nhận cấu hình ngrok hoặc header test và giữ nguyên SEO
của từng trang. Không ghi ngrok authtoken vào repository; chỉ cấu hình token
trong máy phát triển.
