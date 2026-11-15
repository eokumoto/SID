import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 20;

function subscriptionUserId(subscription: Stripe.Subscription) {
  const id = subscription.metadata.supabase_user_id;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

// Stripe signs the exact raw body; do not parse JSON before constructEvent.
export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const signature = request.headers.get("stripe-signature");
  if (!secretKey || !webhookSecret || !url || !service || !signature)
    return Response.json({ error: "unavailable" }, { status: 503 });

  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  const supabase = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const syncSubscription = async (subscription: Stripe.Subscription) => {
    const userId = subscriptionUserId(subscription);
    if (!userId) throw new Error("subscription_missing_user");
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const periodEndSeconds = Math.max(...subscription.items.data.map(item => item.current_period_end));
    if (!Number.isFinite(periodEndSeconds)) throw new Error("subscription_missing_period_end");
    const periodEnd = new Date(periodEndSeconds * 1000);
    const entitlementActive = ["active", "trialing"].includes(subscription.status)
      || (subscription.status === "canceled" && periodEnd.getTime() > Date.now());
    const plan = entitlementActive ? "pro" : "free";
    const expiresAt = entitlementActive ? periodEnd.toISOString() : null;
    const { error: subscriptionError } = await supabase.from("stripe_subscriptions").upsert({
      user_id: userId, stripe_customer_id: customerId, stripe_subscription_id: subscription.id,
      status: subscription.status, current_period_end: periodEnd.toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    }, { onConflict: "user_id" });
    if (subscriptionError) throw subscriptionError;
    const { error: entitlementError } = await supabase.from("account_entitlements").upsert({
      user_id: userId, plan, expires_at: expiresAt,
    }, { onConflict: "user_id" });
    if (entitlementError) throw entitlementError;
  };
  const { data: received, error: receiptError } = await supabase.from("stripe_webhook_events")
    .upsert({ id: event.id, event_type: event.type }, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (receiptError) {
    console.error("stripe_webhook_receipt_failed", receiptError.message);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!received?.length) return Response.json({ received: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!session.subscription) throw new Error("checkout_missing_subscription");
        const subscription = typeof session.subscription === "string"
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription;
        await syncSubscription(subscription);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (error) {
    // A failed attempt must be retried by Stripe. Keeping the receipt would
    // turn the retry into a false success and leave the entitlement stale.
    await supabase.from("stripe_webhook_events").delete().eq("id", event.id);
    console.error("stripe_webhook_processing_failed", { eventId: event.id, type: event.type, error: error instanceof Error ? error.message : "unknown" });
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
