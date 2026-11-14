export function scanStatus(status: string, startedAt?: string | null): "queued" | "processing" | "ready" | "failed" {
  if (status === "ready" || status === "queued") return status;
  if (status === "processing" && startedAt && Date.now() - Date.parse(startedAt) < 120_000) return "processing";
  return "failed";
}
