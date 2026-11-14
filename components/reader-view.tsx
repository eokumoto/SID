"use client";

import { useEffect, useRef, useState } from "react";
import type { Scan } from "@/lib/ui-types";
import { Icon } from "./ui/icon";
import { ScanImage } from "./ui/scan-image";
import { PhotoView } from "./photo-view";

export function ReaderView({
  scan,
  notify,
  initialView = "text",
}: {
  scan: Scan;
  initialView?: "text" | "photo";
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<"text" | "photo">(initialView);
  const speechRun = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const [active, setActive] = useState<{
    block: number;
    start: number;
    length: number;
  } | null>(null);
  const blocks = scan.sections.length ? scan.sections : [{ text: scan.text }];
  useEffect(
    () => () => {
      speechRun.current += 1;
      window.speechSynthesis?.cancel();
    },
    [],
  );
  function speak() {
    if (!("speechSynthesis" in window)) {
      notify("Audio unavailable");
      return;
    }
    const run = ++speechRun.current;
    window.speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      setActive(null);
      return;
    }
    setSpeaking(true);
    blocks.forEach((block, index) => {
      const text = block.label ? `${block.label}: ${block.text}` : block.text;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.85;
      utterance.onstart = () => {
        if (run === speechRun.current)
          setActive({ block: index, start: 0, length: text.length });
      };
      utterance.onboundary = (event) => {
        if (run === speechRun.current && event.name === "word")
          setActive({
            block: index,
            start: event.charIndex,
            length:
              event.charLength ||
              (text.slice(event.charIndex).match(/^\S+/)?.[0].length ?? 1),
          });
      };
      utterance.onend = () => {
        if (run === speechRun.current && index === blocks.length - 1) {
          setSpeaking(false);
          setActive(null);
        }
      };
      utterance.onerror = (event) => {
        if (run !== speechRun.current) return;
        if (event.error !== "interrupted" && event.error !== "canceled")
          notify("Audio unavailable");
        setSpeaking(false);
        setActive(null);
      };
      window.speechSynthesis.speak(utterance);
    });
  }
  return (
    <section
      className={`reader-screen ${view === "photo" ? "show-photo" : ""}`}
      aria-label="Reader"
    >
      <div className="reader-top">
        <div className="segment view-toggle" aria-label="Reader view">
          <button
            type="button"
            aria-pressed={view === "text"}
            onClick={() => setView("text")}
          >
            Text
          </button>
          <button
            type="button"
            aria-pressed={view === "photo"}
            onClick={() => setView("photo")}
          >
            Photo
          </button>
        </div>
        {scan.sample && <span className="sample-label">Sample</span>}
      </div>
      {scan.warnings?.some((warning) => warning === "vision_disabled" || warning === "vision_unavailable") && (
        <p className="sample-label" role="status">Second read unavailable; check the original.</p>
      )}
      {view === "text" ? (
        <>
          <div className="reader-split">
            <article className="reader-panel" aria-label="Transcribed text">
              <div className="reader-copy">
                {blocks.map((block, index) => {
                  const full = block.label
                    ? `${block.label}: ${block.text}`
                    : block.text;
                  const highlight = active?.block === index ? active : null;
                  return (
                    <p key={index} className={index === 0 ? "reader-lead" : ""}>
                      {highlight ? (
                        <>
                          {full.slice(0, highlight.start)}
                          <mark>
                            {full.slice(
                              highlight.start,
                              highlight.start + highlight.length,
                            )}
                          </mark>
                          {full.slice(highlight.start + highlight.length)}
                        </>
                      ) : (
                        <>
                          {block.label && <strong>{block.label}: </strong>}
                          {block.text}
                        </>
                      )}
                    </p>
                  );
                })}
              </div>
              <button
                type="button"
                className="icon-button speaker-button"
                aria-label={speaking ? "Stop reading" : "Read aloud"}
                title={speaking ? "Stop reading" : "Read aloud"}
                aria-pressed={speaking}
                onClick={speak}
              >
                <Icon name={speaking ? "stop" : "speaker"} />
              </button>
            </article>
            <button
              type="button"
              className="original-photo"
              aria-label="Open original photo"
              title="Open photo"
              onClick={() => setView("photo")}
            >
              {scan.photoUrl ? (
                <>
                  <ScanImage src={scan.photoUrl} alt="Original scan" />
                </>
              ) : (
                <span className="missing-photo">
                  <Icon name="photo" />
                  Photo unavailable
                </span>
              )}
            </button>
          </div>
          <div className="mobile-reader-tools">
            <button
              type="button"
              className="photo-thumbnail"
              aria-label="Open original photo"
              title="Open photo"
              onClick={() => setView("photo")}
            >
              {scan.photoUrl ? (
                <>
                  <ScanImage
                    src={scan.photoUrl}
                    alt="Original scan thumbnail"
                  />
                </>
              ) : (
                <Icon name="photo" />
              )}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={speaking ? "Stop reading" : "Read aloud"}
              title={speaking ? "Stop reading" : "Read aloud"}
              aria-pressed={speaking}
              onClick={speak}
            >
              <Icon name={speaking ? "stop" : "speaker"} />
            </button>
          </div>
        </>
      ) : (
        <PhotoView
          key={scan.id}
          url={scan.photoUrl}
          regions={scan.textRegions}
        />
      )}
    </section>
  );
}
