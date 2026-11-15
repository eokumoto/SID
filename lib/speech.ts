export type Voice = "Emi" | "Cameron";
export type SpeechMark = { start: number; length: number; time: number };

// Pro voices. `hd` is a Chirp 3: HD voice (Google's most natural voices, same
// GOOGLE_TTS_API_KEY). Chirp 3: HD ignores SSML <mark>, so word timing is
// estimated on the client. `fallback` is the older Neural2 voice, used only if
// the HD request fails; it returns exact word timepoints.
// `gemini` is the same voice through Gemini speech generation (GEMINI_API_KEY),
// used when there is no Cloud TTS key.
export const SPEECH_VOICES: Record<Voice, { hd: string; fallback: string; gemini: string }> = {
  Emi: { hd: "en-US-Chirp3-HD-Achernar", fallback: "en-US-Neural2-F", gemini: "Achernar" },
  Cameron: { hd: "en-US-Chirp3-HD-Iapetus", fallback: "en-US-Neural2-D", gemini: "Iapetus" },
};
// Both voices are US English; the Settings buttons show this code.
export const VOICE_LANGUAGE = "en-US";

const escapeXml = (text: string) => text.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

export function speechWords(text: string) {
  return Array.from(text.matchAll(/\S+/gu), match => ({ start: match.index, length: match[0].length }));
}

export function speechInput(text: string) {
  const words = speechWords(text);
  let cursor = 0;
  let ssml = "<speak>";
  words.forEach((word, index) => {
    ssml += escapeXml(text.slice(cursor, word.start)) + `<mark name="w${index}"/>` + escapeXml(text.slice(word.start, word.start + word.length));
    cursor = word.start + word.length;
  });
  ssml += escapeXml(text.slice(cursor)) + "</speak>";
  return { ssml, words };
}

// Estimate when each word starts in audio that has no timepoints. Each word is
// weighted by its length, plus extra time after punctuation where speakers pause.
export function estimateMarks(text: string, duration: number): SpeechMark[] {
  const words = speechWords(text);
  if (!words.length || !(duration > 0) || !Number.isFinite(duration)) return [];
  const lead = Math.min(0.15, duration * 0.03);
  const weights = words.map(word => {
    const value = text.slice(word.start, word.start + word.length);
    const letters = value.replace(/[^\p{L}\p{N}]/gu, "").length;
    const spoken = /\d/.test(value) ? letters * 1.6 : letters; // numbers are read as longer words
    const pause = /[.!?:;]["')\]]*$/.test(value) ? 5 : /[,–—-]["')\]]*$/.test(value) ? 2.5 : 0;
    return { speak: 1.5 + spoken, pause };
  });
  const total = weights.reduce((sum, weight) => sum + weight.speak + weight.pause, 0);
  const scale = (duration - lead) / total;
  let time = lead;
  return words.map((word, index) => {
    const mark = { ...word, time: Number(time.toFixed(3)) };
    time += (weights[index].speak + weights[index].pause) * scale;
    return mark;
  });
}

// ~600 characters is about 40 seconds of speech: quick to generate, and as WAV it
// stays well under Vercel's 4.5 MB response limit.
export const SPEECH_CHUNK_CHARS = 600;

// Bound actual SSML bytes (including marks and escaping), not just text length.
export function speechChunks(text: string) {
  const chunks: { text: string; offset: number }[] = [];
  let start = 0;
  let end = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    const next = match.index + match[0].length;
    const candidate = text.slice(start, next);
    if (end > start && (candidate.length > SPEECH_CHUNK_CHARS || new TextEncoder().encode(speechInput(candidate).ssml).length > 4700)) {
      chunks.push({ text: text.slice(start, end), offset: start });
      start = match.index;
    }
    end = next;
  }
  if (end > start) chunks.push({ text: text.slice(start, end), offset: start });
  return chunks;
}

type DeviceVoice = { name: string; lang: string; localService?: boolean; default?: boolean };

// macOS and iOS list joke voices (Bad News, Bubbles, Zarvox...) as English.
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|pipe organ|fred|junior|kathy|ralph|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)\b/i;
const GOOD_NAMES = /\b(samantha|ava|zoe|allison|susan|evan|nathan|tom|aaron|nicky|joelle|noelle|aria|jenny|guy|ana|michelle|emma|brian|andrew|christopher|eric|roger|steffan|libby|sonia|ryan|karen|daniel|moira|serena|tessa)\b/i;

function voiceScore(voice: DeviceVoice, language: string) {
  const name = voice.name;
  let score = 0;
  if (/natural|neural/i.test(name)) score += 60; // Edge / Windows 11 natural voices
  if (/premium|enhanced|siri/i.test(name)) score += 50; // Apple downloaded voices
  if (/^google\b/i.test(name)) score += 25; // Chrome's online voices
  if (GOOD_NAMES.test(name)) score += 20;
  if (/online/i.test(name)) score += 10;
  if (/espeak|compact|desktop/i.test(name)) score -= 30;
  const lang = voice.lang.replace("_", "-").toLowerCase();
  if (lang === language.toLowerCase()) score += 15;
  else if (lang === "en-us") score += 10;
  else if (/^en-(gb|au|ca|ie|nz)/.test(lang)) score += 5;
  return score;
}

// Rank the device's English voices best first, without the novelty voices, and
// give Emi and Cameron the top two distinct ones.
export function pickDeviceVoice<T extends DeviceVoice>(voices: T[], choice: Voice, language = "en-US"): T | undefined {
  const english = voices.filter(voice => /^en\b/i.test(voice.lang));
  const usable = english.filter(voice => !NOVELTY.test(voice.name));
  const ranked = (usable.length ? usable : english)
    .map((voice, order) => ({ voice, order, score: voiceScore(voice, language) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(entry => entry.voice);
  if (!ranked.length) return undefined;
  const slot = ({ Emi: 0, Cameron: 1 })[choice];
  return ranked[Math.min(slot, ranked.length - 1)];
}
