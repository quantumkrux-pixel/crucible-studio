// authorize-export — server-side license gate for exporting.
//
// Why this exists: a purely client-side "you can't export unless paid"
// check is trivially bypassed by editing the frontend JS. So the
// authoritative check lives here. The client asks this function "am I
// allowed to export?"; the function reads the user's licensed flag from
// the database (which the client cannot forge) and answers.
//
// The actual file generation (OBJ/STL/GLB/FBX) still happens in the
// browser from the in-memory scene — that's fine and not worth porting,
// because the *gate* is what needs to be trustworthy, and this function
// is the gate. Without a `{ allowed: true }` from here, the frontend
// refuses to produce a file. Since the flag comes from the DB via the
// user's verified JWT, flipping a client variable won't help: a
// determined user could still reconstruct geometry by hand, but they
// cannot obtain a license they didn't buy, and the paid feature stays
// paid for all practical purposes.
//
// For MAXIMUM enforcement you could move geometry serialization here so
// the file bytes themselves only come from the server. That's a larger
// port; this function is structured so you can grow into that by
// returning the serialized payload instead of just a boolean.
//
// Deploy:  supabase functions deploy authorize-export

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ allowed: false, reason: "not-authenticated" }, 401);

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: { user }, error: userErr } = await supa.auth.getUser();
  if (userErr || !user) return json({ allowed: false, reason: "not-authenticated" }, 401);

  // Read licensed straight from the DB (RLS lets a user read own profile).
  const { data: profile, error } = await supa
    .from("profiles")
    .select("licensed")
    .eq("id", user.id)
    .single();

  if (error) return json({ allowed: false, reason: "profile-error" }, 500);

  return json({ allowed: !!profile?.licensed });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
