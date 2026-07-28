/* The two patterns webgl2-context.mjs leans on. Do they compile?
 *
 * 1. Object wrappers: `class WebGLBuffer { _id }`, returned from
 *    createBuffer, passed back to bindBuffer, compared for null.
 * 2. 526 GL constants as readable names.
 */

// 1. wrapper objects
class WebGLBuffer { id = 0; }
class WebGLTexture { id = 0; }

class Ctx {
  private nextId = 1;
  createBuffer(): WebGLBuffer {
    const b = new WebGLBuffer();
    b.id = this.nextId;
    this.nextId += 1;
    return b;
  }
  bindBuffer(target: number, buf: WebGLBuffer | null): void {
    // null unbinds, which is the spec shape and the common call.
    const name = buf === null ? 0 : buf.id;
    console.log(`bindBuffer(${target}, ${name})`);
  }
}

// 2. constants as module-level consts
const ARRAY_BUFFER = 0x8892;
const TEXTURE_2D = 0x0DE1;

const ctx = new Ctx();
const b = ctx.createBuffer();
ctx.bindBuffer(ARRAY_BUFFER, b);
ctx.bindBuffer(ARRAY_BUFFER, null);
console.log(`TEXTURE_2D=${TEXTURE_2D} buffer id=${b.id}`);
console.log("webgl shapes compile");
