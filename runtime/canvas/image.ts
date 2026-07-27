/* GameImage: a decoded bitmap, ready to draw.
 *
 * Decoding is synchronous native work through Skia's codecs (png, jpeg,
 * webp, gif first frame). There is no Image element and no onload: assets
 * load during a load screen or at startup, which is what games do anyway.
 */
import * as ffi from "../ffi.js";
import * as sk from "./skia-ffi.js";

export class GameImage {
  handle = 0;
  width = 0;
  height = 0;

  constructor(handle: number) {
    this.handle = handle;
    if (handle !== 0) {
      this.width = sk.bitmapGetWidth(handle);
      this.height = sk.bitmapGetHeight(handle);
    }
  }

  get valid(): boolean { return this.handle !== 0; }

  dispose(): void {
    if (this.handle !== 0) { sk.bitmapDestroy(this.handle); this.handle = 0; }
  }
}

/** Decodes encoded image bytes. Returns an invalid image on failure. */
export function decodeImage(bytes: Buffer): GameImage {
  return new GameImage(ffi.imageDecode(bytes));
}
