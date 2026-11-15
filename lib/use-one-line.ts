"use client";

import { useEffect, type RefObject } from "react";

const MIN_FONT_RATIO = 0.7;

const overflows = (element: Element | null) =>
  !!element && element.scrollWidth > element.clientWidth + 1;

// Keep the navbar on one row: drop to icon-only labels, then hide the wordmark text.
function fitNavbar(root: HTMLElement) {
  const navbar = root.querySelector<HTMLElement>(".navbar");
  if (!navbar) return;
  const tooWide = () =>
    overflows(navbar) || overflows(navbar.querySelector("nav")) || overflows(navbar.querySelector(".wordmark"));
  navbar.classList.remove("nav-compact", "nav-minimal");
  if (!tooWide()) return;
  navbar.classList.add("nav-compact");
  if (tooWide()) navbar.classList.add("nav-minimal");
}

// Any button whose single-line label is wider than the button gets a smaller font, down to 70%.
function fitButtons(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("button, .button").forEach((element) => {
    if (element.classList.contains("upload-dropzone")) return;
    element.style.removeProperty("font-size");
    if (!overflows(element)) return;
    let size = parseFloat(getComputedStyle(element).fontSize);
    const min = size * MIN_FONT_RATIO;
    while (overflows(element) && size > min) {
      size -= 0.5;
      element.style.fontSize = `${size}px`;
    }
  });
}

/** Keeps labels in `root` on one line without spilling over; re-runs on resize, content and setting changes. */
export function useOneLineLabels(root: RefObject<HTMLElement | null>, settingsKey: unknown) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        fitNavbar(element);
        fitButtons(element);
      });
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(element);
    const mutation = new MutationObserver(fit);
    mutation.observe(element, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(fit);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [root, settingsKey]);
}
