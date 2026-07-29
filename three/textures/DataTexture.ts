/* DataTexture: a texture whose pixels come from raw bytes, not an image.
 *
 * What it is for: procedurally generated textures (noise, gradients,
 * palettes), lookup tables read by a shader, and anything a game computes
 * rather than loads. three's signature is `new DataTexture(data, width,
 * height)`, and this matches it.
 *
 * The bytes are RGBA8 (four per pixel, top-down). three defaults to
 * RGBAFormat/UnsignedByteType too, and the WebGL2 tier's upload path takes
 * exactly that, so no format plumbing is needed for the common case.
 *
 * NEAREST filtering by default, unlike Texture's LINEAR: data textures are
 * usually lookup tables where interpolating between neighbouring entries
 * produces a value that means nothing. three makes the same choice.
 */
import { Texture, NearestFilter, ClampToEdgeWrapping } from "./Texture.js";

export class DataTexture extends Texture {
  constructor(data: Buffer, width: number, height: number) {
    /* No Image source: the renderer must upload from `data` instead, which
     * it decides on via isDataTexture. */
    super(null);
    this.isDataTexture = true;
    this.data = data;
    this.width = width;
    this.height = height;
    this.magFilter = NearestFilter;
    this.minFilter = NearestFilter;
    this.wrapS = ClampToEdgeWrapping;
    this.wrapT = ClampToEdgeWrapping;
    this.needsUpdate = true;
  }

  /* Replace the pixels. The caller may also mutate `data` in place and set
   * needsUpdate directly; this is the spelling for swapping the buffer. */
  setData(data: Buffer, width: number, height: number): DataTexture {
    this.data = data;
    this.width = width;
    this.height = height;
    this.needsUpdate = true;
    return this;
  }
}
