/** Crop only validated MinerU content_list coordinates; never guess another parser's units. */
export function pdfRegion(box: number[] | undefined, width: number, height: number) {
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[0]! < 0 || box[1]! < 0
    || box[2]! > 1000 || box[3]! > 1000 || box[2]! <= box[0]! || box[3]! <= box[1]!
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const left = box[0]! * width / 1000;
  const top = box[1]! * height / 1000;
  const right = box[2]! * width / 1000;
  const bottom = box[3]! * height / 1000;
  return { left, top, width: Math.ceil(right - left), height: Math.ceil(bottom - top) };
}

export type PdfRegion = NonNullable<ReturnType<typeof pdfRegion>>;

/** Include intersecting native labels and the complete PDF image object; do not add arbitrary margins. */
export function completeFigureRegion(region: PdfRegion, labels: PdfRegion[], images: PdfRegion[], width: number, height: number): PdfRegion {
  const right = region.left + region.width, bottom = region.top + region.height;
  let left = region.left, top = region.top, endX = right, endY = bottom;
  const intersects = (box: PdfRegion) => box.left < right && box.top < bottom && box.left + box.width > region.left && box.top + box.height > region.top;
  for (const box of [...labels, ...images.filter(box => {
    if (box.left <= 0 && box.top <= 0 && box.left + box.width >= width && box.top + box.height >= height) return false;
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    return x >= region.left && x <= right && y >= region.top && y <= bottom;
  })]) {
    if (![box.left,box.top,box.width,box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || !intersects(box)) continue;
    left = Math.max(0, Math.min(left, box.left)); top = Math.max(0, Math.min(top, box.top));
    endX = Math.min(width, Math.max(endX, box.left + box.width)); endY = Math.min(height, Math.max(endY, box.top + box.height));
  }
  if (left === region.left && top === region.top && endX === right && endY === bottom) return region;
  left = Math.floor(left); top = Math.floor(top);
  return { left, top, width: Math.ceil(endX - left), height: Math.ceil(endY - top) };
}
