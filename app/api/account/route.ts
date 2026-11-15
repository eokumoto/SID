import { createClient } from "@supabase/supabase-js";
import { readAllowance } from "../../../lib/pro";

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return Response.json({ error: "unavailable" }, { status: 503 });
  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { data: quota, error: quotaError } = await supabase.rpc("get_upload_allowance", { owner_id: data.user.id });
    const allowance = !quotaError && readAllowance(quota);
    if (!allowance) return Response.json({ error: "unavailable" }, { status: 503 });
    return Response.json(allowance, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
