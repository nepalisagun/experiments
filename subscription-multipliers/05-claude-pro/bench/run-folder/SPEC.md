# Linkt — a professional network (LinkedIn-class clone)

Build a production-quality professional networking web app in this directory. It must run locally with `npm install && npm run dev` and pass `npm test`.

## Fixed stack (do not change)
- TypeScript everywhere, Node 26, npm workspaces monorepo: `apps/api`, `apps/web`, `packages/shared`.
- API: Fastify, SQLite via better-sqlite3 + Drizzle ORM, zod validation shared with the web app, JWT access + refresh tokens in httpOnly cookies, argon2 password hashing.
- Web: React 19 + Vite + React Router + TanStack Query, CSS modules. Responsive (mobile and desktop).
- Realtime: WebSocket (Fastify websocket plugin) for messaging, presence and notifications.
- Tests: Vitest for everything (API via Fastify inject, web via Testing Library + jsdom). Coverage via v8.
- Seed script producing 500 users, 5,000 connections, 3,000 posts, 200 companies, 400 jobs with realistic fake data (no external network calls at runtime).

## Features (each needs API, UI, validation, authorization, and tests)
1. **Accounts:** sign up, email verification (token logged to console), login, logout, refresh, password reset, account deletion with data export (JSON).
2. **Profiles:** headline, about, photo + banner upload (local disk, resized with sharp), experience, education, skills with endorsements, certifications, languages, custom public URL slug, profile completeness meter, "open to work" badge, who-viewed-your-profile (90-day history).
3. **Network:** connection requests (send, withdraw, accept, ignore), follow without connecting, 1st/2nd/3rd-degree computation, "People you may know" ranked by mutual connections + shared companies/schools, mutual-connections list, block and report.
4. **Feed:** text posts with rich formatting (bold, italics, links, @mentions, #hashtags), image posts (up to 9 images), polls, article posts (long form with headings, edit history), reshares with commentary, reactions (like, celebrate, support, love, insightful, funny), threaded comments with replies and reactions, edit/delete, ranked feed (recency × engagement × connection degree × hashtag follows, documented formula), infinite scroll with cursor pagination, hide/unfollow/report from the feed.
5. **Messaging:** 1:1 and group conversations, realtime delivery, typing indicators, read receipts, attachments, message search, unread counts, mute and archive.
6. **Notifications:** in-app realtime notifications for every social event, grouped ("Anna and 12 others reacted"), mark-read, per-type preferences.
7. **Companies:** company pages, admins, followers, company posts, employees list derived from experience entries.
8. **Jobs:** post a job (company admins), search with filters (title, location, remote, seniority, salary range, date), saved jobs, Easy Apply with resume upload, applicant tracking for the poster (stages: applied, screening, interview, offer, rejected), job alerts.
9. **Search:** global typeahead + full results across people, companies, posts, jobs using SQLite FTS5, with filters and highlighting.
10. **Groups:** create, join (open/request), group feed, moderators, rules.
11. **Admin & trust:** admin dashboard (user/post/report counts, charts), moderation queue for reports, rate limiting per endpoint, audit log.
12. **Analytics for users:** post impressions, profile views, search appearances; 30-day charts.

## Quality bar
- Every endpoint authorizes correctly (users cannot read or change others' private data) — test each.
- Accessibility: keyboard navigation and labelled controls; no console errors.
- `npm test` passes with ≥ 90% line coverage across `apps/*` and `packages/*`.
- `npm run lint` (ESLint, strict TypeScript) and `npm run typecheck` pass with zero errors.
- `REPORT.md` lists every numbered feature and its sub-items with status and the tests that prove it.
