/* InstancedMesh: one geometry, one material, N transforms, ONE draw call.
 *
 * API-compatible with three: construct with (geometry, material, count),
 * write transforms with `setMatrixAt(i, matrix)`, read them back with
 * `getMatrixAt(i, target)`, and set `instanceMatrix.needsUpdate = true`
 * after writing. `count` may be lowered below the allocated maximum to draw
 * a prefix, which is how three does pooling.
 *
 * WHY IT IS FAST: the per-object cost of a normal Mesh is not the triangles,
 * it is the draw call and the uniform uploads around it. 10k cubes as
 * separate meshes is 10k of each; as one InstancedMesh it is one call plus
 * one buffer upload, and the GPU reads each instance's matrix from a vertex
 * attribute with a divisor of 1.
 *
 * THE MATRIX ATTRIBUTE: a mat4 attribute occupies FOUR consecutive
 * attribute locations, one per column. The renderer binds locations 4..7
 * for this and sets a divisor on each, so `position` (0) advances per
 * vertex while the matrix advances per instance.
 *
 * Storage is a flat f64 array of 16 floats per instance in column-major
 * order, the same layout Matrix4.elements uses, so setMatrixAt is a copy
 * rather than a transpose.
 */
import { Mesh } from "./Mesh.js";
import { BufferGeometry } from "../core/BufferGeometry.js";
import { Material } from "../materials/Material.js";
import { Matrix4 } from "../math/Matrix4.js";
import { Color } from "../math/Color.js";
import { WebGLBuffer, WebGLVertexArrayObject } from "../../web/webgl/objects.js";

/* three exposes `mesh.instanceMatrix` as a BufferAttribute whose
 * `needsUpdate` flag drives re-upload. The flag is the part games actually
 * touch, so it is a real object here with that field. */
export class InstancedBufferAttribute {
  array: number[];
  itemSize: number;
  needsUpdate = false;

  constructor(array: number[], itemSize: number) {
    this.array = array;
    this.itemSize = itemSize;
  }

  get count(): number { return (this.array.length / this.itemSize) | 0; }

  /* GL wants f32; the dialect's numbers are f64. Same conversion
   * BufferAttribute does, kept here so the two attribute types stay
   * independent (this one is per-instance and re-uploaded, that one is
   * per-vertex and usually static). */
  toFloat32Buffer(): Buffer {
    return this.prefixFloat32Buffer(this.count);
  }

  /* Only the first `items` elements.
   *
   * An InstancedMesh is usually allocated at its MAXIMUM size and drawn
   * with a smaller `count` (that is how pooling works), so converting and
   * uploading the whole array every frame charges the caller for instances
   * it is not drawing. Measured on the spinfield benchmark: uploading all
   * 10000 slots while drawing 250 cost 2.27 ms/frame, against 0.72 ms for
   * the same 250 as individual meshes. Uploading the prefix removes that
   * fixed cost. */
  prefixFloat32Buffer(items: number): Buffer {
    let n = items * this.itemSize;
    if (n > this.array.length) n = this.array.length;
    if (n < 0) n = 0;

    /* REUSE the scratch buffer across frames.
     *
     * This is called every frame for every InstancedMesh whose transforms
     * changed, and it was allocating a fresh Buffer each time -- 640KB per
     * frame at 10000 instances, handed straight to the collector. The
     * buffer only ever grows, so one allocation covers the whole run.
     *
     * Sized to the FULL array rather than the current prefix, so lowering
     * and raising `count` does not reallocate. */
    let buf = this.scratch;
    if (buf === null || buf.length < n * 4) {
      buf = Buffer.alloc(this.array.length * 4);
      this.scratch = buf;
    }
    for (let i = 0; i < n; i++) {
      buf.writeFloatLE(this.array[i], i * 4);
    }
    /* The GL upload takes a length, and a too-long buffer would send the
     * stale tail as well, so the prefix is handed over as its own view. */
    return n * 4 === buf.length ? buf : buf.subarray(0, n * 4);
  }

  /** Grow-only staging buffer; see prefixFloat32Buffer. */
  private scratch: Buffer | null = null;
}

export class InstancedMesh extends Mesh {
  readonly isInstancedMesh = true;

  /** How many instances to DRAW. May be < the allocated capacity. */
  count: number;
  /** The allocated capacity; setMatrixAt beyond this is ignored. */
  readonly capacity: number;

  instanceMatrix: InstancedBufferAttribute;
  /** Per-instance tint, allocated lazily by setColorAt as in three. */
  instanceColor: InstancedBufferAttribute | null = null;

  /* GL objects, created by the renderer on first draw. */
  glMatrixBuffer: WebGLBuffer | null = null;
  glColorBuffer: WebGLBuffer | null = null;
  /** The VAO the renderer built for THIS mesh's geometry+instance buffers. */
  glInstancedVAO: WebGLVertexArrayObject | null = null;
  /* Which geometry the VAO's attribute bindings were built from.
   *
   * A VAO captures the BUFFERS bound at build time, so assigning a new
   * geometry (loading a model over a placeholder, swapping an LOD) leaves
   * the VAO pointing at the old one: the mesh keeps drawing the previous
   * shape, or -- if the placeholder had no normals in the same layout --
   * renders unlit black. Comparing this to `geometry` each frame catches
   * the swap. */
  glVAOGeometry: BufferGeometry | null = null;
  /* How many instances are actually IN the GL buffers. The renderer uploads
   * only the drawn prefix, so a later increase in `count` needs a re-upload
   * even when the game set no needsUpdate flag. -1 = nothing uploaded. */
  uploadedCount = -1;
  uploadedColorCount = -1;

  constructor(geometry: BufferGeometry, material: Material, count: number) {
    super(geometry, material);
    const n = count < 0 ? 0 : count;
    this.count = n;
    this.capacity = n;
    const data: number[] = [];
    /* Identity for every instance: an unwritten slot draws at the origin
     * rather than collapsing to a zero matrix and vanishing, which makes a
     * half-filled pool debuggable. */
    for (let i = 0; i < n; i++) {
      data.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    }
    this.instanceMatrix = new InstancedBufferAttribute(data, 16);
  }

  /** Writes instance `i`'s world transform. Marks the buffer for re-upload. */
  setMatrixAt(i: number, matrix: Matrix4): void {
    if (i < 0 || i >= this.capacity) return;
    const dst = this.instanceMatrix.array;
    const src = matrix.elements;
    const base = i * 16;
    for (let k = 0; k < 16; k++) dst[base + k] = src[k];
    this.instanceMatrix.needsUpdate = true;
  }

  /** Reads instance `i`'s transform into `target`. three's signature. */
  getMatrixAt(i: number, target: Matrix4): Matrix4 {
    if (i < 0 || i >= this.capacity) return target;
    const src = this.instanceMatrix.array;
    const base = i * 16;
    for (let k = 0; k < 16; k++) target.elements[k] = src[base + k];
    return target;
  }

  /* Per-instance colour. Allocating on first use matches three and keeps
   * the common (untinted) case from paying for a buffer it never reads. */
  setColorAt(i: number, color: Color): void {
    if (i < 0 || i >= this.capacity) return;
    if (this.instanceColor === null) {
      const data: number[] = [];
      for (let k = 0; k < this.capacity; k++) data.push(1, 1, 1);
      this.instanceColor = new InstancedBufferAttribute(data, 3);
    }
    const dst = this.instanceColor.array;
    dst[i * 3] = color.r;
    dst[i * 3 + 1] = color.g;
    dst[i * 3 + 2] = color.b;
    this.instanceColor.needsUpdate = true;
  }

  getColorAt(i: number, target: Color): Color {
    if (this.instanceColor === null || i < 0 || i >= this.capacity) return target;
    const src = this.instanceColor.array;
    target.r = src[i * 3];
    target.g = src[i * 3 + 1];
    target.b = src[i * 3 + 2];
    return target;
  }
}
