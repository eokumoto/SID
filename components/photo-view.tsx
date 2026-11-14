"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui/icon";
import { ScanImage } from "./ui/scan-image";
import { fitPhoto, type TextRegion } from "@/lib/transcription";
import { useReaderSettings } from "@/lib/settings";

function TextOverlay({ region, font }: { region: TextRegion; font: string }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = box.current, content = text.current;
    if (!element || !content) return;
    let active = true;
    const fit = () => {
      if (!active || !element.clientWidth || !element.clientHeight) return;
      // Measure real DOM glyphs after the chosen font loads. Never crop or
      // shorten transcription to make it fit a box.
      let low = 0.5, high = element.clientHeight;
      for (let i = 0; i < 14; i++) {
        const size = (low + high) / 2;
        content.style.fontSize = `${size}px`;
        if (content.offsetWidth <= element.clientWidth - 2 && content.offsetHeight <= element.clientHeight - 1) low = size;
        else high = size;
      }
      content.style.fontSize = `${low}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener("loadingdone", fit);
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener("loadingdone", fit); };
  }, [region.text, font]);
  const [top, left, bottom, right] = region.box_2d;
  return (
    <div ref={box} className="photo-text-region" style={{ left: `${left / 10}%`, top: `${top / 10}%`, width: `${(right - left) / 10}%`, height: `${(bottom - top) / 10}%`, fontFamily: font }}>
      <span ref={text}>{region.text}</span>
    </div>
  );
}

export function PhotoView({
  url,
  regions = [],
}: {
  url: string;
  regions?: TextRegion[];
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [original, setOriginal] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const settings = useReaderSettings();
  const fitted = fitPhoto(imageSize, frameSize);
  const zoom = (factor: number) =>
    setTransform((t) => ({
      ...t,
      scale: Math.max(1, Math.min(5, t.scale * factor)),
    }));
  useEffect(() => {
    const element = viewport.current;
    const measure = () => {
      if (!element) return;
      const style = getComputedStyle(element);
      setFrameSize({
        width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      });
      // Server-rendered or cached images can finish loading before React
      // attaches onLoad. Read their intrinsic size during the first measure.
      const image = element.querySelector("img");
      if (image?.naturalWidth && image.naturalHeight) {
        setImageSize((current) => current.width === image.naturalWidth && current.height === image.naturalHeight
          ? current : { width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    const observer = new ResizeObserver(measure);
    if (element) observer.observe(element);
    function wheel(event: WheelEvent) {
      event.preventDefault();
      setTransform((t) => ({
        ...t,
        scale: Math.max(
          1,
          Math.min(
            5,
            t.scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)),
          ),
        ),
      }));
    }
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); element?.removeEventListener("wheel", wheel); };
  }, [url]);
  if (!url)
    return (
      <div className="photo-view center-stage">
        <span className="missing-photo">
          <Icon name="photo" />
          Photo unavailable
        </span>
      </div>
    );
  return (
    <div className="photo-view">
      <div
        className="photo-viewport"
        ref={viewport}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }}
        onPointerMove={(e) => {
          const previous = pointers.current.get(e.pointerId);
          if (!previous) return;
          const before = [...pointers.current.values()];
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const after = [...pointers.current.values()];
          if (before.length === 2) {
            const distance = (p: typeof before) =>
              Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
            const factor = distance(after) / Math.max(1, distance(before));
            setTransform((t) => ({
              x: t.x + (e.clientX - previous.x) / 2,
              y: t.y + (e.clientY - previous.y) / 2,
              scale: Math.max(1, Math.min(5, t.scale * factor)),
            }));
          } else
            setTransform((t) => ({
              ...t,
              x: t.x + e.clientX - previous.x,
              y: t.y + e.clientY - previous.y,
            }));
        }}
        onPointerUp={(e) => pointers.current.delete(e.pointerId)}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
      >
        <div
          className="photo-canvas"
          style={{
            ...(fitted ?? {}),
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          {/* Local photos and signed Storage URLs must render without an optimizer proxy. */}

          <ScanImage src={url} alt="Original scan" draggable={false}
            onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
          {!!regions.length && !original && fitted && (
            <div className="photo-text-overlays" aria-label="Original text in a readable font">
              {regions.map((region, index) => <TextOverlay key={index} region={region} font={settings.font} />)}
            </div>
          )}
        </div>
      </div>
      <div className="photo-toolbar">
        {regions.length ? (
          <div className="segment original-toggle">
            <button
              type="button"
              aria-pressed={!original}
              onClick={() => setOriginal(false)}
            >
              Readable
            </button>
            <button
              type="button"
              aria-pressed={original}
              onClick={() => setOriginal(true)}
            >
              <Icon name="eye" />
              Original
            </button>
          </div>
        ) : (
          <span className="original-label">
            <Icon name="eye" />
            Original
            <span className="overlay-unavailable"> · Scan again for overlay</span>
          </span>
        )}
        <div className="zoom-controls">
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoom(1 / 1.25)}
            disabled={transform.scale <= 1}
          >
            <Icon name="minus" />
          </button>
          <button
            type="button"
            className="zoom-reset"
            aria-label="Reset zoom and position"
            title="Reset view"
            onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
          >
            {Math.round(transform.scale * 100)}%
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoom(1.25)}
            disabled={transform.scale >= 5}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
    </div>
  );
}
