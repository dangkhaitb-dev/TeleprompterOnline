# Frontend quality

## Direction

- Choose a specific visual direction before implementation; avoid the vague
  default "clean minimal".
- Keep the existing system font stack unless the user explicitly requests a
  font change.
- Use the token palette in `src/styles/tokens.css`.
- Build hierarchy with deliberate scale, rhythm, layering, and semantic color.
- Avoid uniform card grids, stock centered heroes, decorative gradient blobs,
  unmodified component-library defaults, and dashboard-by-numbers layouts.
- Design hover, focus, active, loading, empty, and error states intentionally.

## Responsive behavior

- Work mobile-first with `min-width` media queries.
- Verify 320px, 390px, 768px, 1024px, and 1440px widths.
- Prevent horizontal overflow from media, grids, tables, controls, and long
  strings.
- Preserve reading order: heading, primary product visual, support copy, then
  secondary details.
- Keep practical touch targets at least 44px and mobile form text at least
  16px.
- Prefer sequential stacking on mobile over forced equal-height cards.

## Performance

- Give images explicit dimensions.
- Use eager/high-priority loading only for hero media; lazy-load media below
  the fold.
- Prefer appropriately sized WebP or AVIF assets with a fallback when needed.
- Avoid layout shifts and accidental render-blocking resources.
- Animate compositor-friendly properties; use `will-change` narrowly.
- Prefer CSS for simple transitions and IntersectionObserver for visibility
  work.

Targets are diagnostic goals rather than reasons to make speculative changes:
LCP under 2.5s, INP under 200ms, CLS under 0.1.

## Accessibility and visual verification

- Use semantic HTML before ARIA.
- Preserve keyboard navigation and visible focus.
- Check text contrast and reduced-motion behavior where motion is added.
- Inspect the full affected page, not only the edited section, at phone, tablet,
  and desktop sizes.
