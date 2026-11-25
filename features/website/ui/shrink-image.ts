/** Phone photos are 8 to 12 MB; the site never shows one wider than 2000px. Shrink before upload so it is quick and under the limit. */
export async function shrink(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1_500_000) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], `${file.name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" }) : file;
  } catch { return file; }
}

