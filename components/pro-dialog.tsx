"use client";

import { useState } from "react";
import { PRO_PLANS, type ProPlan } from "@/lib/pro";
import { getSupabase } from "@/lib/supabase/client";
import { Dialog } from "./ui/dialog";
import { Icon } from "./ui/icon";

const checkoutErrors: Record<string, string> = {
  sign_in_required: "Sign in with your email to subscribe.",
  already_pro: "You already have SID Pro.",
};

export function ProDialog({ onClose, signedIn, preview, onSignIn }: {
  onClose: () => void;
  signedIn: boolean;
  preview?: boolean;
  onSignIn: () => void;
}) {
  const [plan, setPlan] = useState<ProPlan>("annual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = PRO_PLANS[plan];

  async function startCheckout() {
    if (!signedIn) return onSignIn();
    setLoading(true);
    setError(null);
    try {
      const { data } = await getSupabase()?.auth.getSession() ?? { data: { session: null } };
      if (!data.session) { setLoading(false); return onSignIn(); }
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body.url === "string" && body.url.startsWith("https://checkout.stripe.com/")) {
        window.location.assign(body.url);
        return;
      }
      setError(checkoutErrors[body.error] ?? "Checkout is unavailable right now. Please try again.");
    } catch {
      setError("Checkout is unavailable right now. Please try again.");
    }
    setLoading(false);
  }

  const note = preview ? "Sample — purchasing is off in previews"
    : error ?? (signedIn ? "Cancel anytime" : "Sign in with your email to subscribe.");

  return <Dialog label="SID Pro" className="pro-dialog" animateClose onClose={onClose}>
    <h2>SID Pro</h2>
    <table className="pro-comparison">
      <caption className="sr-only">Compare Free and SID Pro</caption>
      <thead><tr><th scope="col"><span className="sr-only">Feature</span></th><th scope="col">Free</th><th scope="col">Pro</th></tr></thead>
      <tbody>
        <tr><th scope="row">Uploads</th><td>10/day</td><td>150/day</td></tr>
        {[
          ["Clear-font reader", true], ["Settings (font, size, color)", true],
          ["Listen (read aloud)", false], ["Voice and speed", false], ["Saved history", true],
        ].map(([label, free]) => <tr key={String(label)}><th scope="row">{label}</th><td>{free ? <><Icon name="check" /><span className="sr-only">Included</span></> : <span aria-label="Not included">—</span>}</td><td><Icon name="check" /><span className="sr-only">Included</span></td></tr>)}
      </tbody>
    </table>
    <fieldset className="pro-plans" disabled={loading}>
      <legend className="sr-only">Billing period</legend>
      {(Object.keys(PRO_PLANS) as ProPlan[]).map(key => {
        const option = PRO_PLANS[key];
        return <label key={key} className={`pro-plan ${plan === key ? "selected" : ""}`}>
          <input type="radio" name="pro-plan" value={key} checked={plan === key} onChange={() => setPlan(key)} />
          <span className="pro-plan-body">
            <span className="pro-plan-name">{option.label}</span>
            {option.badge && <span className="pro-plan-badge">{option.badge}</span>}
            <span className="pro-plan-price">{option.price}</span>
            <span className="pro-plan-per">/ {option.per}</span>
          </span>
        </label>;
      })}
    </fieldset>
    <button type="button" className="button" disabled={preview || loading} aria-busy={loading}
      aria-describedby="pro-checkout-note" onClick={startCheckout}>
      <Icon name="star" />{loading ? "Opening checkout…" : signedIn ? `Go Pro · ${selected.cta}` : "Sign in to go Pro"}
    </button>
    <p id="pro-checkout-note" className="pro-coming-soon" role={error ? "alert" : undefined}>{note}</p>
  </Dialog>;
}
