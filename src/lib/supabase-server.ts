import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Server-side Supabase client for the Lovable balance app's backend.
//
// We can't use a service_role key because that backend is a Lovable Cloud
// project we don't own. Instead we sign in with an admin user's email +
// password (anon key + Supabase Auth) and reuse the resulting JWT for all
// subsequent queries. The admin's RLS policies determine what we can read.
//
// Env vars are read lazily so the app still compiles when the integration
// isn't wired up yet.

let cached: SupabaseClient | null = null;
let signInPromise: Promise<void> | null = null;

function normalizeSupabaseUrl(raw: string): string {
  let u = raw.trim();
  u = u.replace(/\/+$/, '');
  u = u.replace(/\/rest\/v1$/, '');
  return u;
}

async function ensureSignedIn(client: SupabaseClient, email: string, password: string): Promise<void> {
  // Coalesce concurrent callers onto a single sign-in.
  if (signInPromise) return signInPromise;
  signInPromise = (async () => {
    const { data: sessionData } = await client.auth.getSession();
    if (sessionData.session) return;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Supabase admin sign-in failed: ${error.message}`);
  })();
  try {
    await signInPromise;
  } finally {
    signInPromise = null;
  }
}

export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  const rawUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const adminEmail = process.env.SUPABASE_ADMIN_EMAIL;
  const adminPassword = process.env.SUPABASE_ADMIN_PASSWORD;
  if (!rawUrl || !anonKey) {
    throw new Error('Supabase not configured: set SUPABASE_URL and SUPABASE_ANON_KEY in .env.local');
  }
  if (!adminEmail || !adminPassword) {
    throw new Error('Supabase admin login not configured: set SUPABASE_ADMIN_EMAIL and SUPABASE_ADMIN_PASSWORD in .env.local');
  }
  if (!cached) {
    const url = normalizeSupabaseUrl(rawUrl);
    cached = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
  }
  await ensureSignedIn(cached, adminEmail, adminPassword);
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY &&
    process.env.SUPABASE_ADMIN_EMAIL &&
    process.env.SUPABASE_ADMIN_PASSWORD,
  );
}
