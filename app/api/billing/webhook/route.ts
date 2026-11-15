import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 20;

// Stripe → SID entitlement sync. This is the only place Pro is granted or revoked.
// Each event re-fetches the subscription from Stripe, so out-of-order or replayed
// events always converge on Stripe's current state.
const ACTIVE: Stripe.Subscription.Status[] = ["active", "trialing", "past_due"];
const GRACE_SECONDS = 24 * 60 * 60; // tolerate renewal webhooks arriving a little late

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!url || !service || !secretKey || !webhookSecret) return new Response("unavailable", { status: 503 });

  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, webhookSecret);
  } catch (error) {
    console.error("webhook_signature_failed", error instanceof Error ? error.message : error);
    return new Response("invalid signature", { status: 400 });
  }

  let subscriptionId: string | null = null;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode === "subscription" && typeof session.subscription === "string") subscriptionId = session.subscription;
    else if (session.mode === "subscription" && session.subscription) subscriptionId = session.subscription.id;
  } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" ||
             event.type === "customer.subscription.deleted") {
    subscriptionId = event.data.object.id;
  }
  if (!subscriptionId) return Response.json({ received: true, ignored: event.type });

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.supabase_user_id;
    if (!userId) {
      console.error("webhook_missing_user", subscription.id);
      return Response.json({ received: true, ignored: "no_user" });
    }

    const periodEnd = Math.max(0, ...subscription.items.data.map(item => item.current_period_end ?? 0));
    const active = ACTIVE.includes(subscription.status) && periodEnd > 0;
    const row = active
      ? { user_id: userId, plan: "pro", expires_at: new Date((periodEnd + GRACE_SECONDS) * 1000).toISOString() }
      : { user_id: userId, plan: "free", expires_at: null };

    const supabase = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await supabase.from("account_entitlements").upsert(row, { onConflict: "user_id" });
    if (error) throw error;
    return Response.json({ received: true, plan: row.plan });
  } catch (error) {
    // A non-2xx makes Stripe retry the event later.
    console.error("webhook_failed", event.type, error instanceof Stripe.errors.StripeError ? `${error.type}: ${error.message}` : error);
    return new Response("failed", { status: 500 });
  }
}
