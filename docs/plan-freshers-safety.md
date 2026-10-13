# Plan: freshers, safety and account rights

Agreed 13 Oct 2026. Build order at the end. Decisions made with the user are marked **Decided**.

**Status (13 Oct 2026):** all eight steps built and tested on the hosted database in rolled-back dry runs (35 test files, 949 checks). Migrations pushed, `letters` and `media` deployed and types regenerated on 13 Oct 2026; the secrets below are still to set. Deviation: the data download is a JSON file made on the phone instead of a ZIP stored in R2, so no copy of anyone's data sits on a server.

## 1. Fresher accounts

- A student without a university email signs up as a fresher: personal email, password, 18+ and guidelines, 6-digit code, then uploads the UGC selection letter (photo or PDF). Nothing else is asked.
- **Decided:** the letter overrides Build Plan v2's "never ask for the selection letter" rule. It lives in its own private R2 bucket (own API key), is opened by staff only through 5-minute links (every view audited), and is **kept until the fresher verifies their university email** (or the account expires), then deleted.
- Staff approve from an in-app Approvals screen (students and freshers): choose university, degree programme and intake year; optional letter number, stored only as a keyed hash to catch reuse; identical files flagged. Reject with a reason; "unreadable" lets the student upload again.
- `profiles.account_kind` (`student`, `fresher`), `fresher_until` (120 days, staff can extend). A fresher's institution is empty until approval. The access token carries the kind.
- Upgrade: the fresher changes their login email to the university one (Supabase email change; codes to both emails). The account becomes `student` only if the domain belongs to their university; the letter is then deleted.
- After 120 days without it the app opens on "Add your university email to continue". Nothing is deleted.

## 2. Fresher limits (enforced in the database)

- Allowed: batch chat, direct messages (below), files and photos in chats, reading Resources and Explore, the feed.
- **Decided:** in the feed, freshers read and like only (no posts, no comments).
- Blocked until verified: posts and comments, Shop (buy, sell, interest), publishing to Explore, creating groups. Kuppi opens by itself once their batch has modules.
- **Decided, shielded:** only batchmates find freshers in search and message them directly; seniors reach them through Requests; their photo is hidden outside the batch; they join the batch chat only (the national group follows verification). Others see a "Fresher" label.

## 3. Fresher batches

- The fresher's batch is the real batch (university, programme, intake year), created on approval if needed; its group chat is the normal batch chat.
- `cohorts.stage`: `freshers` or `started`. While `freshers`, a verified student can join only if their email's intake year matches. A moderator marks it started and appoints reps with the existing tool.

## 4. Freshers' questions and ambassadors

- Staff appoint ambassadors (verified seniors) per university: badge, an "Answer freshers" screen, no access to member lists.
- Freshers ask from Home. Questions show as "A fresher, <programme>"; staff can see who asked. Answered questions are visible to every fresher at that university. Report and rate limits apply.

## 5. Part-time jobs (feed type `job`)

Role, pay (amount, per hour, day or month, or fixed), area or remote, hours, contact (phone or message), closing date; "Filled" by the author; 30 days in the feed; a Jobs filter; a fixed "Never pay to get a job" line; a scam report reason. Verified students only.

## 6. Reports, strikes, suspensions and appeals

- In-app Reports queue for staff, every report kind, ragging/threats/self-harm first with the 2-hour target.
- Actions: warn (a strike), mute (send, post and comment blocked for a time), suspend (time-limited or indefinite), ban; a written reason each time. Three strikes in 90 days suggests a 7-day suspension; a human confirms. Expiry by cron. Moderators cannot act on their own batch.
- The student sees "Your standing" (each action, reason, end date) and can appeal once per action; a different moderator decides. Overturning removes the action.

## 7. Delete account and export data

- Export: a ZIP built by an Edge function (profile, consents, posts, comments, listings, own messages, own reports, file list), 24-hour link from the private bucket, once a week.
- Delete: retype the email, 30 days' grace (signing in cancels), then a cron job deletes profile, photos, posts, comments, listings, letters, uploads and DMs. **Decided:** group messages stay, shown as "Deleted account". Reports against the account are kept for a year.

## 8. Consent centre

Settings, Privacy and consent: required items with version and date agreed; analytics and digest email switches, off by default; one row per change. A policy version change asks again once.

## 9. Privacy controls

Per-field visibility (photo, bio, programme and year: everyone, my university, my batch, nobody) applied in the profile card. Opt-in batch directory, asked on joining a batch with equal-weight buttons.

## 10. Ragging route and Get help

Per-university contacts (anti-ragging committee, campus security) and national ones (police, helplines, the UGC complaint portal), all kept by the Uni Era team (national admins: Profile, Help contacts); university staff do not use the app; shown after a "Ragging or threats" report and on Account, Get help (with 1333 and 119). No number is shipped until it is confirmed; a university's ragging links stay hidden until filled in.

## 11. Community guidelines

English v1 drafted from Build Plan v2's safety rules, shown in-app and linked from sign-up. Sinhala and Tamil with i18n; lawyer review before launch.

## 12. Minimum version and kill switches

The app reads `api.app_config` on start and when it returns to the foreground: below `app.min_version` it shows "Update Uni Era". Switches (`feature.posting`, `feature.shop`, `feature.uploads`, `feature.new_dms`, `feature.kuppi`, `feature.signup`, `feature.fresher_signup`) are enforced in the database and shown as "Paused for now"; an optional notice banner. National admins flip them from Profile, App switches (audited).

## Build order

1. Minimum version and kill switches
2. Approvals, fresher sign-up and letters, fresher batches, upgrade
3. Freshers' questions and ambassadors
4. Jobs
5. Reports queue, strikes and appeals
6. Ragging route and guidelines
7. Consent centre, privacy controls, batch directory
8. Delete and export

## Needed from the user

1. Done: migrations pushed, functions deployed, types regenerated.
2. Cloudflare: a private bucket for letters (for example `uni-era-private`) and an API token for that bucket only. Function secrets: `R2_LETTERS_BUCKET`, `R2_LETTERS_ACCESS_KEY_ID`, `R2_LETTERS_SECRET_ACCESS_KEY`, `LETTERS_SECRET`, `MEDIA_SECRET` (two long random values).
3. Vault: `letters_function_url` (…/functions/v1/letters), `letters_function_secret` (= `LETTERS_SECRET`), `media_function_url` (…/functions/v1/media), `media_function_secret` (= `MEDIA_SECRET`).
4. Supabase Auth: the "Change email address" template must show `{{ .Token }}` (freshers type the codes). "Secure email change" stays on: codes go to both emails.
5. Ragging contacts: add each university's anti-ragging and security numbers yourself (Profile, Admin, Help contacts). Seeded nationally: 119, 1926, 1333 and the UGC complaint portal (eugc.ugc.ac.lk/complaint-portal); confirm them before launch.
6. A lawyer reviews the community guidelines (English v1, `src/lib/guidelines.ts`) before launch.
