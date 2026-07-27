/* HTMLImageElement: `new Image()`, set `.src`, get `onload`.
 *
 * `Image` IS the drawable, exactly as in a browser. `ctx.drawImage(img, x, y)`
 * takes this class, and a game never sees or names a separate bitmap type.
 *
 * The decode underneath is synchronous native work through Skia's codecs
 * (png, jpeg, webp, bmp, gif), but the callback fires from the task queue so
 * that attaching `onload` AFTER setting `src` still works, which is how most
 * real code is written.
 *
 * Lives here rather than in globals.ts because Context2D needs the type and
 * globals.ts imports Context2D; the other direction is a circular import,
 * which is a hard compiler error (SC1016).
 */
import * as ffi from "../../host/ffi.js";
import * as sk from "../../host/skia-ffi.js";
import { queueTask } from "../../host/tasks.js";
import { resolveUrl, readBinary, warnAsset } from "../../host/resources.js";

export class Image {
  width = 0;
  height = 0;
  complete = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  /* The Skia bitmap handle. Internal: drawImage reads it, games do not.
   * Zero means nothing is loaded, which is also the "draw nothing" case. */
  handle = 0;
  private srcUrl = "";

  get src(): string { return this.srcUrl; }

  set src(url: string) {
    this.srcUrl = url;
    const path = resolveUrl(url);
    // Decode NOW (it is a native call) but report LATER, so ordering matches
    // a browser: the assignment returns before any handler runs.
    const bytes = readBinary(path);
    if (bytes === null) {
      warnAsset("image", url, `not found at ${path}`);
      queueTask(() => { this.fireError(); });
      return;
    }
    const h = ffi.imageDecode(bytes);
    if (h === 0) {
      warnAsset("image", url, "unsupported or corrupt");
      queueTask(() => { this.fireError(); });
      return;
    }
    this.handle = h;
    this.width = sk.bitmapGetWidth(h);
    this.height = sk.bitmapGetHeight(h);
    queueTask(() => {
      this.complete = true;
      this.fireLoad();
    });
  }

  /* A field holding a function cannot be called as `this.onload()` (SC1090
   * reads it as a method call), so it is copied to a local first. */
  private fireLoad(): void {
    const fn = this.onload;
    if (fn !== null) fn();
  }

  private fireError(): void {
    const fn = this.onerror;
    if (fn !== null) fn();
  }

  /** The modern promise form. Settles on a later turn, as the spec requires. */
  decode(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      queueTask(() => {
        if (this.handle !== 0) resolve();
        else reject(new Error(`could not decode ${this.srcUrl}`));
      });
    });
  }

  /** Releases the bitmap. Not a web API; the host and tests use it. */
  dispose(): void {
    if (this.handle !== 0) { sk.bitmapDestroy(this.handle); this.handle = 0; }
  }
}

/* Decodes encoded bytes straight to a loaded Image, skipping src/onload.
 *
 * Host and test use only: the conformance suite needs a loaded image without
 * running a task queue, and there is no web equivalent of "already decoded".
 * Games use `new Image()` with `src`. */
export function imageFromBytes(bytes: Buffer): Image {
  const img = new Image();
  const h = ffi.imageDecode(bytes);
  if (h !== 0) {
    img.handle = h;
    img.width = sk.bitmapGetWidth(h);
    img.height = sk.bitmapGetHeight(h);
    img.complete = true;
  }
  return img;
}
