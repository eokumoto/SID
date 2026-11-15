export type ScanErrorCode =
  | "no_text"
  | "blurry"
  | "too_big"
  | "wrong_type"
  | "busy"
  | "timeout"
  | "network"
  | "server";

export type ScanErrorCopy = {
  title: string;
  detail: string;
  canRetry: boolean;
};

const messages: Record<ScanErrorCode, ScanErrorCopy> = {
  no_text: { title: "No words found", detail: "Try a photo of a menu, sign or page", canRetry: false },
  blurry: { title: "Too blurry", detail: "Hold steady and try again", canRetry: false },
  too_big: { title: "Photo too big", detail: "Try a smaller photo", canRetry: false },
  wrong_type: { title: "Can’t open this file", detail: "Use a JPG, PNG or HEIC photo", canRetry: false },
  busy: { title: "Taking too long", detail: "Try again in a moment", canRetry: true },
  timeout: { title: "Taking too long", detail: "Try again in a moment", canRetry: true },
  network: { title: "No connection", detail: "Check your internet", canRetry: true },
  server: { title: "Something went wrong", detail: "Try again", canRetry: true },
};

export function scanErrorCode(value: unknown): ScanErrorCode {
  if (typeof value === "string" && Object.hasOwn(messages, value))
    return value as ScanErrorCode;
  return "server";
}

export function scanErrorCopy(value: unknown): ScanErrorCopy {
  return messages[scanErrorCode(value)];
}
