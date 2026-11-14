"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

export function Capture() {
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ url: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!photo) return;
    return () => URL.revokeObjectURL(photo.url);
  }, [photo]);

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose an image under 5 MB.");
      return;
    }
    setError("");
    setPhoto({ url: URL.createObjectURL(file) });
  }

  return (
    <div className="capture">
      <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectPhoto} hidden aria-label="Take picture" />
      <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto} hidden aria-label="Upload file" />
      <div className="capture-actions">
        <button className="capture-button camera-button" type="button" onClick={() => cameraInput.current?.click()}>
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 12l3-5h8l3 5h8a4 4 0 014 4v21a4 4 0 01-4 4H9a4 4 0 01-4-4V16a4 4 0 014-4h8z" />
            <circle cx="24" cy="26" r="9" />
          </svg>
          Take picture
        </button>
        <button className="capture-button upload-button" type="button" onClick={() => uploadInput.current?.click()}>
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M24 31V7m-8 8l8-8 8 8M8 29v10a3 3 0 003 3h26a3 3 0 003-3V29" />
          </svg>
          Upload file
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {photo && (
        <div className="photo-preview">
          {/* Blob URLs stay in this browser; no remote image optimizer is needed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="Selected photo preview" onError={() => { setPhoto(null); setError("This image couldn’t be opened. Try another photo."); }} />
          <button className="remove-photo" type="button" aria-label="Remove photo" onClick={() => { setPhoto(null); setError(""); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
