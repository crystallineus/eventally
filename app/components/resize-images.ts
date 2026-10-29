// Browser-only: shrink photos before upload so a claim fits in one request
// (Vercel caps function request bodies at about 4.5 MB).

const MAX_EDGE = 1600;
const QUALITY = 0.85;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export async function resizeImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image`);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`Can't read ${file.name}. Try a JPEG or PNG photo.`);
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Can't compress ${file.name}`))), "image/jpeg", QUALITY),
  );
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** Returns a copy of the form data with every file field resized to a JPEG. */
export async function withResizedImages(form: HTMLFormElement): Promise<FormData> {
  const source = new FormData(form);
  const out = new FormData();
  let total = 0;
  for (const [name, value] of source.entries()) {
    if (value instanceof File) {
      if (value.size === 0) continue; // empty file input
      const resized = await resizeImage(value);
      total += resized.size;
      out.append(name, resized);
    } else {
      out.append(name, value);
    }
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("These photos are too large together. Upload fewer at a time.");
  return out;
}
