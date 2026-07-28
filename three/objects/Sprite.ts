/* Sprite, Line, LineSegments, LineLoop and Points.
 *
 * All four are Object3D subclasses carrying a geometry and a material, the
 * same shape as Mesh; what differs is the GL primitive the renderer draws
 * them with and, for Sprite, how the model-view matrix is built.
 *
 * They live in one file because they are small and share the registry
 * story: the Scene keeps a typed list per kind (the dialect cannot narrow
 * Object3D back down, see Scene.ts), so each new drawable kind is a list
 * plus a renderer loop, and splitting five ~30-line classes across five
 * files would obscure that.
 */
import { Object3D } from "../core/Object3D.js";
import { BufferGeometry } from "../core/BufferGeometry.js";
import { Material, SpriteMaterial } from "../materials/Material.js";
import { Vector2 } from "../math/Vector2.js";
import { PlaneGeometry } from "../geometries/PlaneGeometry.js";

/* A camera-facing textured quad.
 *
 * three's Sprite takes ONLY a material and uses a shared unit-quad
 * geometry; this matches that. `center` moves the anchor point within the
 * quad ((0.5,0.5) is the middle, (0.5,0) the bottom edge), which is how you
 * pin a health bar above a character or stand a billboard on the ground.
 *
 * The billboard itself happens in the renderer: it zeroes the rotation part
 * of the model-view matrix, so the quad keeps its world position and scale
 * but always faces the camera plane.
 */
export class Sprite extends Object3D {
  readonly isSprite = true;
  geometry: BufferGeometry;
  material: Material;
  center: Vector2 = new Vector2(0.5, 0.5);

  constructor(material: Material) {
    super();
    this.material = material;
    this.geometry = sharedSpriteGeometry();
  }
}

/* One unit quad, shared by every Sprite, as in three. Built on first use
 * rather than at module load: a game with no sprites should not allocate a
 * geometry or (more importantly) a GL buffer for one. */
let _spriteGeo: BufferGeometry | null = null;
function sharedSpriteGeometry(): BufferGeometry {
  if (_spriteGeo === null) _spriteGeo = new PlaneGeometry(1, 1, 1, 1);
  return _spriteGeo;
}

/* A connected polyline: vertex 0 to 1 to 2 ... (GL_LINE_STRIP).
 *
 * On `linewidth`: WebGL ignores widths above 1 on essentially every
 * desktop driver. See LineBasicMaterial. */
export class Line extends Object3D {
  readonly isLine = true;
  geometry: BufferGeometry;
  material: Material;

  constructor(geometry: BufferGeometry, material: Material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

/** Disconnected pairs: 0-1, 2-3, ... (GL_LINES). three's LineSegments. */
export class LineSegments extends Line {
  readonly isLineSegments = true;
}

/** Like Line but closes back to vertex 0 (GL_LINE_LOOP). */
export class LineLoop extends Line {
  readonly isLineLoop = true;
}

/* One point sprite per vertex (GL_POINTS).
 *
 * Size comes from the material (PointsMaterial.size, in pixels) and is
 * written to gl_PointSize by the shader. With `sizeAttenuation` the size
 * divides by view distance so points shrink with depth like real geometry;
 * without it they stay a fixed pixel size, which is what you want for a
 * starfield or a UI scatter. */
export class Points extends Object3D {
  readonly isPoints = true;
  geometry: BufferGeometry;
  material: Material;

  constructor(geometry: BufferGeometry, material: Material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

/** Exported so game code can build a sprite without importing the material. */
export function makeSprite(material: SpriteMaterial): Sprite {
  return new Sprite(material);
}
