"use client";

import { useSyncExternalStore } from "react";
import type { ReaderSettings } from "./ui-types";

const key = "sid.reader.settings";
const defaults: ReaderSettings = {
  font: "OpenDyslexic",
  size: 21,
  spacing: "Normal",
  background: "cream",
  reduceMotion: false,
};
const initial = JSON.stringify(defaults);
let memory = initial;
let memoryOnly = false;

export function validateSettings(value: unknown): ReaderSettings {
  const v =
    value && typeof value === "object"
      ? (value as Partial<ReaderSettings>)
      : {};
  return {
    font: ["OpenDyslexic", "Lexend", "Arial"].includes(v.font ?? "")
      ? v.font!
      : defaults.font,
    size:
      typeof v.size === "number" && Number.isFinite(v.size)
        ? Math.min(30, Math.max(14, v.size))
        : defaults.size,
    spacing: [
      "Tight",
      "Slightly tight",
      "Normal",
      "Slightly wide",
      "Wide",
    ].includes(v.spacing ?? "")
      ? v.spacing!
      : defaults.spacing,
    background: ["cream", "peach", "dark", "navy"].includes(
      v.background ?? "",
    )
      ? v.background!
      : defaults.background,
    reduceMotion: typeof v.reduceMotion === "boolean" ? v.reduceMotion : false,
  };
}
function snapshot() {
  if (memoryOnly) return memory;
  try {
    return localStorage.getItem(key) ?? memory;
  } catch {
    return memory;
  }
}
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener("sid-settings", notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener("sid-settings", notify);
  };
}
export function saveSettings(settings: ReaderSettings) {
  memory = JSON.stringify(validateSettings(settings));
  let saved = true;
  try {
    localStorage.setItem(key, memory);
    memoryOnly = false;
  } catch {
    saved = false;
    memoryOnly = true;
  }
  window.dispatchEvent(new Event("sid-settings"));
  return saved;
}
export function useReaderSettings() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => initial);
  try {
    return validateSettings(JSON.parse(raw));
  } catch {
    return defaults;
  }
}
