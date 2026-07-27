/* Offscreen surfaces and pixel readback.
 *
 * `createCanvas(w, h)` is the sg.createCanvas of API-SURFACE.md: a Context2D
 * backed by its own surface, usable as a drawImage/drawCanvas source. It
 * OWNS its surface, so dispose() frees it (the screen context does not own
 * its surface and must not).
 *
 * Readback is the one place the web shape demands bulk data OUT, which FFI
 * format 1 cannot express. It is implemented as one native-side rect read
 * plus a per-pixel scalar getter, and is documented as debug-tier: real
 * screenshots go through saveImage(), which never crosses the boundary.
 */
import * as ffi from "../../host/ffi.js";
import * as sk from "../../host/skia-ffi.js";
import { Context2D } from "./context.js";

/** An offscreen drawing surface. Dispose it when done. */
export function createCanvas(width: number, height: number): Context2D | null {
  const surface = ffi.surfaceCreate(width, height);
  if (surface === 0) return null;
  return new Context2D(sk.surfaceGetCanvas(surface), surface);
}

/** RGBA pixels read back from a surface, in canvas ImageData order. */
export class ImageData {
  width = 0;
  height = 0;
  data: number[] = [];
}

/* One FFI call per PIXEL. At measured prices (~3ns) a 64x64 block is about
 * 12us, which is fine for a debug inspect and ruinous for a per-frame
 * readback. Use saveImage() for screenshots and keep game state in TS. */
export function getImageData(ctx: Context2D, x: number, y: number,
                             w: number, h: number): ImageData | null {
  const surface = ctx.surfaceHandle();
  if (surface === 0) return null;   // screen context: no readback source
  if (ffi.readbackBegin(surface, x, y, w, h) !== 0) return null;

  const out = new ImageData();
  out.width = w;
  out.height = h;
  const count = w * h;
  for (let i = 0; i < count; i++) {
    const px = ffi.readbackPixel(i);
    // Skia wrote RGBA bytes; unpack little-endian into canvas order.
    out.data.push(px & 255);
    out.data.push((px >>> 8) & 255);
    out.data.push((px >>> 16) & 255);
    out.data.push((px >>> 24) & 255);
  }
  return out;
}

/** Writes a surface to a PNG file. 0 on success. */
export function saveImage(ctx: Context2D, path: string): number {
  return ffi.surfaceSavePng(ctx.surfaceHandle(), path);
}
