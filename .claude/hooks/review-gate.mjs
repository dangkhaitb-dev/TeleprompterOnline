// Stop hook: tự động review code KHI VÀ CHỈ KHI toàn bộ công việc đã xong xuôi.
//
// Cơ chế:
// - lint-changed.mjs tích lũy các file JS đã sửa vào marker theo session.
// - Cuối mỗi lượt, hook chặn và để AI tự đánh giá: task CHƯA xong → kết thúc
//   lượt bình thường; task ĐÃ xong xuôi → TỰ ĐỘNG chạy review (không hỏi user).
// - Review nhẹ: code smell, tuân thủ codebase — KHÔNG overthinking, KHÔNG auto-fix.
// - stop_hook_active guard chống loop vô hạn trong cùng một lượt.
//
// Test thủ công: echo '{"session_id":"test","stop_hook_active":false}' | node .claude/hooks/review-gate.mjs
//   → exit 0 khi chưa có marker; tạo marker claude-review-pending-test.txt trong $TMPDIR rồi chạy lại → in JSON {"decision":"block",...}.
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

// Đang tiếp tục do chính Stop hook chặn trước đó → cho kết thúc (tránh loop)
if (payload.stop_hook_active) process.exit(0);

const marker = join(tmpdir(), `claude-review-pending-${payload.session_id || 'default'}.txt`);
if (!existsSync(marker)) process.exit(0);

let files = [];
try {
  files = [...new Set(readFileSync(marker, 'utf8').split('\n').filter(Boolean))];
} catch {
  process.exit(0);
}
if (files.length === 0) process.exit(0);

const list = files.map((f) => f.replace(/^.*\/src\/script\//, 'src/script/')).join(', ');
console.log(JSON.stringify({
  decision: 'block',
  reason: `[review-gate] This session has modified ${files.length} JS file(s): ${list}. Self-assessment: Is the user requested task FULLY COMPLETED (all operations + verification done, no pending steps)?
- NOT COMPLETED (in progress / next steps pending / waiting for user reply on the task): end the turn immediately, DO NOT review, DO NOT delete marker — you will be prompted again in the next turn.
- FULLY COMPLETED: AUTOMATICALLY run /code-review low (DO NOT ask user). Scope: code changes in THIS SESSION + related context (import/call files, surrounding functions) to understand enough context — DO NOT review code from other sessions. Only check: code smell, codebase/conventions compliance. DO NOT overthink, DO NOT look for deep bugs, DO NOT auto-fix (only report findings). After the review is complete, run: rm '${marker}'.
- If the task reveals new lessons/patterns/decisions → write them to BASE_COMPONENTS.md or CLAUDE.md (codify) immediately in this turn.`,
}));
