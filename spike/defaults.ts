/* Does the dialect support default parameters and circular-ish imports?
 * Both matter for three compatibility:
 *   new Vector3()          -- default params
 *   v.applyMatrix4(m)      -- Vector3 referencing Matrix4's type
 */
class Matrix4Like { elements: number[] = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

class Vector3Like {
  x = 0; y = 0; z = 0;
  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x; this.y = y; this.z = z;
  }
  applyMatrix4(m: Matrix4Like): Vector3Like {
    const e = m.elements;
    const x = this.x, y = this.y, z = this.z;
    const w = 1 / (e[3]*x + e[7]*y + e[11]*z + e[15]);
    this.x = (e[0]*x + e[4]*y + e[8]*z + e[12]) * w;
    this.y = (e[1]*x + e[5]*y + e[9]*z + e[13]) * w;
    this.z = (e[2]*x + e[6]*y + e[10]*z + e[14]) * w;
    return this;
  }
}

const a = new Vector3Like();              // no args
const b = new Vector3Like(1, 2, 3);       // all args
const c = new Vector3Like(5);             // partial
console.log(`a=${a.x},${a.y},${a.z} b=${b.x},${b.y},${b.z} c=${c.x},${c.y},${c.z}`);
b.applyMatrix4(new Matrix4Like());
console.log(`after identity: ${b.x},${b.y},${b.z}`);
console.log("three-compatible shapes work");
