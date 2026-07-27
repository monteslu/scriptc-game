/* Patterns: an image used as a repeating fill.
 *
 * createPattern(image, repeat) where repeat is one of "repeat", "repeat-x",
 * "repeat-y", "no-repeat". Skia expresses this as a per-axis tile mode, so
 * the four CSS names decompose into two independent modes.
 */
import * as ffi from "../../host/ffi.js";
import * as sk from "../../host/skia-ffi.js";
import { TILE_CLAMP, TILE_REPEAT, TILE_DECAL } from "../../host/skia-enums.js";
import { Image } from "./image.js";

export class Pattern {
  private shader = 0;

  constructor(img: Image, repeat: string) {
    // "no-repeat" is DECAL (draw once, transparent outside) rather than
    // CLAMP (smear the edge pixels forever), which is what canvas means.
    let rx = TILE_REPEAT;
    let ry = TILE_REPEAT;
    if (repeat === "repeat-x") ry = TILE_DECAL;
    else if (repeat === "repeat-y") rx = TILE_DECAL;
    else if (repeat === "no-repeat") { rx = TILE_DECAL; ry = TILE_DECAL; }
    this.shader = ffi.shaderFromBitmap(img.handle, rx, ry);
  }

  handle(): number { return this.shader; }

  dispose(): void {
    if (this.shader !== 0) { sk.shaderDestroy(this.shader); this.shader = 0; }
  }
}

export function createPattern(img: Image, repeat: string): Pattern {
  return new Pattern(img, repeat);
}
