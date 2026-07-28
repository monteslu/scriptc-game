/* PlaneGeometry. API-compatible with three (width, height, segments).
 * Lies in the XY plane facing +Z, as three's does. */
import { BufferGeometry } from "../core/BufferGeometry.js";
import { Float32BufferAttribute, Uint16BufferAttribute } from "../core/BufferAttribute.js";

export class PlaneGeometry extends BufferGeometry {
  constructor(width: number = 1, height: number = 1,
              widthSegments: number = 1, heightSegments: number = 1) {
    super();
    const wSeg = widthSegments < 1 ? 1 : widthSegments;
    const hSeg = heightSegments < 1 ? 1 : heightSegments;
    const halfW = width / 2;
    const halfH = height / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let iy = 0; iy <= hSeg; iy++) {
      const y = (iy / hSeg) * height - halfH;
      for (let ix = 0; ix <= wSeg; ix++) {
        const x = (ix / wSeg) * width - halfW;
        positions.push(x, -y, 0);
        normals.push(0, 0, 1);
        uvs.push(ix / wSeg, 1 - iy / hSeg);
      }
    }

    for (let iy = 0; iy < hSeg; iy++) {
      for (let ix = 0; ix < wSeg; ix++) {
        const a = ix + (wSeg + 1) * iy;
        const b = ix + (wSeg + 1) * (iy + 1);
        const c = ix + 1 + (wSeg + 1) * (iy + 1);
        const d = ix + 1 + (wSeg + 1) * iy;
        indices.push(a, b, d, b, c, d);
      }
    }

    this.position = new Float32BufferAttribute(positions, 3);
    this.normal = new Float32BufferAttribute(normals, 3);
    this.uv = new Float32BufferAttribute(uvs, 2);
    this.index = new Uint16BufferAttribute(indices, 1);
    this.computeBoundingRadius();
  }
}
