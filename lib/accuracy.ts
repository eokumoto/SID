// Conservative checks for common changes, not proof that meaning was preserved.
// Exact tokens deliberately retain years, signs, units, currency and URL case.
const protectedValue = /https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}:\d{2}(?:\s*[ap]m)?\b|\b(?:Room|Bldg)\s+[\w-]+|\b[A-Z]+-\d+\b|[$€£]?[+-]?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:%|mg|kg|ml|cm|km|mm|g|l|m|hours?|minutes?|[ap]m)\b|%)?/gi;

export type AccuracyFlag = { original: string; reason: string; question: string; source: "accuracy" };

function inventory(text: string) {
  const values = new Map<string, number>();
  for (const match of text.matchAll(protectedValue)) {
    const value = match[0].replace(/[.,;!?]+$/, "").replace(/\s+/g, " ").trim();
    values.set(value, (values.get(value) ?? 0) + 1);
  }
  return values;
}

function containsTerm(text: string, term: string) {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

export function checkAccuracy(source: string, rewrite: string, keyTerms: string[]): AccuracyFlag[] {
  const before = inventory(source), after = inventory(rewrite);
  const flags: AccuracyFlag[] = [];
  for (const value of new Set([...before.keys(), ...after.keys()])) {
    if ((before.get(value) ?? 0) !== (after.get(value) ?? 0)) {
      flags.push({ original: value, reason: "A protected value or its occurrence count changed.", question: "Check this value against the original photo.", source: "accuracy" });
    }
  }
  for (const term of new Set(keyTerms.filter((term) => term.trim()))) {
    if (!containsTerm(source, term) || !containsTerm(rewrite, term)) {
      flags.push({ original: term, reason: "A candidate name or term is missing from one version.", question: "Check this term against the original photo.", source: "accuracy" });
    }
  }
  return flags;
}
