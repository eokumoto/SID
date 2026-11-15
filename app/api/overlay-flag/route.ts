import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OVERLAY_REMOVED = "overlay_box_removed";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  const payload: unknown = await request.json().catch(() => null);
  const documentId = payload && typeof payload === "object" && !Array.isArray(payload) &&
    Object.keys(payload).length === 1 ? (payload as { documentId?: unknown }).documentId : null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!token) return json({ error: "unauthorized" }, 401);
  if (!UUID.test(typeof documentId === "string" ? documentId : "")) return json({ error: "invalid" }, 400);
  if (!url || !serviceKey) return json({ error: "unavailable" }, 503);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);
  const { data: document, error: readError } = await supabase
    .from("documents")
    .select("warnings")
    .eq("id", documentId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (readError || !document) return json({ error: "not_found" }, 404);
  const warnings = Array.isArray(document.warnings)
    ? document.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  if (warnings.includes(OVERLAY_REMOVED)) return json({ ok: true });
  const { error: writeError } = await supabase
    .from("documents")
    .update({ warnings: [...warnings, OVERLAY_REMOVED] })
    .eq("id", documentId)
    .eq("user_id", userData.user.id);
  return writeError ? json({ error: "unavailable" }, 500) : json({ ok: true });
}
