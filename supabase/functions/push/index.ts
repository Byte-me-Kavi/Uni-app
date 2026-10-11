// Sends push notifications for a new message.
//
// Called by the database (messaging.queue_push, through pg_net) after a message is saved, never
// by the app. The call carries a shared secret instead of a user's token:
//   1. api.push_batch picks who to notify (DMs always; groups at most once until read or 15
//      minutes; never muted chats or the sender) and returns ready-made Expo push messages;
//   2. they go to Expo's push service in batches of 100, which passes them to FCM (Android) and
//      APNs (iPhone);
//   3. tokens Expo reports as DeviceNotRegistered (the app was uninstalled) are deleted.
//
// Secrets: PUSH_SECRET (the same value as the Vault secret `push_function_secret`).
// Optional: EXPO_ACCESS_TOKEN, if "enhanced push security" is turned on in the Expo project.

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo's limit per request

type PushMessage = { to: string; title: string; body: string; data: Record<string, unknown> };
type Ticket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

const env = (name: string) => Deno.env.get(name) ?? '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Compares in constant time, so the secret cannot be guessed one character at a time.
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function sendToExpo(messages: PushMessage[]): Promise<Ticket[]> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (env('EXPO_ACCESS_TOKEN')) headers.Authorization = `Bearer ${env('EXPO_ACCESS_TOKEN')}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(EXPO_SEND, { method: 'POST', headers, body: JSON.stringify(messages) });
    if (response.ok) return ((await response.json()).data ?? []) as Ticket[];
    // Expo asks for a retry on 429 and 5xx; one retry keeps a notification from being lost to a blip.
    if (attempt >= 2 || (response.status !== 429 && response.status < 500)) {
      console.error('[push] expo refused', response.status, await response.text());
      return [];
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env('PUSH_SECRET') || !sameSecret(req.headers.get('x-push-secret') ?? '', env('PUSH_SECRET'))) {
    return json({ error: 'Not allowed.' }, 401);
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.message_id !== 'string' || typeof body?.created_at !== 'string') {
    return json({ error: 'Missing message.' }, 400);
  }

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    db: { schema: 'api' },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db.rpc('push_batch', { p_message_id: body.message_id, p_created_at: body.created_at });
  if (error) {
    console.error('[push] push_batch failed', error);
    return json({ error: 'Could not prepare notifications.' }, 500);
  }
  const messages = (data ?? []) as PushMessage[];

  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH);
    const tickets = await sendToExpo(chunk);
    tickets.forEach((ticket, n) => {
      if (ticket.status === 'error') {
        if (ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[n].to);
        else console.warn('[push] not sent', ticket.message);
      }
    });
  }

  if (dead.length > 0) {
    const { error: dropError } = await db.rpc('drop_push_tokens', { p_tokens: dead });
    if (dropError) console.error('[push] could not drop tokens', dropError);
  }

  return json({ sent: messages.length - dead.length, dropped: dead.length });
});
