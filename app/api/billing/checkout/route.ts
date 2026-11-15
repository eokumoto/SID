import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { isProPlan, readAllowance } from "../../../../lib/pro";

export const runtime = "nodejs";
export const maxDuration = 20;
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Creates a Stripe Checkout Session for SID Pro and returns its hosted URL.
// Pro is granted only by the Stripe webhook (not by reaching the success URL).
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ error: "unauthorized" }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !service || !secretKey) return reply({ error: "unavailable" }, 503);

  // The client picks a plan name; only the server maps it to a Stripe price ID.
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !isProPlan(body.plan)) return reply({ error: "bad_request" }, 400);
  const price = body.plan === "annual" ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY;
  if (!price) return reply({ error: "unavailable" }, 503);

  try {
    const supabase = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: authError } = await supabase.auth.getUser(token);
    const user = identity?.user;
    if (authError || !user) return reply({ error: "unauthorized" }, 401);
    // Anonymous sessions can be lost, which would strand a paid subscription.
    if (user.is_anonymous || !user.email) return reply({ error: "sign_in_required" }, 403);

    const { data: quota, error: quotaError } = await supabase.rpc("get_upload_allowance", { owner_id: user.id });
    const access = !quotaError && readAllowance(quota);
    if (!access) return reply({ error: "unavailable" }, 503);
    if (access.plan === "pro") return reply({ error: "already_pro" }, 409);

    const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
    const origin = new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id, plan: body.plan },
      subscription_data: { metadata: { supabase_user_id: user.id, plan: body.plan } },
      allow_promotion_codes: true,
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });
    if (!session.url) return reply({ error: "unavailable" }, 502);
    return reply({ url: session.url });
  } catch (error) {
    console.error("checkout_failed", error instanceof Stripe.errors.StripeError ? `${error.type}: ${error.message}` : error);
    return reply({ error: "unavailable" }, 502);
  }
}
