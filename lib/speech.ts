export type Voice = "Calm" | "Clear" | "Warm";
export type SpeechMark = { start: number; length: number; time: number };
export const SPEECH_VOICES: Record<Voice, string> = {
  Calm: "en-US-Neural2-F",
  Clear: "en-US-Neural2-D",
  Warm: "en-US-Neural2-C",
};

const escapeXml = (text: string) => text.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

export function speechInput(text: string) {
  const words = Array.from(text.matchAll(/\S+/gu), match => ({ start: match.index, length: match[0].length }));
  let cursor = 0;
  let ssml = "<speak>";
  words.forEach((word, index) => {
    ssml += escapeXml(text.slice(cursor, word.start)) + `<mark name="w${index}"/>` + escapeXml(text.slice(word.start, word.start + word.length));
    cursor = word.start + word.length;
  });
  ssml += escapeXml(text.slice(cursor)) + "</speak>";
  return { ssml, words };
}

// Bound actual SSML bytes (including marks and escaping), not just text length.
export function speechChunks(text: string) {
  const chunks: { text: string; offset: number }[] = [];
  let start = 0;
  let end = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    const next = match.index + match[0].length;
    const candidate = text.slice(start, next);
    if (end > start && (candidate.length > 1900 || new TextEncoder().encode(speechInput(candidate).ssml).length > 4700)) {
      chunks.push({ text: text.slice(start, end), offset: start });
      start = match.index;
    }
    end = next;
  }
  if (end > start) chunks.push({ text: text.slice(start, end), offset: start });
  return chunks;
}
