// Supabase client + auth wrapper for Crucible3D.
//
// SETUP (yours to fill in):
//   1. Create a project at supabase.com
//   2. Copy your Project URL and anon (public) key below.
//   3. The anon key is SAFE to ship in frontend code — it only grants
//      what your RLS policies allow. NEVER put the service_role key here.
//
// Loaded from the CDN so there's no build step, matching the rest of
// the app. If you later add a bundler, swap to `import`.

// ⬇️ FILL THESE IN ⬇️
export const SUPABASE_URL = "https://YOUR-PROJECT-ref.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
// ⬆️ FILL THESE IN ⬆️

let _client = null;
let _loading = null;

// Lazily load the supabase-js library from CDN and construct the client.
export async function getSupabase(){
  if (_client) return _client;
  if (_loading) return _loading;
  _loading = (async () => {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return _client;
  })();
  return _loading;
}

export function isConfigured(){
  return !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-ANON");
}

// ---- thin auth helpers ----
export async function signUp(email, password){
  const supa = await getSupabase();
  return supa.auth.signUp({ email, password });
}
export async function signIn(email, password){
  const supa = await getSupabase();
  return supa.auth.signInWithPassword({ email, password });
}
export async function signOut(){
  const supa = await getSupabase();
  return supa.auth.signOut();
}
export async function getUser(){
  const supa = await getSupabase();
  const { data } = await supa.auth.getUser();
  return data.user ?? null;
}
export async function getSession(){
  const supa = await getSupabase();
  const { data } = await supa.auth.getSession();
  return data.session ?? null;
}
export async function onAuthChange(cb){
  const supa = await getSupabase();
  return supa.auth.onAuthStateChange((_event, session) => cb(session));
}
