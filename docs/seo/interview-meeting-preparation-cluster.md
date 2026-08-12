# Interview & Meeting Preparation SEO cluster

Last reviewed: 2026-08-12

## Objective

Build a people-first, method-neutral resource for candidates, meeting
participants, and meeting leaders. The cluster should help people prepare a
clear contribution and communicate naturally, while referring to SolPrompter
only as an optional rehearsal or recording tool.

It must not encourage reading a hidden script or using AI to answer during a
live job interview.

## Research basis and limitation

Priorities are directional rather than volume estimates. Ahrefs, Semrush,
Google Keyword Planner, and Search Console exports were not available during
planning. The map uses current SERP intent, distinct query coverage, product
relevance, ability to provide a practical answer, and cannibalization risk in
the existing SolPrompter corpus.

Career guidance consistently supports focused role research, truthful
behavioral examples, mock practice, and questions for the employer. Meeting
facilitation guidance emphasizes a stated result, item outcomes, timeboxes,
participation design, decision rules, and a visible close. Source links are
included in the relevant articles.

## Keyword and URL map

| URL | Primary keyword | Intent | Scope boundary |
| --- | --- | --- | --- |
| `/blog/interview-meeting-preparation/` | interview and meeting preparation | Broad informational pillar | Route to the relevant role and guide; do not duplicate child detail. |
| `/blog/interview-meeting-preparation/how-to-prepare-for-a-job-interview/` | how to prepare for a job interview | Complete candidate workflow | Role research, evidence, questions, practice, logistics. |
| `/blog/interview-meeting-preparation/video-interview-checklist/` | video interview checklist | Remote-specific interview setup | Technical readiness and natural delivery only. |
| `/blog/interview-meeting-preparation/star-method-behavioral-interviews/` | STAR method interview | Behavioral-answer structure | Story bank, action, result, and follow-up; no generic job-prep repetition. |
| `/blog/interview-meeting-preparation/tell-me-about-yourself-interview-answer/` | tell me about yourself interview answer | Opening interview answer | Present-past-future introduction only. |
| `/blog/interview-meeting-preparation/questions-to-ask-an-interviewer/` | questions to ask an interviewer | Candidate evaluation questions | Work, success, team, organization, and process—not a bulk list. |
| `/blog/interview-meeting-preparation/how-to-prepare-for-a-meeting/` | how to prepare for a meeting | Participant workflow | Pre-work and contribution; not agenda design. |
| `/blog/interview-meeting-preparation/how-to-lead-a-meeting/` | how to lead a meeting | Facilitation lifecycle | Purpose through follow-up; not a copyable template. |
| `/blog/interview-meeting-preparation/meeting-agenda-template/` | meeting agenda template | Ready-to-use planning format | Template fields and agenda design; no meeting-leadership duplication. |
| `/blog/interview-meeting-preparation/how-to-start-a-meeting/` | how to start a meeting | Facilitator opening | Purpose, agenda, roles, participation, and first step only. |

The pillar uses category `Guides` with `flatUrl: true`, matching the existing
`speaking-on-camera` convention. Its slug matches the supporting category slug,
so Eleventy’s `hasHub` behavior makes the pillar the category destination and
avoids a competing generated archive.

## Internal-link architecture

- The pillar links to every child guide, split into job-interview and meeting
  paths.
- Existing job-interview preparation links to the pillar, video checklist,
  STAR guide, and interview-introduction guide.
- Video interview links to the job-preparation and interview-introduction
  guides.
- STAR links to job preparation and the introduction guide.
- Questions-to-ask links to job preparation.
- Meeting participant preparation links to agenda template and meeting opener.
- Meeting leadership links to agenda template and meeting opener.
- Agenda template and meeting opener link to each other and to meeting
  leadership.

## Editorial requirements

- One primary intent per URL; no keyword stuffing or generic bulk listicles.
- Start with a two-to-four-sentence direct answer, then use descriptive H2/H3
  headings, one TOC, practical examples, and FAQs.
- Cite primary or authoritative sources beside substantive claims and repeat
  them in References.
- Use the SolPrompter editorial disclosure on every new article.
- Keep product claims within documented capability: SolPrompter can support
  rehearsal and recording in compatible browsers; it is not an interview
  answer engine, hiring platform, legal advisor, or meeting-management system.
- Add a unique hero image with accurate dimensions and descriptive alt text.
- When editing an existing article, update `modified` and
  `review.updatedDisplay` in the same change.

## Verification and measurement

Before release, build the site and confirm that each page has one H1,
canonical, metadata, `BlogPosting` graph, hero asset, sitemap entry, and
resolving internal links. Check the pillar, a long supporting article, and the
blog listing at 390px and 1440px, then add the project-required responsive
width checks if a visual component changes.

After indexing, use Search Console to review impressions, clicks, queries, and
URL overlap. If the pillar begins to surface for a child’s narrow query,
shorten the pillar’s overlapping summary and strengthen its link to the child
before creating another article.
