// create-checkout — starts a $10 purchase for the logged-in user.
//
// The client calls this with its auth JWT. We identify the user from
// the token (never from the request body), create a Stripe Checkout
// session, and stamp the Supabase user id into the session metadata so
// the webhook can license the right account on success.
//
// Required secrets:
//   STRIPE_SECRET_KEY   Stripe secret key
//   STRIPE_PRICE_ID     the Price id for the $10 one-time product (price_…)
//   APP_URL             your app's base URL (for success/cancel redirects)
//
// Deploy:  supabase functions deploy create-checkout
//   (JWT verification ON — only logged-in users can buy)

import Stripe from "https://esm.sh/stripe@16?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const PRICE_ID = Deno.env.get("STRIPE_PRICE_ID")!;
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:3000";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Identify the caller from their JWT (anon client + their token).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: { user }, error: userErr } = await supa.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      // tie this purchase to the Supabase user for the webhook
      metadata: { supabase_user_id: user.id },
      customer_email: user.email,
      success_url: `${APP_URL}/?purchase=success`,
      cancel_url: `${APP_URL}/?purchase=cancelled`,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
