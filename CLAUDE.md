# CLAUDE.md

Hướng dẫn cho Claude Code khi làm việc trong repo này.

> **SolPrompter** — base cho một ứng dụng **teleprompter** web. Stack: **Vite + 11ty + Vanilla JS (ES modules)**, không framework. Đây là bộ khung tối giản: hạ tầng build/lint/test + HTTP layer + Firebase auth + 1 trang `index`. Business logic của teleprompter sẽ được xây trên nền này.

---

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # Build 11ty + sitemap + Vite
npm run lint         # ESLint + Stylelint
npm run lint:js      # ESLint only
npm run lint:css     # Stylelint only
npm test             # Vitest run all tests
npx vitest run src/script/path/to/file.test.js  # Run single test file
```

---

## Khi nào PHẢI lập kế hoạch (Plan Mode)

**BẮT BUỘC** gõ `/plan` và đợi user approve trước khi code nếu task:

- Thay đổi **≥3 file**, hoặc
- Thay đổi **architecture** / **layer boundaries**, hoặc
- Thêm **feature mới** (không phải fix bug nhỏ), hoặc
- **Refactor** code có sẵn, hoặc
- Thay đổi **API contract** / **data model**.

Task nhỏ (fix bug 1–2 file, sửa typo, thêm style) → làm trực tiếp.

---

## Kiến Trúc Core (BẮT BUỘC tuân theo)

### Cấu trúc thư mục

```
src/script/
  constants/api-endpoints.js   ← ENDPOINTS + API_BASES (chỉ path/spec)
  constants/events.js          ← tên CustomEvent (import hằng, không viết literal)
  http/errors.js               ← HttpError, NetworkError
  http/http-client.js          ← fetch wrapper (timeout, error shape)
  environment.js               ← config (baseUrl, timeout, feature flags)
  libs/firebase/               ← auth plumbing (init + auth-cache)
  services/[name].service.js   ← gọi http-client, trả raw data, KHÔNG touch DOM
  features/[name]/
    [name].model.js            ← toXxx(raw) pure functions, định nghĩa data shape
    [name].logic.js            ← orchestrate service + model, KHÔNG touch DOM
    [name].ui.js               ← DOM events, import logic — initXxxUI() export
  main.js                      ← entry: import CSS + wiring UI
```

### Quy tắc import — máy enforce (eslint.config.js)

```
constants → http → service → model → logic → ui
```

Layer trên không bao giờ import layer dưới. **UI là layer duy nhất biết DOM** (service/model/logic/http cấm đụng `document`/`window`).

### Thêm API mới

1. Thêm spec vào `ENDPOINTS` trong `constants/api-endpoints.js`.
2. Thêm hàm vào `services/[tên].service.js` — chỉ gọi `http.get/post`, không logic.

### Thêm feature mới

Tạo folder `features/[tên]/` với 3 file `model.js → logic.js → ui.js`. Gọi `initXxxUI()` từ `main.js`.

### Quy ước

- **Commit message**: KHÔNG thêm `Co-Authored-By`.
- `toXxx(raw)` trong model: mapping field backend → app shape. Đổi field backend → chỉ sửa model.
- Error handling tập trung ở `ui.js`; service/logic để lỗi nổi lên tự nhiên.
- Timeout key lấy từ `environment.api.timeout` — thêm key mới ở đó, không hardcode ms.
- Tên CustomEvent khai báo ở `constants/events.js`; cấm string literal (eslint chặn).
- Recording từ listing (`listAllRecordings`/`listByWorkspace`) có thể `blob: null` + `hasBytes: true` (WebKit fallback, bytes ở store `recording-bytes`) — cần media thì gọi `ensureRecordingBlob` (service) / `loadRecordingBlob` (workspaces.logic), KHÔNG giả định `record.blob` luôn có.
- Thumbnail video: dùng `getVideoThumbnail(id, blob)` (memoize theo id + cap 3 decoder) thay vì gọi `extractVideoThumbnail` trực tiếp.
- Teleprompter — đồng bộ cross-tab hiện chỉ là badge "Content updated" (edit view, **desktop only**), CHỈ theo dõi **content** (`scriptHtml`+`scriptText`, kèm style inline), KHÔNG theo settings: `utils/cross-tab-sync.js` (storage event, seam cho BroadcastChannel/Yjs sau) + `features/teleprompter/collab/` (`stale-detector.js` thuần + `edit-stale-badge.ui.js`). `notifyLocalWrite()` trong `persistSharedState` re-baseline badge sau mỗi lần lưu content.

### Rule cứng — máy enforce (`npm run lint`, pre-commit, hook)

- Cấm `backdrop-filter: blur()` trên overlay (chỉ tối nền `rgba(...)`).
- Màu dùng token `var(--...)` (khai báo trong `src/styles/tokens.css`).
- Cấm `window.__*` làm kênh liên lạc giữa module — dùng import tĩnh.
- Cấm gọi `localStorage`/`sessionStorage` trong feature code — bọc trong `utils/`.
- Cấm `alert()` / `confirm()` / `prompt()` — dùng custom popup component.

### CSS tokens

Token thiết kế ở `src/styles/tokens.css` (color/spacing/typography, theme qua `[data-theme]`). Khi thêm/sửa màu, spacing, font-size: **dùng token `var(--...)`**, không hardcode.

- Trên mobile, `input` và `textarea` phải có `font-size` tối thiểu **16px** để tránh trình duyệt tự zoom khi focus.

---

## HTML Template (BẮT BUỘC)

Các file `.html` ở root (vd `index.html`) **được 11ty sinh tự động** từ template Nunjucks trong `_templates/` — **không sửa trực tiếp** (build sẽ ghi đè).

- Layout: `_templates/_includes/base.njk`
- Trang: `_templates/pages/*.njk` (hiện chỉ `index.njk`)
- Nội dung/text: file JSON trong `_templates/_data/pages/<page>/en.json` — **không hardcode text trong `.njk`**.
- Trang mới **1 ngôn ngữ** (about, pricing…): tạo `_templates/pages/<key>.njk` với front matter `layout` + `permalink: /<key>.html` + `pageKey` + `lang`, và data `_templates/_data/pages/<key>/en.json`. Chrome (nav/footer) lấy từ `i18nPages['index']['en']`. **KHÔNG** thêm vào `indexPages.cjs` — file đó chỉ để phân trang bản đa ngữ của `index`. Sitemap + vite input tự nhận file `.html` mới ở root; nginx `try_files` lo clean URL nên canonical để `/<key>`.
- `partials/json-ld.njk` là **schema riêng của index** (hardcode `pageData.howItWorks.steps` + `faq.items`) — khai báo `pageData.schema` ở trang khác sẽ làm build fail. Trang khác cần structured data → viết partial riêng, tự guard bằng key data của chính nó (xem `partials/pricing-json-ld.njk`), rồi include thêm 1 dòng ở layout.
- Sau khi sửa template → chạy lại build.

Pipeline build: `build:11ty` (sinh HTML → root) → `gen:sitemap` → `vite build`. `vite.config.js` tự phát hiện mọi `*.html` ở root làm input.

---

## Hành Vi Chung (giảm lỗi LLM)

- **Suy nghĩ trước khi code**: nêu giả định; nếu nhiều cách hiểu, hỏi thay vì tự chọn im lặng.
- **Đơn giản trước**: code tối thiểu giải quyết vấn đề; không abstraction/flexibility khi chưa cần.
- **Surgical changes**: chỉ chạm phần bắt buộc; không "cải thiện" code xung quanh; theo style hiện có; xóa orphan do chính thay đổi của mình tạo ra.
- **Goal-driven**: chuyển task thành tiêu chí verify được (viết test reproduce → làm cho pass).

---

## ECC Rules (bổ sung — rule project luôn thắng khi xung đột)

Common:
@.claude/rules/ecc/common/agents.md
@.claude/rules/ecc/common/security.md
@.claude/rules/ecc/common/performance.md

Web:
@.claude/rules/ecc/web/design-quality.md
@.claude/rules/ecc/web/patterns.md
@.claude/rules/ecc/web/performance.md
@.claude/rules/ecc/web/security.md
