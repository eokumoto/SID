// Only fixed messages: never display a raw provider response or document text.
const messages: Record<string, string> = {
  invalid_input: "Image unreadable",
  timeout: "Timed out",
  daily_limit: "Daily limit reached",
  service_unavailable: "Scanning not configured",
  already_processing: "Still processing. Try again shortly",
  attempt_superseded: "Scan changed. Try again",
  original_unavailable: "Original unavailable",
  unauthorized: "Session expired. Refresh and try again",
  not_found: "Scan unavailable",
  storage_failed: "Couldn’t download the saved photo",
  bad_ai_json: "AI returned an invalid response. Try again",
  ai_rate_limited: "Gemini quota or rate limit reached",
  ai_auth_failed: "Gemini key or access rejected",
  ai_model_unavailable: "Gemini model unavailable",
  ai_request_rejected: "Gemini rejected the processing request",
  ai_unavailable: "Gemini temporarily unavailable",
  ai_response_blocked: "Gemini blocked this scan",
  ai_output_incomplete: "AI response was cut short. Try a smaller page",
  ai_empty_response: "AI returned no text. Try another photo",
};

export function processingErrorMessage(error: unknown, reason?: unknown): string {
  const code = error === "ai_failed" && typeof reason === "string" ? reason : error;
  return typeof code === "string" && Object.hasOwn(messages, code)
    ? messages[code] : "Couldn’t process this photo. Try again";
}
