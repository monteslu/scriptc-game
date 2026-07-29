/* Scene: the root of the graph, and the renderer's index into it.
 *
 * API-compatible with three: `scene.add(mesh)` and `scene.background` work
 * as they do there.
 *
 * The addition is the TYPED REGISTRIES. three's renderer walks the graph and
 * narrows each node with `isMesh` / `isLight` flags, which the dialect
 * refuses: `Object3D` to `Mesh` is SC1090, and a structural interface hits
 * SC2003 (a class does not re-tag into a structurally-identical union).
 *
 * So `add` keeps concrete lists as objects arrive. The renderer iterates
 * those directly, with no narrowing anywhere, and it is strictly cheaper
 * than a per-frame graph walk. `traverse` still works for game code.
 *
 * The cost: an object reparented deeper in the graph must be added through
 * the scene to be drawn. `addTo(parent, child)` does both.
 */
import { Object3D } from "./Object3D.js";
import { Color } from "../math/Color.js";
import { Fog } from "../scenes/Fog.js";
import { Mesh } from "../objects/Mesh.js";
import { InstancedMesh } from "../objects/InstancedMesh.js";
import { Sprite, Line, Points } from "../objects/Sprite.js";
import { Light } from "../lights/Light.js";

export class Scene extends Object3D {
  background: Color | null = null;
  /* three's `scene.fog`. Null means no fog; the renderer keys a separate
   * shader variant on its presence, so a scene without it pays nothing. */
  fog: Fog | null = null;
  readonly isScene = true;

  /** Everything drawable, in insertion order. */
  meshes: Mesh[] = [];
  /* A FLAT MIRROR of the two flags the render loop tests per mesh.
   *
   * `visible && material.visible && !material.transparent` is three reads
   * through fat objects: an Object3D carries two Matrix4s (128 bytes
   * each) plus separately-allocated Vector3/Quaternion/Euler, so 10000
   * meshes span megabytes and the loop is dominated by cache misses --
   * measured at 20ms for a loop that reads nothing else.
   *
   * Packed into one number per mesh, the same scan touches 80KB of
   * contiguous memory instead. Bit 0 = drawable at all, bit 1 =
   * transparent. Rebuilt only when it can have changed; see
   * `flagsDirty`. */
  meshFlags: number[] = [];
  /* Set when a mesh is added or removed. The renderer also refreshes the
   * mirror every frame for meshes whose flags it cannot see change --
   * `visible` is a plain public field a game may assign at any time. */
  flagsDirty = true;
  /** Every light, whatever its type. */
  lights: Light[] = [];
  /* One list per drawable KIND, for the same reason meshes is a list: the
   * renderer needs a concrete type to call through, and the dialect will
   * not narrow an Object3D back down (SC1090). Each list is drawn with its
   * own GL primitive, so they could not share a loop regardless. */
  instanced: InstancedMesh[] = [];
  sprites: Sprite[] = [];
  lines: Line[] = [];
  points: Points[] = [];

  /* three's `scene.add(anything)`.
   *
   * Dispatches to the right registry by `instanceof`, so the canonical
   * three call works verbatim:
   *
   *     scene.add(mesh);
   *     scene.add(light);
   *     scene.add(sprite);
   *
   * ORDER MATTERS: most-derived first. InstancedMesh and Sprite both
   * descend from Mesh-shaped bases, so testing the base first would file
   * them in the wrong list and they would draw with the wrong path.
   *
   * The typed addMesh/addLight/... methods below remain, and are what the
   * renderer-facing code uses: they skip the type tests and, more usefully,
   * they FAIL AT COMPILE TIME if you pass the wrong kind, where add()
   * can only ignore it at runtime. */
  override add(child: Object3D): Object3D {
    if (child instanceof InstancedMesh) { this.addInstancedMesh(child); return this; }
    if (child instanceof Sprite) { this.addSprite(child); return this; }
    if (child instanceof Line) { this.addLine(child); return this; }
    if (child instanceof Points) { this.addPoints(child); return this; }
    if (child instanceof Mesh) { this.addMesh(child); return this; }
    if (child instanceof Light) { this.addLight(child); return this; }
    /* Not a drawable: a Group or a bare Object3D, which is a legitimate
     * transform parent. Parent it and register nothing. */
    super.add(child);
    return this;
  }

  /* The typed adders parent through SUPER.add, never this.add.
   *
   * this.add() now dispatches by instanceof back into these methods, so
   * calling it here would recurse until the stack overflowed -- which
   * segfaults with no diagnostic at all. super.add is also what they always
   * meant: "attach to the graph", not "re-enter the dispatcher". */
  addMesh(mesh: Mesh): Scene {
    super.add(mesh);
    this.meshes.push(mesh);
    this.meshFlags.push(0);
    this.flagsDirty = true;
    return this;
  }

  addLight(light: Light): Scene {
    super.add(light);
    this.lights.push(light);
    return this;
  }

  /* Parent to something OTHER than the scene root while staying visible to
   * the renderer: the registry is flat, the transform hierarchy is not. */
  addMeshTo(parent: Object3D, mesh: Mesh): Scene {
    parent.add(mesh);
    this.meshes.push(mesh);
    this.meshFlags.push(0);
    this.flagsDirty = true;
    return this;
  }

  addInstancedMesh(mesh: InstancedMesh): Scene {
    super.add(mesh);
    this.instanced.push(mesh);
    return this;
  }

  addSprite(sprite: Sprite): Scene {
    super.add(sprite);
    this.sprites.push(sprite);
    return this;
  }

  addLine(line: Line): Scene {
    super.add(line);
    this.lines.push(line);
    return this;
  }

  addPoints(points: Points): Scene {
    super.add(points);
    this.points.push(points);
    return this;
  }

  removeSprite(sprite: Sprite): Scene {
    const i = this.sprites.indexOf(sprite);
    if (i >= 0) this.sprites.splice(i, 1);
    this.remove(sprite);
    return this;
  }

  removeInstancedMesh(mesh: InstancedMesh): Scene {
    const i = this.instanced.indexOf(mesh);
    if (i >= 0) this.instanced.splice(i, 1);
    this.remove(mesh);
    return this;
  }

  removeMesh(mesh: Mesh): Scene {
    const i = this.meshes.indexOf(mesh);
    if (i >= 0) {
      this.meshes.splice(i, 1);
      this.meshFlags.splice(i, 1);
      this.flagsDirty = true;
    }
    this.remove(mesh);
    return this;
  }
}
