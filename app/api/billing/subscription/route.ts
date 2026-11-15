import type Stripe from "stripe";
import {
  billingContext, billingInterval, periodEnd, reply, saveSubscription, storedSubscription, stripeErrorLog,
} from "../../../../lib/billing-server";

export const runtime = "nodejs";
export const maxDuration = 20;

function describe(subscription: Stripe.Subscription) {
  return {
    status: subscription.status,
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    interval: billingInterval(subscription),
  };
}

// Plan and subscription details for the account page.
export async function GET(request: Request) {
  try {
    const context = await billingContext(request);
    if (context instanceof Response) return context;
    const { supabase, user, stripe } = context;
    const { data: entitlement, error } = await supabase.from("account_entitlements")
      .select("plan, expires_at").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    const active = entitlement?.plan === "pro"
      && (!entitlement.expires_at || Date.parse(entitlement.expires_at) > Date.now());
    const stored = await storedSubscription(supabase, user.id);
    let subscription: ReturnType<typeof describe> | { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; interval: "monthly" | "annual" | null } | null = stored && {
      status: stored.status,
      currentPeriodEnd: stored.current_period_end,
      cancelAtPeriodEnd: stored.cancel_at_period_end,
      interval: null as "monthly" | "annual" | null,
    };
    // Prefer Stripe's live copy so the page is right even if a webhook is late.
    if (stored && stripe) {
      try {
        const live = await stripe.subscriptions.retrieve(stored.stripe_subscription_id, { expand: ["items.data.price"] });
        subscription = describe(live);
      } catch (stripeError) {
        stripeErrorLog("subscription_lookup_failed", stripeError);
      }
    }
    return reply({
      plan: active ? "pro" : "free",
      expiresAt: active ? entitlement?.expires_at ?? null : null,
      subscription,
      billingAvailable: !!stripe,
    });
  } catch (error) {
    console.error("account_billing_failed", error instanceof Error ? error.message : error);
    return reply({ error: "unavailable" }, 503);
  }
}

// { "action": "cancel" } stops renewal at the end of the paid period.
// { "action": "resume" } undoes that while the period is still running.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body && typeof body === "object" ? body.action : null;
  if (action !== "cancel" && action !== "resume") return reply({ error: "bad_request" }, 400);
  try {
    const context = await billingContext(request);
    if (context instanceof Response) return context;
    const { supabase, user, stripe } = context;
    if (!stripe) return reply({ error: "unavailable" }, 503);
    const stored = await storedSubscription(supabase, user.id);
    if (!stored) return reply({ error: "no_subscription" }, 404);
    const current = await stripe.subscriptions.retrieve(stored.stripe_subscription_id);
    if (current.metadata.supabase_user_id && current.metadata.supabase_user_id !== user.id)
      return reply({ error: "no_subscription" }, 404);
    if (!["active", "trialing", "past_due"].includes(current.status)) return reply({ error: "not_active" }, 409);
    const updated = await stripe.subscriptions.update(current.id, {
      cancel_at_period_end: action === "cancel",
      expand: ["items.data.price"],
    });
    await saveSubscription(supabase, user.id, updated);
    return reply({ subscription: describe(updated) });
  } catch (error) {
    stripeErrorLog("subscription_update_failed", error);
    return reply({ error: "unavailable" }, 502);
  }
}
