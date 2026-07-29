# Verification matrix

Select checks based on the files and behavior changed.

| Change | During iteration | Before completion |
| --- | --- | --- |
| JS module | `npx --no-install eslint --quiet --no-warn-ignored <files>` | relevant Vitest file(s), then `npm run lint:js` when scope is broad |
| CSS | `npx --no-install stylelint --quiet <files>` | responsive visual check; `npm run lint:css` when scope is broad |
| Nunjucks/page data | targeted source inspection | `npm run build` and inspect generated routes |
| Feature or bug | smallest failing Vitest test first | `npm test` when practical |
| Build pipeline/config | smallest failing command | `npm run build` |
| Critical browser flow | focused reproduction | E2E/browser verification at relevant widths |

Do not run broad checks merely for appearance. Run them when the change can
affect shared wiring, generated output, or multiple modules.

## Final diff review

1. Read `git diff --check`.
2. Read the complete diff for the files changed by the current task.
3. Confirm generated root HTML was changed only by the build.
4. Confirm import direction and DOM/storage/event rules.
5. Check for secrets, unsafe HTML injection, missing validation, debug output,
   and unhandled user-facing failure states.
6. Check that tests assert behavior rather than implementation details.
7. Confirm unrelated user changes remain untouched.

Report findings in descending severity with file references. Do not report
formatting that lint already enforces unless it causes a behavioral risk.
