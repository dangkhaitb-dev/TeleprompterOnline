# Security review

Use this checklist for authentication, authorization, user-controlled input,
storage, filesystem access, external APIs, cryptography, payments, or sensitive
data.

## Boundaries

- Reject hardcoded credentials, API keys, tokens, and passwords.
- Validate input and external API data at the boundary.
- Keep authorization checks separate from UI visibility.
- Avoid exposing sensitive details through errors, logs, analytics, or hook
  output.
- Use parameterized queries for any database access.
- Keep secrets in environment variables or an approved secret manager and
  validate required secrets at startup.

## Browser security

- Never inject unsanitized user HTML.
- Prefer text APIs over `innerHTML`; if HTML is required, use the project's
  vetted sanitizer.
- Escape dynamic Nunjucks values appropriately.
- For production delivery, verify CSP and security headers against the actual
  hosting model rather than pasting a generic policy.
- Use CSRF protection and rate limiting on server-side state-changing forms or
  endpoints.
- Audit new third-party scripts, load them asynchronously, and prefer
  self-hosting for critical dependencies.

## Response

If an exposed secret or critical vulnerability is found:

1. Stop expanding the change.
2. Record concrete evidence without repeating the secret.
3. Recommend or perform rotation only with the required authority.
4. Search the in-scope code for the same pattern.
5. Do not mark the task complete while a critical issue introduced by the
   current change remains.
