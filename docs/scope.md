# Uni Era: product scope

Last updated 10 Oct 2026. This file is the current scope for the app; the original build plan (Gansiya Build Plan v2) predates the rename, the tab layout and the Shop.

## What Uni Era is

One app that connects university students across every university in Sri Lanka. Students are verified by university email and approved by a moderator. Batches are one way students are grouped, not the whole app: a student also belongs to course groups, their faculty and university, and nationwide groups by subject or interest.

## Navigation

| Tab | Holds | Status |
| --- | --- | --- |
| Home | Greeting, set-up steps, feed, staff approval count | Built (feed empty until content features land) |
| Chats | Direct messages with requests, batch and course groups, own groups | Opens soon |
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
| Search | Name search across universities in the top bar, student cards, "who can find you" setting, typo correction, rate limit |
| Brand | Uni Era mark, lockup, app icons, light and dark themes |
| Security | Row-level security on every table, database tests (accounts, batches and search), audit log |
