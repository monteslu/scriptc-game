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

/* three's blending modes.
 *
 * ADDITIVE is the one that matters for game feel: it adds light rather than
 * covering what is behind, so overlapping glows brighten instead of
 * flattening, and a dark background shows through the dark parts of a
 * sprite with no cutout needed. Every explosion, muzzle flash, engine
 * trail and energy field is additive. */
export const NormalBlending = 0;
export const AdditiveBlending = 1;

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
/* Set by the RENDERER, not by a material: an InstancedMesh needs a shader
 * that reads a per-instance matrix attribute, and the same material may be
 * drawn both ways in one scene. Keeping it in the same bitfield means the
 * program cache handles the two variants without a second cache. */
export const FEAT_INSTANCED = 16;
/** Point-sprite variant: reads gl_PointCoord and writes gl_PointSize. */
export const FEAT_POINTS = 32;
/** Camera-facing quad: the model-view rotation is replaced at draw time. */
export const FEAT_SPRITE = 64;
/* Set by the RENDERER from scene.fog, not by a material: the same material
 * is drawn fogged in one scene and clear in another, so it cannot live in
 * featureBits(). three has a per-material `fog` flag as well, which is
 * honoured here -- a HUD or a skybox sets fog=false to opt out. */
export const FEAT_FOG = 128;

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
  /** NormalBlending or AdditiveBlending; only applies when transparent. */
  blending: number = NormalBlending;
  /* Whether scene.fog affects this material. three's default is true; a
   * HUD quad or a skybox wants false. */
  fog = true;
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

/* Unlit: the colour (and map) exactly as given. three's MeshBasicMaterial.
 *
 * three takes an options OBJECT (`new MeshBasicMaterial({ color: 0xff0000 })`).
 * The dialect refuses an object literal where a class is expected (SC2003:
 * "not representable in the target union"), so the colour is a positional
 * argument instead -- which covers the overwhelmingly common case in one
 * line rather than two:
 *
 *     new MeshBasicMaterial(0xff0000)        // here
 *     new MeshBasicMaterial({color:0xff0000})  // three
 *
 * Everything else is a field assignment, exactly as it may be in three. */
export class MeshBasicMaterial extends Material {
  readonly isMeshBasicMaterial = true;

  constructor(color: number = 0xffffff) {
    super();
    this.color.setHex(color);
  }
}

/* Diffuse (Lambert) shading: one dot product per light.
 *
 * Cheap and entirely adequate for a game; the difference from a full PBR
 * model is not visible at game distances with game textures. */
export class MeshLambertMaterial extends Material {
  readonly isMeshLambertMaterial = true;

  constructor(color: number = 0xffffff) {
    super();
    this.color.setHex(color);
  }

  override featureBits(): number {
    let bits = super.featureBits() | FEAT_LAMBERT;
    if (this.emissive.getHex() !== 0) bits |= FEAT_EMISSIVE;
    return bits;
  }
}

/* Line material. three exposes `linewidth`, and so does this, but WebGL
 * ignores any width above 1 on virtually every desktop driver: the ES spec
 * only requires a range of [1,1] for aliased lines. It is kept for API
 * compatibility and to avoid silently dropping a property games set, NOT
 * because setting it does anything. Thick lines need quad geometry. */
export class LineBasicMaterial extends Material {
  readonly isLineBasicMaterial = true;
  linewidth = 1;

  constructor(color: number = 0xffffff) {
    super();
    this.color.setHex(color);
  }
}

/* Point material. `size` is in PIXELS and `sizeAttenuation` decides whether
 * that size shrinks with distance, matching three's PointsMaterial. */
export class PointsMaterial extends Material {
  readonly isPointsMaterial = true;
  size = 1;
  sizeAttenuation = true;

  constructor(color: number = 0xffffff) {
    super();
    this.color.setHex(color);
  }

  override featureBits(): number {
    return super.featureBits() | FEAT_POINTS;
  }
}

/* Sprite material: a textured quad that always faces the camera.
 *
 * three's SpriteMaterial has `rotation`; it is here and is applied in the
 * shader-side billboard construction. */
export class SpriteMaterial extends Material {
  readonly isSpriteMaterial = true;
  rotation = 0;

  constructor(color: number = 0xffffff) {
    super();
    this.color.setHex(color);
  }

  override featureBits(): number {
    return super.featureBits() | FEAT_SPRITE;
  }
}
