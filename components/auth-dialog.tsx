"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth-errors";
import { Dialog } from "./ui/dialog";
import { Icon } from "./ui/icon";

type Step = "email" | "login" | "signup" | "forgot" | "reset" | "sent";

export function AuthDialog({
  preview = false,
  recovery = false,
  onClose,
  onSuccess,
}: {
  preview?: boolean;
  recovery?: boolean;
  onClose: () => void;
  onSuccess: (message?: string) => void;
}) {
  const [step, setStep] = useState<Step>(recovery ? "reset" : "email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentKind, setSentKind] = useState<"signup" | "reset">("signup");
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const requestId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);
  useEffect(() => {
    if (["login", "signup", "reset"].includes(step))
      passwordRef.current?.focus();
    else if (step === "forgot") emailRef.current?.focus();
  }, [step]);

  function changeStep(next: Step) {
    if (busy) return;
    setError("");
    setPassword("");
    setConfirmation("");
    setStep(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (step === "email") {
      setEmail(email.trim());
      changeStep("login");
      return;
    }
    if ((step === "signup" || step === "reset") && password !== confirmation) {
      setError("Passwords don’t match.");
      return;
    }
    if (preview) {
      setError(
        "Login is disabled in sample previews. Open SID’s home page to log in.",
      );
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setError("Not connected. Supabase settings are missing.");
      return;
    }
    const attempt = ++requestId.current;
    const current = () => mounted.current && requestId.current === attempt;
    setBusy(true);
    try {
      if (step === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (!data.session) throw new Error("missing_session");
        if (current()) {
          setPassword("");
          onSuccess();
        }
      } else if (step === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!current()) return;
        setPassword("");
        setConfirmation("");
        if (data.session) onSuccess();
        else {
          setSentKind("signup");
          setStep("sent");
        }
      } else if (step === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: window.location.origin },
        );
        if (error) throw error;
        if (current()) {
          setSentKind("reset");
          setStep("sent");
        }
      } else if (step === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        if (current()) {
          setPassword("");
          setConfirmation("");
          onSuccess("Password updated");
        }
      }
    } catch (error) {
      if (current()) setError(authErrorMessage(error));
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function google() {
    setError("");
    if (preview) {
      setError(
        "Login is disabled in sample previews. Open SID’s home page to log in.",
      );
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setError("Not connected. Supabase settings are missing.");
      return;
    }
    const attempt = ++requestId.current;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (error) {
      if (mounted.current && requestId.current === attempt) {
        setError(authErrorMessage(error));
        setBusy(false);
      }
    }
  }
  const title = {
    email: "Log in or sign up",
    login: "Log in",
    signup: "Create account",
    forgot: "Reset password",
    reset: "Set password",
    sent: "Check email",
  }[step];
  return (
    <Dialog
      label="Log in or sign up"
      className="login-dialog"
      onClose={onClose}
    >
      <h2>{title}</h2>
      {step === "email" ? (
        <>
          <button
            type="button"
            className="button outlined google-button"
            disabled={busy}
            onClick={() => void google()}
          >
            <span className="google-g" aria-hidden="true">
              G
            </span>
            Continue with Google
          </button>
          <div className="or-divider">
            <span>or</span>
          </div>
          <form onSubmit={submit} aria-busy={busy}>
            <label className="sr-only" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              name="email"
              type="email"
              placeholder="Email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
            <button className="button" type="submit" disabled={busy}>
              Continue with email
            </button>
          </form>
        </>
      ) : step === "sent" ? (
        <div className="auth-sent">
          <Icon name="mail" />
          <p role="status">
            {sentKind === "signup"
              ? "If this email is eligible, a confirmation link is on its way. Confirm it before logging in."
              : "If this email has an account, a password reset link is on its way."}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => changeStep("login")}
          >
            Back to log in
          </button>
        </div>
      ) : (
        <>
          {step !== "reset" && step !== "forgot" && (
            <div className="auth-email-row">
              <span>{email}</span>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => changeStep("email")}
              >
                Change
              </button>
            </div>
          )}
          <form onSubmit={submit} aria-busy={busy}>
            {step === "forgot" ? (
              <>
                <label className="sr-only" htmlFor="reset-email">
                  Email
                </label>
                <input
                  ref={emailRef}
                  id="reset-email"
                  name="email"
                  type="email"
                  placeholder="Email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </>
            ) : (
              <>
                <input
                  name="email"
                  type="email"
                  value={email}
                  readOnly
                  hidden
                  autoComplete="username"
                />
                <label className="sr-only" htmlFor="auth-password">
                  {step === "login" ? "Password" : "New password"}
                </label>
                <input
                  ref={passwordRef}
                  id="auth-password"
                  name="password"
                  type="password"
                  placeholder={
                    step === "login" ? "Password" : "Password · 8+ characters"
                  }
                  autoComplete={
                    step === "login" ? "current-password" : "new-password"
                  }
                  required
                  minLength={step === "login" ? undefined : 8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                  aria-describedby={error ? "auth-error" : undefined}
                />
                {step !== "login" && (
                  <>
                    <label className="sr-only" htmlFor="auth-confirm-password">
                      Confirm password
                    </label>
                    <input
                      id="auth-confirm-password"
                      name="confirmPassword"
                      type="password"
                      placeholder="Confirm password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      disabled={busy}
                    />
                  </>
                )}
              </>
            )}
            <button className="button" type="submit" disabled={busy}>
              {busy
                ? "Connecting"
                : step === "login"
                  ? "Log in"
                  : step === "signup"
                    ? "Create account"
                    : step === "forgot"
                      ? "Send reset link"
                      : "Save password"}
            </button>
          </form>
          {step === "login" && (
            <div className="auth-alternatives">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => changeStep("signup")}
              >
                Create account
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => changeStep("forgot")}
              >
                Forgot password?
              </button>
            </div>
          )}
          {(step === "signup" || step === "forgot") && (
            <button
              type="button"
              className="text-button auth-back"
              disabled={busy}
              onClick={() => changeStep("login")}
            >
              Back to log in
            </button>
          )}
        </>
      )}
      {error && (
        <p id="auth-error" className="auth-feedback error-message" role="alert">
          <Icon name="offline" />
          {error}
        </p>
      )}
    </Dialog>
  );
}
