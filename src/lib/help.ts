import { onSignOut } from '@/lib/resets';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

// Who to contact for ragging, safety and wellbeing: the student's university and national lines
// (police, helplines, the UGC), kept as data on the server by the Uni Era team.

export type ContactKind = 'ragging' | 'security' | 'wellbeing' | 'emergency';

export type Contact = { kind: ContactKind; label: string; phone?: string; email?: string; url?: string; note?: string };

export type HelpContacts = {
  university: string | null;
  university_contacts: Contact[];
  national: Contact[];
  can_edit: boolean;
};

/** For the Uni Era team's editor: the national list and every university's. */
export type AllHelpContacts = {
  national: Contact[];
  universities: { id: number; name: string; contacts: Contact[] }[];
};

export const KIND_TITLE: Record<ContactKind, string> = {
  emergency: 'If someone is in danger now',
  ragging: 'Ragging and threats',
  security: 'Campus security',
  wellbeing: 'Someone to talk to',
};

let cached: HelpContacts | null = null;
onSignOut(() => {
  cached = null;
});

/** Loaded once per launch; contacts rarely change. */
export async function loadHelpContacts(force = false): Promise<{ data: HelpContacts | null; error: string | null }> {
  if (cached && !force) return { data: cached, error: null };
  const { data, error } = await supabase.rpc('help_contacts');
  if (error) return { data: null, error: error.message };
  cached = data as HelpContacts;
  return { data: cached, error: null };
}

export async function loadAllHelpContacts(): Promise<{ data: AllHelpContacts | null; error: string | null }> {
  const { data, error } = await supabase.rpc('admin_help_contacts');
  if (error) return { data: null, error: error.message };
  return { data: data as AllHelpContacts, error: null };
}

export async function saveHelpContacts(institutionId: number | null, contacts: Contact[]) {
  const { data, error } = await supabase.rpc('set_help_contacts', {
    p_institution_id: institutionId as number,
    p_contacts: contacts as unknown as Json,
  });
  if (error) return { data: null, error: error.message };
  cached = null;
  return { data: data as Contact[], error: null };
}
