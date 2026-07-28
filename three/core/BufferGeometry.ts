/* BufferGeometry. API-compatible with three, with one shape difference.
 *
 * three stores attributes in a string-keyed dictionary
 * (`geometry.attributes.position`), which the dialect cannot express: no
 * dynamic property access, no index signatures. The four attributes a game
 * renderer actually reads are NAMED FIELDS here instead, and
 * `setAttribute(name, attr)` still works so calling code reads the same.
 *
 * That trade is the fence becoming an architecture improvement, the same
 * way the material uniform story goes: the renderer knows statically what
 * it can bind, so there is no reflection at draw time.
 */
import { BufferAttribute } from "./BufferAttribute.js";
import { Vector3 } from "../math/Vector3.js";
import { Math as M } from "../../web/globals.js";
import { WebGLVertexArrayObject, WebGLBuffer } from "../../web/webgl/objects.js";

export class BufferGeometry {
  position: BufferAttribute | null = null;
  normal: BufferAttribute | null = null;
  uv: BufferAttribute | null = null;
  color: BufferAttribute | null = null;
  index: BufferAttribute | null = null;

  /** Bounding sphere radius, for frustum culling. -1 until computed. */
  boundingRadius = -1;

  /* GL objects, created by the renderer on first draw. null = not uploaded.
   * These are the SPEC wrapper types, so the renderer hands them straight
   * to gl.bindVertexArray / gl.bindBuffer with no unwrapping. */
  glVAO: WebGLVertexArrayObject | null = null;
  glPositionBuffer: WebGLBuffer | null = null;
  glNormalBuffer: WebGLBuffer | null = null;
  glUVBuffer: WebGLBuffer | null = null;
  glColorBuffer: WebGLBuffer | null = null;
  glIndexBuffer: WebGLBuffer | null = null;

  /** three's spelling; dispatches to the named field. */
  setAttribute(name: string, attribute: BufferAttribute): BufferGeometry {
    if (name === "position") this.position = attribute;
    else if (name === "normal") this.normal = attribute;
    else if (name === "uv") this.uv = attribute;
    else if (name === "color") this.color = attribute;
    return this;
  }

  getAttribute(name: string): BufferAttribute | null {
    if (name === "position") return this.position;
    if (name === "normal") return this.normal;
    if (name === "uv") return this.uv;
    if (name === "color") return this.color;
    return null;
  }

  setIndex(attribute: BufferAttribute): BufferGeometry {
    this.index = attribute;
    return this;
  }

  /** Vertices to draw: the index count when indexed, else the position count. */
  getDrawCount(): number {
    if (this.index !== null) return this.index.array.length;
    return this.position === null ? 0 : this.position.count;
  }

  /* A bounding sphere around the origin, for culling.
   *
   * Radius from the origin rather than from a computed centre: game
   * geometry is modelled around its own origin, and the cheaper test is
   * good enough to reject what is off screen. */
  computeBoundingRadius(): number {
    const pos = this.position;
    if (pos === null) { this.boundingRadius = 0; return 0; }
    let maxSq = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const d = x * x + y * y + z * z;
      if (d > maxSq) maxSq = d;
    }
    this.boundingRadius = M.sqrt(maxSq);
    return this.boundingRadius;
  }

  /* Flat (per-face) normals from the positions.
   *
   * Only meaningful for INDEXED geometry whose vertices are not shared
   * across faces; a shared vertex gets the average, which is what smooth
   * shading wants anyway. */
  computeVertexNormals(): BufferGeometry {
    const pos = this.position;
    const idx = this.index;
    if (pos === null || idx === null) return this;

    const normals: number[] = [];
    for (let i = 0; i < pos.count * 3; i++) normals.push(0);

    for (let i = 0; i < idx.array.length; i += 3) {
      const a = idx.array[i];
      const b = idx.array[i + 1];
      const c = idx.array[i + 2];

      _pA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
      _pB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
      _pC.set(pos.getX(c), pos.getY(c), pos.getZ(c));

      _cb.subVectors(_pC, _pB);
      _ab.subVectors(_pA, _pB);
      _cb.cross(_ab);

      normals[a * 3] += _cb.x; normals[a * 3 + 1] += _cb.y; normals[a * 3 + 2] += _cb.z;
      normals[b * 3] += _cb.x; normals[b * 3 + 1] += _cb.y; normals[b * 3 + 2] += _cb.z;
      normals[c * 3] += _cb.x; normals[c * 3 + 1] += _cb.y; normals[c * 3 + 2] += _cb.z;
    }

    for (let i = 0; i < normals.length; i += 3) {
      _pA.set(normals[i], normals[i + 1], normals[i + 2]).normalize();
      normals[i] = _pA.x;
      normals[i + 1] = _pA.y;
      normals[i + 2] = _pA.z;
    }

    this.normal = new BufferAttribute(normals, 3);
    return this;
  }
}

const _pA = new Vector3();
const _pB = new Vector3();
const _pC = new Vector3();
const _cb = new Vector3();
const _ab = new Vector3();
