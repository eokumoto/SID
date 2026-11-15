import { billingContext, reply, storedSubscription, stripeErrorLog } from "../../../../lib/billing-server";

export const runtime = "nodejs";
export const maxDuration = 20;

// Opens the Stripe Customer Portal (card, invoices, cancel) for the caller's own customer.
export async function POST(request: Request) {
  try {
    const context = await billingContext(request);
    if (context instanceof Response) return context;
    const { supabase, user, stripe } = context;
    if (!stripe) return reply({ error: "unavailable" }, 503);
    const stored = await storedSubscription(supabase, user.id);
    if (!stored) return reply({ error: "no_subscription" }, 404);
    const origin = new URL(request.url).origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: stored.stripe_customer_id,
      return_url: `${origin}/?view=account`,
      ...(process.env.STRIPE_PORTAL_CONFIGURATION ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION } : {}),
    });
    return reply({ url: session.url });
  } catch (error) {
    stripeErrorLog("billing_portal_failed", error);
    return reply({ error: "unavailable" }, 502);
  }
}
