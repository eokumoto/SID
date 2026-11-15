"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { ReaderSettings } from "@/lib/ui-types";
import { speechChunks, type SpeechMark } from "@/lib/speech";
import { getSupabase } from "@/lib/supabase/client";
import { Icon } from "./ui/icon";
import { LoadingDots } from "./ui/loading-dots";

export function ListenPlayer({ text, settings, preview, onWord, onClose, notify }: {
  text: string; settings: ReaderSettings; preview: boolean;
  onWord: (word: { start: number; length: number } | null) => void;
  onClose: () => void; notify: (message: string) => void;
}) {
  const chunks = useMemo(() => speechChunks(text), [text]);
  const toggle = useRef<(() => void) | null>(null);
  const updateRate = useRef<((rate: number) => void) | null>(null);
  const seek = useRef<((position: number) => void) | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const rate = useRef(settings.speed);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);

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
    let playingChunk: { text: string; offset: number } | null = null;
    let seekPending = false;
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
      playingChunk = chunk; seekPending = false;
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
        const speech = new SpeechSynthesisUtterance(chunk.text);
        utterance = speech;
        speech.rate = rate.current;
        const voices = window.speechSynthesis.getVoices().filter(voice => /^en\b/i.test(voice.lang));
        const selected = voices[({ Calm: 0, Clear: 1, Warm: 2 })[settings.voice] % Math.max(voices.length, 1)];
        if (selected) speech.voice = selected;
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
        const response = await fetch("/api/speak", {
          method: "POST", signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
          headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk.text, voice: settings.voice }),
        });
        if (!current()) return;
        if (response.status === 401 || response.status === 403) { setLoading(false); notify("Pro access unavailable. Refresh and try again"); return; }
        if (!response.ok) throw Error("audio_unavailable");
        const result = await response.json();
        if (!current()) return;
        if (typeof result.audioContent !== "string") throw Error("audio_unavailable");
        const bytes = Uint8Array.from(atob(result.audioContent), char => char.charCodeAt(0));
        audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
        const element = new Audio(audioUrl);
        player = element;
        element.playbackRate = rate.current;
        const marks: SpeechMark[] = Array.isArray(result.marks) ? result.marks : [];
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
      if (seekPending) { void playChunk(index, wordOffset); return; }
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
    seek.current = target => {
      if (cancelled || !text.trim()) return;
      // Snap to the start of the word under the target so speech never begins mid-word.
      let position = Math.min(Math.max(0, Math.round(target)), text.length - 1);
      while (position > 0 && /\S/u.test(text[position - 1])) position--;
      const ahead = text.slice(position).search(/\S/u);
      if (ahead < 0) { position = text.length - 1; while (position > 0 && /\S/u.test(text[position - 1])) position--; } else position += ahead;
      const next = Math.max(0, chunks.findLastIndex(chunk => chunk.offset <= position));
      const length = text.slice(position).match(/^\S+/u)?.[0].length ?? 1;
      const show = () => {
        wordOffset = position;
        onWord({ start: position, length });
        setProgress(Math.min(99, position / Math.max(1, text.length) * 100));
      };
      // Cloud audio already covering this spot: jump inside it instead of fetching again.
      const chunk = playingChunk;
      if (player && chunk && next === index && position >= chunk.offset && position < chunk.offset + chunk.text.length
        && Number.isFinite(player.duration) && player.duration > 0) {
        player.currentTime = (position - chunk.offset) / Math.max(1, chunk.text.length) * player.duration;
        show(); return;
      }
      if (!paused && index < chunks.length) { show(); void playChunk(next, position); return; }
      // Paused or finished: move there and wait for Play.
      run++; request?.abort(); cleanAudio();
      window.speechSynthesis?.cancel(); utterance = null;
      rateChangedWhilePaused = false; paused = true;
      index = next; seekPending = true;
      setLoading(false); setPlaying(false); show();
    };
    void playChunk(0);
    return () => {
      cancelled = true; run++; request?.abort(); cleanAudio();
      window.speechSynthesis?.cancel(); toggle.current = null; updateRate.current = null; seek.current = null;
    };
  }, [chunks, text, settings.voice, preview, onWord, notify]);

  const shown = scrub ?? progress;
  const at = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect();
    return box && box.width > 0 ? Math.min(100, Math.max(0, (clientX - box.left) / box.width * 100)) : shown;
  };
  const commit = (percent: number) => {
    scrubbing.current = false; setScrub(null);
    seek.current?.(percent / 100 * text.length);
  };
  const step = (event: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 10, PageDown: -10, Home: -100, End: 100 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    commit(Math.min(100, Math.max(0, progress + keys[event.key])));
  };

  return <div className="listen-player" aria-label="Listen player">
    <button type="button" className="player-toggle" disabled={loading} aria-label={loading ? "Loading audio" : playing ? "Pause reading" : progress >= 100 ? "Replay reading" : "Resume reading"} onClick={() => toggle.current?.()}>
      <Icon name={playing ? "pause" : "play"} />
    </button>
    <div ref={bar} className={`player-scrub ${scrub !== null ? "is-scrubbing" : ""}`} role="slider" tabIndex={0}
      aria-label="Reading position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown)} aria-valuetext={`${Math.round(shown)}% read`}
      style={{ "--progress": `${shown}%` } as CSSProperties}
      onPointerDown={event => {
        if (event.button > 0) return;
        event.preventDefault(); event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        scrubbing.current = true; setScrub(at(event.clientX));
      }}
      onPointerMove={event => { if (scrubbing.current) setScrub(at(event.clientX)); }}
      onPointerUp={event => { if (scrubbing.current) commit(at(event.clientX)); }}
      onPointerCancel={() => { scrubbing.current = false; setScrub(null); }}
      onKeyDown={step}>
      <span className="player-scrub-track"><span className="player-scrub-fill" /></span>
      <span className="player-scrub-thumb" />
    </div>
    {loading && <span role="status" className="player-status">Loading<LoadingDots /></span>}
    <button type="button" className="icon-button player-close" aria-label="Close Listen" onClick={onClose}><Icon name="close" /></button>
  </div>;
}
