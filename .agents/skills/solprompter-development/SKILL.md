---
name: solprompter-development
description: Apply SolPrompter's repository-specific planning, architecture, implementation, frontend, testing, security, and review workflow. Use whenever Codex implements, fixes, refactors, reviews, tests, or documents code in the SolPrompter/VPromter repository; especially for changes under src/script, src/styles, or _templates.
---

# SolPrompter development

Follow `AGENTS.md` as the authoritative project contract. Use this skill to
turn that contract into an execution workflow.

## Classify the task

Before editing:

1. Inspect `git status`, the affected entry points, nearby tests, and applicable
   generated/source-file boundaries.
2. Decide whether the planning gate in `AGENTS.md` applies.
3. If it applies and the user has not already approved a concrete plan, present
   the plan and wait for approval.
4. Choose the narrowest relevant agent roles from `.codex/agents/`. Use
   parallel roles only for independent work; never assign overlapping writes.
   Spawn a named custom role with no inherited context or a bounded recent-turn
   fork, never a full-history fork.

## Execute

1. State assumptions only when they materially affect implementation.
2. Define behavior that can be verified.
3. Trace the actual import and call path before changing a layer.
4. For a feature or reproducible bug, prefer RED -> GREEN -> IMPROVE:
   establish a failing test, make the smallest implementation pass, then
   refactor only when necessary.
5. Preserve the dependency direction
   `constants -> http -> service -> model -> logic -> ui`.
6. Keep DOM access in UI files, raw HTTP calls in services, mapping in models,
   and orchestration in logic.
7. Edit Nunjucks and JSON sources, never generated root HTML.
8. Keep changes surgical and preserve unrelated user work.

## Apply conditional guidance

- For frontend or template work, read
  [references/frontend-quality.md](references/frontend-quality.md).
- For authentication, untrusted input, storage, filesystem, external API,
  crypto, payment, or sensitive-data work, read
  [references/security-review.md](references/security-review.md).
- For verification selection and the final review, read
  [references/verification.md](references/verification.md).

## Verify and hand off

1. Run the smallest relevant test or lint command while iterating.
2. Run the final verification matrix from `references/verification.md` in
   proportion to risk.
3. Inspect the final diff and confirm generated files are intentional.
4. Use `code-reviewer` after code changes. Add `security-reviewer` for the
   security triggers above.
5. Resolve verified regressions introduced by the current work. Report
   unrelated pre-existing failures without changing them.
6. Summarize the outcome, verification performed, and any remaining limitation.

## Handle failures

- When lint fails, fix errors in the edited scope before proceeding. Do not use
  `--no-verify`.
- When the build fails for a non-obvious reason, use `build-error-resolver`,
  reproduce the smallest failing command, and fix incrementally.
- When verification is blocked by environment or a pre-existing failure,
  gather evidence and report the exact command and error.
