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

## Still to do

- **Before regional launch: the ClamAV scanner** (see `clamav-before-regional-launch`). Today, files are checked by their structure (magic bytes, macros, PDF scripts), not by a virus scanner.
- **Restrict the Firebase API key** in Google Cloud Console → APIs & Services → Credentials: Android apps only, package `lk.uniera.app` with the release SHA-1, and only the Firebase APIs the app uses.
- **Supabase Auth settings** (dashboard, not visible from the CLI): turn on leaked-password protection if passwords are used, and check the email OTP expiry and the sign-up and OTP rate limits.
- **Link preview DNS rebinding:** a name can change its address between our check and the fetch. The window is small, and the preview only returns a page's title and description to the student who sent the link.
- **The phone's chat cache** (SQLite) is not encrypted. It is readable only with the unlocked phone or root access.
- **Dependency advisories** (`pnpm audit`): 4, all in build tools or the router's query-string parsing. None can be reached from outside. Update with the next Expo upgrade.
- **Leftover uploads:** photo uploads that were never committed stay in the public bucket (always `image/jpeg`). Add an R2 lifecycle rule to clear `avatars/` objects that are not in use.

## Rules for new code

- Every new `api` function: `revoke execute on function api.x(...) from public, anon;`, then grant `authenticated` (or `service_role` for server-only ones). `supabase/tests/security_test.sql` fails if one is left open.
- Never add a Realtime insert policy that lets students send on a channel the database also uses: Realtime checks once per channel, not per event.
- Every signed upload carries `If-None-Match: *`.
- Anything fetched for a user-supplied URL goes through the link-preview checks (public address after DNS, limited redirects, size and time limits).
- Only `EXPO_PUBLIC_*` values may be read in app code. Everything else stays in function secrets.
