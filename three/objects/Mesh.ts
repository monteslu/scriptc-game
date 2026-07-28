/* Mesh: geometry plus material at a place in the scene. three's shape. */
import { Object3D } from "../core/Object3D.js";
import { BufferGeometry } from "../core/BufferGeometry.js";
import { Material } from "../materials/Material.js";

export class Mesh extends Object3D {
  geometry: BufferGeometry;
  material: Material;

  constructor(geometry: BufferGeometry, material: Material) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
}

/** A Mesh-less container, three's Group. */
export class Group extends Object3D {
  readonly isGroup = true;
}
