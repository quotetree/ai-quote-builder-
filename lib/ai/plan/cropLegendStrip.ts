import sharp from "sharp";

/** Bottom band — common but not universal. */
const BOTTOM_STRIP_RATIO = 0.24;
/** Corner crops for legends placed bottom-left or bottom-right. */
const CORNER_WIDTH_RATIO = 0.42;
const CORNER_HEIGHT_RATIO = 0.36;

async function cropRegion(
  buffer: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  return sharp(buffer).extract(region).png().toBuffer();
}

/**
 * Crop likely legend areas (format varies by survey vendor).
 * Returns multiple crops so vision can find the legend wherever it sits.
 */
export async function cropLegendRegions(buffer: Buffer): Promise<Buffer[]> {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 10 || height < 10) return [buffer];

  const crops: Buffer[] = [];

  const stripHeight = Math.max(Math.round(height * BOTTOM_STRIP_RATIO), 120);
  crops.push(
    await cropRegion(buffer, {
      left: 0,
      top: Math.max(0, height - stripHeight),
      width,
      height: stripHeight,
    }),
  );

  const cornerW = Math.max(Math.round(width * CORNER_WIDTH_RATIO), 200);
  const cornerH = Math.max(Math.round(height * CORNER_HEIGHT_RATIO), 150);

  crops.push(
    await cropRegion(buffer, {
      left: 0,
      top: Math.max(0, height - cornerH),
      width: Math.min(cornerW, width),
      height: Math.min(cornerH, height),
    }),
  );

  crops.push(
    await cropRegion(buffer, {
      left: Math.max(0, width - cornerW),
      top: Math.max(0, height - cornerH),
      width: Math.min(cornerW, width),
      height: Math.min(cornerH, height),
    }),
  );

  return crops;
}

/** @deprecated Use cropLegendRegions */
export async function cropLegendStrip(buffer: Buffer): Promise<Buffer> {
  const regions = await cropLegendRegions(buffer);
  return regions[0] ?? buffer;
}
