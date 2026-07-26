// PostToolUse hook: lint file vừa được Edit/Write.
// Exit 2 khi có ERROR → Claude Code hiển thị lỗi ngược cho AI tự sửa ngay.
// Warning (nợ legacy) không chặn — chỉ error mới chặn (dùng --quiet).
// Ngoài ra: ghi lại file JS đã sửa vào marker theo session — hook Stop
// (review-gate.mjs) dùng marker này để đề xuất AI review khi kết thúc lượt.
//
// Test thủ công: echo '{"session_id":"test","tool_input":{"file_path":"<đường dẫn tuyệt đối file .js trong src/script/>"}}' | node .claude/hooks/lint-changed.mjs
//   → exit 0 khi file sạch, exit 2 khi có lint error.
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path || '';
if (!filePath || !existsSync(filePath)) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let args = null;
if (/\.(js|mjs)$/.test(filePath) && filePath.includes('/src/script/')) {
  args = ['eslint', '--quiet', '--no-warn-ignored', filePath];
  // Đánh dấu "phiên này có sửa JS" cho review-gate.mjs (Stop hook)
  try {
    const marker = join(tmpdir(), `claude-review-pending-${payload.session_id || 'default'}.txt`);
    appendFileSync(marker, filePath + '\n');
  } catch {
    // marker chỉ là tiện ích — không được làm hỏng lint hook
  }
} else if (/\.css$/.test(filePath) && filePath.includes('/src/')) {
  args = ['stylelint', '--quiet', filePath];
}
if (!args) process.exit(0);

const res = spawnSync('npx', ['--no-install', ...args], {
  cwd: projectDir,
  encoding: 'utf8',
  timeout: 25000,
});

if (res.status !== 0) {
  if (res.stdout) console.error(res.stdout);
  if (res.stderr) console.error(res.stderr);
  console.error('Lint FAIL on the modified file — fix the errors above before continuing. Rule/baseline: eslint.config.js, stylelint.config.js.');
  process.exit(2);
}
process.exit(0);
