/* cube: a spinning textured cube, drawn with WebGL2.
 *
 * The 3D counterpart to the 2D examples. Everything here is the WebGL2 API:
 * shaders in GLSL ES 3.00, a vertex buffer, an index buffer, a texture
 * uploaded from a PNG, and a perspective matrix built by hand.
 *
 * Two spellings differ from a browser, both forced by the dialect and both
 * aliased away in a page (see docs/WEBGL-AND-3D.md):
 *
 *   canvas.getContextGL()        is getContext("webgl2")
 *   import { TEXTURE_2D }        is gl.TEXTURE_2D
 *
 * Everything else is code a browser runs unchanged.
 */
import { window, document, requestAnimationFrame, Image, Math } from "../../web/globals.js";
import {
  COLOR_BUFFER_BIT, DEPTH_BUFFER_BIT, DEPTH_TEST, ARRAY_BUFFER,
  ELEMENT_ARRAY_BUFFER, STATIC_DRAW, TRIANGLES, FLOAT, UNSIGNED_SHORT,
  VERTEX_SHADER, FRAGMENT_SHADER, TEXTURE_2D, TEXTURE0, RGBA, UNSIGNED_BYTE,
  TEXTURE_MIN_FILTER, TEXTURE_MAG_FILTER, LINEAR, CLAMP_TO_EDGE,
  TEXTURE_WRAP_S, TEXTURE_WRAP_T, CULL_FACE, COMPILE_STATUS, LINK_STATUS,
} from "../../web/webgl/constants.js";

const VERT = "#version 300 es\n" +
  "in vec3 aPos;\n" +
  "in vec2 aUV;\n" +
  "uniform mat4 uMVP;\n" +
  "out vec2 vUV;\n" +
  "void main() {\n" +
  "  vUV = aUV;\n" +
  "  gl_Position = uMVP * vec4(aPos, 1.0);\n" +
  "}\n";

const FRAG = "#version 300 es\n" +
  "precision mediump float;\n" +
  "in vec2 vUV;\n" +
  "uniform sampler2D uTex;\n" +
  "out vec4 fragColor;\n" +
  "void main() {\n" +
  "  vec4 t = texture(uTex, vUV);\n" +
  // A little face-based shading so the cube reads as 3D even untextured.
  "  fragColor = vec4(t.rgb * (0.6 + 0.4 * vUV.y), 1.0);\n" +
  "}\n";

/* Column-major 4x4, the layout GL wants and uniformMatrix4fv uploads
 * untransposed. Written into a Buffer because that is what crosses the FFI. */
function writeMat4(out: Buffer, offset: number, m: number[]): void {
  for (let i = 0; i < 16; i++) out.writeFloatLE(m[i], offset + i * 4);
}

function perspective(fovY: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

/** Multiply two column-major matrices: out = a * b. */
function mul(a: number[], b: number[]): number[] {
  const o: number[] = [];
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o.push(s);
    }
  }
  return o;
}

function rotateY(angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function rotateX(angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function translate(x: number, y: number, z: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const gl = canvas.getContextGL();
  if (gl === null) {
    console.log("cube: no WebGL2 context available");
    return;
  }

  const W = canvas.width;
  const H = canvas.height;

  /* ---- program ---- */
  const vs = gl.createShader(VERTEX_SHADER);
  gl.shaderSource(vs, VERT);
  gl.compileShader(vs);
  if (gl.getShaderParameter(vs, COMPILE_STATUS) === 0) {
    console.log(`cube: vertex shader failed: ${gl.getShaderInfoLog(vs)}`);
    return;
  }

  const fs = gl.createShader(FRAGMENT_SHADER);
  gl.shaderSource(fs, FRAG);
  gl.compileShader(fs);
  if (gl.getShaderParameter(fs, COMPILE_STATUS) === 0) {
    console.log(`cube: fragment shader failed: ${gl.getShaderInfoLog(fs)}`);
    return;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (gl.getProgramParameter(prog, LINK_STATUS) === 0) {
    console.log(`cube: link failed: ${gl.getProgramInfoLog(prog)}`);
    return;
  }
  gl.useProgram(prog);

  /* ---- geometry ----
   * 24 vertices rather than 8: each face needs its own UVs, so corners are
   * duplicated per face. Interleaved as x,y,z,u,v. */
  const F: number[] = [
    // front
    -1, -1, 1, 0, 0,   1, -1, 1, 1, 0,   1, 1, 1, 1, 1,   -1, 1, 1, 0, 1,
    // back
    1, -1, -1, 0, 0,  -1, -1, -1, 1, 0,  -1, 1, -1, 1, 1,   1, 1, -1, 0, 1,
    // top
    -1, 1, 1, 0, 0,    1, 1, 1, 1, 0,    1, 1, -1, 1, 1,   -1, 1, -1, 0, 1,
    // bottom
    -1, -1, -1, 0, 0,  1, -1, -1, 1, 0,  1, -1, 1, 1, 1,   -1, -1, 1, 0, 1,
    // right
    1, -1, 1, 0, 0,    1, -1, -1, 1, 0,  1, 1, -1, 1, 1,    1, 1, 1, 0, 1,
    // left
    -1, -1, -1, 0, 0, -1, -1, 1, 1, 0,  -1, 1, 1, 1, 1,   -1, 1, -1, 0, 1,
  ];

  const verts = Buffer.alloc(F.length * 4);
  for (let i = 0; i < F.length; i++) verts.writeFloatLE(F[i], i * 4);

  /* WebGL2 requires a bound vertex array object: it is what captures the
   * attribute pointers and the ELEMENT_ARRAY_BUFFER binding. Without one,
   * drawElements raises INVALID_OPERATION because there is no element
   * buffer bound at draw time, even though bindBuffer was called during
   * setup. (In WebGL1 the default VAO covered this; ES3 has no default.) */
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(ARRAY_BUFFER, vbo);
  gl.bufferData(ARRAY_BUFFER, verts, STATIC_DRAW);

  // Two triangles per face, six faces.
  const idx: number[] = [];
  for (let face = 0; face < 6; face++) {
    const b = face * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const indices = Buffer.alloc(idx.length * 2);
  for (let i = 0; i < idx.length; i++) indices.writeUInt16LE(idx[i], i * 2);

  const ibo = gl.createBuffer();
  gl.bindBuffer(ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(ELEMENT_ARRAY_BUFFER, indices, STATIC_DRAW);

  const posLoc = gl.getAttribLocation(prog, "aPos");
  const uvLoc = gl.getAttribLocation(prog, "aUV");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 3, FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, FLOAT, false, 20, 12);

  /* ---- texture ----
   * `new Image()` and onload, exactly as in a page. Until it arrives the
   * cube draws with the 1x1 white placeholder below, so there is no
   * flash of nothing. */
  const tex = gl.createTexture();
  gl.bindTexture(TEXTURE_2D, tex);
  const white = Buffer.alloc(4);
  white.writeUInt8(255, 0); white.writeUInt8(255, 1);
  white.writeUInt8(255, 2); white.writeUInt8(255, 3);
  gl.texImage2D(TEXTURE_2D, 0, RGBA, 1, 1, 0, RGBA, UNSIGNED_BYTE, white);
  gl.texParameteri(TEXTURE_2D, TEXTURE_MIN_FILTER, LINEAR);
  gl.texParameteri(TEXTURE_2D, TEXTURE_MAG_FILTER, LINEAR);
  gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_S, CLAMP_TO_EDGE);
  gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_T, CLAMP_TO_EDGE);

  const img = new Image();
  img.onload = () => {
    /* The pixels go Skia -> GL natively; they never enter TS. In a browser
     * this is texImage2D(target, level, format, format, type, image). */
    gl!.bindTexture(TEXTURE_2D, tex);
    gl!.texImage2DFromImage(TEXTURE_2D, 0, img);
  };
  img.src = "texture.png";

  const texLoc = gl.getUniformLocation(prog, "uTex");
  gl.activeTexture(TEXTURE0);
  gl.uniform1i(texLoc, 0);

  const mvpLoc = gl.getUniformLocation(prog, "uMVP");
  const mvpBuf = Buffer.alloc(64);

  gl.enable(DEPTH_TEST);
  gl.enable(CULL_FACE);
  gl.viewport(0, 0, W, H);

  const proj = perspective(Math.PI / 4, W / H, 0.1, 100);
  let angle = 0;
  let last = 0;

  function frame(time: number): void {
    const dt = last === 0 ? 16 : time - last;
    last = time;
    angle += dt * 0.0009;

    const model = mul(rotateY(angle), rotateX(angle * 0.6));
    const view = translate(0, 0, -6);
    writeMat4(mvpBuf, 0, mul(proj, mul(view, model)));
    gl!.uniformMatrix4fv(mvpLoc, false, mvpBuf);

    gl!.clearColor(0.06, 0.08, 0.12, 1);
    gl!.clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT);
    gl!.drawElements(TRIANGLES, idx.length, UNSIGNED_SHORT, 0);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
