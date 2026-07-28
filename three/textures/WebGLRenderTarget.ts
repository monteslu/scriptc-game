/* WebGLRenderTarget: render into a texture instead of the screen.
 *
 * API-compatible with three for the part a game uses:
 *
 *   const rt = new WebGLRenderTarget(512, 512);
 *   renderer.setRenderTarget(rt);
 *   renderer.render(scene, rtCamera);
 *   renderer.setRenderTarget(null);      // back to the screen
 *   material.map = rt.texture;           // the result, as a texture
 *
 * This is what makes a security monitor, a rear-view mirror, a portal, a
 * minimap or a post-processing pass possible: all of them are "draw the
 * scene somewhere that is not the screen, then sample it".
 *
 * WHAT IT IS. A framebuffer with a colour texture and, when `depthBuffer`
 * is set (the default), a depth renderbuffer. The depth attachment is not
 * optional in practice: without it a 3D scene drawn into the target has no
 * depth test, so triangles land in submission order and the result looks
 * like a broken mesh rather than a view.
 *
 * three's `samples` (MSAA) and `stencilBuffer` are not implemented; a
 * game-sized target rarely wants either, and both need a resolve step that
 * would triple this file.
 */
import { Texture, LinearFilter, ClampToEdgeWrapping } from "./Texture.js";
import { WebGLFramebuffer, WebGLRenderbuffer } from "../../web/webgl/objects.js";

export class WebGLRenderTarget {
  readonly isWebGLRenderTarget = true;

  width: number;
  height: number;

  /* The colour attachment, usable anywhere a Texture is: assign it to
   * `material.map` and the next frame samples what was drawn here. */
  texture: Texture;

  /** Whether to attach a depth renderbuffer. Off means no depth testing. */
  depthBuffer = true;

  /* GL objects, created by the renderer on first use. Null means "not
   * uploaded yet", the same convention BufferGeometry uses. */
  glFramebuffer: WebGLFramebuffer | null = null;
  glDepthBuffer: WebGLRenderbuffer | null = null;

  constructor(width: number = 512, height: number = 512) {
    this.width = width < 1 ? 1 : width;
    this.height = height < 1 ? 1 : height;

    /* The texture has no image and no canvas: its pixels come from being
     * RENDERED INTO, so the renderer must not try to upload anything for
     * it. `isRenderTarget` is how it tells the difference. */
    const t = new Texture(null);
    t.isRenderTarget = true;
    t.width = this.width;
    t.height = this.height;
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = ClampToEdgeWrapping;
    /* Nothing to upload, so needsUpdate must start FALSE -- otherwise the
     * first draw that samples it would try to read an image that does not
     * exist and blank the attachment. */
    t.needsUpdate = false;
    this.texture = t;
  }

  /* Resize. Drops the GL objects so the renderer rebuilds them at the new
   * size; three does the same. */
  setSize(width: number, height: number): void {
    const w = width < 1 ? 1 : width;
    const h = height < 1 ? 1 : height;
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.texture.width = w;
    this.texture.height = h;
    this.glFramebuffer = null;
    this.glDepthBuffer = null;
    this.texture.glTexture = null;
  }
}
