"use client";

import { useRef, useState } from "react";
import type { ReaderSettings, Scan } from "@/lib/ui-types";
import { summaryUnavailable } from "@/lib/pro";
import { getSupabase } from "@/lib/supabase/client";
import { Icon } from "./ui/icon";
import { LoadingDots } from "./ui/loading-dots";
import { ScanImage } from "./ui/scan-image";
import { PhotoView } from "./photo-view";
import { ListenPlayer } from "./listen-player";

export function ReaderView({ scan, notify, settings, pro, onUpgrade, initialView = "text", initialSummary = false, onNewPhoto, onOverlayRemoved }: {
  scan: Scan; settings: ReaderSettings; pro: boolean; onUpgrade: () => void;
  initialView?: "text" | "photo"; initialSummary?: boolean; onNewPhoto?: () => void;
  onOverlayRemoved?: (documentId: string) => void;
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<"text" | "photo">(initialView);
  const [listening, setListening] = useState(false);
  const [word, setWord] = useState<{ start: number; length: number } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(initialSummary);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [summaryMessage, setSummaryMessage] = useState("");
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryRequest = useRef(false);
  const unavailable = summaryUnavailable(scan.text);
  const blocks = scan.sections.length ? scan.sections : [{ text: scan.text }];
  const fullBlocks = blocks.map(block => block.label ? `${block.label}: ${block.text}` : block.text);
  const fullText = fullBlocks.join("\n\n");
  const demoBullets = scan.id === "sample-housing" && !unavailable ? [
    "Move out by Dec 18, 5 PM.",
    "Leave your key at the front desk.",
    "Rooms will be checked on Dec 19. Items left behind will be stored for 30 days.",
  ] : null;

  async function toggleSummary() {
    if (!pro) { onUpgrade(); return; }
    setView("text");
    setSummaryOpen(open => !open);
    if (summaryOpen || summary || (summaryMessage && !summaryFailed) || unavailable || demoBullets || summaryRequest.current) return;
    summaryRequest.current = true;
    setSummaryMessage("");
    setSummaryFailed(false);
    setSummaryLoading(true);
    try {
      const supabase = getSupabase();
      const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
      if (!data.session || scan.sample) throw Error("unavailable");
      const response = await fetch("/api/summary", {
        method: "POST", signal: AbortSignal.timeout(35_000),
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: scan.id }),
      });
      if (response.status === 403) { setSummaryOpen(false); onUpgrade(); return; }
      const result = await response.json();
      if (!response.ok) throw Error("unavailable");
      if (typeof result.reason === "string") setSummaryMessage(result.reason);
      else if (Array.isArray(result.bullets) && result.bullets.every((text: unknown) => typeof text === "string")) setSummary(result.bullets);
      else throw Error("unavailable");
    } catch { setSummaryMessage("Couldn’t create a summary. Your full text is still here."); setSummaryFailed(true); }
    finally { summaryRequest.current = false; setSummaryLoading(false); }
  }

  const openPhoto = () => { setView("photo"); setSummaryOpen(false); };
  const bullets = summary ?? demoBullets;
  const articleBlocks = fullBlocks.map((text, index) => {
    const start = fullBlocks.slice(0, index).reduce((length, block) => length + block.length + 2, 0);
    const highlight = word && word.start >= start && word.start < start + text.length
      ? { start: word.start - start, length: word.length } : null;
    return <p key={index} className={index === 0 ? "reader-lead" : ""}>
      {highlight ? <>{text.slice(0, highlight.start)}<mark>{text.slice(highlight.start, highlight.start + highlight.length)}</mark>{text.slice(highlight.start + highlight.length)}</> : <>{blocks[index].label && <strong>{blocks[index].label}: </strong>}{blocks[index].text}</>}
    </p>;
  });

  return <section className={`reader-screen ${view === "photo" ? "show-photo" : ""} ${listening ? "has-listen-player" : ""}`} aria-label="Reader">
    <div className="reader-meta">{scan.sample && <span className="sample-label">Sample</span>}</div>
    <div className="reader-top reader-toggle-sticky">
      <div className="segment view-toggle" aria-label="Reader view">
        <button type="button" aria-pressed={view === "text"} onClick={() => setView("text")}><Icon name="document" />Text</button>
        <button type="button" aria-pressed={view === "photo"} onClick={openPhoto}><Icon name="photo" />Photo</button>
      </div>
      <div className="reader-actions">
        <button type="button" className={`reader-action ${listening ? "active" : ""}`} aria-pressed={listening} onClick={() => {
          if (!pro) { onUpgrade(); return; }
          if (listening) setWord(null);
          setListening(!listening);
        }}><Icon name="speaker" />Listen{!pro && <span className="pro-tag">Pro</span>}</button>
        <button type="button" className={`reader-action ${summaryOpen ? "active" : ""} ${pro && unavailable ? "unavailable" : ""}`} aria-expanded={summaryOpen} onClick={() => void toggleSummary()}><Icon name="summary" />Summary{!pro && <span className="pro-tag">Pro</span>}</button>
      </div>
    </div>
    {scan.warnings?.some(warning => warning === "vision_disabled" || warning === "vision_unavailable") && <p className="sample-label" role="status">Second read unavailable; check the original.</p>}
    {view === "text" ? <>
      <div className="reader-split">
        <article className="reader-panel" aria-label="Transcribed text"><div className="reader-copy">{articleBlocks}</div></article>
        <div className="reader-side">
          {summaryOpen && <aside className={`summary-panel ${unavailable ? "summary-unavailable" : ""}`} aria-label="Summary" aria-busy={summaryLoading}>
            <h2>Summary</h2>
            {summaryLoading ? <p role="status">Creating summary<LoadingDots /></p> : bullets && !unavailable ? <><ul>{bullets.map((bullet, i) => <li key={i}>{bullet}</li>)}</ul><p className="summary-note">Full text stays visible.</p></> : <p role="status">{unavailable || summaryMessage || "Select Summary to get started."}</p>}
          </aside>}
          <button type="button" className="original-photo" aria-label="Open original photo" title="Open photo" onClick={openPhoto}>
            {scan.photoUrl ? <ScanImage src={scan.photoUrl} alt="Original scan" /> : <span className="missing-photo"><Icon name="photo" />Photo unavailable</span>}
          </button>
        </div>
      </div>
      <div className="mobile-reader-tools"><button type="button" className="photo-thumbnail" aria-label="Open original photo" title="Open photo" onClick={openPhoto}>
        {scan.photoUrl ? <ScanImage src={scan.photoUrl} alt="Original scan thumbnail" /> : <Icon name="photo" />}
      </button></div>
    </> : <PhotoView key={scan.id} url={scan.photoUrl} regions={scan.textRegions} onNewPhoto={onNewPhoto} onOverlayRemoved={scan.sample ? undefined : () => onOverlayRemoved?.(scan.id)} />}
    {listening && pro && <ListenPlayer text={fullText} settings={settings} preview={!!scan.sample} onWord={setWord} notify={notify} onClose={() => { setListening(false); setWord(null); }} />}
  </section>;
}
