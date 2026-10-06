import type { Pixels } from "../integration/png.js";

/*
 * Image comparison for the visual regression suite (issue #32): a
 * difference hash for "looks the same" and a pixel count for "is the same",
 * both on StarUML's own PNG export of a golden spec.
 */

const gray = (p: Pixels, i: number) =>
  0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]!;

/** Mean grey of the image cut into a cols x rows grid, cell by cell. */
function cells(p: Pixels, cols: number, rows: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x0, x1] = [
        Math.floor((c * p.width) / cols),
        Math.max(
          Math.floor(((c + 1) * p.width) / cols),
          Math.floor((c * p.width) / cols) + 1,
        ),
      ];
      const [y0, y1] = [
        Math.floor((r * p.height) / rows),
        Math.max(
          Math.floor(((r + 1) * p.height) / rows),
          Math.floor((r * p.height) / rows) + 1,
        ),
      ];
      let sum = 0;
      let n = 0;
      for (let y = y0; y < Math.min(y1, p.height); y++) {
        for (let x = x0; x < Math.min(x1, p.width); x++) {
          sum += gray(p, (y * p.width + x) * 4);
          n++;
        }
      }
      out.push(n > 0 ? sum / n : 255);
    }
  }
  return out;
}

/** dHash: 64 bits, each whether a cell is brighter than its right neighbour. */
export function dhash(p: Pixels): string {
  const g = cells(p, 9, 8);
  let bits = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      bits += g[r * 9 + c]! > g[r * 9 + c + 1]! ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Share of pixels whose colour differs by more than `tolerance` in some
 * channel; 1 when the sizes differ.
 */
export function pixelDiff(a: Pixels, b: Pixels, tolerance = 32): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let differ = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(a.data[i + k]! - b.data[i + k]!) > tolerance) {
        differ++;
        break;
      }
    }
  }
  return differ / (a.width * a.height);
}

export interface Baseline {
  hash: string;
  score: number;
  width: number;
  height: number;
}

/** Thresholds: at most this many differing hash bits and this share of pixels. */
export const MAX_HASH_DISTANCE = 6;
export const MAX_PIXEL_DIFF = 0.01;
