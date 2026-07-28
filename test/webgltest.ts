/* WebGL2 tier: does the ported context actually RENDER?
 *
 * Runs on the headless EGL lane, so it needs no display and fits CI. What
 * it proves is the whole chain: context creation, shader compilation,
 * buffer upload, a draw call, and readback that reflects what was drawn.
 *
 * Readback is a native hash rather than pixels, because FFI format 1 has no
 * out-bytes class. The hash is what the parity gate compares.
 */
import { WebGL2RenderingContext } from "../web/webgl/context.js";
import { initHeadless, shutdownHeadless } from "../host/gl-ffi.js";
import {
  COLOR_BUFFER_BIT, ARRAY_BUFFER, STATIC_DRAW, TRIANGLES, FLOAT,
  VERTEX_SHADER, FRAGMENT_SHADER,
} from "../web/webgl/constants.js";

let passed = 0;
let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) { passed += 1; } else { failed += 1; console.log(`  FAIL: ${label}`); }
}

const W = 64;
const H = 64;

function main(): void {
  console.log("==> webgl2");

  if (initHeadless(W, H) !== 0) {
    console.log("    SKIP (no headless GL device)");
    process.exit(0);
  }

  const gl = new WebGL2RenderingContext(W, H);

  /* 1. a clear must change the framebuffer, and differently per colour. */
  gl.viewport(0, 0, W, H);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(COLOR_BUFFER_BIT);
  const red = gl.hashPixels(0, 0, W, H);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(COLOR_BUFFER_BIT);
  const green = gl.hashPixels(0, 0, W, H);
  check(red !== 0, "readback produced a hash");
  check(red !== green, "different clear colours hash differently");

  /* 2. shaders compile and link. A failure here is the most common real
   * bug, so the info log is printed rather than swallowed. */
  const vs = gl.createShader(VERTEX_SHADER);
  gl.shaderSource(vs, "#version 300 es\n" +
    "in vec2 pos;\n" +
    "void main() { gl_Position = vec4(pos, 0.0, 1.0); }\n");
  gl.compileShader(vs);
  const vsOk = gl.getShaderCompileStatus(vs);
  if (!vsOk) console.log(`  vertex shader log: ${gl.getShaderInfoLog(vs)}`);
  check(vsOk, "vertex shader compiles");

  const fs = gl.createShader(FRAGMENT_SHADER);
  gl.shaderSource(fs, "#version 300 es\n" +
    "precision mediump float;\n" +
    "out vec4 color;\n" +
    "void main() { color = vec4(0.0, 0.0, 1.0, 1.0); }\n");
  gl.compileShader(fs);
  const fsOk = gl.getShaderCompileStatus(fs);
  if (!fsOk) console.log(`  fragment shader log: ${gl.getShaderInfoLog(fs)}`);
  check(fsOk, "fragment shader compiles");

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  const linked = gl.getProgramLinkStatus(prog);
  if (!linked) console.log(`  program log: ${gl.getProgramInfoLog(prog)}`);
  check(linked, "program links");

  /* 3. a real draw. The triangle covers the lower-left half, so the result
   * must differ from a plain clear. */
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(ARRAY_BUFFER, buf);

  // Three vertices, x/y float32 pairs, written as bytes.
  const verts = Buffer.alloc(24);
  verts.writeFloatLE(-1.0, 0);  verts.writeFloatLE(-1.0, 4);
  verts.writeFloatLE(1.0, 8);   verts.writeFloatLE(-1.0, 12);
  verts.writeFloatLE(-1.0, 16); verts.writeFloatLE(1.0, 20);
  gl.bufferData(ARRAY_BUFFER, verts, STATIC_DRAW);

  const loc = gl.getAttribLocation(prog, "pos");
  check(loc >= 0, `attribute 'pos' has a location (got ${loc})`);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, FLOAT, false, 0, 0);

  gl.clearColor(0, 0, 0, 1);
  gl.clear(COLOR_BUFFER_BIT);
  const cleared = gl.hashPixels(0, 0, W, H);
  gl.drawArrays(TRIANGLES, 0, 3);
  const drawn = gl.hashPixels(0, 0, W, H);
  check(gl.getError() === 0, "no GL error after the draw");
  check(cleared !== drawn, "the draw changed the framebuffer");

  /* 4. CONTROL: the harness must be able to see a FAILURE.
   * Two identical clears must hash the SAME, or the hash is not reading
   * real pixels and every check above is meaningless. */
  gl.clearColor(0.3, 0.6, 0.9, 1);
  gl.clear(COLOR_BUFFER_BIT);
  const a = gl.hashPixels(0, 0, W, H);
  gl.clear(COLOR_BUFFER_BIT);
  const b = gl.hashPixels(0, 0, W, H);
  check(a === b, "CONTROL: identical clears hash identically");

  gl.deleteBuffer(buf);
  gl.deleteProgram(prog);
  shutdownHeadless();

  console.log(`\nwebgl test: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
