import { inflateSync } from "node:zlib";

/**
 * A decoded 8-bit RGB or RGBA PNG (RFC 2083), enough to read the pixels of
 * the images StarUML's canvas exports: no palette, no interlacing.
 */
export interface Pixels {
  width: number;
  height: number;
  /** RGBA bytes, row by row. */
  data: Uint8Array;
}

export function decodePng(png: Buffer): Pixels {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) {
        throw new Error(`unsupported PNG: depth ${depth} colour ${color}`);
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (row[i]! + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 4; k++) {
        out[(y * width + x) * 4 + k] =
          k < channels ? line[x * channels + k]! : 255;
      }
    }
    prev.set(line);
  }
  return { width, height, data: out };
}

/** Whether the pixel at (x, y) is dark: drawn ink on a white background. */
export function dark(p: Pixels, x: number, y: number): boolean {
  const i = (Math.round(y) * p.width + Math.round(x)) * 4;
  const [r, g, b, a] = [
    p.data[i]!,
    p.data[i + 1]!,
    p.data[i + 2]!,
    p.data[i + 3]!,
  ];
  return a > 0 && (r + g + b) / 3 < 160;
}

/** Dark pixels within a rectangle, in pixel coordinates. */
export function inkIn(
  p: Pixels,
  rect: { x: number; y: number; width: number; height: number },
): number {
  let n = 0;
  for (
    let y = Math.max(0, rect.y);
    y < Math.min(p.height, rect.y + rect.height);
    y++
  ) {
    for (
      let x = Math.max(0, rect.x);
      x < Math.min(p.width, rect.x + rect.width);
      x++
    ) {
      if (dark(p, x, y)) n++;
    }
  }
  return n;
}

/** The pixel at (x, y) as "#rrggbb". */
export function colorAt(p: Pixels, x: number, y: number): string {
  const i = (Math.round(y) * p.width + Math.round(x)) * 4;
  return `#${[0, 1, 2].map((k) => p.data[i + k]!.toString(16).padStart(2, "0")).join("")}`;
}
