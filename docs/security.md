# Security review

Last full review: 12 October 2026. It covered what ships inside the app, the hosted database (live), the five Edge Functions, Realtime, file storage (R2) and the phone itself. Each attack was tried from outside with only the app's public key, the way a student poking at the app would.

## What an attacker can see

| Thing | Where | Exposed? |
| --- | --- | --- |
| Supabase URL, publishable key (`sb_publishable_…`) | inside the app | Yes, by design. They grant nothing without a signed-in student's token. |
| Photo bucket address | inside the app | Yes, by design (avatars and stickers are public). |
| R2 keys, service role key, `FILES_SECRET`, `PUSH_SECRET` | Supabase function secrets, `.env.local` | No. The built bundle was searched for every secret value: none present. `.env*` was never committed. |
| `google-services.json` (Firebase) | committed | Yes, by design for Android, but **restrict its API key** (see below). |

## Fixed in this review

1. **Fake chat events over Realtime (high).** Members of a direct chat could send on its `chat:<id>` channel to show typing, and Realtime checks that right once per channel, not per event. So one person could broadcast a fake edit, deletion, message (any sender, any link), pin or poll result to the other person's phone. Now `chat:<id>` is receive-only; typing has its own `typing:<id>` channel, and the app reads only typing from it.
2. **Files swapped after their check (medium).** Upload links lasted 10 minutes and could be used again after a file passed its check. A sticker (shared by everyone who saved it) could become an offensive image, and a clean shared PDF a malicious one. Every upload link (chat files, shared files, stickers, avatars) is now for one new file only (`If-None-Match: *`, covered by the signature), and R2 refuses a second upload. This was tested on the real bucket: second upload 412, header removed 403.
3. **Link preview could be pointed inside the network (medium).** It refused IP addresses in private ranges, but not names that point at them (`127.0.0.1.nip.io`, a name aimed at the cloud metadata address). Each name is now resolved and every address must be public, on every redirect. It also had no limit and accepted suspended accounts; now it is active accounts only, 300 previews a day.
4. **Every `api` function could be run signed out (low).** Each one checked its caller, so nothing leaked, but the surface was 120 functions. Now signed-out callers can run only `api.app_config` (minimum app version, sign-up open). This was checked live: signed-out calls get `permission denied`.
5. **Links opened without a scheme check on the phone (low).** The app now opens only `http(s)` links, as the server already required.
6. **Android backups (low).** `allowBackup` is now false, so chats cached on the phone are not copied into device backups. This takes effect with the next build.

## Checked and fine

- **Database schemas:** only the `api` schema is reachable. `identity`, `messaging` and the rest answer `Invalid schema`, and GraphQL is off.
- **Row-level security:** on for every table. There are no grants to `anon`. The "auth admin" policies apply only to the sign-up hook's role.
- **Server-only functions** (`chat_file_checked`, `finish_resource`, `needs_text`, `store_file_text`, sticker commits): service role only.
- **Function secrets:** `files` and `push` compare their shared secret in constant time. Forged or missing secrets get 401.
- **File downloads:** signed links are issued only for files the student may see (`api.media_access`).
- **Upload links:** each is pinned to one path, type and size.
- **Avatars and stickers:** checked by their bytes (JPEG, WebP with a matching SHA-256).
- **Upload types:** chat uploads accept only an allow-list of types.
- **Session tokens:** encrypted on the phone, with the key in the Android Keystore or iOS Keychain.
- **Message links:** the server accepts only `http(s)`.
- **Realtime inboxes:** nobody can listen to another student's `user:<id>` channel.

## Shop (added 12 October 2026)

- **Slips and phone numbers:** a payment slip is readable only by its buyer and the reps who manage that listing (`api.media_access`), and only while the order is live. Buyers' email and phone are returned only by `api.listing_orders`, to those reps.
- **Who manages merch:** the seller and the batch's current reps (admins of its batch group), or for club merch every merch lead of that club at the university. Only reps and moderators choose merch leads, only at their own university, up to 20 per rep; every change is audited. Moderators do not see orders; they handle reported listings in the admin repo.
- **Uploads:** shop photos, size charts and slips are JPEGs made on the phone, up to 3 MB, to `shop/<student>/<id>.jpg` in the private bucket, one new file per link. A listing or order accepts only the student's own unused uploads (tested: someone else's path is refused).
- **Limits:** 80 uploads, 10 new listings, 30 orders and 50 "I'm interested" a day per student; each student gets at most one "New in the shop" push every 30 minutes, so nobody can flood a university with notifications. Three students reporting a listing hides it.
- **Other universities:** a listing reaches other universities only when its seller chose "All universities"; blocks still apply. Only the seller sees who is interested.
- **Notifications:** sent only by the database (`shop.notify`, through the push function with its shared secret); `api.shop_push_batch` is service-role only. Text is built on the server from the listing, names and (for a rejection) the rep's reason, up to 180 characters.
- **PDF slips:** up to 5 MB, signed as `application/pdf`, then checked by the media function with the same rules as chat documents (really a PDF; no JavaScript, launch actions, embedded files, Flash or XFA, also inside object streams). An order only accepts a checked slip; a failing one is deleted.
- **Notifications** outside chats are written only by the database (`messaging.notify`, triggers and pg_cron), sent by the push function with its shared secret; `api.app_push_batch` is service-role only. Links in them are checked against a list of screens in the app before opening. Students waiting for approval may register a push token (only to hear the decision).
- **CSV export:** cells starting with `= + - @` are prefixed with `'`, so a buyer's note cannot run as a formula in the reps' spreadsheet.

## Still to do

- **Before regional launch: the ClamAV scanner** (see `clamav-before-regional-launch`). Today, files are checked by their structure (magic bytes, macros, PDF scripts), not by a virus scanner.
- **Restrict the Firebase API key** in Google Cloud Console → APIs & Services → Credentials: Android apps only, package `lk.uniera.app` with the release SHA-1, and only the Firebase APIs the app uses.
- **Supabase Auth settings** (dashboard, not visible from the CLI): turn on leaked-password protection if passwords are used, and check the email OTP expiry and the sign-up and OTP rate limits.
- **Link preview DNS rebinding:** a name can change its address between our check and the fetch. The window is small, and the preview only returns a page's title and description to the student who sent the link.
- **The phone's chat cache** (SQLite) is not encrypted. It is readable only with the unlocked phone or root access.
- **Dependency advisories** (`pnpm audit`): 4, all in build tools or the router's query-string parsing. None can be reached from outside. Update with the next Expo upgrade.
- **Leftover uploads:** photo uploads that were never committed stay in the public bucket (always `image/jpeg`). Add an R2 lifecycle rule to clear `avatars/` objects that are not in use, and a cleanup of `shop/` uploads with no listing or order (`shop.uploads`).
- **Shop photos are not checked by their bytes:** they are signed as `image/jpeg` and served only through signed links, so a non-image file just fails to show. Add the same JPEG check the avatar function does if that changes.

## Rules for new code

- Every new `api` function: `revoke execute on function api.x(...) from public, anon;`, then grant `authenticated` (or `service_role` for server-only ones). `supabase/tests/security_test.sql` fails if one is left open.
- Never add a Realtime insert policy that lets students send on a channel the database also uses: Realtime checks once per channel, not per event.
- Every signed upload carries `If-None-Match: *`.
- Anything fetched for a user-supplied URL goes through the link-preview checks (public address after DNS, limited redirects, size and time limits).
- Only `EXPO_PUBLIC_*` values may be read in app code. Everything else stays in function secrets.
