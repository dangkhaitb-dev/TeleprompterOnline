# Prompt: Chuyển teleprompter sang render overlay bằng JS (bỏ điều hướng trang)

> Dán toàn bộ file này cho AI/agent thực thi. Đây là spec tự-chứa: đọc kỹ, lập plan, rồi implement theo phase. Repo: **VPromter** — Vite + 11ty + Vanilla JS (ES modules), **không framework**.

---

## 1. Bối cảnh & vấn đề (đã đo thực tế)

App teleprompter hiện là **Multi-Page App**: user submit script ở trang home (`/`) hoặc `/workspaces` → điều hướng sang trang `/teleprompter?ws=<id>` (một document HTML riêng).

Đo trên production (`test.vpromter.com`, nginx):
- **TTFB ~0.9–1.2 giây cho MỌI request tĩnh** (kể cả file JS hash immutable, không redirect). Server phản hồi rất chậm.
- RTT ~300ms (server ở xa).
- HTML **không có header cache** nào (`Cache-Control`/`ETag`/`Last-Modified` đều thiếu) → mỗi lần điều hướng phải tải lại HTML từ server chậm.

Kết luận: bottleneck là **thời gian chờ server + độ trễ mạng**, không phải kích thước asset. Mọi tối ưu bytes (nén, critical CSS, prefetch) đều không cứu được việc **mỗi lần mở teleprompter phải tải một document mới qua server chậm**.

## 2. Mục tiêu

**Không điều hướng trang nữa.** Khi user submit, render teleprompter **bằng JS đè lên (overlay) trang hiện tại** (home hoặc workspaces) trong **cùng một document**. Vì mọi thứ đã ở client (hoặc đã prefetch vào cache), việc mở teleprompter trở nên **tức thì, 0 round-trip tới server**.

Đóng teleprompter → gỡ overlay → quay lại home/workspaces (vẫn còn nguyên trong DOM) **tức thì**.

### Ràng buộc bắt buộc
- **Vanilla JS thuần, không thêm framework/thư viện.**
- **Giữ nguyên trang `/teleprompter.html` độc lập** cho direct-link/SEO/chia sẻ. Overlay và trang độc lập **dùng chung một module** `teleprompter.ui.js` (không nhân đôi logic).
- Không phá vỡ bất kỳ tính năng teleprompter nào (record, camera, scroll, format, notch, popups, storage, scene-editor…).

---

## 3. Kiến trúc đề xuất

Biến `initTeleprompterUI` thành thứ mount được vào **một container bất kỳ** thay vì giả định "cả document là teleprompter".

**Luồng khi user submit (thay cho việc điều hướng):**
1. `import('features/teleprompter/teleprompter.ui.js')` — chunk này **đã nằm trong cache nhờ prefetch** (xem §4) → load tức thì.
2. Lấy **markup teleprompter** (xem §5 — tái dùng HTML đã prefetch, không nhân đôi njk).
3. Chèn markup vào một **overlay full-screen** (`<div class="tp-overlay" role="dialog" aria-modal="true">`) append vào `document.body`, đè lên home/workspaces.
4. Gọi `mountTeleprompter({ root: overlay, workspace, onClose })`.
5. `history.pushState` để nút Back của trình duyệt = đóng overlay (không rời site).

**Luồng khi đóng:** chạy teardown (tắt camera, nhả Web Lock, dừng timers, `.destroy()` các component) → gỡ overlay khỏi DOM → `history.back()`/dọn state → focus lại trang nền.

---

## 4. Bản đồ file hiện trạng (đọc trước khi sửa)

```
src/script/
  teleprompter-main.js                     ← ENTRY của trang /teleprompter.html độc lập
  features/teleprompter/
    teleprompter.ui.js  (~1140 dòng)       ← initTeleprompterUI(workspace); teardown on 'pagehide'
    teleprompter.logic.js                  ← loadWorkspace, createRecordingController, GC… (KHÔNG DOM)
    teleprompter.model.js                  ← pure (clampWpm, formatDuration…)
    components/*.ui.js                      ← scroll-controller, color-picker, format-toolbar,
                                              popups, settings-theme, notch, layout-guides,
                                              panel-drag, shared-edit-history
  features/home/home.ui.js                 ← submit → mở teleprompter (HIỆN openInNewTab)
  features/workspaces/workspaces.ui.js     ← openWorkspace(id) → mở teleprompter (HIỆN openInNewTab)
  utils/prefetch-page.js                   ← fetch '/teleprompter' + prefetch asset (ĐÃ CÓ)
  utils/open-page.js                       ← reserveTab/openInNewTab (dùng cho luồng tab mới hiện tại)
  utils/workspace-session-lock.js          ← holdWorkspaceSessionLock(id)
_templates/pages/teleprompter.njk          ← MARKUP teleprompter (server-render)
src/styles/teleprompter.css  (~47KB)       ← CSS teleprompter (import trong teleprompter-main.js)
```

### `teleprompter-main.js` hiện tại (entry trang độc lập)
```js
import '../styles/reset.css'; import '../styles/tokens.css';
import '../styles/components/back-btn.css'; import '../styles/teleprompter.css';
import { initTeleprompterUI, loadWorkspace } from './features/teleprompter/teleprompter.ui.js';
import { opfsGarbageCollect, indexedDbGarbageCollect } from './features/teleprompter/teleprompter.logic.js';
import { holdWorkspaceSessionLock } from './utils/workspace-session-lock.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';

releasePointerButtonFocus();
const params = new URLSearchParams(window.location.search);
const workspace = loadWorkspace(params.get('ws'));
async function boot() {
  if (workspace?.id) await holdWorkspaceSessionLock(workspace.id);
  initTeleprompterUI(workspace);
  opfsGarbageCollect().catch(() => {});
  indexedDbGarbageCollect().catch(() => {});
}
boot().catch(() => {});
```

### `teleprompter.njk` (markup) — các mốc quan trọng
- `<script type="application/json" id="tpCopy">…</script>` — chuỗi i18n (đọc bởi JS).
- `<section id="tpEmptyState" class="tp-empty" hidden>` — empty state.
- `<main class="app" id="app">` … header, vùng video, `#teleprompterText` (contenteditable), control-bar, popups…

### `teleprompter.ui.js` — điểm cần biết
- `export function initTeleprompterUI(workspace)` — query DOM bằng `document.getElementById`/helper `$(id)`.
- Cuối hàm có `teardown` gọi `storageMonitor.stop()`, `popups.destroy()`, `settings.destroy()`, `notch.destroy()`, `layout.destroy()`, `panelDrag.destroy()`, `formatToolbar.destroy()`, `colorPicker.destroy()`, `stopCamera()`, clear timers… và `window.addEventListener('pagehide', teardown, { once: true })`.
- Scene-editor đã lazy: `const { mountSceneEditor } = await import('../scene-editor/scene-editor.ui.js')`.

> ⚠️ **Lưu ý trạng thái repo hiện tại:** `home.ui.js` và `workspaces.ui.js` vừa được sửa để mở `/teleprompter?ws=` ở **tab mới** (qua `openInNewTab`) + prefetch `/teleprompter`. Phương án overlay này **thay thế** hành vi tab-mới đó cho luồng in-app.

---

## 5. Nguồn markup (quyết định thiết kế then chốt)

**Cách khuyến nghị (A): tái dùng HTML đã prefetch — giữ njk là nguồn sự thật duy nhất.**
- `utils/prefetch-page.js` đã `fetch('/teleprompter')` rồi. Mở rộng nó (hoặc thêm util `utils/teleprompter-markup.js`) để **cache lại chuỗi HTML** đã fetch và expose một hàm `getTeleprompterMarkup()` trả về `Promise<string>` (fetch nếu chưa có).
- Khi mount: `DOMParser` parse HTML đó, trích `#tpCopy`, `#tpEmptyState`, `<main class="app">` (và mọi phần thân teleprompter) → chèn vào overlay root.
- Ưu điểm: **không nhân đôi markup**; njk vẫn là 1 nguồn; sửa UI teleprompter chỉ ở njk.
- Nhược điểm: phụ thuộc fetch (nhưng đã prefetch nền; nếu chưa xong thì `await`, chỉ chậm lần đầu).

**Cách thay thế (B): chuyển markup thành template JS** (`teleprompter.template.js` export chuỗi HTML), njk include lại từ nguồn chung qua build. Chỉ chọn nếu (A) vướng. Tránh để njk và template JS lệch nhau.

→ **Mặc định làm (A).**

---

## 6. Các thay đổi, chia phase

### Phase 0 — Chuẩn bị: tách boot logic dùng chung
Tạo `features/teleprompter/teleprompter.boot.js` export:
```
export async function bootTeleprompter({ root, workspace, onClose })
```
Gồm: `holdWorkspaceSessionLock` → `initTeleprompterUI(...)` → `opfsGarbageCollect`/`indexedDbGarbageCollect`. Trả về `{ destroy }` để caller teardown.
- `teleprompter-main.js` (trang độc lập) chuyển sang gọi `bootTeleprompter({ root: document, workspace, onClose: () => history.back() })`.

### Phase 1 — Cho `initTeleprompterUI` nhận `root` (scope DOM)
- Đổi chữ ký: `initTeleprompterUI(workspace, { root = document } = {})`.
- **Thay MỌI `document.getElementById(x)` / `$(x)` bằng query trong `root`** (vd `root.querySelector('#'+id)` hoặc helper `const $ = (id) => root.querySelector('#'+CSS.escape(id))`). Lý do: khi overlay nằm cùng document với home/workspaces, `document.getElementById` có thể **đụng ID trùng** ở trang nền. **Đây là điểm rủi ro #1 — bắt buộc scope.**
- Kiểm tra collision ID: teleprompter dùng `#app`, `#teleprompterText`, `#tpEmptyState`, `#notchEditText`… Rà xem home/workspaces có ID trùng không; nếu có, ưu tiên scope-by-root (đã làm ở trên) là đủ.
- Các listener `window`/`document` toàn cục (fullscreenchange, keydown, resize, pagehide) → chuyển thành cleanup được: thu vào mảng `cleanups`, gỡ hết trong `destroy()`. **Bỏ `pagehide`-only teardown**; teardown phải gọi được thủ công khi đóng overlay (vẫn giữ `pagehide` như một trigger phụ cho trang độc lập).

### Phase 2 — Component mount overlay
Tạo `features/teleprompter/teleprompter-overlay.ui.js`:
```
export async function openTeleprompterOverlay(workspace)
```
- Tạo `<div class="tp-overlay" role="dialog" aria-modal="true">`, append `document.body`.
- `getTeleprompterMarkup()` → parse → chèn thân teleprompter + `#tpCopy` vào overlay.
- `import()` module ui + boot: `await bootTeleprompter({ root: overlay, workspace, onClose })`.
- **Back button:** `history.pushState({ tpOverlay: true }, '', location.href)`, `addEventListener('popstate', close)`. Nút "back to workspaces" trong teleprompter → gọi `close()` thay vì `window.location.href='/workspaces'`.
- `close()`: `destroy()` (teardown) → gỡ overlay → gỡ popstate listener → khôi phục scroll/focus trang nền. Idempotent.
- Khoá scroll nền khi overlay mở (`document.body` overflow hidden / class), mở lại khi đóng.

### Phase 3 — CSS (rủi ro #2)
- teleprompter.css phải áp dụng **trong overlay** mà **không phá home/workspaces**.
- Kiểm tra teleprompter.css có selector **global** không (`html`, `body`, `*`, reset, `:root` biến trùng). Nếu có rule tác động `body`/global → **scope lại dưới `.tp-overlay`** hoặc chuyển thành biến cục bộ.
- Nạp CSS: cho overlay module `import '../../styles/teleprompter.css'` (Vite tách chunk CSS, inject khi module load). Chấp nhận CSS áp toàn document nhưng **phải đảm bảo không đè layout trang nền** — test kỹ.
- Token màu/spacing: dùng `var(--…)` từ `src/styles/tokens.css` (đã global).

### Phase 4 — Đổi call site
- `home.ui.js`: thay `openInNewTab('/teleprompter?ws='+id)` trong `submitScript` → `await openTeleprompterOverlay(result.workspace)`. Bỏ logic `reserveTab`/tab-mới cho luồng này.
- `workspaces.ui.js`: `openWorkspace(id)` → `openTeleprompterOverlay(getWorkspace(id))`. Áp cho mọi caller (card click, New script, upload, context-menu Open).
- **Giữ prefetch** (`prefetchPageAssets('/teleprompter')` on idle/intent) — vì nó warm chunk JS/CSS + HTML để mount tức thì. Có thể đổi tên/khái niệm thành "warm teleprompter module".
- `open-page.js` có thể không còn dùng (nếu không còn tab mới) → xoá nếu thành orphan (chỉ xoá thứ do chính thay đổi này tạo ra thành mồ côi; kiểm tra bằng grep).

### Phase 5 — Lifecycle & edge cases
- **Camera/mic/fullscreen:** submit là user-gesture → getUserMedia/requestFullscreen chạy được ngay trong overlay. Đảm bảo `stopCamera()`/nhả stream chạy trong `destroy()`.
- **Web Lock (workspace-session-lock):** giữ khi mở, **nhả khi đóng overlay** (không chỉ khi rời trang).
- **Empty state:** nếu `workspace` không hợp lệ → hiện `#tpEmptyState` trong overlay với nút quay lại (đóng overlay), không điều hướng.
- **Persist:** teleprompter tự lưu edit vào workspace store (localStorage/OPFS) như cũ — không đổi.
- **Reload trang khi overlay đang mở:** vì URL không đổi (overlay là state client), F5 sẽ về home. Chấp nhận được; nếu muốn khôi phục, cân nhắc `#ws=` hash (tuỳ chọn, ngoài phạm vi bắt buộc).

---

## 7. Ràng buộc dự án (BẮT BUỘC tuân theo — xem `CLAUDE.md`)

- **Layer imports một chiều:** `constants → http → service → model → logic → ui`. **Chỉ layer `ui` được đụng DOM.** `service/model/logic/http` cấm `document`/`window`. (util được phép đụng DOM.)
- **Không** `window.__*` làm kênh liên module — dùng import tĩnh.
- **Không** gọi `localStorage`/`sessionStorage` trực tiếp trong feature code — bọc trong `utils/`.
- **Không** `alert()`/`confirm()`/`prompt()` — dùng popup component có sẵn.
- **Không** `backdrop-filter: blur()` trên overlay (chỉ tối nền `rgba(...)`).
- Màu/spacing/font dùng **token `var(--…)`** (`src/styles/tokens.css`), không hardcode.
- Tên `CustomEvent` khai báo ở `constants/events.js`, cấm string literal (eslint chặn).
- Input/textarea mobile `font-size ≥ 16px`.
- **Commit message KHÔNG kèm `Co-Authored-By`.** Conventional commits (`feat/fix/refactor/perf/...`).
- Đơn giản trước, surgical, xóa orphan do chính mình tạo ra.
- Task này đổi kiến trúc + ≥3 file → **phải lập plan và được duyệt trước khi code** (repo yêu cầu `/plan`).

## 8. Kiểm thử & lệnh

```
npm run dev        # Vite dev
npm run lint       # ESLint + Stylelint (phải sạch; eslint enforce layer imports)
npm test           # Vitest
npm run build      # 11ty + vite (phải xanh)
```
- Viết test cho phần thuần (markup-extract, boot factory) theo style **dependency-injection, môi trường `node`** (xem `utils/prefetch-page.test.js`, `utils/open-page.test.js` làm mẫu — inject `doc`/`fetch`, không dựa jsdom).

## 9. Tiêu chí nghiệm thu

Chức năng:
- [ ] Submit ở home → teleprompter hiện **tức thì**, **không có request document mới** (kiểm tra tab Network: 0 navigation request khi mở).
- [ ] Mở workspace ở `/workspaces` (card click, New script, upload, context-menu) → overlay teleprompter, danh sách workspaces vẫn ở nền.
- [ ] Đóng teleprompter → về home/workspaces tức thì; **nút Back trình duyệt cũng đóng overlay** (không rời site).
- [ ] Camera/mic, record, scroll, format toolbar, color picker, notch, popups, settings, scene-editor, storage warning — **hoạt động y như trang độc lập**.
- [ ] Đóng overlay **nhả camera + Web Lock + dừng timers** (không rò rỉ; mở lại lần nữa vẫn sạch).
- [ ] Trang `/teleprompter.html` độc lập (direct link) **vẫn chạy** bình thường qua `bootTeleprompter`.
- [ ] Không xung đột CSS: home/workspaces nền không bị lệch layout khi overlay đóng.
- [ ] Không xung đột ID (query đã scope theo `root`).

Kỹ thuật:
- [ ] `npm run lint` sạch (đặc biệt rule layer-imports), `npm test` xanh, `npm run build` xanh.
- [ ] Không nhân đôi markup teleprompter (njk vẫn là nguồn, hoặc template chung).
- [ ] Không thêm dependency mới.

## 10. Không được phá (regression guard)
- Toàn bộ tính năng record/export/scene-editor/storage.
- Trang độc lập `/teleprompter.html` cho SEO/chia sẻ.
- Prefetch/warm asset (giữ để mount tức thì).

## 11. Ghi chú ưu tiên
Đây là **giải pháp frontend** né server chậm cho đúng luồng home/workspaces → teleprompter. Vẫn nên (song song, không thuộc task này) **fix hạ tầng**: đặt **CDN (Cloudflare)** trước origin + thêm header `Cache-Control: public, max-age=31536000, immutable` cho `/assets/` và `no-cache` cho HTML ở nginx — cái đó giúp mọi trang, direct-link, và lần tải đầu.
