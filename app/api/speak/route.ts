import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 15;

const cache = new Map<string, Buffer>();
const calls = new Map<string, number[]>();

function response(body: object, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const ttsKey = process.env.GOOGLE_TTS_API_KEY;
  if (!token || !url || !serviceKey || !ttsKey) return response({ error: "unavailable" }, 503);
  let payload: unknown;
  try { payload = await request.json(); } catch { return response({ error: "bad_request" }, 400); }
  const text = payload && typeof payload === "object" && !Array.isArray(payload) &&
    Object.keys(payload).length === 1 && typeof (payload as { text?: unknown }).text === "string"
    ? (payload as { text: string }).text.trim() : "";
  if (!text || text.length > 2000) return response({ error: "bad_request" }, 400);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return response({ error: "unauthorized" }, 401);
  const now = Date.now();
  const recent = (calls.get(data.user.id) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) return response({ error: "limited" }, 429);
  recent.push(now);
  calls.set(data.user.id, recent);
  const digest = createHash("sha256").update(text).digest("hex");
  let audio = cache.get(digest);
  if (!audio) {
    try {
      const upstream = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(ttsKey)}`, {
        method: "POST", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { text }, voice: { languageCode: "en-US", name: "en-US-Neural2-F" }, audioConfig: { audioEncoding: "MP3", speakingRate: 0.9, volumeGainDb: 6 } }),
      });
      const result: unknown = await upstream.json().catch(() => null);
      const content = result && typeof result === "object" ? (result as { audioContent?: unknown }).audioContent : null;
      if (!upstream.ok || typeof content !== "string") {
        console.error("tts_failed", { status: upstream.status });
        return response({ error: "unavailable" }, 502);
      }
      audio = Buffer.from(content, "base64");
      cache.set(digest, audio);
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
    } catch (cause) {
      console.error("tts_failed", cause);
      return response({ error: "unavailable" }, 502);
    }
  }
  const body = audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength,
  ) as ArrayBuffer;
  return new Response(body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
