"use client";

import { useRef, useState } from "react";
import type { Scan } from "@/lib/ui-types";
import { Icon } from "./ui/icon";
import { ScanImage } from "./ui/scan-image";

function HistoryRow({
  scan,
  onOpen,
  onDelete,
  onRetry,
}: {
  scan: Scan;
  onOpen: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const start = useRef({ x: 0, y: 0 });
  const [swiped, setSwiped] = useState(false);
  return (
    <li
      className={`history-row ${swiped ? "swiped" : ""}`}
      onPointerDown={(e) => {
        if (e.pointerType === "touch")
          start.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== "touch" || e.buttons !== 1) return;
        const dx = e.clientX - start.current.x,
          dy = e.clientY - start.current.y;
        if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.5)
          setSwiped(dx < 0);
      }}
    >
      <button
        type="button"
        className="swipe-delete"
        onClick={onDelete}
        tabIndex={swiped ? 0 : -1}
        aria-hidden={!swiped}
      >
        <Icon name="trash" />
        Delete
      </button>
      <div className="history-row-inner">
        <button type="button" className="history-open" onClick={onOpen}>
          {scan.photoUrl ? (
            <>
              <ScanImage src={scan.photoUrl} alt="" />
            </>
          ) : (
            <span className="history-photo-placeholder" aria-hidden="true" />
          )}
          <span className="history-meta">
            <span className="history-title">{scan.title}</span>
            {scan.status === "failed" ? (
              <span className="failed-label">
                <Icon name="blur" />
                Didn’t work
              </span>
            ) : (
              <time dateTime={scan.createdAt}>
                {scan.id === "sample-flu"
                  ? "Today"
                  : new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(scan.createdAt))}
              </time>
            )}
          </span>
        </button>
        {scan.status === "failed" && (
          <button type="button" className="retry-button" onClick={onRetry}>
            <Icon name="retry" />
            Retry
          </button>
        )}
        <button
          type="button"
          className="icon-button delete-trigger"
          aria-label={`Delete ${scan.title}`}
          title="Delete"
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}
export function HistoryList({
  scans,
  loading,
  error,
  onUpload,
  onOpen,
  onDelete,
  onRetry,
  onRefresh,
}: {
  scans: Scan[];
  loading: boolean;
  error: boolean;
  onUpload: () => void;
  onOpen: (scan: Scan) => void;
  onDelete: (scan: Scan) => void;
  onRetry: (scan: Scan) => void;
  onRefresh: () => void;
}) {
  if (loading)
    return (
      <div className="center-stage">
        <Icon name="history" className="state-icon muted-icon" />
        <p role="status">Loading</p>
      </div>
    );
  if (error)
    return (
      <div className="center-stage">
        <div className="error-icon">
          <Icon name="offline" />
        </div>
        <h1>No connection</h1>
        <button className="button" onClick={onRefresh}>
          Try again
        </button>
      </div>
    );
  if (!scans.length)
    return (
      <div className="center-stage">
        <Icon name="history" className="empty-history-icon" />
        <button className="button" onClick={onUpload}>
          <Icon name="upload" />
          Upload
        </button>
      </div>
    );
  return (
    <section className="history-screen" aria-label="History">
      <ul className="history-list">
        {scans.map((scan) => (
          <HistoryRow
            key={scan.id}
            scan={scan}
            onOpen={() => onOpen(scan)}
            onRetry={() => onRetry(scan)}
            onDelete={() => onDelete(scan)}
          />
        ))}
      </ul>
    </section>
  );
}
