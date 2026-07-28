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
import { Mesh } from "../objects/Mesh.js";
import { InstancedMesh } from "../objects/InstancedMesh.js";
import { Sprite, Line, Points } from "../objects/Sprite.js";
import { Light } from "../lights/Light.js";

export class Scene extends Object3D {
  background: Color | null = null;
  readonly isScene = true;

  /** Everything drawable, in insertion order. */
  meshes: Mesh[] = [];
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

  /** three's spelling; also registers so the renderer can find it. */
  addMesh(mesh: Mesh): Scene {
    this.add(mesh);
    this.meshes.push(mesh);
    return this;
  }

  addLight(light: Light): Scene {
    this.add(light);
    this.lights.push(light);
    return this;
  }

  /* Parent to something OTHER than the scene root while staying visible to
   * the renderer: the registry is flat, the transform hierarchy is not. */
  addMeshTo(parent: Object3D, mesh: Mesh): Scene {
    parent.add(mesh);
    this.meshes.push(mesh);
    return this;
  }

  addInstancedMesh(mesh: InstancedMesh): Scene {
    this.add(mesh);
    this.instanced.push(mesh);
    return this;
  }

  addSprite(sprite: Sprite): Scene {
    this.add(sprite);
    this.sprites.push(sprite);
    return this;
  }

  addLine(line: Line): Scene {
    this.add(line);
    this.lines.push(line);
    return this;
  }

  addPoints(points: Points): Scene {
    this.add(points);
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
    if (i >= 0) this.meshes.splice(i, 1);
    this.remove(mesh);
    return this;
  }
}
