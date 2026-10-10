# Uni Era mobile app

The student app (Expo, Android and iOS) and the Supabase backend. The admin dashboard lives in a separate repo, `uni-app-admin-web`, and connects to the same Supabase project.

- Build plan: https://claude.ai/artifact/8SXMCpNDCpRvGRLDA5y3D8#ba48b1a8-9d3e.m42j0byq35d.58457
- Task list: `Gansiya-MVP-Build-Tasks.pdf` (task IDs such as `B2` are used in branch names)
- Current scope (tabs, grouping, Shop, what is built): [docs/scope.md](docs/scope.md)

## What's in here

```
src/app/            screens (Expo Router: every file is a route)
src/components/     shared UI
supabase/
  config.toml       local Supabase settings (auth, ports)
  migrations/       every database change, as SQL, in order
  seed.sql          test institutions and users for local development
  functions/        Edge Functions (server code that holds secrets)
```

**This repo owns the database.** All migrations live here. The admin repo never creates or edits tables.

## One-time setup

1. Install:
   - Node 24 (see `.nvmrc`)
   - pnpm: run `corepack enable`
   - Docker Desktop (must be running for local Supabase)
   - Supabase CLI
   - EAS CLI: `npm i -g eas-cli`
   - On your phone: the Expo Go app, or use an Android emulator
2. Clone and install:
   ```
   git clone https://github.com/Byte-me-Kavi/Uni-app.git uni-app
   cd uni-app
   pnpm install
   ```
3. Start the local backend (Docker must be running):
   ```
   supabase start
   ```
   It prints a local API URL and a publishable key.
4. Create your env file:
   ```
   cp .env.example .env.local
   ```
   Paste the local URL and publishable key from step 3. Never commit `.env.local`.
5. Run the app:
   ```
   pnpm start
   ```
   Scan the QR code with Expo Go, or press `a` for the Android emulator.

## Daily commands

| Command | What it does |
| --- | --- |
| `supabase start` / `supabase stop` | Start or stop the local backend |
| `supabase db reset` | Rebuild the local database from all migrations + seed |
| `supabase migration new <name>` | Create a new migration file |
| `supabase gen types typescript --local > src/types/database.ts` | Regenerate database types |
| `pnpm start` | Start the app |
| `npx expo install <package>` | Add a package (always use this, not `pnpm add`) |
| `npx tsc --noEmit` | Typecheck |

Local sign-in emails never leave your machine. Open the local inbox at http://127.0.0.1:54324 to read the 6-digit codes.

## How sign-in works

1. A student signs up with their university email, a password and their full name.
2. The `before_user_created` hook ([auth_hooks migration](supabase/migrations/20261009144606_auth_hooks.sql)) rejects any email whose domain is not a **live** institution in `identity.institution_email_domains`.
3. Supabase emails a 6-digit code ([template](supabase/templates/confirmation.html)); entering it confirms the email.
4. The account is `pending` until a moderator or admin approves it with `api.review_account`. Pending, rejected and suspended students only see the account status screen, and RLS gives them no data.
5. The `custom_access_token` hook adds `account_status`, `institution_id` and `staff_role` to the token's `app_metadata`. The app uses these only to choose which screen to show; the database never trusts them.

**Try it locally:** sign up with any `@student.test` address (seeded as a live test university), read the code at http://127.0.0.1:54324, then make yourself an admin with the SQL at the top of [seed.sql](supabase/seed.sql). Sign up a second student and approve them from Studio's SQL editor:

```sql
-- as your admin user, or run the update + insert by hand as postgres
select api.review_account('<student user id>', 'approved');
```

**Security tests:** `supabase test db` runs [supabase/tests](supabase/tests). Every new table needs a test that a student cannot read another student's rows or another institution's.

## Staging and production settings (dashboard)

Local settings live in `supabase/config.toml`. Cloud projects need the same settings set once in the dashboard:

| Where | Setting |
| --- | --- |
| Integrations > Data API | Exposed schemas: `api` only (remove `public` and `graphql_public`) |
| Authentication > Sign In / Providers > Email | Confirm email on; minimum password length 10; letters and digits |
| Authentication > Hooks | Before User Created: `identity.before_user_created`; Customize Access Token: `identity.custom_access_token` |
| Authentication > Emails | Custom SMTP (Resend or Amazon SES), then paste `supabase/templates/confirmation.html` into "Confirm signup". Free projects can't edit templates without custom SMTP |
| Authentication > Rate limits | Keep defaults until the pilot |

Then apply migrations with `supabase db push`.

## Rules

- **Database changes are migrations only.** Never edit tables in the Supabase dashboard; clicks don't reach Git and everyone's database drifts.
- **Row-level security on every table**, with tests. No exceptions.
- **The app only holds the publishable key.** The service-role key never goes in this repo, the app or any `EXPO_PUBLIC_*` variable.
- **Branch per task:** `B2-login`, `D3-chat-screen`. Small pull requests into `main`.
- **Staging** (`Uni App` project, Singapore) gets migrations through `supabase db push`, run by the project owner until CI does it. Nobody experiments on staging.
