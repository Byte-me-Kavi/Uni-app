# Uni Era mobile app: rules for AI assistants

Read `AGENTS.md` for Expo conventions and `readme.md` for setup. These rules come first.

## Stack
- Expo (SDK in package.json) + Expo Router, TypeScript strict, StyleSheet with tokens from `src/theme/tokens.ts`.
- Supabase backend. This repo owns every migration; the admin web repo never changes the schema.

## Database (non-negotiable)
- Only the `api` schema is exposed. Module schemas (`identity`, `academics`, `content`, `kuppi`, `messaging`, `safety`, `ops`) are private.
- Every table has row-level security enabled, plus pgTAP tests in `supabase/tests` proving a student cannot read another student's or another institution's rows.
- App writes go through `api` functions. Do not add insert/update/delete grants or policies for the app without review.
- `security definer` functions: `set search_path = ''`, check `auth.uid()` inside, live in a private schema unless they are deliberate `api` endpoints, and are granted to specific roles only.
- Never authorise with `user_metadata` or with JWT claims; RLS reads the tables. Claims are for routing only.
- Wrap `auth.uid()` and helper calls in `(select ...)` inside policies. Index every foreign key and every column a policy reads.
- UUIDv7 (`ops.uuid_v7()`) for user-generated rows; `bigint identity` for reference data.
- Schema changes only as new migration files (`supabase migration new <name>`). Never edit an applied migration.
- Never use Postgres Changes for chat; use Realtime Broadcast.

## App
- Only the publishable key in the app. Never the service-role key, never any secret in `EXPO_PUBLIC_*`.
- Sessions are stored with the encrypted LargeSecureStore in `src/lib/supabase.ts`. Do not swap it for plain AsyncStorage.
- Brand: text on brand red is always Ink. The logo is `UniEraMark` / `Lockup` in `src/components/brand`; the tassel is the only red part (white on a red background). Fonts are embedded (expo-font plugin); use the PostScript names in `tokens.ts`: Nunito for all UI text, Figtree Black only for the "uni era" wordmark.
- Persistent chrome, changing content: anything that stays the same across a group of screens (background, header, logo, brand marks, later the tab bar) lives once in that group's `_layout.tsx` (see `AuthChrome` in `(auth)/_layout.tsx`). The screens render only the part that changes and have transparent backgrounds (`contentStyle: { backgroundColor: 'transparent' }` plus a transparent navigation theme), so transitions move only what changed. Never redraw the same logo or header inside each screen.
- Safe areas come from `Screen` in `src/components/ui/screen.tsx` (padding from `useSafeAreaInsets`): used once by a group's persistent chrome, or by a standalone screen that has no chrome. Never use `SafeAreaView`: it re-measures during navigation animations and makes screens jump.
- Light and dark mode follow the phone. Never hard-code colours in a component: use `useTheme()` or `createThemedStyles()` from `src/theme/tokens.ts`. Dark mode background is black.
- Motion uses Reanimated and the tokens in `src/theme/motion.ts`; animate only transform, opacity and colour, and keep each animation tied to something the user did.
- Performance: no new dependency without asking; lists use FlashList; paginate with cursors; no work at startup that can wait.
- Install packages with `npx expo install`. Run `npx tsc --noEmit` and `supabase test db` before calling a task done.
