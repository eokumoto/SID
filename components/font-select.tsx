"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_FONT, READER_FONTS, fontStack, type ReaderFont } from "@/lib/fonts";
import { Icon } from "./ui/icon";

// Font dropdown for Settings. Each option is shown in its own font, which a
// native <select> can't do on every browser, so this is a small listbox.
export function FontSelect({
  value,
  onChange,
}: {
  value: ReaderFont;
  onChange: (font: ReaderFont) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => READER_FONTS.indexOf(value));
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function show() {
    setActive(READER_FONTS.indexOf(value));
    setOpen(true);
  }
  function choose(font: ReaderFont) {
    onChange(font);
    setOpen(false);
    button.current?.focus();
  }
  function onListKey(event: React.KeyboardEvent) {
    const last = READER_FONTS.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(READER_FONTS[active]);
    } else if (event.key === "Escape") {
      // Close only the list, not the Settings dialog.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  const label = (font: ReaderFont) => (
    <span className="font-select-name">
      {font}
      {font === DEFAULT_FONT && <span className="font-default">Default</span>}
    </span>
  );

  return (
    <div className="font-select" ref={root}>
      <button
        ref={button}
        type="button"
        className="font-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`font-label ${id}-value`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span id={`${id}-value`} style={{ fontFamily: fontStack(value) }}>
          {label(value)}
        </span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <ul
          ref={list}
          className="font-options"
          role="listbox"
          tabIndex={-1}
          aria-labelledby="font-label"
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
        >
          {READER_FONTS.map((font, index) => (
            <li
              key={font}
              id={`${id}-${index}`}
              role="option"
              aria-selected={font === value}
              data-active={index === active || undefined}
              style={{ fontFamily: fontStack(font) }}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(font)}
            >
              {label(font)}
              {font === value && <Icon name="check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
