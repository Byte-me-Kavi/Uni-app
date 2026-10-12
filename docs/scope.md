# Uni Era: product scope

Last updated 12 Oct 2026. This file is the current scope for the app; the original build plan (Gansiya Build Plan v2) predates the rename, the tab layout and the Shop.

## What Uni Era is

One app that connects university students across every university in Sri Lanka. Students are verified by university email and approved by a moderator. Batches are one way students are grouped, not the whole app: a student also belongs to course groups, their faculty and university, and nationwide groups by subject or interest.

## Navigation

| Tab | Holds | Status |
| --- | --- | --- |
| Home | Greeting, set-up steps, feed, staff approval count | Built (feed empty until content features land) |
| Chats | Batch group, national programme group, direct messages with requests | Built (course groups and own groups next) |
| Resources | Your modules by semester, files and links from your chats sorted into module folders, shared notes and past papers, kuppi sessions | Built: modules, library, kuppi, Explore (shared files), file checks |
| Events | University and inter-university events, RSVP, calendar | Opens soon |
| Shop | Merch, second-hand items from students, at your university and others | Built: merch with pre-orders, student listings, other universities, notifications |

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
| Course groups | Students of the same intake year taking the same module | From the batch's semester list (see Resources) |
| Faculty and university | Everyone at that faculty or university | From the verified email and batch |
| National groups | Anyone, by subject or interest | The national subject index links the same subject across universities |

Programme names are built by students, not entered by admins. Spellings are merged automatically when they differ only in punctuation or spacing ("BSc" and "B.Sc."); moderators can rename or merge the rest. A student joins one batch; changing it goes through a moderator. A batch chosen against what the email suggests is flagged for moderators.

## Chats

- **Default groups.** Joining a batch adds you to its group ("UCSC · Computer Science · 2023") and to a national group for your degree ("Computer Science"), shared by students from every university. Programmes are matched to a national field automatically; the Uni Era team can merge fields that are the same degree.
- **Direct messages.** From any student's card. "Who can message me" applies. Students at your university go straight to Chats; students from other universities land in Requests and can send one message until you accept (or ignore, or block). Opening a request never sends a read receipt.
- **Delivery.** A message is saved, then broadcast from the database (Supabase Realtime Broadcast), so nothing unsaved or blocked is ever delivered. Measured from Sri Lanka to the Singapore project: saved in about 80 ms, on the other phone in about 60 ms.
- **On the phone.** Chats and messages are kept in SQLite (like WhatsApp), so chats open instantly and offline. Messages wait in an outbox until sent; retries never duplicate (ids are made on the phone).
- **Photos, documents, polls, stickers and contacts.** Photos are resized on the phone (1600 px JPEG, location data removed) and carry a tiny preview that shows blurred while they load. Documents: PDF, Word, PowerPoint, Excel, text and zip, up to 25 MB, opened in the phone's own viewer and kept on the phone after the first open. Both upload straight to Cloudflare R2 from the outbox with progress, so they survive a lost connection. Every upload is recorded per chat, ready to become a group's shared files and module resources. Polls take one or several answers, update live and can be voted again or taken back. Stickers: a built-in pack of 36 (Microsoft Fluent Emoji 3D, MIT), bundled with the app. Contacts: share a student (opens their card, one tap to message) or a phone contact (call, save).
- **Like WhatsApp.** Long-press a message for quick reactions (or any emoji), Reply, Copy, Forward (up to 5 chats, files are not uploaded again), Star, Pin, Edit (15 minutes) and Delete (for me, or for everyone within 2 days). Swipe right to reply. Ticks: ✓ sent, grey ✓✓ delivered, red ✓✓ read (direct chats). An "unread messages" divider, a ↓ button counting new messages, large emoji when a message is only emoji, @mentions in groups (they notify even when muted), link previews made on the sender's phone, search within a chat (on the phone, works offline), Starred messages, a pinned message per chat, voice notes (hold to record, slide to cancel, 1x/1.5x/2x), several photos at once, last seen and online (mutual, direct chats only), and Reply / Mark as read buttons on notifications.
- **Stickers.** Recent, Favourites, My stickers and the built-in pack. On Android, Uni Era reads WhatsApp's own sticker folder after one tap of permission and keeps importing new ones automatically; iPhone users make stickers from photos. Stickers are 512 px WebP like WhatsApp's, stored once per unique sticker.
- **Private files.** Chat photos, documents and voice notes are in a private R2 bucket, read through 6-hour signed links given only to members of chats that have the file (forwarding grants the new chat access). Each chat's files are listed under Photos, documents and voice notes.
- **Notifications.** Push notifications when the app is closed (Expo push service, FCM on Android, APNs on iPhone). Direct messages notify every time; groups once, then again after reading or 15 minutes. Muted chats, blocked students and your own messages never notify. The open chat stays quiet. Lock-screen text can be hidden. Asked for on the Chats tab, not at launch.
- **Keeping Realtime usage low (free tier).** Direct messages arrive on each student's own channel; a group is followed live only while it is open; typing is in direct chats only; the connection closes 30 seconds after the app goes to the background.
- **Report.** Long-press any message from someone else, or use the chat menu (a student or a group), or a student's card. Categories come from the safety plan (ragging and threats first). The report keeps a copy of the message and five messages either side, so deleting it afterwards does not remove the evidence; it goes to the moderators of the sender's university; the reported student is never told who reported them. You can block in the same step.
- **Batch reps.** Batch and national groups have up to 5 reps. Reps are appointed by the Uni Era team (a university's moderators for its batches, national admins for national groups), never by students themselves, and every change is in the audit log. Reps can make a group announcement-only ("Only reps can send"), switch on slow mode (10 seconds to 1 hour between messages; reps are exempt) and pin messages. The server enforces all of it.
- **Your own groups.** Project groups, lab groups, study circles: up to 100 members. The creator is admin and can rename the group, add and remove people, make others admins, and use the same announcement and slow mode switches. Adding someone follows their "who can message me" setting and blocks; students at another university can be added only after an accepted direct chat. If the last admin leaves, the longest-standing member becomes admin.
- **The chat list.** Pin up to 3 chats to the top, archive chats (they stay archived when new messages arrive and do not count in the tab badge), and search chat names and every message on the phone.
- **Quiet hours.** No notifications between two times you choose (Sri Lanka time), mentions included; messages still arrive.
- **Next.** Kuppi chats (with kuppi), the rep request and endorsement flow, and the moderation panel where reports are handled.

## Resources

Everything for studying, organised by module. One module is one place: its files, its shared material, its kuppi and its course chat.

### Modules: one list per batch, built once, reused every year

Nobody adds modules one by one, and nobody imports catalogues.

- **Degrees are 4 years of 2 semesters** (Year 1 · Semester 1 to Year 4 · Semester 2), enforced by the database.
- **A batch keeps one short list per semester** (Year 2 · Semester 1). Core modules apply to everyone; each student ticks the electives they take, can mark a core module as not taken, and can mark an earlier module as repeated.
- **Most of the list is suggested.** The nearest other batch of the same programme that already listed that semester (usually the senior batch) is offered as a checklist, so each programme's curriculum is typed once and reused for every later intake. Next: module codes seen in files shared in the batch's chats.
- **Reps confirm in one step**; moderators can too. Any batchmate can add a module: it shows for them straight away and joins the batch's list once enough batchmates add it (half the batch, at most 3). Students cannot remove what is on the list.
- **No duplicates.** A module is its university plus its code, normalised ("CS 2012", "cs-2012" and "CS2012" are one module), enforced by a unique key. The name is only a label: renaming (reps and moderators, audited) changes the same row. Codes replaced in a curriculum revision, or duplicates that slip through, are merged by moderators; lists, choices and course chats follow the merge. Each batch owns its lists, so a rep's edit never changes another batch.
- **The current semester comes first.** Each batch stores its semester, set by a rep or, once the batch has one, moved to the next by batchmates' votes (calendars slip, so it is not computed from dates). About five months in, the app asks whether the semester has ended. The Resources tab shows the current semester's modules; earlier ones fold away.
- **Course chats**: one per module per intake year (every programme at the university taking it that year). Students join while the module is current for them; when the batch moves on the chat is archived for them, still readable.

### Library: files and links from chats, filed automatically

When a document or link is sent, the server records it once with a guessed module and category; nothing is copied or uploaded again. Each student's library is a view over their own chats plus their own changes, private to them.

| Shared in | Documents | Study links (YouTube, Drive, Docs, OneDrive, GitHub, .ac.lk, LMS) | Photos |
| --- | --- | --- | --- |
| Course chat, kuppi chat | Auto, into that module | Auto | Auto |
| Batch group, own groups | Auto | Auto | One tap |
| Direct messages | Auto | One tap | One tap |

- Folder, strongest first: the student's own move; the sender's or a rep's tag ("File it for everyone in this chat" when saving); the chat's module; module codes in the file name, caption or link matched against the student's own modules; otherwise **To sort** (the last 60 days, with the likeliest module marked).
- Categories, guessed from the name and type: Lecture slides, Notes, Past papers (with year), Tutorials and labs, Assignments, Videos, Links, Photos, Other files.
- Every item opens in place (documents in the phone's viewer, photos in the app, links in the browser) and links back to its message (Show in chat). Move or change folder, pin, remove from my library. Long-press any document, photo or link in a chat for **Save to Resources**.
- Acting on an item saves it: it stays (and still opens) after the student leaves the chat. The same file forwarded to several chats shows once.
- Deleting a message for everyone removes it from every library, saved or not: the sender asked for it to be gone. Delete for me, and blocking a student, remove it from that student's library only.
- Built for scale: each item is recorded once when it is sent, never copied per member; a folder reads only that module's candidates. In chats, each filed document, photo and link shows a small folder tag (tap to change it); when sending a document the composer offers the student's modules, with the one named in the file chosen already, and files it for everyone. The library can be searched by name or module code.

### Shared library (Explore)

Past papers and notes published to a module for the whole university. Students publish their own files (from the library's menu, or uploaded from the phone); batch reps may also publish files posted in their batch group. Files are copied inside R2 to their own key (deleting the chat message never breaks them), stay pending until checked, then go live or are quarantined with a reason the uploader sees. Explore: search by name or module code, the student's modules with file counts, their own files waiting, and the latest shares; each module has a Shared tab by kind. Report on every file (copyright included); uploaders and moderators can take files down; moderators can stop a student publishing (upload bans). Up to 20 a day; PDF, Word, PowerPoint and photos. Still to do: the public copyright takedown form on the website.

### Kuppi

Inside Resources (going and hosting, for your modules, more at your university) and on each module's Kuppi tab. Hosting takes under a minute: module, topic, day and time chips, length, Zoom / Meet / Teams link (only those services, checked) or a venue, capacity. RSVP is enforced on the server with a lock, so the last seat cannot be taken twice. The meeting link is never readable directly: the host always sees it, RSVP'd students from 15 minutes before the start, with a countdown and then Join, which opens the meeting app. The kuppi chat holds the host and everyone going, and its files file themselves into the module. Hosts and moderators cancel; anyone can report. Still to do: reminders an hour before, adding to the phone calendar (needs expo-calendar), slides and recordings afterwards, ratings.

### Exam season

- **Exam dates.** A rep sets each module's exams once for the batch (final, mid, quiz, practical, assignment due; in a batch with no reps, any batchmate; audited, and the batch sees who set it). Resources and Home count down ("CS2012 · Final exam in 12 days"); in exam season module tiles sort by the nearest exam, and a module's banner jumps to its past papers (shared, and the student's own).
- **Offline packs.** "Download for offline" keeps every file of a module (the student's library and what the university shared) in the phone's documents folder, which the phone never clears. On Wi-Fi only unless the student confirms (expo-network; older builds ask first). Opening a file uses the offline copy first.
- **Search inside files.** After a file passes its check, its text (PDF through pdf.js, first 80 pages; Word, PowerPoint, Excel, text) is stored once per fingerprint. Library and Explore search match it and show the matching line.

### Kuppi requests

"I need help with AVL trees": students ask for a kuppi on a topic; batchmates vote; a similar open request gets the vote instead of a duplicate. Anonymous to other students (moderators can see who asked). Hosting a kuppi for a request closes it and shows the askers the kuppi. Report on every request.

**Across universities.** The asker chooses who sees a request: "All universities" (the default) or "My university". Asked of all universities, it reaches every student taking the same national subject: they see where it was asked (never who), vote ("Wanted at 3 universities"), and similar asks anywhere merge into it. A student elsewhere answers with an **online kuppi open to all universities** (in person is refused: nobody travels to another campus for a session arranged with strangers). Any online kuppi can also be opened to all universities by its host. Kuppi open to all show on the same subject's module at every university, with the host's university; their chat's slides file into each student's own module on the subject. Reports go to the moderators of the university where the request or kuppi was made.

### Duplicates, national subjects, discussions

- **Duplicates.** Every checked file is fingerprinted (SHA-256): the same PDF posted by five people shows once in a library, and a file already shared at the university is refused ("Already shared as ... in CS2012").
- **National subject index.** Each module links to a national subject, matched from its name ("Data Structures and Algorithms II" joins "Data Structures and Algorithms"); reps and moderators correct it, national admins merge subjects. Files are shared with the uploader's university by default; only files shared with "All universities" reach students elsewhere taking the same subject (a module's Shared tab: Your university / Other universities).
- **Discussions.** A thread on every shared file, by question for past papers ("Q3(b)"): answers, replies, helpful votes (best first), names shown, blocked students hidden, report and delete.

### Finding your way around

- **Names first.** Students know modules by name, not code: tiles, pickers, chat folder tags and kuppi show the name, with the code small.
- **A colour per module.** Eight muted colours (teal, green, amber, clay, rose, violet, indigo, slate), each with a light and a dark version (text on the tint at least 5:1). This semester's modules get different colours by default; a student picks their own from the module page (kept on the server, only for them). Used on tiles, the module page header, module pickers, chat folder tags, kuppi date blocks and list dots. The blue accent stays for buttons and selection, red for errors.
- **One search** above the Resources sections: modules (name or code), your files (including text inside), files shared at your university, kuppi and kuppi requests, grouped by kind.
- **On this phone** badge on modules downloaded for offline.
- **Getting started** card while the library is empty: add this semester's modules, open the batch chat, exam dates (reps add them; others ask in the batch chat). Ticks itself off, goes when done or hidden.
- **Appearance** (Profile → Display): match the phone, light or dark. Kept on the phone, survives sign-out.

### File safety

| Layer | What | When |
| --- | --- | --- |
| Phone | Allowed types only, 25 MB, macro files refused | Built |
| File checks (`files` Edge Function) | Real type matches the name; Office files with macros, ActiveX, embedded programs or remote templates refused; old .doc/.ppt/.xls with macros refused; PDFs with JavaScript, launch actions, embedded files, Flash or XFA refused (also inside compressed object streams, hex-escaped names decoded); archives with programs refused. Chat documents and photos are checked after sending (a blocked file can no longer be opened, leaves every library and says why in the chat); shared files before they go live | Built |
| People | Moderators, reports, take-downs and upload bans | Built (the moderation panel lives in the admin repo) |
| **ClamAV virus scan** | **Known-malware scan on Cloud Run (slim `clamav:stable_base` image, signatures kept in R2, so $0 at pilot volume). Needs a Google Cloud billing account with a card** | **Before regional launch: must be built** |

> **Before regional launch: build the ClamAV scanner.** The pilot runs on the first three layers only, because the Google Cloud account needs a card. Do not open regional launch until files published to the Shared library are scanned by ClamAV.

## Shop (new)

A place to buy and sell what students actually need.

| Feature | What it does | Phase |
| --- | --- | --- |
| Merch with pre-orders | Batch reps publish T-shirts and hoodies (photos, sizes, size chart, price, last day to order, for their batch, their university or every university, bank details or pay on collection, where to collect). Students pre-order: how many of each size, phone number, a note (name on the back, where to deliver) and a photo of their payment slip. Every rep of the batch sees the orders with each buyer's name, batch, email and phone, checks the slips (Confirm, or Reject with a reason the buyer sees), marks orders collected, sees totals per size for the supplier and shares the list as a CSV. Replaces the Google Form and slip upload | Built |
| Student listings | Calculators, laptops, phones, books, lab coats and tools, listed by any student for their university or every university, with condition and an optional phone number. Buyers tap I'm interested (the seller is told and sees who), message the seller or call, and meet in person; nothing is paid through the app | Built |
| Other universities | The Shop tab has Your uni and Other unis; other universities show only what was opened to every university, with the university's name | Built |
| Notifications | Reps and merch leads: new orders and fixed slips (one per listing every 10 minutes, with how many wait). Buyers: payment confirmed or needs a fix. Batch: new merch from its reps. Everyone who can see a new listing open to the university or every university: "New in the shop" (at most one every 30 minutes each). Sellers: someone is interested. Android channel "Shop", separate from chats; quiet hours and blocks apply | Built |
| Merch leads (clubs and societies) | A batch rep or moderator makes a student at their university the merch lead of a club or society. Merch leads publish merch from that club (for the university or every university) and every lead of the same club runs its orders together. The rep who chose them, a moderator or the lead can end it; audited | Built |
| Uni Era team merch | The same pre-orders for the Uni Era team | Next |
| In-app payments | Pay through a local gateway such as PayHere, for merch first | Grow |

Safety rules, built in from the first version:

- Sellers are verified students, batch reps, societies or the Uni Era team. Merch comes only from the reps of a batch (admins of its group); publishing and every change to merch and to an order's status is in the audit log.
- Payment slips are private: only the buyer and the reps running that merch can open one. A buyer's phone number and email go only to those reps.
- Meet on campus and pay when you collect; the app warns against paying in advance (merch slips go to the batch's own reps, as before).
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
| Modules | Semester lists per batch (rep confirms, batchmates vote, senior batch suggested), one module per code with merges, current semester and votes to move on, electives, not taking, repeats, course chats per module and intake year |
| Kuppi | Host (chips for day and time, checked meeting links), list, RSVP with capacity, link from 15 minutes before with Join, kuppi chat, cancel, report |
| Explore | Publish from the library or upload, file checks before going live, browse and search by module, code and kind, take down, report, upload bans |
| Exam season | Exam dates per batch with countdowns on Resources and Home, past papers first, offline packs (Wi-Fi only), search inside files |
| Shop | Merch: reps publish with sizes, size chart, closing date and bank details; pre-orders with phone, note and slip; reps confirm or reject slips, mark collected, totals per size, CSV. Student listings with category, condition, optional phone, I'm interested, Message seller, 30-day expiry and renew. Your uni and Other unis (opt-in per listing). Push notifications for orders, slip checks, new merch and interest. Search, filters, Your orders and listings, report (three students hide a listing until a moderator looks) |
| Kuppi requests | Anonymous asks with votes, similar asks merged; open until someone hosts a kuppi for them (no expiry), then they leave the list and everyone who asked or voted gets a notification that opens the kuppi; the asker can remove a request only while nobody else has voted; across universities by national subject, answered with online kuppi open to all |
| Shared files v2 | Duplicates by fingerprint, national subject index with opt-in national sharing, past-paper discussions |
| Library | Files, photos and links from chats recorded once and filed per student into module folders (chat module, sender or rep tag, module codes, own moves), categories guessed, To sort with a suggested module, folder counts on the Resources tab, open in place, Show in chat, move, pin, remove, Save to Resources from chats, saved files kept after leaving a chat |
| Search | Name search across universities in the top bar, student cards, "who can find you" setting, typo correction, rate limit |
| Brand | Uni Era mark, lockup, app icons, light and dark themes |
| Notifications | Chats (direct, groups, mentions, requests); kuppi: answered requests, new kuppi in your modules, cancelled (with the reason), starting in 15 minutes; exams: date set or moved, the evening before; shop: orders, fixed slips, cancellations (to reps), payment confirmed or needs a fix, new merch and new listings (at most one every 30 minutes), interest, hidden after reports, made a merch lead, orders close tomorrow, listing about to expire; shared files: live or not published, comments, replies; account approved, not approved or active again (students waiting can turn this on). Android channels per kind; quiet hours; tapping opens the right screen |
| Security | Row-level security on every table, database tests (accounts, batches, search, profiles, names, chats, push, read receipts, members and rich messages), audit log |
