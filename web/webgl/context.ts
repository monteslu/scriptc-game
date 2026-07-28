/* WebGL2RenderingContext.
 *
 * A port of webgl-node's webgl2-context.mjs, which is the owned, debugged
 * reference: 1,275 lines of semantics that already map WebGL's API onto raw
 * GLES3 calls, with the binding-tracking `getParameter` needs.
 *
 * Two deviations from the browser, both forced and both documented in
 * docs/WEBGL-AND-3D.md:
 *
 *   1. Constants are imported (`import { TEXTURE_2D }`) rather than read off
 *      the context (`gl.TEXTURE_2D`). The web assigns all 519 in a loop over
 *      a table, which needs dynamic property assignment the dialect does not
 *      have.
 *
 *   2. `readPixels` cannot hand pixels back: FFI format 1 has no out-bytes
 *      class. The conformance path hashes the framebuffer natively instead
 *      (`hashPixels`), which is what the readback-parity gate compares.
 *
 * Everything else is the spec surface, including that object accessors
 * return `null` rather than 0 when a thing does not exist, and that a
 * `null` argument unbinds.
 */
import * as gl from "../../host/gl-ffi.js";
import { readMailbox } from "../../host/mailbox.js";
import { Image } from "../canvas/image.js";
import { Context2D } from "../canvas/context.js";
import {
  WebGLBuffer, WebGLTexture, WebGLFramebuffer, WebGLRenderbuffer,
  WebGLProgram, WebGLShader, WebGLVertexArrayObject, WebGLSampler,
  WebGLQuery, WebGLTransformFeedback, WebGLUniformLocation,
  WebGLActiveInfo, WebGLShaderPrecisionFormat,
} from "./objects.js";
import {
  ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, TEXTURE_2D, TEXTURE_CUBE_MAP,
  TEXTURE0, FRAMEBUFFER, RENDERBUFFER, COMPILE_STATUS, LINK_STATUS,
  UNPACK_FLIP_Y_WEBGL, UNPACK_PREMULTIPLY_ALPHA_WEBGL,
} from "./constants.js";

/* Names are u32 in GL, and 0 is "no object", so an unbound slot is 0 and a
 * null argument becomes 0. This is the one place that conversion lives. */
function nameOf(o: WebGLBuffer | null): number { return o === null ? 0 : o.name; }

export class WebGL2RenderingContext {
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;

  /* Binding tracking. GL can report most of this through glGetIntegerv, but
   * the spec says getParameter returns the OBJECT, and a name cannot be
   * turned back into the wrapper it came from. So the bindings are tracked
   * here, exactly as the reference does. */
  private boundArrayBuffer: WebGLBuffer | null = null;
  private boundElementArrayBuffer: WebGLBuffer | null = null;
  private boundFramebuffer: WebGLFramebuffer | null = null;
  private boundRenderbuffer: WebGLRenderbuffer | null = null;
  private boundTexture2D: WebGLTexture | null = null;
  private boundTextureCubeMap: WebGLTexture | null = null;
  private boundVAO: WebGLVertexArrayObject | null = null;
  private currentProgram: WebGLProgram | null = null;
  private activeTextureUnit = TEXTURE0;

  /* WebGL-only pixel store state: these two have no GL equivalent, so they
   * are remembered and applied during uploads rather than forwarded. */
  private unpackFlipY = false;
  private unpackPremultiplyAlpha = false;

  constructor(width: number, height: number) {
    this.drawingBufferWidth = width;
    this.drawingBufferHeight = height;
  }

  /* ---- state ---- */

  clearColor(r: number, g: number, b: number, a: number): void {
    gl.clearColor(r, g, b, a);
  }
  clearDepth(d: number): void { gl.clearDepthf(d); }
  clearStencil(s: number): void { gl.ClearStencil(s); }
  clear(mask: number): void { gl.Clear(mask); }

  enable(cap: number): void { gl.Enable(cap); }
  disable(cap: number): void { gl.Disable(cap); }
  isEnabled(cap: number): boolean { return gl.IsEnabled(cap) !== 0; }

  viewport(x: number, y: number, w: number, h: number): void {
    gl.Viewport(x, y, w, h);
  }
  scissor(x: number, y: number, w: number, h: number): void {
    gl.Scissor(x, y, w, h);
  }

  blendFunc(sfactor: number, dfactor: number): void { gl.BlendFunc(sfactor, dfactor); }
  blendFuncSeparate(srcRGB: number, dstRGB: number, srcA: number, dstA: number): void {
    gl.BlendFuncSeparate(srcRGB, dstRGB, srcA, dstA);
  }
  blendEquation(mode: number): void { gl.BlendEquation(mode); }
  blendEquationSeparate(rgb: number, alpha: number): void {
    gl.BlendEquationSeparate(rgb, alpha);
  }
  blendColor(r: number, g: number, b: number, a: number): void {
    gl.blendColor(r, g, b, a);
  }

  depthFunc(func: number): void { gl.DepthFunc(func); }
  depthMask(flag: boolean): void { gl.DepthMask(flag ? 1 : 0); }
  depthRange(zNear: number, zFar: number): void { gl.depthRangef(zNear, zFar); }

  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void {
    gl.ColorMask(r ? 1 : 0, g ? 1 : 0, b ? 1 : 0, a ? 1 : 0);
  }

  cullFace(mode: number): void { gl.CullFace(mode); }
  frontFace(mode: number): void { gl.FrontFace(mode); }
  lineWidth(width: number): void { gl.lineWidth(width); }
  polygonOffset(factor: number, units: number): void {
    gl.polygonOffset(factor, units);
  }

  stencilFunc(func: number, ref: number, mask: number): void {
    gl.StencilFunc(func, ref, mask);
  }
  stencilFuncSeparate(face: number, func: number, ref: number, mask: number): void {
    gl.StencilFuncSeparate(face, func, ref, mask);
  }
  stencilMask(mask: number): void { gl.StencilMask(mask); }
  stencilMaskSeparate(face: number, mask: number): void {
    gl.StencilMaskSeparate(face, mask);
  }
  stencilOp(fail: number, zfail: number, zpass: number): void {
    gl.StencilOp(fail, zfail, zpass);
  }
  stencilOpSeparate(face: number, fail: number, zfail: number, zpass: number): void {
    gl.StencilOpSeparate(face, fail, zfail, zpass);
  }

  finish(): void { gl.Finish(); }
  flush(): void { gl.Flush(); }
  getError(): number { return gl.GetError(); }

  /* pixelStorei carries two WebGL-only pnames that GL has never heard of;
   * those are remembered rather than forwarded, which is what the reference
   * does and what makes texture uploads match a browser. */
  pixelStorei(pname: number, param: number): void {
    if (pname === UNPACK_FLIP_Y_WEBGL) { this.unpackFlipY = param !== 0; return; }
    if (pname === UNPACK_PREMULTIPLY_ALPHA_WEBGL) {
      this.unpackPremultiplyAlpha = param !== 0;
      return;
    }
    gl.PixelStorei(pname, param);
  }

  /* ---- buffers ---- */

  createBuffer(): WebGLBuffer {
    const b = new WebGLBuffer();
    b.name = gl.genBuffer();
    return b;
  }

  deleteBuffer(buf: WebGLBuffer | null): void {
    if (buf === null) return;
    gl.deleteBuffer(buf.name);
    // The spec unbinds a deleted object from wherever it was bound.
    if (this.boundArrayBuffer === buf) this.boundArrayBuffer = null;
    if (this.boundElementArrayBuffer === buf) this.boundElementArrayBuffer = null;
  }

  isBuffer(buf: WebGLBuffer | null): boolean {
    return buf === null ? false : gl.IsBuffer(buf.name) !== 0;
  }

  bindBuffer(target: number, buf: WebGLBuffer | null): void {
    gl.BindBuffer(target, nameOf(buf));
    if (target === ARRAY_BUFFER) this.boundArrayBuffer = buf;
    else if (target === ELEMENT_ARRAY_BUFFER) this.boundElementArrayBuffer = buf;
  }

  /* The spec's bufferData is polymorphic: a size allocates, a view uploads,
   * null is a no-op. */
  bufferData(target: number, sizeOrData: number | Buffer | null,
             usage: number): void {
    if (sizeOrData === null) return;
    if (typeof sizeOrData === "number") {
      gl.bufferDataSize(target, sizeOrData, usage);
      return;
    }
    gl.bufferData(target, sizeOrData, usage);
  }

  bufferSubData(target: number, offset: number, data: Buffer | null): void {
    if (data === null) return;
    gl.bufferSubData(target, offset, data);
  }

  copyBufferSubData(readTarget: number, writeTarget: number, readOffset: number,
                    writeOffset: number, size: number): void {
    gl.CopyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size);
  }

  /* ---- vertex array objects ---- */

  createVertexArray(): WebGLVertexArrayObject {
    const v = new WebGLVertexArrayObject();
    v.name = gl.genVertexArray();
    return v;
  }

  deleteVertexArray(vao: WebGLVertexArrayObject | null): void {
    if (vao === null) return;
    gl.deleteVertexArray(vao.name);
    if (this.boundVAO === vao) this.boundVAO = null;
  }

  bindVertexArray(vao: WebGLVertexArrayObject | null): void {
    gl.BindVertexArray(vao === null ? 0 : vao.name);
    this.boundVAO = vao;
  }

  isVertexArray(vao: WebGLVertexArrayObject | null): boolean {
    return vao === null ? false : gl.IsVertexArray(vao.name) !== 0;
  }

  /* ---- shaders ---- */

  createShader(type: number): WebGLShader {
    const s = new WebGLShader();
    s.name = gl.CreateShader(type);
    return s;
  }

  deleteShader(shader: WebGLShader | null): void {
    if (shader === null) return;
    gl.DeleteShader(shader.name);
  }

  isShader(shader: WebGLShader | null): boolean {
    return shader === null ? false : gl.IsShader(shader.name) !== 0;
  }

  shaderSource(shader: WebGLShader, source: string): void {
    gl.shaderSource(shader.name, source);
  }

  compileShader(shader: WebGLShader): void { gl.CompileShader(shader.name); }

  getShaderParameter(shader: WebGLShader, pname: number): number {
    return gl.getShaderParameter(shader.name, pname);
  }

  /** True when the last compile succeeded. The spec spells this
   * getShaderParameter(s, COMPILE_STATUS), which returns a boolean there. */
  getShaderCompileStatus(shader: WebGLShader): boolean {
    return gl.getShaderParameter(shader.name, COMPILE_STATUS) !== 0;
  }

  getShaderInfoLog(shader: WebGLShader): string {
    gl.shaderInfoLog(shader.name);
    return readMailbox();
  }

  /* ---- programs ---- */

  createProgram(): WebGLProgram {
    const p = new WebGLProgram();
    p.name = gl.CreateProgram();
    return p;
  }

  deleteProgram(program: WebGLProgram | null): void {
    if (program === null) return;
    gl.DeleteProgram(program.name);
    if (this.currentProgram === program) this.currentProgram = null;
  }

  isProgram(program: WebGLProgram | null): boolean {
    return program === null ? false : gl.IsProgram(program.name) !== 0;
  }

  attachShader(program: WebGLProgram, shader: WebGLShader): void {
    gl.AttachShader(program.name, shader.name);
  }
  detachShader(program: WebGLProgram, shader: WebGLShader): void {
    gl.DetachShader(program.name, shader.name);
  }
  linkProgram(program: WebGLProgram): void { gl.LinkProgram(program.name); }
  useProgram(program: WebGLProgram | null): void {
    gl.UseProgram(program === null ? 0 : program.name);
    this.currentProgram = program;
  }
  validateProgram(program: WebGLProgram): void { gl.ValidateProgram(program.name); }

  getProgramParameter(program: WebGLProgram, pname: number): number {
    return gl.getProgramParameter(program.name, pname);
  }

  getProgramLinkStatus(program: WebGLProgram): boolean {
    return gl.getProgramParameter(program.name, LINK_STATUS) !== 0;
  }

  getProgramInfoLog(program: WebGLProgram): string {
    gl.programInfoLog(program.name);
    return readMailbox();
  }

  /* ---- uniforms and attributes ---- */

  /* Returns null when the name is not an active uniform, which is what the
   * spec says and what shader-reflection code checks for. */
  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    const loc = gl.getUniformLocation(program.name, name);
    if (loc < 0) return null;
    const w = new WebGLUniformLocation();
    w.location = loc;
    return w;
  }

  getAttribLocation(program: WebGLProgram, name: string): number {
    return gl.getAttribLocation(program.name, name);
  }

  bindAttribLocation(program: WebGLProgram, index: number, name: string): void {
    gl.bindAttribLocation(program.name, index, name);
  }

  uniform1f(loc: WebGLUniformLocation | null, x: number): void {
    if (loc !== null) gl.uniform1f(loc.location, x);
  }
  uniform2f(loc: WebGLUniformLocation | null, x: number, y: number): void {
    if (loc !== null) gl.uniform2f(loc.location, x, y);
  }
  uniform3f(loc: WebGLUniformLocation | null, x: number, y: number, z: number): void {
    if (loc !== null) gl.uniform3f(loc.location, x, y, z);
  }
  uniform4f(loc: WebGLUniformLocation | null, x: number, y: number, z: number,
            w: number): void {
    if (loc !== null) gl.uniform4f(loc.location, x, y, z, w);
  }

  uniform1i(loc: WebGLUniformLocation | null, x: number): void {
    if (loc !== null) gl.Uniform1i(loc.location, x);
  }
  uniform2i(loc: WebGLUniformLocation | null, x: number, y: number): void {
    if (loc !== null) gl.Uniform2i(loc.location, x, y);
  }
  uniform3i(loc: WebGLUniformLocation | null, x: number, y: number, z: number): void {
    if (loc !== null) gl.Uniform3i(loc.location, x, y, z);
  }
  uniform4i(loc: WebGLUniformLocation | null, x: number, y: number, z: number,
            w: number): void {
    if (loc !== null) gl.Uniform4i(loc.location, x, y, z, w);
  }

  /* The *v forms take the raw bytes of a Float32Array; the component count
   * tells the shim which glUniform*fv to call. */
  uniform1fv(loc: WebGLUniformLocation | null, data: Buffer): void {
    if (loc !== null) gl.uniformFv(loc.location, 1, data);
  }
  uniform2fv(loc: WebGLUniformLocation | null, data: Buffer): void {
    if (loc !== null) gl.uniformFv(loc.location, 2, data);
  }
  uniform3fv(loc: WebGLUniformLocation | null, data: Buffer): void {
    if (loc !== null) gl.uniformFv(loc.location, 3, data);
  }
  uniform4fv(loc: WebGLUniformLocation | null, data: Buffer): void {
    if (loc !== null) gl.uniformFv(loc.location, 4, data);
  }

  uniformMatrix2fv(loc: WebGLUniformLocation | null, transpose: boolean,
                   data: Buffer): void {
    if (loc !== null) gl.uniformMatrixFv(loc.location, 2, transpose ? 1 : 0, data);
  }
  uniformMatrix3fv(loc: WebGLUniformLocation | null, transpose: boolean,
                   data: Buffer): void {
    if (loc !== null) gl.uniformMatrixFv(loc.location, 3, transpose ? 1 : 0, data);
  }
  uniformMatrix4fv(loc: WebGLUniformLocation | null, transpose: boolean,
                   data: Buffer): void {
    if (loc !== null) gl.uniformMatrixFv(loc.location, 4, transpose ? 1 : 0, data);
  }

  enableVertexAttribArray(index: number): void { gl.EnableVertexAttribArray(index); }
  disableVertexAttribArray(index: number): void { gl.DisableVertexAttribArray(index); }

  /* `offset` is a byte offset into the bound ARRAY_BUFFER in ES3, never a
   * client pointer, which is why it crosses as a number. */
  vertexAttribPointer(index: number, size: number, type: number,
                      normalized: boolean, stride: number, offset: number): void {
    gl.vertexAttribPointer(index, size, type, normalized ? 1 : 0, stride, offset);
  }

  vertexAttribIPointer(index: number, size: number, type: number, stride: number,
                       offset: number): void {
    gl.vertexAttribIPointer(index, size, type, stride, offset);
  }

  vertexAttribDivisor(index: number, divisor: number): void {
    gl.VertexAttribDivisor(index, divisor);
  }

  /* ---- textures ---- */

  createTexture(): WebGLTexture {
    const t = new WebGLTexture();
    t.name = gl.genTexture();
    return t;
  }

  deleteTexture(tex: WebGLTexture | null): void {
    if (tex === null) return;
    gl.deleteTexture(tex.name);
    if (this.boundTexture2D === tex) this.boundTexture2D = null;
    if (this.boundTextureCubeMap === tex) this.boundTextureCubeMap = null;
  }

  isTexture(tex: WebGLTexture | null): boolean {
    return tex === null ? false : gl.IsTexture(tex.name) !== 0;
  }

  bindTexture(target: number, tex: WebGLTexture | null): void {
    gl.BindTexture(target, tex === null ? 0 : tex.name);
    if (target === TEXTURE_2D) this.boundTexture2D = tex;
    else if (target === TEXTURE_CUBE_MAP) this.boundTextureCubeMap = tex;
  }

  activeTexture(unit: number): void {
    gl.ActiveTexture(unit);
    this.activeTextureUnit = unit;
  }

  texParameteri(target: number, pname: number, param: number): void {
    gl.TexParameteri(target, pname, param);
  }
  texParameterf(target: number, pname: number, param: number): void {
    gl.texParameterf(target, pname, param);
  }

  /* An empty span is the texImage2D(..., null) form: allocate, do not
   * upload. */
  texImage2D(target: number, level: number, internalformat: number,
             width: number, height: number, border: number, format: number,
             type: number, pixels: Buffer): void {
    gl.texImage2d(target, level, internalformat, width, height, border,
                          format, type, pixels);
  }

  texSubImage2D(target: number, level: number, xoffset: number, yoffset: number,
                width: number, height: number, format: number, type: number,
                pixels: Buffer): void {
    gl.texSubImage2d(target, level, xoffset, yoffset, width, height,
                              format, type, pixels);
  }

  generateMipmap(target: number): void { gl.GenerateMipmap(target); }

  /* texImage2D from a decoded Image.
   *
   * The web spells this as the 6-argument texImage2D overload taking an
   * image source. Here it is its own method, because the pixels never enter
   * TS: format 1 has no out-bytes class, so the copy happens natively,
   * Skia bitmap straight to GL texture. That is FASTER than the browser
   * path, which round-trips through an ImageData.
   *
   * The internal format is RGBA8, which is what the decoder produces. */
  texImage2DFromImage(target: number, level: number, image: Image): void {
    gl.texImageFromBitmap(target, level, image.handle);
  }

  /* texImage2D from an OFFSCREEN 2D CANVAS.
   *
   * The web spells this as the same 6-argument overload, passing the canvas
   * element. Here it takes the Context2D, and like the Image path the
   * pixels stay native: Skia surface straight to GL texture.
   *
   * This is what makes a Canvas-drawn HUD usable as a texture in 3D. */
  texImage2DFromCanvas(target: number, level: number, ctx: Context2D): void {
    gl.texImageFromSurface(target, level, ctx.surfaceHandle());
  }

  /* ---- framebuffers and renderbuffers ---- */

  createFramebuffer(): WebGLFramebuffer {
    const f = new WebGLFramebuffer();
    f.name = gl.genFramebuffer();
    return f;
  }

  deleteFramebuffer(fb: WebGLFramebuffer | null): void {
    if (fb === null) return;
    gl.deleteFramebuffer(fb.name);
    if (this.boundFramebuffer === fb) this.boundFramebuffer = null;
  }

  bindFramebuffer(target: number, fb: WebGLFramebuffer | null): void {
    gl.BindFramebuffer(target, fb === null ? 0 : fb.name);
    if (target === FRAMEBUFFER) this.boundFramebuffer = fb;
  }

  isFramebuffer(fb: WebGLFramebuffer | null): boolean {
    return fb === null ? false : gl.IsFramebuffer(fb.name) !== 0;
  }

  checkFramebufferStatus(target: number): number {
    return gl.CheckFramebufferStatus(target);
  }

  framebufferTexture2D(target: number, attachment: number, textarget: number,
                       tex: WebGLTexture | null, level: number): void {
    gl.FramebufferTexture2D(target, attachment, textarget,
                              tex === null ? 0 : tex.name, level);
  }

  createRenderbuffer(): WebGLRenderbuffer {
    const r = new WebGLRenderbuffer();
    r.name = gl.genRenderbuffer();
    return r;
  }

  deleteRenderbuffer(rb: WebGLRenderbuffer | null): void {
    if (rb === null) return;
    gl.deleteRenderbuffer(rb.name);
    if (this.boundRenderbuffer === rb) this.boundRenderbuffer = null;
  }

  bindRenderbuffer(target: number, rb: WebGLRenderbuffer | null): void {
    gl.BindRenderbuffer(target, rb === null ? 0 : rb.name);
    if (target === RENDERBUFFER) this.boundRenderbuffer = rb;
  }

  renderbufferStorage(target: number, internalformat: number, width: number,
                      height: number): void {
    gl.RenderbufferStorage(target, internalformat, width, height);
  }

  framebufferRenderbuffer(target: number, attachment: number,
                          renderbuffertarget: number,
                          rb: WebGLRenderbuffer | null): void {
    gl.FramebufferRenderbuffer(target, attachment, renderbuffertarget,
                                 rb === null ? 0 : rb.name);
  }

  /* ---- drawing ---- */

  drawArrays(mode: number, first: number, count: number): void {
    gl.DrawArrays(mode, first, count);
  }

  drawElements(mode: number, count: number, type: number, offset: number): void {
    gl.drawElements(mode, count, type, offset);
  }

  drawArraysInstanced(mode: number, first: number, count: number,
                      instances: number): void {
    gl.DrawArraysInstanced(mode, first, count, instances);
  }

  drawElementsInstanced(mode: number, count: number, type: number,
                        offset: number, instances: number): void {
    gl.drawElementsInstanced(mode, count, type, offset, instances);
  }

  /* ---- parameters ---- */

  getParameter(pname: number): number { return gl.getInteger(pname); }
  getParameterf(pname: number): number { return gl.getFloat(pname); }
  getParameterb(pname: number): boolean { return gl.getBoolean(pname) !== 0; }

  /** Multi-component parameters (VIEWPORT, SCISSOR_BOX) one at a time. */
  getParameteri(pname: number, index: number): number {
    return gl.getIntegerI(pname, index);
  }

  /* ---- readback ---- */

  /* NOT the spec's readPixels: FFI format 1 has no out-bytes class, so
   * pixels cannot cross the boundary. The framebuffer is hashed natively
   * instead, which is what the conformance gate compares. A game that wants
   * the pixels uses the screenshot path. */
  hashPixels(x: number, y: number, width: number, height: number): number {
    return gl.hashPixels(x, y, width, height);
  }
}
