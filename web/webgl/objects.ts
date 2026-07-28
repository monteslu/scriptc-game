/* The WebGL object types.
 *
 * On the web these are opaque handles: `createBuffer()` hands back a
 * `WebGLBuffer` you pass to `bindBuffer`, and the only things a game does
 * with one are pass it back, compare it to `null`, and let it be collected.
 *
 * They exist as real classes rather than bare numbers for the same reason
 * they do in a browser: `bindBuffer(target, texture)` should not typecheck.
 * GL names are `u32` underneath, so the wrapper is one field.
 *
 * `WebGLSync` is the exception. It is a POINTER in GL, not a name, so it
 * cannot cross the FFI as a scalar; the shim keeps a handle table and this
 * holds the handle. That is invisible from game code, which is the point.
 */

export class WebGLBuffer {
  /** The GL name. Internal: the context reads it, games do not. */
  name = 0;
}

export class WebGLTexture {
  name = 0;
}

export class WebGLFramebuffer {
  name = 0;
}

export class WebGLRenderbuffer {
  name = 0;
}

export class WebGLProgram {
  name = 0;
}

export class WebGLShader {
  name = 0;
}

export class WebGLVertexArrayObject {
  name = 0;
}

export class WebGLSampler {
  name = 0;
}

export class WebGLQuery {
  name = 0;
}

export class WebGLTransformFeedback {
  name = 0;
}

/* A GLsync is a pointer in GL. `name` is a shim handle-table index rather
 * than a GL name, which is why the sync entry points are hand-written shim
 * code instead of generated passthroughs. */
export class WebGLSync {
  name = 0;
}

/* getUniformLocation returns one of these, or null when the uniform is not
 * active. The location is a GLint and CAN be -1, which is why this is a
 * class and not a bare number: -1 and null are different states on the web
 * and game code distinguishes them. */
export class WebGLUniformLocation {
  location = 0;
}

/** getActiveAttrib / getActiveUniform return this triple. */
export class WebGLActiveInfo {
  size = 0;
  type = 0;
  name = "";
}

/** getShaderPrecisionFormat returns this. */
export class WebGLShaderPrecisionFormat {
  rangeMin = 0;
  rangeMax = 0;
  precision = 0;
}
