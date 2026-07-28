/* SphereGeometry. API-compatible with three
 * (radius, widthSegments, heightSegments).
 *
 * A UV sphere: rings of latitude by segments of longitude. The poles are
 * degenerate triangles, which is what three produces too and what every
 * texture-mapped sphere looks like.
 */
import { BufferGeometry } from "../core/BufferGeometry.js";
import { Float32BufferAttribute, Uint16BufferAttribute } from "../core/BufferAttribute.js";
import { Math as M } from "../../web/globals.js";

export class SphereGeometry extends BufferGeometry {
  constructor(radius: number = 1, widthSegments: number = 16,
              heightSegments: number = 12) {
    super();
    const wSeg = widthSegments < 3 ? 3 : widthSegments;
    const hSeg = heightSegments < 2 ? 2 : heightSegments;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let iy = 0; iy <= hSeg; iy++) {
      const v = iy / hSeg;
      const theta = v * M.PI;
      const sinTheta = M.sin(theta);
      const cosTheta = M.cos(theta);
      for (let ix = 0; ix <= wSeg; ix++) {
        const u = ix / wSeg;
        const phi = u * M.PI * 2;
        const x = -sinTheta * M.cos(phi);
        const y = cosTheta;
        const z = sinTheta * M.sin(phi);
        positions.push(x * radius, y * radius, z * radius);
        normals.push(x, y, z);      // a unit sphere's normal IS its position
        uvs.push(u, 1 - v);
      }
    }

    const rowLen = wSeg + 1;
    for (let iy = 0; iy < hSeg; iy++) {
      for (let ix = 0; ix < wSeg; ix++) {
        const a = iy * rowLen + ix + 1;
        const b = iy * rowLen + ix;
        const c = (iy + 1) * rowLen + ix;
        const d = (iy + 1) * rowLen + ix + 1;
        // The pole rows would emit degenerate triangles; skip those halves.
        if (iy !== 0) indices.push(a, b, d);
        if (iy !== hSeg - 1) indices.push(b, c, d);
      }
    }

    this.position = new Float32BufferAttribute(positions, 3);
    this.normal = new Float32BufferAttribute(normals, 3);
    this.uv = new Float32BufferAttribute(uvs, 2);
    this.index = new Uint16BufferAttribute(indices, 1);
    this.boundingRadius = radius;
  }
}
