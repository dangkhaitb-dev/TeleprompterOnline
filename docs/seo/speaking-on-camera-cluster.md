# Speaking on Camera SEO cluster

Last reviewed: 2026-08-08

## Objective

Build a method-neutral content cluster for people who need to communicate on
video, then route readers to the existing teleprompter guides only when a
script, notes, eye-line aid, or recording workflow solves a real constraint.

The cluster should own the broader topic of speaking on camera without
competing with the existing articles about teleprompter setup, script writing,
scrolling, or natural teleprompter delivery.

## Research basis and limitation

Priorities are directional rather than volume estimates. No Ahrefs, Semrush,
Google Keyword Planner, or Search Console data was available during planning.
The map is based on current SERP intent, near-exact query coverage, product
relevance, the ability to provide a distinct useful answer, and
cannibalization risk within the existing SolPrompter corpus.

Search results commonly mix broad listicles, coaching pages, university
recording guidance, and teleprompter product content. SolPrompter's opportunity
is a practical record-review-adjust system with separate diagnostic guides for
confidence, visual delivery, vocal delivery, gaze, and pre-recorded
presentations.

## Keyword and URL map

| Priority | URL | Primary keyword | Intent | Scope boundary |
| --- | --- | --- | --- | --- |
| 1 | `/blog/speaking-on-camera/` | speaking on camera | Broad informational hub | Summarize and route; do not duplicate child guides |
| 2 | `/blog/how-to-speak-confidently-on-camera/` | how to speak confidently on camera | Build comfort and recover from freezing | Practice ladder and observable review; no medical claims |
| 3 | `/blog/where-to-look-when-speaking-on-camera/` | where to look when speaking on camera | Choose lens, screen, interviewer, notes, or script | Gaze by format; teleprompter mechanics remain in existing guides |
| 4 | `/blog/how-to-look-natural-on-camera/` | how to look natural on camera | Improve visual delivery | Frame, posture, gestures, expression, and movement only |
| 5 | `/blog/how-to-sound-natural-on-camera/` | how to sound natural on camera | Improve vocal delivery | Conversational phrasing, pace, pauses, emphasis, and breath only |
| 6 | `/blog/how-to-pre-record-a-presentation/` | how to pre-record a presentation | Complete a recorded presentation workflow | Speaking-first workflow; not PowerPoint or screen-capture instructions |

The five supporting articles use the `Speaking on Camera` category. The pillar
uses `Guides` so its visible and structured breadcrumbs do not link back to the
same page. Its `speaking-on-camera` slug still matches the supporting category's
derived slug, so the existing global Eleventy `hasHub` check makes the pillar
the category destination instead of generating a competing category archive.

## Internal-link architecture

- The pillar links to all five supporting articles and to the existing
  decision, setup, script, and natural-reading guides where relevant.
- Every supporting article links back to the pillar near the beginning.
- Confidence links to visual delivery, vocal delivery, and the existing
  teleprompter-versus-bullet-points decision guide.
- Visual delivery links to confidence and gaze, while leaving voice mechanics
  to the vocal-delivery article.
- Vocal delivery links to confidence and the existing script-writing,
  teleprompter-reading, and scrolling guides.
- Gaze links to visual delivery and the existing setup and natural-reading
  guides.
- Pre-recorded presentations link to confidence, gaze, vocal delivery, script
  writing, and delivery-method selection.
- Product instructions link to `/teleprompter-guide`; neutral conversion links
  use `/` with anchors such as `Open SolPrompter`.

Backfill one contextual link from the established `/blog/teleprompter-guides/`
hub to the new cluster. Do not rewrite every existing article merely to add the
new generic keyword.

## Editorial requirements

- One primary intent per URL and no keyword stuffing.
- Answer-first introductions, descriptive H2/H3 hierarchy, and one table of
  contents per long-form article.
- Practical tests, decision rules, and checklists rather than generic tip
  collections.
- Cite sources next to the claims they support and repeat them in a References
  section.
- Distinguish research context from inference. In particular, Stanford gaze
  research concerns videoconferencing and should not be generalized to every
  video format.
- Confidence content must not promise to treat anxiety. Readers whose distress
  is persistent or disruptive should be directed toward qualified support.
- State the SolPrompter editorial conflict: SolPrompter publishes the guide and
  develops the product it references.
- Keep product claims within documented capability. SolPrompter can support
  scripts and camera/audio recording in compatible browsers; it is not a slide
  or screen-capture tool.

## Publishing order

Publish the six pages in one coordinated release after link and asset QA so no
cluster links are temporarily broken. If editorial capacity requires waves,
use:

1. Pillar, confidence, and gaze.
2. Visual and vocal delivery.
3. Pre-recorded presentation.

There is no assumption that spacing the waves improves rankings; waves exist
only to manage editorial capacity.

## Verification and measurement

Before release:

1. Parse every article JSON.
2. Run the Eleventy/Vite build.
3. Confirm one H1, canonical, title, description, and valid `BlogPosting` graph
   per page.
4. Confirm `/blog/speaking-on-camera/` is the pillar and no category archive
   competes with it.
5. Confirm every new URL occurs once in the sitemap and every internal link
   resolves.
6. Inspect the blog listing, pillar, and a supporting article at 390px and
   1440px, with additional overflow checks at the project-required widths.
7. Confirm every edited existing article has a current `modified` date and
   `review.updatedDisplay` value.

After indexing, use Search Console to review queries, impressions, clicks, and
URL overlap. If the pillar gains impressions for a child's narrow keyword,
shorten the overlapping pillar section and strengthen the descriptive link to
the child before considering another article.
