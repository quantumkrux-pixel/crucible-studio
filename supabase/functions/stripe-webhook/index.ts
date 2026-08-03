// Stripe webhook — the ONLY thing that grants a license.
//
// Flow: Stripe Checkout completes → Stripe POSTs an event here → we
// verify the signature (so the call genuinely came from Stripe, not a
// forged request) → on `checkout.session.completed` we mark the buyer
// licensed using the service-role key (bypasses RLS).
//
// The client is never trusted to report payment. This function is the
// trust boundary.
//
// Required secrets (set with `supabase secrets set`):
//   STRIPE_SECRET_KEY          your Stripe secret key (sk_live_… / sk_test_…)
//   STRIPE_WEBHOOK_SECRET      the signing secret for THIS webhook (whsec_…)
//   SUPABASE_URL               (auto-provided in Edge runtime)
//   SUPABASE_SERVICE_ROLE_KEY  service role key (auto-provided)
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
//   (--no-verify-jwt because Stripe calls it directly, not a logged-in user)

import Stripe from "https://esm.sh/stripe@16?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

// service-role client — bypasses RLS so it can set `licensed`.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    // async variant is required in Deno (uses SubtleCrypto)
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      // We passed the Supabase user id in metadata when creating checkout.
      const userId = session.metadata?.supabase_user_id;
      const customerId = typeof session.customer === "string" ? session.customer : null;
      if (userId && session.payment_status === "paid") {
        const { error } = await admin
          .from("profiles")
          .update({
            licensed: true,
            license_source: "stripe",
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        if (error) throw error;
        console.log(`Licensed user ${userId}`);
      }
    }
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return new Response(`Handler Error: ${err.message}`, { status: 500 });
  }
});
