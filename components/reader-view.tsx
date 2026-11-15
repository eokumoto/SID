"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReaderSettings, Scan } from "@/lib/ui-types";
import { Icon } from "./ui/icon";
import { ScanImage } from "./ui/scan-image";
import { PhotoView, SWIPE_DISTANCE } from "./photo-view";
import { ListenPlayer } from "./listen-player";

export function ReaderView({ scan, notify, settings, pro, onUpgrade, initialView = "text", onOverlayRemoved }: {
  scan: Scan; settings: ReaderSettings; pro: boolean; onUpgrade: () => void;
  initialView?: "text" | "photo";
  onOverlayRemoved?: (documentId: string) => void;
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<"text" | "photo">(initialView);
  // A signed photo URL can expire while the reader is open; fall back to the placeholder.
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoUrl = photoFailed ? "" : scan.photoUrl;
  const [listening, setListening] = useState(false);
  const [word, setWord] = useState<{ start: number; length: number } | null>(null);
  const blocks = scan.sections.length ? scan.sections : [{ text: scan.text }];
  const fullBlocks = blocks.map(block => block.label ? `${block.label}: ${block.text}` : block.text);
  const fullText = fullBlocks.join("\n\n");


  // Copy puts the whole transcription on the clipboard; the icon shows a check for 2 seconds after.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copyText() {
    try { await navigator.clipboard.writeText(fullText); setCopied(true); }
    catch { notify("Couldn’t copy. Select the text to copy it instead"); }
  }

  // Set only by a swipe, so the incoming view slides in from that side; taps switch without animating.
  const [swipeIn, setSwipeIn] = useState<"from-right" | "from-left" | null>(null);
  const openPhoto = () => { setView("photo"); setSwipeIn(null); };
  // Fit the toggle box to its content: if Listen wraps below Text/Photo, stack them
  // (so the box hugs the widest row instead of spanning the full width). Then, if a Pro tag
  // would push Listen past one line, show the tag as a star instead.
  const top = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = top.current;
    const row = actions.current;
    const toggle = box?.querySelector<HTMLElement>(".view-toggle");
    const container = box?.parentElement;
    if (!box || !row || !toggle || !container) return;
    const fit = () => {
      box.classList.remove("stacked");
      row.classList.remove("compact-tags");
      box.classList.toggle("stacked", row.offsetTop > toggle.offsetTop + 2);
      if (pro) return;
      const overflows = [...row.querySelectorAll<HTMLElement>(".reader-action")]
        .some(button => button.scrollWidth > button.clientWidth + 1);
      row.classList.toggle("compact-tags", overflows);
    };
    fit();
    // Watch the reader (not the box itself), since fitting changes the box's own size.
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [pro, settings]);
  // Touch swipe left on the text view opens the photo (the photo view handles swiping back).
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const startSwipe = (event: React.TouchEvent) => {
    const target = event.target as Element;
    swipeStart.current = view === "text" && event.touches.length === 1 && !target.closest("input, .listen-player")
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  };
  const endSwipe = (event: React.TouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (dx < -SWIPE_DISTANCE && Math.abs(dy) < Math.abs(dx) * 0.5) { openPhoto(); setSwipeIn("from-right"); }
  };
  const articleBlocks = fullBlocks.map((text, index) => {
    const start = fullBlocks.slice(0, index).reduce((length, block) => length + block.length + 2, 0);
    const highlight = word && word.start >= start && word.start < start + text.length
      ? { start: word.start - start, length: word.length } : null;
    return <p key={index} className={index === 0 ? "reader-lead" : ""}>
      {highlight ? <>{text.slice(0, highlight.start)}<mark>{text.slice(highlight.start, highlight.start + highlight.length)}</mark>{text.slice(highlight.start + highlight.length)}</> : <>{blocks[index].label && <strong>{blocks[index].label}: </strong>}{blocks[index].text}</>}
    </p>;
  });

  return <section className={`reader-screen ${view === "photo" ? "show-photo" : ""} ${listening ? "has-listen-player" : ""} ${swipeIn ? `swipe-${swipeIn}` : ""}`} aria-label="Reader" onTouchStart={startSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { swipeStart.current = null; }}>
    <div className="reader-meta">{scan.sample && <span className="sample-label">Sample</span>}</div>
    <div className="reader-top reader-toggle-sticky" ref={top}>
      <div className="segment view-toggle" aria-label="Reader view">
        <button type="button" aria-pressed={view === "text"} onClick={() => { setView("text"); setSwipeIn(null); }}><Icon name="document" />Text</button>
        <button type="button" aria-pressed={view === "photo"} onClick={openPhoto}><Icon name="photo" />Photo</button>
      </div>
      <div className="reader-actions" ref={actions}>
        <button type="button" className={`reader-action ${listening ? "active" : ""}`} aria-pressed={listening} onClick={() => {
          if (!pro) { onUpgrade(); return; }
          if (listening) setWord(null);
          setListening(!listening);
        }}><Icon name="speaker" />Listen{!pro && <span className="pro-tag"><span className="pro-tag-label">Pro</span><Icon name="star" /></span>}</button>
      </div>
    </div>
    {view === "text" ? <>
      <div className="reader-split">
        <article className="reader-panel" aria-label="Transcribed text"><button type="button" className="reader-copy-button" aria-label={copied ? "Copied" : "Copy text"} title={copied ? "Copied" : "Copy text"} onClick={() => void copyText()}><Icon name={copied ? "check" : "copy"} /></button><div className="reader-copy">{articleBlocks}</div></article>
        <div className="reader-side">
          <button type="button" className="original-photo" aria-label="Open original photo" title="Open photo" onClick={openPhoto}>
            {photoUrl ? <ScanImage src={photoUrl} alt="Original scan" onError={() => setPhotoFailed(true)} /> : <span className="missing-photo"><Icon name="photo" />Photo unavailable</span>}
          </button>
        </div>
      </div>
      <div className="mobile-reader-tools"><button type="button" className="photo-thumbnail" aria-label="Open original photo" title="Open photo" onClick={openPhoto}>
        {photoUrl ? <ScanImage src={photoUrl} alt="Original scan thumbnail" onError={() => setPhotoFailed(true)} /> : <Icon name="photo" />}
      </button></div>
    </> : <PhotoView key={scan.id} url={photoUrl} regions={scan.textRegions} onOverlayRemoved={scan.sample ? undefined : () => onOverlayRemoved?.(scan.id)} onSwipeBack={() => { setView("text"); setSwipeIn("from-left"); }} />}
    {listening && pro && <ListenPlayer text={fullText} settings={settings} preview={!!scan.sample} onWord={setWord} notify={notify} onClose={() => { setListening(false); setWord(null); }} />}
  </section>;
}
