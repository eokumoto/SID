"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReaderSettings } from "@/lib/ui-types";
import { estimateMarks, pickDeviceVoice, speechChunks, type SpeechMark } from "@/lib/speech";
import { getSupabase } from "@/lib/supabase/client";
import { Icon } from "./ui/icon";
import { LoadingDots } from "./ui/loading-dots";

const VOICE_PROBLEMS: Record<string, string> = {
  tts_key_missing: "no voice key set",
  RESOURCE_EXHAUSTED: "daily voice limit reached",
  SERVICE_DISABLED: "Text-to-Speech API not enabled",
  BILLING_DISABLED: "billing not enabled",
  API_KEY_SERVICE_BLOCKED: "key not allowed for Text-to-Speech",
  API_KEY_INVALID: "invalid voice key",
  PERMISSION_DENIED: "voice key not allowed",
  timeout: "timed out",
};

export function ListenPlayer({ text, settings, preview, onWord, onClose, notify }: {
  text: string; settings: ReaderSettings; preview: boolean;
  onWord: (word: { start: number; length: number } | null) => void;
  onClose: () => void; notify: (message: string) => void;
}) {
  const chunks = useMemo(() => speechChunks(text), [text]);
  const toggle = useRef<(() => void) | null>(null);
  const updateRate = useRef<((rate: number) => void) | null>(null);
  const rate = useRef(settings.speed);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    rate.current = settings.speed;
    updateRate.current?.(settings.speed);
  }, [settings.speed]);

  useEffect(() => {
    let cancelled = false;
    let run = 0;
    let index = 0;
    let paused = false;
    let rateChangedWhilePaused = false;
    let browser = preview;
    let player: HTMLAudioElement | null = null;
    let audioUrl: string | null = null;
    let request: AbortController | null = null;
    let wordOffset = 0;
    let utterance: SpeechSynthesisUtterance | null = null;
    let voicesWaited = false;
    const background = new AbortController();
    const prefetched = new Map<string, Promise<{ ok: boolean; status: number; body: { audioContent?: unknown; mimeType?: unknown; marks?: unknown; reason?: unknown } | null }>>();
    const speak = (chunkText: string, token: string, abort?: AbortSignal, prefetch = false) => {
      const waiting = prefetched.get(chunkText);
      if (waiting) { if (!prefetch) prefetched.delete(chunkText); return waiting; }
      const signals = [background.signal, AbortSignal.timeout(40_000), ...(abort ? [abort] : [])];
      const pending = fetch("/api/speak", {
        method: "POST", signal: AbortSignal.any(signals),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: chunkText, voice: settings.voice }),
      }).then(async response => ({ ok: response.ok, status: response.status, body: await response.json().catch(() => null) }));
      if (prefetch) { prefetched.set(chunkText, pending); pending.catch(() => prefetched.delete(chunkText)); }
      return pending;
    };
    const cleanAudio = () => {
      player?.pause(); player = null;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    };
    function finish() {
      setPlaying(false); setLoading(false); setProgress(100); onWord(null);
    }
    async function playChunk(next: number, offset?: number) {
      await Promise.resolve();
      if (cancelled) return;
      const ticket = ++run;
      request?.abort(); cleanAudio();
      window.speechSynthesis?.cancel(); utterance = null;
      index = next;
      if (index >= chunks.length) { finish(); return; }
      const full = chunks[index];
      const start = Math.max(full.offset, offset ?? full.offset);
      const chunk = { text: full.text.slice(start - full.offset), offset: start };
      wordOffset = start;
      paused = false; setLoading(true); setPlaying(false);
      const current = () => !cancelled && run === ticket;
      const highlight = (position: number, length: number) => {
        if (!current() || paused) return;
        wordOffset = chunk.offset + position;
        onWord({ start: wordOffset, length });
        setProgress(Math.min(99, wordOffset / Math.max(1, text.length) * 100));
      };
      const device = () => {
        if (!current()) return;
        if (!("speechSynthesis" in window)) {
          setLoading(false); notify("Audio unavailable on this device"); return;
        }
        browser = true;
        // Chrome loads its voice list late; wait briefly so we don't fall back to the default robotic voice.
        if (!window.speechSynthesis.getVoices().length && !voicesWaited) {
          voicesWaited = true; setLoading(true);
          const ready = () => { window.speechSynthesis.removeEventListener("voiceschanged", ready); clearTimeout(timer); device(); };
          const timer = setTimeout(ready, 1000);
          window.speechSynthesis.addEventListener("voiceschanged", ready);
          return;
        }
        const speech = new SpeechSynthesisUtterance(chunk.text);
        utterance = speech;
        speech.rate = rate.current;
        const selected = pickDeviceVoice(window.speechSynthesis.getVoices(), settings.voice, navigator.language);
        if (selected) { speech.voice = selected; speech.lang = selected.lang; }
        speech.onstart = () => { if (current()) { setLoading(false); setPlaying(true); } };
        speech.onboundary = event => {
          if (event.name === "word") highlight(event.charIndex, event.charLength || (chunk.text.slice(event.charIndex).match(/^\S+/)?.[0].length ?? 1));
        };
        speech.onend = () => { if (current()) void playChunk(index + 1); };
        speech.onerror = event => {
          if (current() && !["canceled", "interrupted"].includes(event.error)) {
            setLoading(false); setPlaying(false); notify("Audio unavailable");
          }
        };
        setLoading(false);
        window.speechSynthesis.speak(speech);
      };
      if (browser || chunk.text.length > 2000) { device(); return; }
      try {
        const supabase = getSupabase();
        const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
        if (!current()) return;
        if (!data.session) { setLoading(false); notify("Please log in again"); return; }
        request = new AbortController();
        const response = await speak(chunk.text, data.session.access_token, request.signal);
        if (!current()) return;
        if (response.status === 401 || response.status === 403) { setLoading(false); notify("Pro access unavailable. Refresh and try again"); return; }
        if (!response.ok) {
          const reason = typeof response.body?.reason === "string" ? response.body.reason : `HTTP_${response.status}`;
          console.warn("SID Listen: cloud voice unavailable, using device voice.", reason);
          notify(`HD voice unavailable (${VOICE_PROBLEMS[reason] ?? reason}). Using your device’s voice`); device();
          return;
        }
        const result = response.body;
        if (!result || typeof result !== "object") throw Error("audio_unavailable");
        // Start generating the next chunk now so there is no long gap between clips.
        const following = chunks[index + 1];
        if (following) void speak(following.text, data.session.access_token, undefined, true);
        if (typeof result.audioContent !== "string") throw Error("audio_unavailable");
        const bytes = Uint8Array.from(atob(result.audioContent), char => char.charCodeAt(0));
        audioUrl = URL.createObjectURL(new Blob([bytes], { type: typeof result.mimeType === "string" ? result.mimeType : "audio/mpeg" }));
        const element = new Audio(audioUrl);
        player = element;
        element.playbackRate = rate.current;
        let marks: SpeechMark[] = Array.isArray(result.marks) ? result.marks : [];
        // HD voices return no timepoints; estimate word timing once the length is known.
        element.onloadedmetadata = () => {
          if (!marks.length) marks = estimateMarks(chunk.text, element.duration);
        };
        element.ontimeupdate = () => {
          if (!current() || paused) return;
          const mark = marks.findLast(mark => mark.time <= element.currentTime);
          if (mark) highlight(mark.start, mark.length);
          if (element.duration > 0 && Number.isFinite(element.duration)) {
            setProgress(Math.min(99, (chunk.offset + chunk.text.length * element.currentTime / element.duration) / Math.max(1, text.length) * 100));
          }
        };
        element.onended = () => { if (current()) void playChunk(index + 1); };
        element.onplay = () => { if (current()) { setLoading(false); setPlaying(true); } };
        element.onerror = () => { if (current()) { cleanAudio(); notify("Using your device’s voice"); device(); } };
        setLoading(false);
        try { await element.play(); } catch { if (current()) { paused = true; setPlaying(false); } }
      } catch {
        if (current()) { notify("Using your device’s voice"); device(); }
      }
    }
    toggle.current = () => {
      if (player) {
        paused = !player.paused;
        if (paused) player.pause(); else void player.play().catch(() => notify("Tap Play to listen"));
        setPlaying(!paused);
      } else if (utterance && window.speechSynthesis?.speaking) {
        if (paused && rateChangedWhilePaused) { rateChangedWhilePaused = false; void playChunk(index, wordOffset); return; }
        paused = !paused;
        if (paused) window.speechSynthesis.pause(); else window.speechSynthesis.resume();
        setPlaying(!paused);
      } else { void playChunk(index >= chunks.length ? 0 : index); }
    };
    updateRate.current = speed => {
      if (player) player.playbackRate = speed;
      else if (utterance && !paused) void playChunk(index, wordOffset);
      else if (utterance && paused) rateChangedWhilePaused = true;
    };
    void playChunk(0);
    return () => {
      cancelled = true; run++; request?.abort(); background.abort(); cleanAudio();
      window.speechSynthesis?.cancel(); toggle.current = null; updateRate.current = null;
    };
  }, [chunks, text, settings.voice, preview, onWord, notify]);

  return <div className="listen-player" aria-label="Listen player">
    <button type="button" className="player-toggle" disabled={loading} aria-label={loading ? "Loading audio" : playing ? "Pause reading" : progress >= 100 ? "Replay reading" : "Resume reading"} onClick={() => toggle.current?.()}>
      <Icon name={playing ? "pause" : "play"} />
    </button>
    <progress max="100" value={progress} aria-label="Reading progress" />
    {loading && <span role="status" className="player-status">Loading<LoadingDots /></span>}
    <button type="button" className="icon-button player-close" aria-label="Close Listen" onClick={onClose}><Icon name="close" /></button>
  </div>;
}
