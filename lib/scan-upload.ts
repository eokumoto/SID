export const PROCESS_BUCKET = "process-uploads";
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";

const photoTypes = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
} as const;

export type PhotoExtension = keyof typeof photoTypes;

export function photoMimeType(extension: string) {
  return Object.hasOwn(photoTypes, extension)
    ? photoTypes[extension as PhotoExtension]
    : null;
}

export function photoExtension(file: { name: string; type: string }) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = photoMimeType(extension);
  if (
    !mime ||
    (file.type &&
      file.type !== "application/octet-stream" &&
      file.type !== mime)
  ) {
    return null;
  }
  return (extension === "jpeg" ? "jpg" : extension) as PhotoExtension;
}

// Check the actual file header, not just a caller-controlled name or MIME type.
export function detectPhotoType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte))
    return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const boxSize = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0);
    for (let i = 8; i + 4 <= Math.min(bytes.length, boxSize); i += 4) {
      if (
        i !== 12 &&
        ["heic", "heix", "hevc", "hevx"].includes(ascii(i, i + 4))
      )
        return "image/heic";
    }
  }
  return null;
}

export function isOwnedPhotoPath(path: string, userId: string) {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return (
    new RegExp(`^${uuid}/${uuid}\\.(jpg|jpeg|png|webp|heic)$`).test(path) &&
    path.split("/")[0] === userId
  );
}
