/* WebGLRenderer: the forward renderer.
 *
 * API-compatible with three for what a game calls: `new WebGLRenderer()`,
 * `setSize`, `setClearColor`, `render(scene, camera)`.
 *
 * Three things are deliberately different inside, and all three are the
 * dialect's fences turning into better architecture:
 *
 *   PROGRAM CACHE keyed by a FEATURE BITMASK (a number), not by a string of
 *   concatenated #defines. Two materials wanting the same features share
 *   one compiled program, and the lookup is an integer compare.
 *
 *   NO UNIFORM REFLECTION. three walks a string-keyed uniform map per draw.
 *   Here each material class knows its uniforms statically, so binding is a
 *   fixed sequence of typed setters.
 *
 *   GEOMETRY OWNS ITS GL STATE. The VAO, vertex buffers and index buffer
 *   live on the BufferGeometry and are created once, on first draw.
 */
import { WebGL2RenderingContext } from "../../web/webgl/context.js";
import {
  WebGLProgram, WebGLUniformLocation, WebGLVertexArrayObject, WebGLBuffer,
  WebGLTexture,
} from "../../web/webgl/objects.js";
import {
  COLOR_BUFFER_BIT, DEPTH_BUFFER_BIT, DEPTH_TEST, CULL_FACE, BACK, FRONT,
  ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, STATIC_DRAW, TRIANGLES, FLOAT,
  UNSIGNED_SHORT, VERTEX_SHADER, FRAGMENT_SHADER, TEXTURE_2D, TEXTURE0,
  RGBA, UNSIGNED_BYTE, TEXTURE_MIN_FILTER, TEXTURE_MAG_FILTER, LINEAR,
  CLAMP_TO_EDGE, REPEAT, TEXTURE_WRAP_S, TEXTURE_WRAP_T, COMPILE_STATUS,
  LINK_STATUS, BLEND, SRC_ALPHA, ONE_MINUS_SRC_ALPHA, LEQUAL, DEPTH_FUNC,
} from "../../web/webgl/constants.js";
import { Scene } from "../core/Scene.js";
import { PerspectiveCamera } from "../core/PerspectiveCamera.js";
import { Object3D } from "../core/Object3D.js";

import { Mesh } from "../objects/Mesh.js";
import { BufferGeometry } from "../core/BufferGeometry.js";
import {
  Material, MeshLambertMaterial, FEAT_MAP, FEAT_VERTEX_COLORS, FEAT_LAMBERT,
  FEAT_EMISSIVE, DoubleSide, BackSide,
} from "../materials/Material.js";
import {
  Light, AmbientLight, DirectionalLight, PointLight,
  LIGHT_AMBIENT, LIGHT_DIRECTIONAL, LIGHT_POINT,
} from "../lights/Light.js";
import { Texture } from "../textures/Texture.js";
import { Matrix4 } from "../math/Matrix4.js";
import { Matrix3 } from "../math/Matrix3.js";
import { Vector3 } from "../math/Vector3.js";
import { Color } from "../math/Color.js";

/* Fixed light maxima. A game-sized budget keeps the shader branch-free and
 * the uniform block small; three's unbounded arrays are what force its
 * shaders to be regenerated per light count. */
const MAX_DIR_LIGHTS = 4;
const MAX_POINT_LIGHTS = 8;

/** One compiled program plus the uniform locations it uses. */
class Program {
  features = 0;
  /* The spec objects, not raw GL names: gl.useProgram takes a WebGLProgram
   * and gl.uniform*  take a WebGLUniformLocation. Keeping the wrappers here
   * means the renderer calls the same API a browser exposes. */
  glProgram: WebGLProgram | null = null;
  uModelViewMatrix: WebGLUniformLocation | null = null;
  uProjectionMatrix: WebGLUniformLocation | null = null;
  uNormalMatrix: WebGLUniformLocation | null = null;
  uColor: WebGLUniformLocation | null = null;
  uOpacity: WebGLUniformLocation | null = null;
  uMap: WebGLUniformLocation | null = null;
  uEmissive: WebGLUniformLocation | null = null;
  uAmbient: WebGLUniformLocation | null = null;
  uDirCount: WebGLUniformLocation | null = null;
  uDirDirections: WebGLUniformLocation | null = null;
  uDirColors: WebGLUniformLocation | null = null;
  uPointCount: WebGLUniformLocation | null = null;
  uPointPositions: WebGLUniformLocation | null = null;
  uPointColors: WebGLUniformLocation | null = null;
}

export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private programs: Program[] = [];

  private width = 0;
  private height = 0;
  private clearColor: Color = new Color(0x000000);

  /* Scratch reused every draw. A 200-object scene allocates nothing here. */
  private modelView: Matrix4 = new Matrix4();
  private normalMatrix: Matrix3 = new Matrix3();
  private mat4Buf: Buffer = Buffer.alloc(64);
  private mat3Buf: Buffer = Buffer.alloc(36);
  private vec3Buf: Buffer = Buffer.alloc(MAX_POINT_LIGHTS * 12);
  private colorBuf: Buffer = Buffer.alloc(MAX_POINT_LIGHTS * 12);

  /* Collected per frame by walking the scene once. */
  private opaque: Mesh[] = [];
  private transparent: Mesh[] = [];
  private dirLights: Light[] = [];
  private pointLights: Light[] = [];
  private ambient: Color = new Color(0x000000);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    gl.enable(DEPTH_TEST);
    gl.depthFunc(LEQUAL);
    gl.enable(CULL_FACE);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  setClearColor(color: number): void {
    this.clearColor.setHex(color);
  }

  /* ---- shader assembly ----
   *
   * One template, with the feature bits deciding which lines are present.
   * GLSL 300 es, which is what WebGL2 requires. */

  private vertexSource(features: number): string {
    let s = "#version 300 es\n";
    s += "in vec3 position;\n";
    s += "in vec3 normal;\n";
    if ((features & FEAT_MAP) !== 0) s += "in vec2 uv;\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "in vec3 color;\n";
    s += "uniform mat4 modelViewMatrix;\n";
    s += "uniform mat4 projectionMatrix;\n";
    s += "uniform mat3 normalMatrix;\n";
    s += "out vec3 vNormal;\n";
    s += "out vec3 vViewPosition;\n";
    if ((features & FEAT_MAP) !== 0) s += "out vec2 vUv;\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "out vec3 vColor;\n";
    s += "void main() {\n";
    s += "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n";
    s += "  vViewPosition = -mvPosition.xyz;\n";
    s += "  vNormal = normalize(normalMatrix * normal);\n";
    if ((features & FEAT_MAP) !== 0) s += "  vUv = uv;\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "  vColor = color;\n";
    s += "  gl_Position = projectionMatrix * mvPosition;\n";
    s += "}\n";
    return s;
  }

  private fragmentSource(features: number): string {
    let s = "#version 300 es\n";
    s += "precision highp float;\n";
    s += "in vec3 vNormal;\n";
    s += "in vec3 vViewPosition;\n";
    if ((features & FEAT_MAP) !== 0) s += "in vec2 vUv;\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "in vec3 vColor;\n";
    s += "uniform vec3 diffuse;\n";
    s += "uniform float opacity;\n";
    if ((features & FEAT_MAP) !== 0) s += "uniform sampler2D map;\n";
    if ((features & FEAT_EMISSIVE) !== 0) s += "uniform vec3 emissive;\n";
    if ((features & FEAT_LAMBERT) !== 0) {
      s += "uniform vec3 ambientLightColor;\n";
      s += `uniform int dirLightCount;\n`;
      s += `uniform vec3 dirLightDirections[${MAX_DIR_LIGHTS}];\n`;
      s += `uniform vec3 dirLightColors[${MAX_DIR_LIGHTS}];\n`;
      s += `uniform int pointLightCount;\n`;
      s += `uniform vec3 pointLightPositions[${MAX_POINT_LIGHTS}];\n`;
      s += `uniform vec3 pointLightColors[${MAX_POINT_LIGHTS}];\n`;
    }
    s += "out vec4 fragColor;\n";
    s += "void main() {\n";
    s += "  vec4 base = vec4(diffuse, opacity);\n";
    if ((features & FEAT_MAP) !== 0) s += "  base *= texture(map, vUv);\n";
    if ((features & FEAT_VERTEX_COLORS) !== 0) s += "  base.rgb *= vColor;\n";

    if ((features & FEAT_LAMBERT) !== 0) {
      s += "  vec3 n = normalize(vNormal);\n";
      s += "  vec3 lit = ambientLightColor;\n";
      s += `  for (int i = 0; i < ${MAX_DIR_LIGHTS}; i++) {\n`;
      s += "    if (i >= dirLightCount) break;\n";
      s += "    lit += dirLightColors[i] * max(dot(n, dirLightDirections[i]), 0.0);\n";
      s += "  }\n";
      s += `  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {\n`;
      s += "    if (i >= pointLightCount) break;\n";
      s += "    vec3 toLight = pointLightPositions[i] + vViewPosition;\n";
      s += "    float dist = length(toLight);\n";
      // Inverse-square falloff with a 1.0 floor so a light at the surface
      // does not blow out to infinity.
      s += "    float atten = 1.0 / (1.0 + dist * dist * 0.1);\n";
      s += "    lit += pointLightColors[i] * max(dot(n, toLight / dist), 0.0) * atten;\n";
      s += "  }\n";
      s += "  base.rgb *= lit;\n";
    }
    if ((features & FEAT_EMISSIVE) !== 0) s += "  base.rgb += emissive;\n";

    s += "  fragColor = base;\n";
    s += "}\n";
    return s;
  }

  /** The program for a feature set, compiled once and reused. */
  private getProgram(features: number): Program | null {
    for (let i = 0; i < this.programs.length; i++) {
      if (this.programs[i].features === features) return this.programs[i];
    }

    const gl = this.gl;
    const vs = gl.createShader(VERTEX_SHADER);
    gl.shaderSource(vs, this.vertexSource(features));
    gl.compileShader(vs);
    if (gl.getShaderParameter(vs, COMPILE_STATUS) === 0) {
      console.log(`three: vertex shader failed: ${gl.getShaderInfoLog(vs)}`);
      return null;
    }

    const fs = gl.createShader(FRAGMENT_SHADER);
    gl.shaderSource(fs, this.fragmentSource(features));
    gl.compileShader(fs);
    if (gl.getShaderParameter(fs, COMPILE_STATUS) === 0) {
      console.log(`three: fragment shader failed: ${gl.getShaderInfoLog(fs)}`);
      return null;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    /* Bind attribute locations BEFORE linking so every program agrees:
     * position 0, normal 1, uv 2, color 3. That lets one VAO serve any
     * material. */
    gl.bindAttribLocation(prog, 0, "position");
    gl.bindAttribLocation(prog, 1, "normal");
    gl.bindAttribLocation(prog, 2, "uv");
    gl.bindAttribLocation(prog, 3, "color");
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, LINK_STATUS) === 0) {
      console.log(`three: program link failed: ${gl.getProgramInfoLog(prog)}`);
      return null;
    }

    const p = new Program();
    p.features = features;
    p.glProgram = prog;
    const loc = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n);
    p.uModelViewMatrix = loc("modelViewMatrix");
    p.uProjectionMatrix = loc("projectionMatrix");
    p.uNormalMatrix = loc("normalMatrix");
    p.uColor = loc("diffuse");
    p.uOpacity = loc("opacity");
    p.uMap = loc("map");
    p.uEmissive = loc("emissive");
    p.uAmbient = loc("ambientLightColor");
    p.uDirCount = loc("dirLightCount");
    p.uDirDirections = loc("dirLightDirections[0]");
    p.uDirColors = loc("dirLightColors[0]");
    p.uPointCount = loc("pointLightCount");
    p.uPointPositions = loc("pointLightPositions[0]");
    p.uPointColors = loc("pointLightColors[0]");
    this.programs.push(p);
    return p;
  }

  /** Upload a geometry's buffers once, then reuse its VAO. */
  private prepareGeometry(geo: BufferGeometry): void {
    if (geo.glVAO !== null) return;
    const gl = this.gl;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    geo.glVAO = vao;

    if (geo.position !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, buf);
      gl.bufferData(ARRAY_BUFFER, geo.position.toFloat32Buffer(), STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0);
      geo.glPositionBuffer = buf;
    }
    if (geo.normal !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, buf);
      gl.bufferData(ARRAY_BUFFER, geo.normal.toFloat32Buffer(), STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, FLOAT, false, 0, 0);
      geo.glNormalBuffer = buf;
    }
    if (geo.uv !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, buf);
      gl.bufferData(ARRAY_BUFFER, geo.uv.toFloat32Buffer(), STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, FLOAT, false, 0, 0);
      geo.glUVBuffer = buf;
    }
    if (geo.color !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ARRAY_BUFFER, buf);
      gl.bufferData(ARRAY_BUFFER, geo.color.toFloat32Buffer(), STATIC_DRAW);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 3, FLOAT, false, 0, 0);
      geo.glColorBuffer = buf;
    }
    if (geo.index !== null) {
      const buf = gl.createBuffer();
      gl.bindBuffer(ELEMENT_ARRAY_BUFFER, buf);
      gl.bufferData(ELEMENT_ARRAY_BUFFER, geo.index.toUint16Buffer(), STATIC_DRAW);
      geo.glIndexBuffer = buf;
    }
  }

  /** Upload or refresh a texture. Canvas sources re-upload when dirty. */
  private prepareTexture(tex: Texture): void {
    const gl = this.gl;
    if (tex.glTexture === null) {
      const t = gl.createTexture();
      tex.glTexture = t;
      gl.bindTexture(TEXTURE_2D, t);
      gl.texParameteri(TEXTURE_2D, TEXTURE_MIN_FILTER, tex.minFilter === 1003 ? 9728 : LINEAR);
      gl.texParameteri(TEXTURE_2D, TEXTURE_MAG_FILTER, tex.magFilter === 1003 ? 9728 : LINEAR);
      gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_S,
                       tex.wrapS === 1000 ? REPEAT : CLAMP_TO_EDGE);
      gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_T,
                       tex.wrapT === 1000 ? REPEAT : CLAMP_TO_EDGE);
      tex.needsUpdate = true;
    }

    if (!tex.needsUpdate) return;
    gl.bindTexture(TEXTURE_2D, tex.glTexture);
    if (tex.image !== null && tex.image.complete) {
      gl.texImage2DFromImage(TEXTURE_2D, 0, tex.image);
      tex.needsUpdate = false;
    } else if (tex.canvas !== null) {
      /* An offscreen 2D canvas as a texture: this is what makes a HUD drawn
       * with the Canvas API usable in 3D. The pixels go surface-to-texture
       * natively, never entering TS. */
      gl.texImage2DFromCanvas(TEXTURE_2D, 0, tex.canvas);
      tex.needsUpdate = false;
    }
  }

  /* Walk the scene once, sorting what it finds. Doing this in one pass
   * rather than per-material is what keeps a big scene cheap. */
  private collect(scene: Scene, camera: PerspectiveCamera): void {
    /* `arr.length = 0` is a property assignment the dialect refuses
     * (SC1090); splice is the supported clear and does not reallocate. */
    this.opaque.splice(0, this.opaque.length);
    this.transparent.splice(0, this.transparent.length);
    this.dirLights.splice(0, this.dirLights.length);
    this.pointLights.splice(0, this.pointLights.length);
    this.ambient.setRGB(0, 0, 0);

    /* Walked by hand rather than through traverseVisible + a downcast:
     * narrowing an Object3D to a Mesh is SC1090 ("values where Mesh is
     * expected"). Object3D keeps typed self-references instead, which the
     * subclass constructors fill in, so this reads the concrete object
     * without a cast. */
    for (let i = 0; i < scene.meshes.length; i++) {
      const mesh = scene.meshes[i];
      if (!mesh.visible || !mesh.material.visible) continue;
      if (mesh.material.transparent) this.transparent.push(mesh);
      else this.opaque.push(mesh);
    }
    for (let i = 0; i < scene.lights.length; i++) {
      const light = scene.lights[i];
      if (!light.visible) continue;
      if (light.lightType === LIGHT_AMBIENT) {
        // Read-modify-write: `this.ambient.r += x` is a compound assignment
        // through a field, which the dialect refuses (SC1090).
        const amb = this.ambient;
        amb.r = amb.r + light.color.r * light.intensity;
        amb.g = amb.g + light.color.g * light.intensity;
        amb.b = amb.b + light.color.b * light.intensity;
      } else if (light.lightType === LIGHT_DIRECTIONAL) {
        if (this.dirLights.length < MAX_DIR_LIGHTS) this.dirLights.push(light);
      } else if (light.lightType === LIGHT_POINT) {
        if (this.pointLights.length < MAX_POINT_LIGHTS) this.pointLights.push(light);
      }
    }
  }

  render(scene: Scene, camera: PerspectiveCamera): void {
    const gl = this.gl;

    scene.updateMatrixWorld(false);
    camera.updateMatrixWorld(false);
    this.collect(scene, camera);

    const bg = scene.background === null ? this.clearColor : scene.background;
    gl.clearColor(bg.r, bg.g, bg.b, 1);
    gl.clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT);

    this.renderList(this.opaque, camera, false);
    /* Transparent after opaque, with depth WRITES off so overlapping
     * surfaces blend rather than occluding each other. */
    this.renderList(this.transparent, camera, true);
  }

  private renderList(list: Mesh[], camera: PerspectiveCamera,
                     isTransparent: boolean): void {
    const gl = this.gl;
    if (list.length === 0) return;

    if (isTransparent) {
      gl.enable(BLEND);
      gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    } else {
      gl.disable(BLEND);
      gl.depthMask(true);
    }

    for (let i = 0; i < list.length; i++) {
      this.renderMesh(list[i], camera);
    }

    if (isTransparent) gl.depthMask(true);
  }

  private renderMesh(mesh: Mesh, camera: PerspectiveCamera): void {
    const gl = this.gl;
    const material = mesh.material;
    const program = this.getProgram(material.featureBits());
    if (program === null) return;

    this.prepareGeometry(mesh.geometry);
    gl.useProgram(program.glProgram);
    gl.bindVertexArray(mesh.geometry.glVAO);

    // modelView = view * world
    this.modelView.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
    this.modelView.toBuffer(this.mat4Buf, 0);
    gl.uniformMatrix4fv(program.uModelViewMatrix, false, this.mat4Buf);

    camera.projectionMatrix.toBuffer(this.mat4Buf, 0);
    gl.uniformMatrix4fv(program.uProjectionMatrix, false, this.mat4Buf);

    /* The normal matrix is the inverse-transpose of modelView's 3x3, which
     * is what keeps normals correct under non-uniform scale. */
    this.normalMatrix.getNormalMatrix(this.modelView.elements);
    this.normalMatrix.toBuffer(this.mat3Buf, 0);
    gl.uniformMatrix3fv(program.uNormalMatrix, false, this.mat3Buf);

    gl.uniform3f(program.uColor, material.color.r, material.color.g, material.color.b);
    gl.uniform1f(program.uOpacity, material.opacity);

    if (material.map !== null) {
      this.prepareTexture(material.map);
      gl.activeTexture(TEXTURE0);
      gl.bindTexture(TEXTURE_2D, material.map.glTexture);
      gl.uniform1i(program.uMap, 0);
    }

    if ((program.features & FEAT_LAMBERT) !== 0) {
      this.bindLights(program, camera);
    }
    if ((program.features & FEAT_EMISSIVE) !== 0) {
      gl.uniform3f(program.uEmissive,
                   material.emissive.r, material.emissive.g, material.emissive.b);
    }

    if (material.side === DoubleSide) gl.disable(CULL_FACE);
    else {
      gl.enable(CULL_FACE);
      gl.cullFace(material.side === BackSide ? FRONT : BACK);
    }

    const count = mesh.geometry.getDrawCount();
    if (mesh.geometry.index !== null) {
      gl.drawElements(TRIANGLES, count, UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(TRIANGLES, 0, count);
    }
  }

  /* Lights are uploaded in VIEW space, so the shader needs no world-space
   * camera position. */
  private bindLights(program: Program, camera: PerspectiveCamera): void {
    const gl = this.gl;
    gl.uniform3f(program.uAmbient, this.ambient.r, this.ambient.g, this.ambient.b);

    gl.uniform1i(program.uDirCount, this.dirLights.length);
    for (let i = 0; i < this.dirLights.length; i++) {
      const l = this.dirLights[i];
      _v.setFromMatrixPosition(l.matrixWorld);
      // Direction only: transformDirection normalises and drops translation.
      _v.transformDirection(camera.matrixWorldInverse);
      this.vec3Buf.writeFloatLE(_v.x, i * 12);
      this.vec3Buf.writeFloatLE(_v.y, i * 12 + 4);
      this.vec3Buf.writeFloatLE(_v.z, i * 12 + 8);
      this.colorBuf.writeFloatLE(l.color.r * l.intensity, i * 12);
      this.colorBuf.writeFloatLE(l.color.g * l.intensity, i * 12 + 4);
      this.colorBuf.writeFloatLE(l.color.b * l.intensity, i * 12 + 8);
    }
    if (this.dirLights.length > 0) {
      gl.uniform3fv(program.uDirDirections, this.vec3Buf);
      gl.uniform3fv(program.uDirColors, this.colorBuf);
    }

    gl.uniform1i(program.uPointCount, this.pointLights.length);
    for (let i = 0; i < this.pointLights.length; i++) {
      const l = this.pointLights[i];
      _v.setFromMatrixPosition(l.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      this.vec3Buf.writeFloatLE(_v.x, i * 12);
      this.vec3Buf.writeFloatLE(_v.y, i * 12 + 4);
      this.vec3Buf.writeFloatLE(_v.z, i * 12 + 8);
      this.colorBuf.writeFloatLE(l.color.r * l.intensity, i * 12);
      this.colorBuf.writeFloatLE(l.color.g * l.intensity, i * 12 + 4);
      this.colorBuf.writeFloatLE(l.color.b * l.intensity, i * 12 + 8);
    }
    if (this.pointLights.length > 0) {
      gl.uniform3fv(program.uPointPositions, this.vec3Buf);
      gl.uniform3fv(program.uPointColors, this.colorBuf);
    }
  }
}

const _v = new Vector3();
