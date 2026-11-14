"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui/icon";
import { ScanImage } from "./ui/scan-image";

export function PhotoView({
  url,
  sample = false,
}: {
  url: string;
  sample?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [original, setOriginal] = useState(!sample);
  const zoom = (factor: number) =>
    setTransform((t) => ({
      ...t,
      scale: Math.max(1, Math.min(5, t.scale * factor)),
    }));
  useEffect(() => {
    const element = viewport.current;
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
    return () => element?.removeEventListener("wheel", wheel);
  }, []);
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
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          {/* Local photos and signed Storage URLs must render without an optimizer proxy. */}

          <ScanImage src={url} alt="Original scan" draggable={false} />
          {sample && !original && (
            <div
              className="sample-overlays"
              aria-label="Sample rewritten overlay"
            >
              <div
                style={{ left: "8%", top: "16%", width: "84%", height: "9%" }}
              >
                Free flu shots
              </div>
              <div
                style={{ left: "8%", top: "28%", width: "84%", height: "8%" }}
              >
                At the Rec Center
              </div>
              <div
                style={{ left: "8%", top: "37%", width: "84%", height: "15%" }}
              >
                Sat, Nov 21
                <br />
                10 AM to 2 PM
              </div>
              <div
                style={{ left: "8%", top: "54%", width: "84%", height: "8%" }}
              >
                Bring your student ID.
              </div>
              <div
                style={{ left: "8%", top: "63%", width: "84%", height: "8%" }}
              >
                Cost: Free
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="photo-toolbar">
        {sample ? (
          <div className="segment original-toggle">
            <button
              type="button"
              aria-pressed={!original}
              onClick={() => setOriginal(false)}
            >
              Rewritten
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
