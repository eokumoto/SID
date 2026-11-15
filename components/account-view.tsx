"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { PRO_PLANS } from "@/lib/pro";
import { Dialog } from "./ui/dialog";
import { Icon } from "./ui/icon";
import { LoadingDots } from "./ui/loading-dots";

export type AccountBilling = {
  plan: "free" | "pro";
  expiresAt: string | null;
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    interval: "monthly" | "annual" | null;
  } | null;
  billingAvailable: boolean;
};

const sampleBilling = (pro: boolean): AccountBilling => ({
  plan: pro ? "pro" : "free",
  expiresAt: pro ? new Date(Date.now() + 18 * 86_400_000).toISOString() : null,
  subscription: pro
    ? { status: "active", currentPeriodEnd: new Date(Date.now() + 18 * 86_400_000).toISOString(), cancelAtPeriodEnd: false, interval: "monthly" }
    : null,
  billingAvailable: true,
});

const longDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

async function accessToken() {
  const { data } = await getSupabase()?.auth.getSession() ?? { data: { session: null } };
  return data.session?.access_token ?? null;
}

export function AccountView({ user, displayName, preview, pro, onUpgrade, onSignOut, notify }: {
  user: User | null;
  displayName: string;
  preview: boolean;
  pro: boolean;
  onUpgrade: () => void;
  onSignOut: () => void;
  notify: (message: string) => void;
}) {
  const [name, setName] = useState(preview ? "Sample Reader" : displayName);
  const [savedName, setSavedName] = useState(preview ? "Sample Reader" : displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [billing, setBilling] = useState<AccountBilling | null>(preview ? sampleBilling(pro) : null);
  const [billingError, setBillingError] = useState(false);
  const [busy, setBusy] = useState<"cancel" | "resume" | "portal" | null>(null);
  const [actionError, setActionError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (preview || !user) return;
    let active = true;
    (async () => {
      try {
        const token = await accessToken();
        if (!token) throw Error("unauthorized");
        const response = await fetch("/api/billing/subscription", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body || (body.plan !== "free" && body.plan !== "pro")) throw Error("unavailable");
        if (active) setBilling(body as AccountBilling);
      } catch {
        if (active) setBillingError(true);
      }
    })();
    return () => { active = false; };
  }, [user, preview, reload]);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next) { setNameError("Enter a name"); return; }
    if (preview) { setSavedName(next); setJustSaved(true); return; }
    setSavingName(true);
    setNameError("");
    // display_name is ours alone; Google rewrites name/full_name on every sign-in.
    const { error } = await getSupabase()!.auth.updateUser({ data: { display_name: next } });
    setSavingName(false);
    if (error) { setNameError("Couldn’t save. Try again."); return; }
    setSavedName(next);
    setName(next);
    setJustSaved(true);
  }

  async function changeRenewal(action: "cancel" | "resume") {
    if (preview) {
      setBilling((b) => b && b.subscription ? { ...b, subscription: { ...b.subscription, cancelAtPeriodEnd: action === "cancel" } } : b);
      setConfirmCancel(false);
      return;
    }
    setBusy(action);
    setActionError("");
    try {
      const token = await accessToken();
      if (!token) throw Error("unauthorized");
      const response = await fetch("/api/billing/subscription", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.subscription) throw Error(body?.error ?? "unavailable");
      setBilling((b) => b ? { ...b, subscription: body.subscription } : b);
      setConfirmCancel(false);
    } catch {
      setActionError(action === "cancel" ? "Couldn’t cancel. Try again." : "Couldn’t turn renewal back on. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    if (preview) { notify("Sample — billing is off in previews"); return; }
    setBusy("portal");
    setActionError("");
    try {
      const token = await accessToken();
      if (!token) throw Error("unauthorized");
      const response = await fetch("/api/billing/portal", {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && typeof body?.url === "string" && body.url.startsWith("https://billing.stripe.com/")) {
        window.location.assign(body.url);
        return;
      }
      throw Error("unavailable");
    } catch {
      setActionError("Billing is unavailable right now. Try again.");
    }
    setBusy(null);
  }

  const subscription = billing?.subscription;
  const renewing = subscription && ["active", "trialing", "past_due"].includes(subscription.status);
  const endDate = longDate(subscription?.currentPeriodEnd ?? billing?.expiresAt);
  const plan = billing?.plan ?? (pro ? "pro" : "free");
  const planLabel = subscription?.interval ? PRO_PLANS[subscription.interval] : null;

  return (
    <section className="account-screen" aria-labelledby="account-heading">
      <h1 id="account-heading">Account</h1>
      {preview && <span className="sample-label">Sample</span>}

      <div className="account-card">
        <h2>Profile</h2>
        <form className="account-name-form" onSubmit={saveName}>
          <label htmlFor="account-name">Name</label>
          <div className="account-name-row">
            <input
              id="account-name"
              type="text"
              autoComplete="name"
              maxLength={100}
              value={name}
              disabled={savingName}
              onChange={(event) => { setName(event.target.value); setNameError(""); setJustSaved(false); }}
            />
            <button type="submit" className="button" disabled={savingName || name.trim() === savedName}>
              {savingName ? "Saving" : justSaved && name.trim() === savedName ? <><Icon name="check" />Saved</> : "Save"}
            </button>
          </div>
          {nameError && <p className="error-message" role="alert"><Icon name="blur" />{nameError}</p>}
        </form>
        <p className="account-detail">
          <span>Email</span>
          <span>{preview ? "sample@example.com" : user?.email ?? "—"}</span>
        </p>
      </div>

      <div className="account-card">
        <h2>Plan</h2>
        {!billing && !billingError && <p className="account-detail">Loading<LoadingDots /></p>}
        {billingError && !billing && (
          <div className="account-plan-error">
            <p className="error-message" role="alert"><Icon name="blur" />Couldn’t load your plan</p>
            <button type="button" className="button outlined" onClick={() => { setBillingError(false); setReload((n) => n + 1); }}>
              <Icon name="retry" />Try again
            </button>
          </div>
        )}
        {billing && plan === "free" && (
          <>
            <p className="account-plan-name">Free · 10 uploads a day</p>
            <button type="button" className="button" onClick={onUpgrade}><Icon name="star" />Go Pro</button>
          </>
        )}
        {billing && plan === "pro" && (
          <>
            <p className="account-plan-name pro">
              <Icon name="star" />SID Pro{planLabel ? ` · ${planLabel.cta}` : ""}
            </p>
            {endDate && (
              <p className="account-detail">
                <span>{renewing && !subscription.cancelAtPeriodEnd ? "Renews on" : "Pro ends on"}</span>
                <span>{endDate}</span>
              </p>
            )}
            {renewing && subscription.cancelAtPeriodEnd && (
              <p className="account-note">You keep Pro until then. You won’t be charged again.</p>
            )}
            {subscription?.status === "past_due" && (
              <p className="account-note">Your last payment didn’t go through. Update your card in Manage billing.</p>
            )}
            {!subscription && (
              <p className="account-note">Your Pro access was added by the SID team, so there’s nothing to cancel.</p>
            )}
            {subscription && billing.billingAvailable && (
              <div className="account-actions">
                {renewing && !subscription.cancelAtPeriodEnd && (
                  <button type="button" className="button outlined" disabled={!!busy} onClick={() => setConfirmCancel(true)}>
                    Cancel Pro
                  </button>
                )}
                {renewing && subscription.cancelAtPeriodEnd && (
                  <button type="button" className="button" disabled={!!busy} onClick={() => void changeRenewal("resume")}>
                    {busy === "resume" ? "Saving" : "Keep Pro"}
                  </button>
                )}
                <button type="button" className="button outlined" disabled={!!busy} onClick={() => void openPortal()}>
                  {busy === "portal" ? "Opening" : "Manage billing"}
                </button>
              </div>
            )}
          </>
        )}
        {actionError && <p className="error-message" role="alert"><Icon name="blur" />{actionError}</p>}
      </div>

      <button type="button" className="button outlined account-logout" onClick={onSignOut}>
        <Icon name="logout" />Log out
      </button>

      {confirmCancel && (
        <Dialog label="Cancel Pro" className="delete-dialog" onClose={() => { if (!busy) setConfirmCancel(false); }}>
          <h2>Cancel Pro?</h2>
          <p className="account-note">
            {endDate ? `You keep Pro until ${endDate}. After that you go back to Free (10 uploads a day).` : "You go back to Free (10 uploads a day) at the end of this billing period."}
          </p>
          <div className="delete-actions">
            <button type="button" className="button outlined" disabled={!!busy} onClick={() => setConfirmCancel(false)}>
              Keep Pro
            </button>
            <button type="button" className="button destructive" disabled={!!busy} onClick={() => void changeRenewal("cancel")}>
              {busy === "cancel" ? "Cancelling" : "Cancel Pro"}
            </button>
          </div>
          {actionError && <p className="error-message" role="alert"><Icon name="blur" />{actionError}</p>}
        </Dialog>
      )}
    </section>
  );
}
