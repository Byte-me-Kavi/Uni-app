# Uni Era: product scope

Last updated 10 Oct 2026. This file is the current scope for the app; the original build plan (Gansiya Build Plan v2) predates the rename, the tab layout and the Shop.

## What Uni Era is

One app that connects university students across every university in Sri Lanka. Students are verified by university email and approved by a moderator. Batches are one way students are grouped, not the whole app: a student also belongs to course groups, their faculty and university, and nationwide groups by subject or interest.

## Navigation

| Tab | Holds | Status |
| --- | --- | --- |
| Home | Greeting, set-up steps, feed, staff approval count | Built (feed empty until content features land) |
| Chats | Batch group, national programme group, direct messages with requests | Built (course groups and own groups next) |
| Resources | Notes and past papers, search across universities, kuppi sessions | Opens soon |
| Events | University and inter-university events, RSVP, calendar | Opens soon |
| Shop | Batch and society merch, second-hand items from students | Opens soon |

The account screen opens from the avatar in the top bar. Kuppi lives inside Resources (it is part of studying, not a separate destination).

## Finding students

A search box in the top bar finds students by name at every university, as they type. Batchmates come first, then the student's own university, then everyone else. Results show name, university and batch, never email. Tapping a result opens the student's card.

- Matches the start of any name word, in any order ("kav", "munasinghe kav", "kavisha mun" skipping a middle name), any case or punctuation, and Sinhala and Tamil script.
- Corrects a misspelling ("kvaisha") when nothing matches as typed, and says so.
- Each student chooses who can find them: every university (default), their university, or no one. Blocked students never see each other. Pending and suspended accounts are never listed.
- Built for 500,000 students: every search is a short index range scan, measured at 1 to 3 ms on the server with 500,000 names (details in the people_search migration). At most 8 results and 120 searches a minute per student, so the directory cannot be scraped.

## How students are grouped

| Group | Who is in it | How they get there |
| --- | --- | --- |
| Batch | Same university, degree programme and intake year. Named with all three, e.g. "UCSC · BSc in Computer Science · 2023", so the same programme at two universities never looks like one group | Suggested from the student email (e.g. `2023cs115` gives code "cs", 2023 intake) and confirmed with one tap; otherwise the student types the programme and picks from matching batches at their university. Joining adds them to the batch group chat. |
| Course groups | Students taking the same module | Added when a student adds the module (opens soon) |
| Faculty and university | Everyone at that faculty or university | From the verified email and batch |
| National groups | Anyone, by subject or interest | The national subject index links the same subject across universities |

Programme names are built by students, not entered by admins. Spellings are merged automatically when they differ only in punctuation or spacing ("BSc" and "B.Sc."); moderators can rename or merge the rest. A student joins one batch; changing it goes through a moderator. A batch chosen against what the email suggests is flagged for moderators.

## Chats

- **Default groups.** Joining a batch adds you to its group ("UCSC · Computer Science · 2023") and to a national group for your degree ("Computer Science"), shared by students from every university. Programmes are matched to a national field automatically; the Uni Era team can merge fields that are the same degree.
- **Direct messages.** From any student's card. "Who can message me" applies. Students at your university go straight to Chats; students from other universities land in Requests and can send one message until you accept (or ignore, or block). Opening a request never sends a read receipt.
- **Delivery.** A message is saved, then broadcast from the database (Supabase Realtime Broadcast), so nothing unsaved or blocked is ever delivered. Measured from Sri Lanka to the Singapore project: saved in about 80 ms, on the other phone in about 60 ms.
- **On the phone.** Chats and messages are kept in SQLite (like WhatsApp), so chats open instantly and offline. Messages wait in an outbox until sent; retries never duplicate (ids are made on the phone).
- **Photos, documents, polls, stickers and contacts.** Photos are resized on the phone (1600 px JPEG, location data removed) and carry a tiny preview that shows blurred while they load. Documents: PDF, Word, PowerPoint, Excel, text and zip, up to 25 MB, opened in the phone's own viewer and kept on the phone after the first open. Both upload straight to Cloudflare R2 from the outbox with progress, so they survive a lost connection. Every upload is recorded per chat, ready to become a group's shared files and module resources. Polls take one or several answers, update live and can be voted again or taken back. Stickers: a built-in pack of 36 (Microsoft Fluent Emoji 3D, MIT), bundled with the app. Contacts: share a student (opens their card, one tap to message) or a phone contact (call, save).
- **Notifications.** Push notifications when the app is closed (Expo push service, FCM on Android, APNs on iPhone). Direct messages notify every time; groups once, then again after reading or 15 minutes. Muted chats, blocked students and your own messages never notify. The open chat stays quiet. Lock-screen text can be hidden. Asked for on the Chats tab, not at launch.
- **Keeping Realtime usage low (free tier).** Direct messages arrive on each student's own channel; a group is followed live only while it is open; typing is in direct chats only; the connection closes 30 seconds after the app goes to the background.
- **Next.** Push notifications (need a development build), photos in chats, replies and reactions, report a message, course groups.

## Shop (new)

A place to buy and sell what students actually need.

| Feature | What it does | Phase |
| --- | --- | --- |
| Batch and society merch | Batch T-shirts, hoodies and society items listed by the Uni Era team, batch reps and verified societies | Launch |
| Student listings | Second-hand calculators, lab coats, drafters and books, listed by students | Grow |
| In-app payments | Pay through a local gateway such as PayHere, for merch first | Grow |

Safety rules, built in from the first version:

- Sellers are verified students, batch reps, societies or the Uni Era team.
- Meet on campus and pay when you collect; the app warns against paying in advance.
- One-tap report on every listing; a listing with several reports is hidden until a moderator reviews it.
- Not allowed: exam papers or answers, assignments for sale, alcohol, tobacco, weapons, medicines, counterfeit goods.
- Listings expire after 30 days unless renewed.

## Built so far

| Area | Built |
| --- | --- |
| Accounts | University-email sign-up with 6-digit code (no name needed), password sign-in, admin approval, account status screen, name chosen on first launch after approval (once; later changes through a moderator), account screen with sign-out |
| Batches | Email suggestion, typed programmes with matching, intake year, one-batch rule, batch group chat created on join and named with the university ("UCSC · BSc in Computer Science · 2023"; chat screens open soon) |
| Home | Greeting, brand card, set-up steps, staff approval count, empty feed |
| Profile and settings | Profile photo (choose or take, cropped and shrunk on the phone, stored in Cloudflare R2 through a signing Edge Function), about-you line, who can find me, who can message me, block and unblock, blocked list |
| Chats | Batch and national programme groups, direct messages, requests, live delivery, phone storage with outbox, typing (direct), read receipts (direct), unread badges, app icon badge, photos, documents, polls, stickers, shared contacts, group details with members and mute, push notifications (Android; iPhone needs the Apple Developer Program) |
| Search | Name search across universities in the top bar, student cards, "who can find you" setting, typo correction, rate limit |
| Brand | Uni Era mark, lockup, app icons, light and dark themes |
| Security | Row-level security on every table, database tests (accounts, batches, search, profiles, names, chats, push, read receipts, members and rich messages), audit log |
