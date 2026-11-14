export type TextRegion = {
  text: string;
  // Image-relative coordinates, 0–1000: top, left, bottom, right.
  box_2d: [number, number, number, number];
};

type TextRow = {
  ocr_text?: string | null;
  gemini_source_text?: string | null;
  plain_text?: string | null;
};

// Older scans may contain a rewrite in plain_text. Prefer their saved OCR.
export function originalText(row: TextRow): string {
  return [row.ocr_text, row.gemini_source_text, row.plain_text]
    .find((text): text is string => typeof text === "string" && !!text.trim()) ?? "";
}

// Optional geometry must never fail a successful transcription or invent text.
export function readTextRegions(value: unknown, source: string): TextRegion[] {
  if (!Array.isArray(value) || value.length > 400) return [];
  const normalizedSource = source.replace(/\s+/g, " ");
  return value.flatMap((region): TextRegion[] => {
    if (!region || typeof region !== "object" || typeof region.text !== "string" ||
        !region.text.trim() || region.text.length > 2000 ||
        !normalizedSource.includes(region.text.replace(/\s+/g, " ").trim()) ||
        !Array.isArray(region.box_2d) || region.box_2d.length !== 4 ||
        !region.box_2d.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1000)) return [];
    const [top, left, bottom, right] = region.box_2d as TextRegion["box_2d"];
    if (bottom <= top || right <= left) return [];
    return [{ text: region.text, box_2d: [top, left, bottom, right] }];
  });
}

export function fitPhoto(image: { width: number; height: number }, frame: { width: number; height: number }) {
  if (image.width <= 0 || image.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.min(frame.width / image.width, frame.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}
