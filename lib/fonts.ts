// Reading fonts offered in Settings, in alphabetical order. The chosen font is
// used for all text in the app. OpenDyslexic is the default.
export const READER_FONTS = [
  "Andika",
  "Atkinson Hyperlegible",
  "Lexend",
  "Luciole",
  "OpenDyslexic",
] as const;
export type ReaderFont = (typeof READER_FONTS)[number];
export const DEFAULT_FONT: ReaderFont = "OpenDyslexic";

export function fontStack(font: ReaderFont) {
  return `"${font}", "OpenDyslexic", system-ui, sans-serif`;
}
