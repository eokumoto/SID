// Keep provider diagnostics useful without exposing tokens or raw server responses.
export function authErrorMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  switch (code) {
    case "invalid_credentials":
      return "Email or password is incorrect. New here? Choose Create account.";
    case "email_not_confirmed":
      return "Confirm your email before logging in.";
    case "user_already_exists":
    case "email_exists":
      return "This account already exists. Choose Log in.";
    case "weak_password":
      return "Choose a stronger password with at least 8 characters.";
    case "same_password":
      return "Choose a different password.";
    case "signup_disabled":
      return "Account creation is disabled. Contact the SID team.";
    case "email_address_invalid":
    case "validation_failed":
      return "Check your email address and password.";
    case "email_address_not_authorized":
      return "Email delivery isn’t configured for this address yet.";
    case "over_email_send_rate_limit":
      return "Too many emails requested. Try again later.";
    case "over_request_rate_limit":
      return "Too many attempts. Try again later.";
    case "provider_disabled":
      return "This login method isn’t enabled yet.";
    case "otp_expired":
      return "Your login link expired. Request a new link.";
    case "bad_jwt":
    case "session_not_found":
    case "refresh_token_not_found":
      return "Your link or session expired. Request a new reset link.";
    default:
      return typeof navigator !== "undefined" && !navigator.onLine
        ? "No connection. Try again when you’re online."
        : "Couldn’t connect to login. Try again.";
  }
}
