import Stripe from "stripe";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export const reply = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export type BillingContext = { supabase: SupabaseClient; user: User; stripe: Stripe | null };

// Verifies the bearer token and returns a service-role client plus the caller.
// Stripe is optional so the account page still loads before billing is configured.
export async function billingContext(request: Request): Promise<BillingContext | Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ error: "unauthorized" }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !service) return reply({ error: "unavailable" }, 503);
  const supabase = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return reply({ error: "unauthorized" }, 401);
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const stripe = secretKey ? new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15_000 }) : null;
  return { supabase, user: data.user, stripe };
}

export type StoredSubscription = {
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
};

export async function storedSubscription(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("stripe_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end")
    .eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as StoredSubscription | null;
}

export function periodEnd(subscription: Stripe.Subscription) {
  const seconds = Math.max(...subscription.items.data.map(item => item.current_period_end));
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

export function billingInterval(subscription: Stripe.Subscription): "monthly" | "annual" | null {
  const interval = subscription.items.data[0]?.price?.recurring?.interval;
  return interval === "year" ? "annual" : interval === "month" ? "monthly" : null;
}

// Mirrors the webhook so the page reflects a cancel right away; the webhook
// stays the source of truth for the Pro entitlement itself.
export async function saveSubscription(supabase: SupabaseClient, userId: string, subscription: Stripe.Subscription) {
  const end = periodEnd(subscription);
  if (!end) return;
  await supabase.from("stripe_subscriptions").update({
    status: subscription.status,
    current_period_end: end,
    cancel_at_period_end: subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("stripe_subscription_id", subscription.id);
}

export function stripeErrorLog(label: string, error: unknown) {
  console.error(label, error instanceof Stripe.errors.StripeError ? `${error.type}: ${error.message}` : error);
}
