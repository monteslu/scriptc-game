/* Vector2. API-compatible with three.js. */
import { Math as M } from "../../web/globals.js";

export class Vector2 {
  x = 0;
  y = 0;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  set(x: number, y: number): Vector2 { this.x = x; this.y = y; return this; }
  copy(v: Vector2): Vector2 { this.x = v.x; this.y = v.y; return this; }
  clone(): Vector2 { return new Vector2(this.x, this.y); }

  add(v: Vector2): Vector2 { this.x += v.x; this.y += v.y; return this; }
  sub(v: Vector2): Vector2 { this.x -= v.x; this.y -= v.y; return this; }
  multiplyScalar(s: number): Vector2 { this.x *= s; this.y *= s; return this; }
  divideScalar(s: number): Vector2 { return this.multiplyScalar(s === 0 ? 0 : 1 / s); }

  dot(v: Vector2): number { return this.x * v.x + this.y * v.y; }
  lengthSq(): number { return this.x * this.x + this.y * this.y; }
  length(): number { return M.sqrt(this.lengthSq()); }
  normalize(): Vector2 { return this.divideScalar(this.length()); }

  equals(v: Vector2): boolean { return this.x === v.x && this.y === v.y; }

  fromArray(a: number[], offset: number = 0): Vector2 {
    this.x = a[offset];
    this.y = a[offset + 1];
    return this;
  }

  toArray(a: number[], offset: number = 0): number[] {
    a[offset] = this.x;
    a[offset + 1] = this.y;
    return a;
  }
}
