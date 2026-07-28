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

  /** Re-upload on the next draw. Set this after redrawing a canvas source. */
  needsUpdate = true;

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
