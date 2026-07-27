/* Gradients.
 *
 * A gradient is built stop-by-stop TS-side and only materialized into a Skia
 * shader on first use, because the canvas API lets stops be added after the
 * gradient object is created and even after it has been assigned to
 * fillStyle. Materializing lazily (and re-materializing when stops change)
 * is what makes that ordering work.
 */
import * as ffi from "../../host/ffi.js";
import * as sk from "../../host/skia-ffi.js";
import { parseColor } from "./color.js";
import { TILE_CLAMP } from "../../host/skia-enums.js";

const KIND_LINEAR = 0;
const KIND_RADIAL = 1;
const KIND_CONIC = 2;

export class Gradient {
  private kind = KIND_LINEAR;
  private x0 = 0; private y0 = 0; private r0 = 0;
  private x1 = 0; private y1 = 0; private r1 = 0;
  private angle = 0;

  private offsets: number[] = [];
  private colors: number[] = [];

  private shader = 0;
  private dirty = true;

  constructor(kind: number, x0: number, y0: number, r0: number,
              x1: number, y1: number, r1: number, angle: number) {
    this.kind = kind;
    this.x0 = x0; this.y0 = y0; this.r0 = r0;
    this.x1 = x1; this.y1 = y1; this.r1 = r1;
    this.angle = angle;
  }

  addColorStop(offset: number, css: string): void {
    if (!(offset >= 0 && offset <= 1)) return;
    const c = parseColor(css);
    // Skia wants a packed ARGB colour per stop.
    const argb = ((c.a & 255) << 24) | ((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255);
    this.offsets.push(offset);
    this.colors.push(argb >>> 0);
    this.dirty = true;
  }

  /** Materializes (or re-materializes) the Skia shader. 0 if unusable. */
  handle(): number {
    if (!this.dirty) return this.shader;
    this.dirty = false;
    if (this.shader !== 0) { sk.shaderDestroy(this.shader); this.shader = 0; }
    // A gradient with fewer than two stops paints nothing, matching canvas.
    if (this.offsets.length < 2) return 0;

    ffi.gradReset();
    for (let i = 0; i < this.offsets.length; i++) {
      ffi.gradAddStop(this.offsets[i], this.colors[i]);
    }
    if (this.kind === KIND_LINEAR) {
      this.shader = ffi.shaderLinearGradient(this.x0, this.y0, this.x1, this.y1, TILE_CLAMP);
    } else if (this.kind === KIND_RADIAL) {
      this.shader = ffi.shaderRadialGradient(this.x0, this.y0, this.r0,
                                             this.x1, this.y1, this.r1, TILE_CLAMP);
    } else {
      this.shader = ffi.shaderConicGradient(this.x0, this.y0, this.angle, TILE_CLAMP);
    }
    return this.shader;
  }

  dispose(): void {
    if (this.shader !== 0) { sk.shaderDestroy(this.shader); this.shader = 0; }
    this.dirty = true;
  }
}

export function createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient {
  return new Gradient(KIND_LINEAR, x0, y0, 0, x1, y1, 0, 0);
}

export function createRadialGradient(x0: number, y0: number, r0: number,
                                     x1: number, y1: number, r1: number): Gradient {
  return new Gradient(KIND_RADIAL, x0, y0, r0, x1, y1, r1, 0);
}

/** startAngle is in radians, as in the web API; Skia wants degrees. */
export function createConicGradient(startAngle: number, cx: number, cy: number): Gradient {
  return new Gradient(KIND_CONIC, cx, cy, 0, 0, 0, 0, startAngle * 57.29577951308232);
}
