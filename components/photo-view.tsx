"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./ui/icon";
import { ScanImage } from "./ui/scan-image";
import { fitPhoto, type TextRegion } from "@/lib/transcription";
import { useReaderSettings } from "@/lib/settings";

type OverlayPlacement = {
  region: TextRegion;
  left: number;
  top: number;
  width: number;
  height: number;
  vertical: boolean;
};

function overlapArea(first: OverlayPlacement, second: OverlayPlacement) {
  const left = Math.max(first.left - first.width / 2, second.left - second.width / 2);
  const top = Math.max(first.top - first.height / 2, second.top - second.height / 2);
  const right = Math.min(first.left + first.width / 2, second.left + second.width / 2);
  const bottom = Math.min(first.top + first.height / 2, second.top + second.height / 2);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function placeRegions(regions: TextRegion[]) {
  const placed = regions.map((region): OverlayPlacement => {
    const [top, left, bottom, right] = region.box_2d;
    const width = (right - left) / 10;
    const height = (bottom - top) / 10;
    return {
      region,
      left: (left + right) / 20,
      top: (top + bottom) / 20,
      width,
      height,
      // Vertical source text needs a horizontal reading line inside a rotated box.
      vertical: height > width * 1.35,
    };
  });
  return placed.reduce<{ placements: OverlayPlacement[]; removed: number }>((resolved, placement) => {
    const previous = resolved.placements.find((candidate) => {
      const intersection = overlapArea(candidate, placement);
      return intersection > 0.15 * Math.min(candidate.width * candidate.height, placement.width * placement.height);
    });
    if (!previous) return { ...resolved, placements: [...resolved.placements, placement] };
    const previousBottom = previous.top + previous.height / 2;
    const placementBottom = placement.top + placement.height / 2;
    const heightAfterOverlap = placementBottom - previousBottom;
    if (heightAfterOverlap <= 0.5) return { ...resolved, removed: resolved.removed + 1 };
    return {
      ...resolved,
      placements: [...resolved.placements, {
        ...placement,
        top: previousBottom + heightAfterOverlap / 2,
        height: heightAfterOverlap,
      }],
    };
  }, { placements: [], removed: 0 });
}

function TextOverlay({ placement, font }: { placement: OverlayPlacement; font: string }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = box.current;
    const content = text.current;
    if (!element || !content) return;
    const fit = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      let low = 1;
      let high = Math.max(1, element.clientHeight);
      for (let index = 0; index < 14; index += 1) {
        const size = (low + high) / 2;
        content.style.fontSize = `${size}px`;
        if (content.scrollWidth <= element.clientWidth && content.scrollHeight <= element.clientHeight) low = size;
        else high = size;
      }
      content.style.fontSize = `${low}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, [placement.region.text, font]);
  const boxWidth = placement.vertical ? placement.height : placement.width;
  const boxHeight = placement.vertical ? placement.width : placement.height;
  return (
    <div ref={box} className={`photo-text-region${placement.vertical ? " vertical" : ""}`} style={{
      left: `${placement.left}%`, top: `${placement.top}%`, width: `${boxWidth}%`, height: `${boxHeight}%`,
      transform: `translate(-50%, -50%)${placement.vertical ? " rotate(-90deg)" : ""}`, fontFamily: font,
    }}>
      <span ref={text}>{placement.region.text}</span>
    </div>
  );
}

export const SWIPE_DISTANCE = 60;

export function PhotoView({
  url,
  regions = [],
  onOverlayRemoved,
  onSwipeBack,
}: {
  url: string;
  regions?: TextRegion[];
  onOverlayRemoved?: () => void;
  onSwipeBack?: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // One-finger touch gesture that started at 100% zoom; a right swipe returns to the text view.
  const swipe = useRef<{ id: number; x: number; y: number; multi: boolean } | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [original, setOriginal] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const settings = useReaderSettings();
  const fitted = fitPhoto(imageSize, frameSize);
  const overlayLayout = useMemo(
    () => placeRegions(regions),
    [regions],
  );
  const placements = overlayLayout.placements;
  const reportedRemoval = useRef(false);
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
  useEffect(() => {
    if (!overlayLayout.removed || reportedRemoval.current) return;
    reportedRemoval.current = true;
    onOverlayRemoved?.();
  }, [onOverlayRemoved, overlayLayout.removed]);
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
          if (pointers.current.size > 0) {
            if (swipe.current) swipe.current.multi = true;
          } else {
            swipe.current = e.pointerType === "touch" && transform.scale <= 1
              ? { id: e.pointerId, x: e.clientX, y: e.clientY, multi: false } : null;
          }
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
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          const gesture = swipe.current;
          if (!gesture || gesture.id !== e.pointerId) return;
          swipe.current = null;
          const dx = e.clientX - gesture.x;
          const dy = e.clientY - gesture.y;
          if (!gesture.multi && dx > SWIPE_DISTANCE && Math.abs(dy) < dx * 0.5) onSwipeBack?.();
        }}
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
              {placements.map((placement, index) => (
                <TextOverlay
                  key={index}
                  placement={placement}
                  font={settings.font}
                />
              ))}
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
