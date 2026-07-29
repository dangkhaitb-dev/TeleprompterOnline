# Deploy website lên Cloudflare Pages bằng Git

Checklist này dùng cho website build từ GitHub/GitLab. Thay các giá trị:

- `<PROJECT_NAME>`: tên Cloudflare Pages project.
- `<DOMAIN>`: domain production, ví dụ `example.com`.
- `<OUTPUT_DIR>`: thư mục sinh ra sau build, ví dụ `dist`.

> Cloudflare Pages luôn tạo `<PROJECT_NAME>.pages.dev`. Không thể xóa riêng
> hostname này; hãy redirect 301 nó về domain production nếu không muốn sử dụng.

## 1. Xác nhận mục tiêu

- [ ] Chốt chính xác repository, production branch, Pages project và domain.
- [ ] Nếu project đã tồn tại, dùng đúng project đó; không tạo project trùng.
- [ ] Domain phải nằm trong đúng Cloudflare account và có quyền sửa DNS/Pages.
- [ ] Không xóa project, deployment, custom domain hoặc DNS record khi chưa có
      kế hoạch khôi phục.

## 2. Kiểm tra repository

Kiểm tra framework, package manager, script, Node, biến môi trường và output:

```bash
node --version
npm --version
cat package.json
cat .nvmrc 2>/dev/null || true
```

Xác nhận:

- Lockfile đúng package manager (`package-lock.json`, `pnpm-lock.yaml` hoặc
  `yarn.lock`).
- Có build script và biết chính xác `<OUTPUT_DIR>`.
- Asset dùng URL đúng khi chạy trên domain gốc.
- Canonical, sitemap và `robots.txt` dùng `https://<DOMAIN>`.
- Liệt kê đủ biến môi trường; không commit token hoặc secret.
- MPA có `404.html`; SPA cần fallback `/* /index.html 200` trong `_redirects`.
  Không thêm SPA fallback cho MPA vì sẽ che mất HTTP 404 thật.

Ví dụ của SolPrompter:

```text
Package manager: npm
Node: 22.16.0
Build command: npm run build
Output directory: dist
```

## 3. Kiểm tra local trước khi deploy

```bash
npm ci
npm run build
npm test
npm run lint
```

- [ ] Tất cả lệnh thoát với exit code `0`.
- [ ] `<OUTPUT_DIR>` chứa HTML, CSS, JavaScript, asset, `404.html`, `_headers`
      và `_redirects` cần thiết.
- [ ] Không có đường dẫn asset bị 404 khi preview build.

Cache khuyến nghị cho asset có hash trong `public/_headers`:

```text
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

## 4. Đẩy code lên Git

```bash
git status
git push origin main
```

Đổi `main` nếu production branch có tên khác.

## 5. Tạo hoặc kết nối Cloudflare Pages

1. Mở **Cloudflare Dashboard → Workers & Pages**.
2. Chọn **Create application → Pages → Connect to Git**.
3. Chọn đúng GitHub/GitLab repository.
4. Chọn đúng production branch.
5. Nhập cấu hình:

```text
Project name: <PROJECT_NAME>
Build command: npm run build
Build output directory: <OUTPUT_DIR>
Root directory: / hoặc thư mục ứng dụng trong monorepo
```

Không dùng `npx wrangler deploy` làm Deploy command cho website Pages kết nối
Git. Sau khi liên kết, mỗi lần push production branch, Pages sẽ tự clone, cài
dependency, build và cập nhật production.

## 6. Thêm biến môi trường

Vào **Pages project → Settings → Environment variables** và thêm các biến mà
build cần. Ví dụ:

```text
NODE_VERSION=22.16.0
SITE_URL=https://<DOMAIN>
```

- Không thêm `SKIP_DEPENDENCY_INSTALL=1` nếu build cần npm dependencies.
- Biến `VITE_*` được đưa vào bundle trình duyệt, không dùng cho secret.
- Thiết lập riêng Production/Preview nếu giá trị khác nhau.

## 7. Deploy lần đầu

1. Chọn **Save and Deploy**.
2. Kiểm tra log: install dependencies → build → upload assets.
3. Chỉ tiếp tục khi deployment có trạng thái **Success**.
4. Nếu lỗi, sửa nguyên nhân trong code/config rồi deploy lại; không tạo project
   khác để né lỗi.

## 8. Gắn production domain

1. Vào **Pages project → Custom domains → Set up a domain**.
2. Nhập `<DOMAIN>` và xác nhận.
3. Với apex domain trong Cloudflare, cho phép Cloudflare tạo CNAME:

```text
Type: CNAME
Name: @
Target: <PROJECT_NAME>.pages.dev
Proxy: Proxied
```

4. Chờ Custom domain chuyển sang **Active**.

Phải gắn domain trong Pages trước khi tự tạo CNAME; chỉ tạo CNAME thủ công mà
không associate custom domain có thể dẫn tới lỗi `522`.

## 9. Redirect `pages.dev` về production

Vào **Bulk Redirects**, tạo list item và bật rule:

```text
Source URL: <PROJECT_NAME>.pages.dev
Target URL: https://<DOMAIN>
Status: 301
```

Bật đủ:

- Preserve query string
- Subpath matching
- Preserve path suffix
- Include subdomains

Cấu hình này redirect cả project hostname và deployment/preview subdomain về
đúng path trên production. Redirect 301 cũng ngăn `pages.dev` trở thành bản
production được index riêng.

## 10. Redirect `www` về apex

Thêm Bulk Redirect item:

```text
Source URL: www.<DOMAIN>
Target URL: https://<DOMAIN>
Status: 301
```

Bật bốn tùy chọn giống bước 9. Sau đó thêm DNS record:

```text
Type: A
Name: www
IPv4: 192.0.2.1
Proxy: Proxied
TTL: Auto
```

Không cần gắn `www.<DOMAIN>` làm Pages custom domain nếu mục tiêu chỉ là redirect
về apex.

## 11. Kiểm tra production

```bash
curl -I https://<DOMAIN>/
curl -I http://<DOMAIN>/
curl -I https://www.<DOMAIN>/path?test=1
curl -I https://<PROJECT_NAME>.pages.dev/path?test=1
curl -I https://<DOMAIN>/404.html
curl -I https://<DOMAIN>/route-khong-ton-tai
curl -I https://<DOMAIN>/robots.txt
curl -I https://<DOMAIN>/sitemap.xml
```

Kết quả mong đợi:

- `https://<DOMAIN>/`: `200`.
- HTTP apex: `301` tới HTTPS và giữ path/query.
- `www`: `301` tới `https://<DOMAIN>` và giữ path/query.
- `pages.dev` và deployment subdomain: `301` tới production.
- Route thật và asset: `200`.
- Route không tồn tại: `404`, không phải `200` giả.
- Trang lỗi có `noindex`; canonical của trang public trỏ về HTTPS production.
- Asset có hash dùng cache dài; HTML có thể revalidate.
- Chứng chỉ TLS hợp lệ cho apex và `www`.

DNS có thể cần vài phút đến 24 giờ để lan truyền. Kiểm tra bằng cả hai resolver:

```bash
dig +short @1.1.1.1 www.<DOMAIN>
dig +short @8.8.8.8 www.<DOMAIN>
```

## 12. Deploy các lần sau

```text
Developer → git push production branch → GitHub/GitLab webhook
          → Cloudflare Pages build → production deployment mới
```

Sau mỗi deploy:

- [ ] Build thành công và đúng commit.
- [ ] Trang chính, route quan trọng và asset trả đúng status.
- [ ] HTTP, `www`, `pages.dev` vẫn redirect đúng.
- [ ] Canonical, `robots.txt`, sitemap và 404 vẫn đúng.
- [ ] Nếu production lỗi, dùng Pages rollback về deployment tốt gần nhất; không
      xóa project hoặc DNS.

## Tài liệu Cloudflare

- [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Redirect pages.dev](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/)
- [Redirect www](https://developers.cloudflare.com/pages/how-to/www-redirect/)
