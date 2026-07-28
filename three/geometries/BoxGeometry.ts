/* BoxGeometry. API-compatible with three (width, height, depth).
 *
 * 24 vertices, not 8: each face needs its own normal and UVs, so corners
 * are duplicated per face. Sharing them would give a smoothly-shaded blob
 * rather than a box with flat faces.
 */
import { BufferGeometry } from "../core/BufferGeometry.js";
import { Float32BufferAttribute, Uint16BufferAttribute } from "../core/BufferAttribute.js";

export class BoxGeometry extends BufferGeometry {
  constructor(width: number = 1, height: number = 1, depth: number = 1) {
    super();
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    /* One face at a time: four corners, one normal, a full UV square.
     * `u` and `v` are the in-plane axes, `n` the outward normal. */
    const face = (nx: number, ny: number, nz: number,
                  ux: number, uy: number, uz: number,
                  vx: number, vy: number, vz: number): void => {
      const base = (positions.length / 3) | 0;
      // centre of the face
      const cx = nx * w; const cy = ny * h; const cz = nz * d;
      // half-extents along the two in-plane axes
      const hx = ux * w + vx * w; const hy = uy * h + vy * h; const hz = uz * d + vz * d;
      const corners: number[] = [
        cx - ux * w - vx * w, cy - uy * h - vy * h, cz - uz * d - vz * d,
        cx + ux * w - vx * w, cy + uy * h - vy * h, cz + uz * d - vz * d,
        cx + ux * w + vx * w, cy + uy * h + vy * h, cz + uz * d + vz * d,
        cx - ux * w + vx * w, cy - uy * h + vy * h, cz - uz * d + vz * d,
      ];
      for (let i = 0; i < 12; i++) positions.push(corners[i]);
      for (let i = 0; i < 4; i++) { normals.push(nx); normals.push(ny); normals.push(nz); }
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    face(0, 0, 1, 1, 0, 0, 0, 1, 0);    // front  +z
    face(0, 0, -1, -1, 0, 0, 0, 1, 0);  // back   -z
    face(0, 1, 0, 1, 0, 0, 0, 0, -1);   // top    +y
    face(0, -1, 0, 1, 0, 0, 0, 0, 1);   // bottom -y
    face(1, 0, 0, 0, 0, -1, 0, 1, 0);   // right  +x
    face(-1, 0, 0, 0, 0, 1, 0, 1, 0);   // left   -x

    this.position = new Float32BufferAttribute(positions, 3);
    this.normal = new Float32BufferAttribute(normals, 3);
    this.uv = new Float32BufferAttribute(uvs, 2);
    this.index = new Uint16BufferAttribute(indices, 1);
    this.computeBoundingRadius();
  }
}
