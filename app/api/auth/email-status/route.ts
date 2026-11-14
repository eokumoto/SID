import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 10;

function response(body: object, status = 200, retryAfter?: number) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

export async function POST(request: Request) {
  // This is an intentionally public yes/no lookup, not authentication.
  // No email, private key, user record or provider diagnostic is logged/returned.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return response({ error: "forbidden" }, 403);
  }
  let email: string;
  try {
    if (Number(request.headers.get("content-length")) > 1024) {
      return response({ error: "bad_request" }, 400);
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 1024) {
      return response({ error: "bad_request" }, 400);
    }
    const body: unknown = JSON.parse(raw);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("email" in body) ||
      typeof body.email !== "string"
    ) {
      return response({ error: "bad_request" }, 400);
    }
    email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response({ error: "bad_request" }, 400);
    }
  } catch {
    return response({ error: "bad_request" }, 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret)
    return response({ error: "account_lookup_unavailable" }, 503);
  // Vercel sets this header itself. Missing platform IPs share a bucket rather
  // than trusting an arbitrary forwarded header. Other hosts use one bucket.
  const ip =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
        "unknown"
      : "local";
  const clientKey = createHmac("sha256", secret).update(ip).digest("hex");
  try {
    const supabase = createClient(url, secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const timeout = AbortSignal.timeout(8000);
    const { data, error } = await supabase
      .rpc("lookup_auth_email", {
        input_email: email,
        client_key_hash: clientKey,
      })
      .abortSignal(timeout);
    if (error || !data || typeof data !== "object") {
      return response({ error: "account_lookup_unavailable" }, 503);
    }
    if (data.limited === true) {
      const seconds =
        typeof data.retry_after === "number"
          ? Math.max(1, Math.min(300, Math.ceil(data.retry_after)))
          : 300;
      return response({ error: "too_many_checks" }, 429, seconds);
    }
    if (data.limited !== false || typeof data.exists !== "boolean") {
      return response({ error: "account_lookup_unavailable" }, 503);
    }
    return response({ exists: data.exists });
  } catch {
    return response({ error: "account_lookup_unavailable" }, 503);
  }
}
