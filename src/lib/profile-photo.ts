export const PROFILE_PHOTO_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PROFILE_PHOTO_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_MAX_STORED_BYTES = 1024 * 1024;
export const PROFILE_PHOTO_MAX_DIMENSION = 512;

export class ProfilePhotoValidationError extends Error {
  constructor(readonly code: "type" | "size" | "decode" | "encode") {
    super(code);
    this.name = "ProfilePhotoValidationError";
  }
}

export function detectImageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

export function validateProfilePhotoSource(file: Pick<File, "size" | "type">): void {
  if (!PROFILE_PHOTO_ACCEPTED_TYPES.includes(file.type as typeof PROFILE_PHOTO_ACCEPTED_TYPES[number])) {
    throw new ProfilePhotoValidationError("type");
  }
  if (file.size <= 0 || file.size > PROFILE_PHOTO_MAX_SOURCE_BYTES) {
    throw new ProfilePhotoValidationError("size");
  }
}

export async function validateProfilePhotoContents(file: File): Promise<void> {
  validateProfilePhotoSource(file);
  const header = new Uint8Array(await new Response(file.slice(0, 16)).arrayBuffer());
  if (detectImageMime(header) !== file.type) {
    throw new ProfilePhotoValidationError("type");
  }
}

export function validateStoredProfilePhoto(
  bytes: Uint8Array,
  contentType: string,
): void {
  if (
    contentType !== "image/webp" ||
    bytes.byteLength <= 0 ||
    bytes.byteLength > PROFILE_PHOTO_MAX_STORED_BYTES ||
    detectImageMime(bytes) !== "image/webp"
  ) {
    throw new ProfilePhotoValidationError(
      bytes.byteLength > PROFILE_PHOTO_MAX_STORED_BYTES ? "size" : "type",
    );
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new ProfilePhotoValidationError("encode")),
      "image/webp",
      quality,
    );
  });
}

/** Recorta, reduz e recodifica: a nova imagem nao carrega EXIF do arquivo fonte. */
export async function normalizeProfilePhoto(file: File): Promise<File> {
  await validateProfilePhotoContents(file);
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new ProfilePhotoValidationError("decode");
  }
  try {
    const side = Math.min(image.width, image.height);
    const sourceX = Math.floor((image.width - side) / 2);
    const sourceY = Math.floor((image.height - side) / 2);
    const target = Math.min(side, PROFILE_PHOTO_MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new ProfilePhotoValidationError("encode");
    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, target, target);
    let blob = await canvasBlob(canvas, 0.84);
    if (blob.size > PROFILE_PHOTO_MAX_STORED_BYTES) blob = await canvasBlob(canvas, 0.68);
    if (blob.type !== "image/webp" || blob.size > PROFILE_PHOTO_MAX_STORED_BYTES) {
      throw new ProfilePhotoValidationError("encode");
    }
    return new File([blob], "avatar.webp", { type: "image/webp" });
  } finally {
    image.close();
  }
}
