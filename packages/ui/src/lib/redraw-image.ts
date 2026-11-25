/**
 * Draw a picked picture again on a canvas and give back the new file (longest side at most `maxSide`). The copy carries
 * only pixels, so location data and camera details in the original are gone. PNG stays PNG; everything else becomes JPEG.
 * Null when the browser cannot read the picture. Browser only.
 */
export async function redrawImage(file: File, maxSide: number, quality = 0.9): Promise<File | null> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const png = file.type === "image/png";
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, png ? "image/png" : "image/jpeg", quality));
    return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.${png ? "png" : "jpg"}`, { type: blob.type }) : null;
  } catch { return null; }
}
