/* Texture. API-compatible with three for the fields games set.
 *
 * The source is an `Image` (decoded by the web layer) or an offscreen
 * Context2D, which is what makes a canvas-rendered HUD usable as a texture.
 * Uploading is the renderer's job.
 */
import { Image } from "../../web/canvas/image.js";
import { Context2D } from "../../web/canvas/context.js";
import { WebGLTexture } from "../../web/webgl/objects.js";

/** three's wrap and filter constants. */
export const RepeatWrapping = 1000;
export const ClampToEdgeWrapping = 1001;
export const NearestFilter = 1003;
export const LinearFilter = 1006;

export class Texture {
  image: Image | null = null;
  /** An offscreen 2D canvas as a texture source: the HUD path. */
  canvas: Context2D | null = null;

  wrapS: number = ClampToEdgeWrapping;
  wrapT: number = ClampToEdgeWrapping;
  magFilter: number = LinearFilter;
  minFilter: number = LinearFilter;
  flipY = true;

  /* UV transform, three's `texture.offset` / `texture.repeat`.
   *
   * The sampled coordinate is `uv * repeat + offset`, which is how a SPRITE
   * SHEET is addressed: a 4-frame strip is repeat=(0.25,1) with offset
   * stepping 0, 0.25, 0.5, 0.75. Without it a sheet renders as every frame
   * squeezed onto one quad, which looks like a squashed sprite rather than
   * an obvious mistake. */
  offsetX = 0;
  offsetY = 0;
  repeatX = 1;
  repeatY = 1;

  /** three spells this `texture.offset.set(x, y)`. */
  setOffset(x: number, y: number): Texture {
    this.offsetX = x;
    this.offsetY = y;
    return this;
  }

  /** three spells this `texture.repeat.set(x, y)`. */
  setRepeat(x: number, y: number): Texture {
    this.repeatX = x;
    this.repeatY = y;
    return this;
  }

  /** Re-upload on the next draw. Set this after redrawing a canvas source. */
  needsUpdate = true;

  /* A render target's colour attachment: its pixels come from being drawn
   * INTO, so the renderer must allocate storage but never upload an
   * image for it. */
  isRenderTarget = false;
  /** Dimensions, for a render target (an image source knows its own). */
  width = 0;
  height = 0;

  /** The GL texture, null until uploaded. */
  glTexture: WebGLTexture | null = null;

  constructor(image: Image | null = null) {
    this.image = image;
  }

  static fromCanvas(ctx: Context2D): Texture {
    const t = new Texture(null);
    t.canvas = ctx;
    return t;
  }
}
