"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./icon";

export function Dialog({
  label,
  className = "",
  onClose,
  children,
}: {
  label: string;
  className?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`dialog ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-content">
        <div className="sheet-handle" aria-hidden="true" />
        <button
          type="button"
          className="icon-button dialog-close"
          aria-label={`Close ${label.toLowerCase()}`}
          title="Close"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        {children}
      </div>
    </dialog>
  );
}
