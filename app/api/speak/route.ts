import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { readAllowance } from "../../../lib/pro";
import { speechInput, SPEECH_VOICES, type Voice } from "../../../lib/speech";

export const runtime = "nodejs";
export const maxDuration = 20;
type AudioResult = { audioContent: string; marks: { start: number; length: number; time: number }[] };
const cache = new Map<string, AudioResult>();
const calls = new Map<string, number[]>();
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ error: "unauthorized" }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !service) { console.error("speak: Supabase server key missing"); return reply({ error: "unavailable", reason: "server_not_configured" }, 503); }
  const signal = AbortSignal.timeout(15_000);
  try {
    const supabase = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return reply({ error: "unauthorized" }, 401);
    const { data: quota, error: quotaError } = await supabase.rpc("get_upload_allowance", { owner_id: data.user.id });
    const access = !quotaError && readAllowance(quota);
    if (!access) { console.error("speak: get_upload_allowance failed", quotaError?.message); return reply({ error: "unavailable", reason: "allowance_unavailable" }, 503); }
    if (access.plan !== "pro") return reply({ error: "pro_required" }, 403);
    const raw = await request.text();
    if (raw.length > 13000) return reply({ error: "bad_request" }, 400);
    const body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).some(k => !["text", "voice"].includes(k)) ||
      typeof body.text !== "string" || !body.text.trim() || body.text.length > 2000) return reply({ error: "bad_request" }, 400);
    const voice = body.voice ?? "Calm";
    if (typeof voice !== "string" || !Object.hasOwn(SPEECH_VOICES, voice)) return reply({ error: "bad_request" }, 400);
    const input = speechInput(body.text);
    if (new TextEncoder().encode(input.ssml).length > 4800) return reply({ error: "bad_request" }, 400);
    const digest = createHash("sha256").update(`${voice}\0${body.text}`).digest("hex");
    if (cache.has(digest)) return reply(cache.get(digest)!);
    const now = Date.now();
    for (const [id, times] of calls) if (!times.some(time => now - time < 60000)) calls.delete(id);
    const recent = (calls.get(data.user.id) ?? []).filter(time => now - time < 60000);
    if (recent.length >= 20) return reply({ error: "limited" }, 429);
    recent.push(now); calls.set(data.user.id, recent);
    const key = process.env.GOOGLE_TTS_API_KEY;
    if (!key) { console.error("speak: GOOGLE_TTS_API_KEY is not set"); return reply({ error: "unavailable", reason: "tts_key_missing" }, 503); }
    const synthesize = (body: object) => fetch("https://texttospeech.googleapis.com/v1beta1/text:synthesize", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    const audioConfig = { audioEncoding: "MP3", speakingRate: 1 };
    const names = SPEECH_VOICES[voice as Voice];
    // Chirp 3: HD first. It has no word timepoints, so the client estimates them (marks: []).
    // Google's error status (e.g. PERMISSION_DENIED, SERVICE_DISABLED) never includes the key.
    const googleReason = async (failed: Response, model: string) => {
      const detail = await failed.json().catch(() => null);
      const error = detail?.error;
      const reason = [...(Array.isArray(error?.details) ? error.details.map((d: { reason?: string }) => d?.reason) : []), error?.status]
        .find((value): value is string => typeof value === "string" && /^[A-Z_]{3,60}$/.test(value)) ?? `HTTP_${failed.status}`;
      console.error(`speak: Google TTS ${model} failed`, failed.status, reason, typeof error?.message === "string" ? error.message.slice(0, 300) : "");
      return reason;
    };
    let response = await synthesize({ input: { text: body.text }, voice: { languageCode: "en-US", name: names.hd }, audioConfig });
    let timed = false;
    if (!response.ok && !signal.aborted) {
      await googleReason(response, "Chirp 3 HD");
      response = await synthesize({
        input: { ssml: input.ssml }, voice: { languageCode: "en-US", name: names.fallback },
        audioConfig, enableTimePointing: ["SSML_MARK"],
      });
      timed = true;
    }
    if (!response.ok) return reply({ error: "unavailable", reason: await googleReason(response, "Neural2") }, 502);
    const audio = await response.json();
    if (typeof audio.audioContent !== "string" || audio.audioContent.length > 8000000) return reply({ error: "unavailable" }, 502);
    const marks = (timed && Array.isArray(audio.timepoints) ? audio.timepoints : []).flatMap((mark: { markName?: string; timeSeconds?: number }) => {
      const index = /^w\d+$/.test(mark.markName ?? "") ? Number(mark.markName!.slice(1)) : -1;
      const word = input.words[index];
      return word && typeof mark.timeSeconds === "number" && Number.isFinite(mark.timeSeconds) && mark.timeSeconds >= 0
        ? [{ ...word, time: mark.timeSeconds }] : [];
    }).sort((a: { time: number }, b: { time: number }) => a.time - b.time);
    const result = { audioContent: audio.audioContent, marks };
    cache.set(digest, result);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    return reply(result);
  } catch (error) {
    console.error("speak: request failed", signal.aborted ? "timeout" : error instanceof Error ? error.message : "");
    return reply({ error: "unavailable", reason: signal.aborted ? "timeout" : "request_failed" }, signal.aborted ? 504 : 502);
  }
}
