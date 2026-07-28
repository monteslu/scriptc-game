/* Materials.
 *
 * API-compatible with three for the fields games actually set: `color`,
 * `map`, `opacity`, `transparent`, `side`, `wireframe`, `emissive`.
 *
 * The big architectural difference from three: there is NO string-keyed
 * uniform dictionary and no reflection at draw time. Each material class
 * declares its uniforms as fields, and the renderer's program cache is
 * keyed by a FEATURE BITMASK (a number, not a string of #defines). The
 * dialect forced this, and it is faster: binding uniforms is a fixed
 * sequence of typed setters rather than a walk over a map.
 */
import { Color } from "../math/Color.js";
import { Texture } from "../textures/Texture.js";

/** three's side constants. */
export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;

/* Feature bits: what a shader program needs to support. The renderer keys
 * its program cache on the OR of these, so two materials wanting the same
 * features share one compiled program. */
export const FEAT_MAP = 1;
export const FEAT_VERTEX_COLORS = 2;
export const FEAT_LAMBERT = 4;
export const FEAT_EMISSIVE = 8;

export class Material {
  color: Color = new Color(0xffffff);
  /* Black means "no emission", so this sits on the base class rather than
   * only on Lambert: the renderer can read it unconditionally and the
   * feature bit decides whether it reaches the shader. */
  emissive: Color = new Color(0x000000);
  opacity = 1;
  transparent = false;
  visible = true;
  side: number = FrontSide;
  depthTest = true;
  depthWrite = true;
  map: Texture | null = null;
  vertexColors = false;

  /** Which shader features this material needs. */
  featureBits(): number {
    let bits = 0;
    if (this.map !== null) bits |= FEAT_MAP;
    if (this.vertexColors) bits |= FEAT_VERTEX_COLORS;
    return bits;
  }
}

/** Unlit: the colour (and map) exactly as given. three's MeshBasicMaterial. */
export class MeshBasicMaterial extends Material {
  readonly isMeshBasicMaterial = true;
}

/* Diffuse (Lambert) shading: one dot product per light.
 *
 * Cheap and entirely adequate for a game; the difference from a full PBR
 * model is not visible at game distances with game textures. */
export class MeshLambertMaterial extends Material {
  readonly isMeshLambertMaterial = true;

  override featureBits(): number {
    let bits = super.featureBits() | FEAT_LAMBERT;
    if (this.emissive.getHex() !== 0) bits |= FEAT_EMISSIVE;
    return bits;
  }
}
