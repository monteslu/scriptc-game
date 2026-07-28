/* The REFERENCE half of the WebGL2 parity gate.
 *
 * Runs a scene under Node + webgl-node + native-gles and prints an FNV-1a
 * hash of the framebuffer. The native build runs the SAME scene through the
 * ported context and hashes it with the same algorithm in C
 * (sg_gl_hash_pixels). Matching hashes mean the two stacks produced
 * identical pixels.
 *
 * The scene is deliberately boring: a clear, then one triangle with a
 * constant-colour fragment shader. Anything with filtering, mipmaps or
 * blending would compare driver behaviour rather than OUR semantics, and
 * that is not what this gate is for.
 *
 * Plain JS on purpose: this runs on the build machine under Node, never
 * through scriptc.
 */
import { createWebGL2Context } from "webgl-node";

const W = 64;
const H = 64;

const VERT = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision mediump float;
out vec4 color;
void main() { color = vec4(0.0, 0.0, 1.0, 1.0); }
`;

/** FNV-1a over RGBA bytes. Must match sg_gl_hash_pixels exactly. */
function hashPixels(bytes) {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function main() {
  const { gl } = createWebGL2Context(W, H, {});

  const results = {};

  gl.viewport(0, 0, W, H);

  // 1. a red clear
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  results.clearRed = readHash(gl);

  // 2. a green clear
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  results.clearGreen = readHash(gl);

  // 3. a triangle over a black clear
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, VERT);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    throw new Error("vertex shader: " + gl.getShaderInfoLog(vs));
  }

  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, FRAG);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    throw new Error("fragment shader: " + gl.getShaderInfoLog(fs));
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("link: " + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const verts = new Float32Array([-1, -1, 1, -1, -1, 1]);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  const loc = gl.getAttribLocation(prog, "pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  results.triangle = readHash(gl);

  console.log(JSON.stringify(results, null, 2));
}

function readHash(gl) {
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return hashPixels(px);
}

main();
