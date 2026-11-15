import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { readAllowance } from "../../../lib/pro";
import { speechInput, SPEECH_VOICES, type SpeechMark, type Voice } from "../../../lib/speech";

export const runtime = "nodejs";
export const maxDuration = 40;
type AudioResult = { audioContent: string; mimeType: string; marks: SpeechMark[] };
type Failure = { reason: string };
const cache = new Map<string, AudioResult>();
const calls = new Map<string, number[]>();
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ error: "unauthorized" }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !service) { console.error("speak: Supabase server key missing"); return reply({ error: "unavailable", reason: "server_not_configured" }, 503); }
  const signal = AbortSignal.timeout(32_000);
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
    const voice = body.voice ?? "Emi";
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
    const cloudKey = process.env.GOOGLE_TTS_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!cloudKey && !geminiKey) { console.error("speak: neither GOOGLE_TTS_API_KEY nor GEMINI_API_KEY is set"); return reply({ error: "unavailable", reason: "tts_key_missing" }, 503); }
    const names = SPEECH_VOICES[voice as Voice];
    let failure = "";
    let audio: AudioResult | null = null;
    if (cloudKey) {
      const cloud = await cloudSpeech(cloudKey, body.text, input, names, signal);
      if ("reason" in cloud) failure = cloud.reason; else audio = cloud;
    }
    if (!audio && geminiKey && !signal.aborted) {
      const gemini = await geminiSpeech(geminiKey, body.text, names.gemini, signal);
      if ("reason" in gemini) failure = gemini.reason; else audio = gemini;
    }
    if (!audio) return reply({ error: "unavailable", reason: signal.aborted ? "timeout" : failure || "request_failed" }, signal.aborted ? 504 : 502);
    const result = audio;
    cache.set(digest, result);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    return reply(result);
  } catch (error) {
    console.error("speak: request failed", signal.aborted ? "timeout" : error instanceof Error ? error.message : "");
    return reply({ error: "unavailable", reason: signal.aborted ? "timeout" : "request_failed" }, signal.aborted ? 504 : 502);
  }
}

// Google's error reason (e.g. SERVICE_DISABLED, PERMISSION_DENIED) never includes the key.
async function googleReason(failed: Response, model: string) {
  const detail = await failed.json().catch(() => null);
  const error = detail?.error;
  const reason = [...(Array.isArray(error?.details) ? error.details.map((d: { reason?: string }) => d?.reason) : []), error?.status]
    .find((value): value is string => typeof value === "string" && /^[A-Z_]{3,60}$/.test(value)) ?? `HTTP_${failed.status}`;
  console.error(`speak: ${model} failed`, failed.status, reason, typeof error?.message === "string" ? error.message.slice(0, 300) : "");
  return reason;
}

// Google Cloud Text-to-Speech: Chirp 3 HD first, then Neural2 with exact word marks.
async function cloudSpeech(key: string, text: string, input: ReturnType<typeof speechInput>, names: (typeof SPEECH_VOICES)[Voice], signal: AbortSignal): Promise<AudioResult | Failure> {
  const synthesize = (body: object) => fetch("https://texttospeech.googleapis.com/v1beta1/text:synthesize", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  const audioConfig = { audioEncoding: "MP3", speakingRate: 1 };
  // Chirp 3 HD has no word timepoints, so the client estimates them (marks: []).
  let response = await synthesize({ input: { text }, voice: { languageCode: "en-US", name: names.hd }, audioConfig });
  let timed = false;
  if (!response.ok && !signal.aborted) {
    await googleReason(response, "Cloud TTS Chirp 3 HD");
    response = await synthesize({
      input: { ssml: input.ssml }, voice: { languageCode: "en-US", name: names.fallback },
      audioConfig, enableTimePointing: ["SSML_MARK"],
    });
    timed = true;
  }
  if (!response.ok) return { reason: await googleReason(response, "Cloud TTS Neural2") };
  const audio = await response.json();
  if (typeof audio.audioContent !== "string" || audio.audioContent.length > 8000000) return { reason: "bad_audio" };
  const marks = (timed && Array.isArray(audio.timepoints) ? audio.timepoints : []).flatMap((mark: { markName?: string; timeSeconds?: number }) => {
    const index = /^w\d+$/.test(mark.markName ?? "") ? Number(mark.markName!.slice(1)) : -1;
    const word = input.words[index];
    return word && typeof mark.timeSeconds === "number" && Number.isFinite(mark.timeSeconds) && mark.timeSeconds >= 0
      ? [{ ...word, time: mark.timeSeconds }] : [];
  }).sort((a: { time: number }, b: { time: number }) => a.time - b.time);
  return { audioContent: audio.audioContent, mimeType: "audio/mpeg", marks };
}

// Gemini speech generation with the existing GEMINI_API_KEY. Same voice family as
// Chirp 3 HD. Returns raw 16-bit PCM, which is wrapped in a WAV header here.
async function geminiSpeech(key: string, text: string, voiceName: string, signal: AbortSignal): Promise<AudioResult | Failure> {
  const models = [process.env.GEMINI_TTS_MODEL?.trim(), "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"]
    .filter((model, index, all): model is string => !!model && all.indexOf(model) === index)
    .map(model => model.replace(/^models\//, ""));
  let reason = "";
  for (const model of models) {
    if (signal.aborted) break;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
      }),
    });
    if (!response.ok) {
      reason = await googleReason(response, `Gemini TTS ${model}`);
      if (response.status === 429) break; // quota is shared; another model won't help
      continue;
    }
    const result = await response.json().catch(() => null);
    const part = (result?.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: { data?: unknown } }) => typeof p?.inlineData?.data === "string");
    if (!part) { reason = "no_audio"; console.error(`speak: Gemini TTS ${model} returned no audio`); continue; }
    const mime = String(part.inlineData.mimeType ?? "");
    if (/^audio\/(wav|x-wav|mpeg|mp3|ogg)/i.test(mime)) return { audioContent: part.inlineData.data, mimeType: mime.split(";")[0], marks: [] };
    const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
    const wav = pcmToWav(Buffer.from(part.inlineData.data, "base64"), rate);
    if (wav.length > 6_000_000) return { reason: "too_long" };
    return { audioContent: wav.toString("base64"), mimeType: "audio/wav", marks: [] };
  }
  return { reason: reason || "request_failed" };
}

function pcmToWav(pcm: Buffer, rate: number, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * bits / 8, 28); header.writeUInt16LE(channels * bits / 8, 32);
  header.writeUInt16LE(bits, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
