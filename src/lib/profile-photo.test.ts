import { describe, expect, it } from "vitest";

import {
  PROFILE_PHOTO_MAX_SOURCE_BYTES,
  ProfilePhotoValidationError,
  detectImageMime,
  validateProfilePhotoContents,
  validateStoredProfilePhoto,
  validateProfilePhotoSource,
} from "@/lib/profile-photo";

describe("foto de perfil", () => {
  it("reconhece assinaturas reais e recusa conteúdo ativo disfarçado", () => {
    expect(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageMime(new TextEncoder().encode("RIFFxxxxWEBP"))).toBe("image/webp");
    expect(detectImageMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("limita tipos e tamanho antes da decodificação", () => {
    expect(() => validateProfilePhotoSource({ type: "image/png", size: 1024 })).not.toThrow();
    expect(() => validateProfilePhotoSource({ type: "image/svg+xml", size: 1024 }))
      .toThrow(ProfilePhotoValidationError);
    expect(() => validateProfilePhotoSource({
      type: "image/jpeg",
      size: PROFILE_PHOTO_MAX_SOURCE_BYTES + 1,
    })).toThrow(ProfilePhotoValidationError);
  });

  it("confere a assinatura real contra o MIME declarado", async () => {
    const disguised = new File(["<svg onload=alert(1)>"], "photo.png", {
      type: "image/png",
    });
    await expect(validateProfilePhotoContents(disguised))
      .rejects.toMatchObject({ code: "type" });
  });

  it("aceita no servidor somente WebP normalizado dentro do teto", () => {
    const webp = new TextEncoder().encode("RIFFxxxxWEBPpayload");
    expect(() => validateStoredProfilePhoto(webp, "image/webp")).not.toThrow();
    expect(() => validateStoredProfilePhoto(webp, "image/png"))
      .toThrow(ProfilePhotoValidationError);
  });
});
