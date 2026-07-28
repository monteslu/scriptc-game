/* Hand-written GL shim: the entry points the generator refuses.
 *
 * codegen/gen-gl.js emits everything that is scalars-only (straight
 * passthrough) or float-taking (a narrowing wrapper). What is left takes
 * POINTERS, which FFI format 1 cannot express, and each needs a decision
 * about what crosses the boundary instead. Those decisions live here.
 *
 * Four shapes cover almost all of it:
 *
 *   1. SINGLE-OBJECT GENERATORS. glGenBuffers(1, &name) is really "return a
 *      name". WebGL's createBuffer() only ever asks for one, so the wrapper
 *      returns it: `uint32_t sg_gl_gen_buffer(void)`. The n>1 form is not
 *      exposed, because the WebGL API has no way to ask for it.
 *
 *   2. SINGLE-OBJECT DELETERS. Same, mirrored.
 *
 *   3. BULK UPLOADS. glBufferData/glTexImage2D take a pointer plus a size,
 *      which is exactly the `bytes` param class: a borrowed span, valid for
 *      the call only. No copy, no lifetime question.
 *
 *   4. OUT-PARAM GETTERS. glGetIntegerv(pname, &out) becomes
 *      `int32_t sg_gl_get_integer(uint32_t pname)`. The multi-value forms
 *      (viewport, scissor) return one component per call, indexed, which
 *      costs four boundary crossings for a value read once a frame at most.
 *
 * Strings (shader source, info logs) go through the existing string mailbox
 * rather than inventing a second protocol.
 */
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sg_skia.h"   /* sg_mail_set, SG_OK and friends */

extern "C" {

/* ---- headless context (the conformance lane) --------------------------
 *
 * SDL_VIDEODRIVER=dummy cannot create a GL context ("Invalid window"), so
 * the 2D headless trick does not carry over. EGL's DEVICE platform needs no
 * display server at all: enumerate devices, take a pbuffer, done. Same
 * shape as native-gles's egl_context.cpp.
 *
 * A windowed context comes from SDL instead (see sg_core.cpp); this exists
 * so the readback-parity gate can run in CI with no X server.
 */
static EGLDisplay g_egl_display = EGL_NO_DISPLAY;
static EGLContext g_egl_context = EGL_NO_CONTEXT;
static EGLSurface g_egl_surface = EGL_NO_SURFACE;

int32_t sg_gl_init_headless(int32_t width, int32_t height) {
  if (g_egl_context != EGL_NO_CONTEXT) return SG_OK;   // idempotent

  auto queryDevices = (PFNEGLQUERYDEVICESEXTPROC)
      eglGetProcAddress("eglQueryDevicesEXT");
  auto getPlatformDisplay = (PFNEGLGETPLATFORMDISPLAYEXTPROC)
      eglGetProcAddress("eglGetPlatformDisplayEXT");
  if (!queryDevices || !getPlatformDisplay) {
    sg_mail_set("EGL device extensions unavailable (no headless GL)");
    return SG_ESDL;
  }

  EGLDeviceEXT devices[8];
  EGLint deviceCount = 0;
  if (!queryDevices(8, devices, &deviceCount) || deviceCount < 1) {
    sg_mail_set("no EGL devices");
    return SG_ESDL;
  }

  g_egl_display = getPlatformDisplay(EGL_PLATFORM_DEVICE_EXT, devices[0], nullptr);
  if (g_egl_display == EGL_NO_DISPLAY) { sg_mail_set("eglGetPlatformDisplay failed"); return SG_ESDL; }
  if (!eglInitialize(g_egl_display, nullptr, nullptr)) {
    sg_mail_set("eglInitialize failed");
    return SG_ESDL;
  }
  eglBindAPI(EGL_OPENGL_ES_API);

  const EGLint configAttribs[] = {
    EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
    EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
    EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
    EGL_DEPTH_SIZE, 24,
    EGL_NONE,
  };
  EGLConfig config;
  EGLint configCount = 0;
  if (!eglChooseConfig(g_egl_display, configAttribs, &config, 1, &configCount) ||
      configCount < 1) {
    sg_mail_set("no ES3-capable EGL config");
    return SG_ESDL;
  }

  const EGLint pbufferAttribs[] = {EGL_WIDTH, width, EGL_HEIGHT, height, EGL_NONE};
  g_egl_surface = eglCreatePbufferSurface(g_egl_display, config, pbufferAttribs);
  if (g_egl_surface == EGL_NO_SURFACE) { sg_mail_set("eglCreatePbufferSurface failed"); return SG_ESDL; }

  const EGLint contextAttribs[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
  g_egl_context = eglCreateContext(g_egl_display, config, EGL_NO_CONTEXT, contextAttribs);
  if (g_egl_context == EGL_NO_CONTEXT) { sg_mail_set("eglCreateContext failed"); return SG_ESDL; }

  if (!eglMakeCurrent(g_egl_display, g_egl_surface, g_egl_surface, g_egl_context)) {
    sg_mail_set("eglMakeCurrent failed");
    return SG_ESDL;
  }
  return SG_OK;
}

void sg_gl_shutdown_headless(void) {
  if (g_egl_display == EGL_NO_DISPLAY) return;
  eglMakeCurrent(g_egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  if (g_egl_context != EGL_NO_CONTEXT) eglDestroyContext(g_egl_display, g_egl_context);
  if (g_egl_surface != EGL_NO_SURFACE) eglDestroySurface(g_egl_display, g_egl_surface);
  eglTerminate(g_egl_display);
  g_egl_display = EGL_NO_DISPLAY;
  g_egl_context = EGL_NO_CONTEXT;
  g_egl_surface = EGL_NO_SURFACE;
}

/* ---- 1. single-object generators ------------------------------------- */

uint32_t sg_gl_gen_buffer(void) { GLuint n = 0; glGenBuffers(1, &n); return n; }
uint32_t sg_gl_gen_texture(void) { GLuint n = 0; glGenTextures(1, &n); return n; }
uint32_t sg_gl_gen_framebuffer(void) { GLuint n = 0; glGenFramebuffers(1, &n); return n; }
uint32_t sg_gl_gen_renderbuffer(void) { GLuint n = 0; glGenRenderbuffers(1, &n); return n; }
uint32_t sg_gl_gen_vertex_array(void) { GLuint n = 0; glGenVertexArrays(1, &n); return n; }
uint32_t sg_gl_gen_sampler(void) { GLuint n = 0; glGenSamplers(1, &n); return n; }
uint32_t sg_gl_gen_query(void) { GLuint n = 0; glGenQueries(1, &n); return n; }
uint32_t sg_gl_gen_transform_feedback(void) {
  GLuint n = 0; glGenTransformFeedbacks(1, &n); return n;
}

/* ---- 2. single-object deleters --------------------------------------- */

void sg_gl_delete_buffer(uint32_t n) { GLuint v = n; glDeleteBuffers(1, &v); }
void sg_gl_delete_texture(uint32_t n) { GLuint v = n; glDeleteTextures(1, &v); }
void sg_gl_delete_framebuffer(uint32_t n) { GLuint v = n; glDeleteFramebuffers(1, &v); }
void sg_gl_delete_renderbuffer(uint32_t n) { GLuint v = n; glDeleteRenderbuffers(1, &v); }
void sg_gl_delete_vertex_array(uint32_t n) { GLuint v = n; glDeleteVertexArrays(1, &v); }
void sg_gl_delete_sampler(uint32_t n) { GLuint v = n; glDeleteSamplers(1, &v); }
void sg_gl_delete_query(uint32_t n) { GLuint v = n; glDeleteQueries(1, &v); }
void sg_gl_delete_transform_feedback(uint32_t n) {
  GLuint v = n; glDeleteTransformFeedbacks(1, &v);
}

/* ---- 3. bulk uploads -------------------------------------------------- */

/* `data` is a borrowed span for the duration of the call, which is exactly
 * what GL wants: it copies into the buffer object before returning. */
void sg_gl_buffer_data(uint32_t target, const uint8_t* data, size_t len,
                       uint32_t usage) {
  glBufferData(target, (GLsizeiptr)len, data, usage);
}

/* A size-only bufferData: glBufferData(target, size, NULL, usage) allocates
 * without initialising, which the `bytes` class cannot express (a zero-length
 * span is not a null pointer). */
void sg_gl_buffer_data_size(uint32_t target, double size, uint32_t usage) {
  glBufferData(target, (GLsizeiptr)size, nullptr, usage);
}

void sg_gl_buffer_sub_data(uint32_t target, double offset,
                           const uint8_t* data, size_t len) {
  glBufferSubData(target, (GLintptr)offset, (GLsizeiptr)len, data);
}

void sg_gl_tex_image_2d(uint32_t target, int32_t level, int32_t internalformat,
                        int32_t width, int32_t height, int32_t border,
                        uint32_t format, uint32_t type,
                        const uint8_t* pixels, size_t len) {
  /* A zero-length span means "allocate, do not upload", which is the
   * texImage2D(..., null) form. */
  glTexImage2D(target, level, internalformat, width, height, border, format,
               type, len == 0 ? nullptr : pixels);
}

void sg_gl_tex_sub_image_2d(uint32_t target, int32_t level, int32_t xoffset,
                            int32_t yoffset, int32_t width, int32_t height,
                            uint32_t format, uint32_t type,
                            const uint8_t* pixels, size_t len) {
  if (len == 0) return;
  glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type,
                  pixels);
}

/* Upload a decoded Skia bitmap straight into a GL texture.
 *
 * The pixels never cross the FFI. Format 1 has no out-bytes class, so a
 * game cannot read an Image's bytes into TS and pass them to texImage2D the
 * way a browser does. Both ends are native, though, so the whole copy
 * happens down here: Skia bitmap in, GL texture out, one call.
 *
 * Skia's C ABI exposes no direct pixel reader on a bitmap, so the bitmap is
 * drawn into a scratch RGBA surface and read back from there. That is one
 * extra blit at LOAD time, not per frame, and it is the same path
 * sg_present already uses for the screen.
 */
int32_t sg_gl_tex_image_from_bitmap(uint32_t target, int32_t level,
                                    uint32_t bitmap_handle) {
  skiac_bitmap* b = (skiac_bitmap*)sg_table_get(SG_T_BITMAP, bitmap_handle);
  if (!b) { sg_mail_set("texImage2D: bitmap handle is stale or invalid"); return SG_EBADHANDLE; }

  const int w = (int)skiac_bitmap_get_width(b);
  const int h = (int)skiac_bitmap_get_height(b);
  if (w <= 0 || h <= 0) { sg_mail_set("texImage2D: image has no pixels"); return SG_ERANGE; }

  skiac_surface* surf = skiac_surface_create_rgba(w, h, 0);
  if (!surf) { sg_mail_set("texImage2D: could not create a scratch surface"); return SG_ESKIA; }

  skiac_canvas* canvas = skiac_surface_get_canvas(surf);
  skiac_canvas_draw_image(canvas, b, false, 0.0f, 0.0f, (float)w, (float)h,
                          0.0f, 0.0f, (float)w, (float)h, false, 0, nullptr);

  skiac_surface_data data;
  data.ptr = nullptr;
  data.size = 0;
  skiac_surface_read_pixels(surf, &data);
  if (!data.ptr) {
    skiac_surface_destroy(surf);
    sg_mail_set("texImage2D: read_pixels returned no data");
    return SG_ESKIA;
  }

  glTexImage2D(target, level, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE,
               data.ptr);
  skiac_surface_destroy(surf);
  return SG_OK;
}

/* ---- 4. out-param getters -------------------------------------------- */

int32_t sg_gl_get_integer(uint32_t pname) {
  GLint v = 0;
  glGetIntegerv(pname, &v);
  return v;
}

/* Multi-value parameters (VIEWPORT, SCISSOR_BOX, COLOR_WRITEMASK) one
 * component at a time. Four crossings for something read at most once a
 * frame is cheaper than inventing a return-array protocol. */
int32_t sg_gl_get_integer_i(uint32_t pname, uint32_t index) {
  GLint v[4] = {0, 0, 0, 0};
  glGetIntegerv(pname, v);
  return index < 4 ? v[index] : 0;
}

double sg_gl_get_float(uint32_t pname) {
  GLfloat v = 0.0f;
  glGetFloatv(pname, &v);
  return (double)v;
}

uint32_t sg_gl_get_boolean(uint32_t pname) {
  GLboolean v = GL_FALSE;
  glGetBooleanv(pname, &v);
  return v ? 1u : 0u;
}

/* ---- shaders and programs -------------------------------------------- */

/* Shader source arrives as one borrowed span; GL wants an array of pointers
 * plus lengths. One string is the only form WebGL's shaderSource can
 * produce. */
void sg_gl_shader_source(uint32_t shader, const uint8_t* src, size_t len) {
  const GLchar* strings[1] = {(const GLchar*)src};
  const GLint lengths[1] = {(GLint)len};
  glShaderSource(shader, 1, strings, lengths);
}

int32_t sg_gl_get_shader_parameter(uint32_t shader, uint32_t pname) {
  GLint v = 0;
  glGetShaderiv(shader, pname, &v);
  return v;
}

int32_t sg_gl_get_program_parameter(uint32_t program, uint32_t pname) {
  GLint v = 0;
  glGetProgramiv(program, pname, &v);
  return v;
}

/* Info logs go to the string mailbox, the same channel every other shim
 * error uses, rather than a second string protocol. Returns the length so
 * TS knows whether to read it. */
int32_t sg_gl_shader_info_log(uint32_t shader) {
  GLint len = 0;
  glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &len);
  if (len <= 0) { sg_mail_set(""); return 0; }
  char buf[4096];
  GLsizei got = 0;
  glGetShaderInfoLog(shader, (GLsizei)sizeof(buf), &got, buf);
  buf[got < (GLsizei)sizeof(buf) ? got : (GLsizei)sizeof(buf) - 1] = 0;
  sg_mail_set(buf);
  return (int32_t)got;
}

int32_t sg_gl_program_info_log(uint32_t program) {
  GLint len = 0;
  glGetProgramiv(program, GL_INFO_LOG_LENGTH, &len);
  if (len <= 0) { sg_mail_set(""); return 0; }
  char buf[4096];
  GLsizei got = 0;
  glGetProgramInfoLog(program, (GLsizei)sizeof(buf), &got, buf);
  buf[got < (GLsizei)sizeof(buf) ? got : (GLsizei)sizeof(buf) - 1] = 0;
  sg_mail_set(buf);
  return (int32_t)got;
}

/* getUniformLocation: -1 means "not an active uniform", which the WebGL
 * layer turns into null. */
int32_t sg_gl_get_uniform_location(uint32_t program, const uint8_t* name,
                                   size_t len) {
  char buf[256];
  if (len >= sizeof(buf)) return -1;
  memcpy(buf, name, len);
  buf[len] = 0;
  return glGetUniformLocation(program, buf);
}

int32_t sg_gl_get_attrib_location(uint32_t program, const uint8_t* name,
                                  size_t len) {
  char buf[256];
  if (len >= sizeof(buf)) return -1;
  memcpy(buf, name, len);
  buf[len] = 0;
  return glGetAttribLocation(program, buf);
}

void sg_gl_bind_attrib_location(uint32_t program, uint32_t index,
                                const uint8_t* name, size_t len) {
  char buf[256];
  if (len >= sizeof(buf)) return;
  memcpy(buf, name, len);
  buf[len] = 0;
  glBindAttribLocation(program, index, buf);
}

/* ---- uniforms with array payloads ------------------------------------ */

/* The *v forms take a float array. Bytes in, reinterpreted: the caller
 * passes a Float32Array's bytes, so the count is len/4 divided by the
 * component count. */
void sg_gl_uniform_fv(int32_t location, uint32_t components,
                      const uint8_t* data, size_t len) {
  const GLfloat* f = (const GLfloat*)data;
  GLsizei count = (GLsizei)(len / (4 * components));
  switch (components) {
    case 1: glUniform1fv(location, count, f); break;
    case 2: glUniform2fv(location, count, f); break;
    case 3: glUniform3fv(location, count, f); break;
    case 4: glUniform4fv(location, count, f); break;
    default: break;
  }
}

void sg_gl_uniform_iv(int32_t location, uint32_t components,
                      const uint8_t* data, size_t len) {
  const GLint* v = (const GLint*)data;
  GLsizei count = (GLsizei)(len / (4 * components));
  switch (components) {
    case 1: glUniform1iv(location, count, v); break;
    case 2: glUniform2iv(location, count, v); break;
    case 3: glUniform3iv(location, count, v); break;
    case 4: glUniform4iv(location, count, v); break;
    default: break;
  }
}

/* Matrix uniforms: dim is 2, 3 or 4. */
void sg_gl_uniform_matrix_fv(int32_t location, uint32_t dim, uint32_t transpose,
                             const uint8_t* data, size_t len) {
  const GLfloat* f = (const GLfloat*)data;
  GLsizei count = (GLsizei)(len / (4 * dim * dim));
  GLboolean t = transpose ? GL_TRUE : GL_FALSE;
  switch (dim) {
    case 2: glUniformMatrix2fv(location, count, t, f); break;
    case 3: glUniformMatrix3fv(location, count, t, f); break;
    case 4: glUniformMatrix4fv(location, count, t, f); break;
    default: break;
  }
}

/* ---- vertex attributes ------------------------------------------------ */

/* The pointer argument is a BYTE OFFSET into the bound buffer in ES3, not a
 * client pointer, so it crosses as a number. */
void sg_gl_vertex_attrib_pointer(uint32_t index, int32_t size, uint32_t type,
                                 uint32_t normalized, int32_t stride,
                                 double offset) {
  glVertexAttribPointer(index, size, type, normalized ? GL_TRUE : GL_FALSE,
                        stride, (const void*)(intptr_t)offset);
}

void sg_gl_vertex_attrib_i_pointer(uint32_t index, int32_t size, uint32_t type,
                                   int32_t stride, double offset) {
  glVertexAttribIPointer(index, size, type, stride, (const void*)(intptr_t)offset);
}

/* Same story for indexed draws. */
void sg_gl_draw_elements(uint32_t mode, int32_t count, uint32_t type,
                         double offset) {
  glDrawElements(mode, count, type, (const void*)(intptr_t)offset);
}

void sg_gl_draw_elements_instanced(uint32_t mode, int32_t count, uint32_t type,
                                   double offset, int32_t instances) {
  glDrawElementsInstanced(mode, count, type, (const void*)(intptr_t)offset,
                          instances);
}

/* ---- readback --------------------------------------------------------- */

/* readPixels into a caller-owned span. FFI format 1 has no out-bytes class,
 * so this is the one place the WebGL layer cannot hand back pixels directly;
 * the conformance harness hashes them natively instead (see sg_gl_hash_pixels).
 */
/* Save the GL framebuffer as a PNG.
 *
 * The 2D screenshot path reads the SKIA surface, which a GL frame never
 * touches, so a WebGL game captured through it comes out blank. That is not
 * hypothetical: it is exactly what happened, and a green exit code hid it
 * until the framebuffer was hashed.
 *
 * glReadPixels is bottom-up while an image file is top-down, so rows are
 * flipped on the way out. Encoding reuses Skia rather than adding a second
 * PNG writer.
 */
int32_t sg_gl_save_png(const uint8_t* path, size_t path_len) {
  char file[1024];
  if (path_len >= sizeof(file)) { sg_mail_set("screenshot path too long"); return SG_ERANGE; }
  memcpy(file, path, path_len);
  file[path_len] = 0;

  GLint vp[4] = {0, 0, 0, 0};
  glGetIntegerv(GL_VIEWPORT, vp);
  const int w = vp[2];
  const int h = vp[3];
  if (w <= 0 || h <= 0) { sg_mail_set("GL viewport is empty"); return SG_ERANGE; }

  const size_t stride = (size_t)w * 4;
  const size_t total = stride * (size_t)h;
  uint8_t* rows = (uint8_t*)malloc(total);
  uint8_t* flipped = (uint8_t*)malloc(total);
  if (!rows || !flipped) {
    free(rows); free(flipped);
    sg_mail_set("out of memory reading the framebuffer");
    return SG_ERANGE;
  }
  glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, rows);
  for (int row = 0; row < h; row++) {
    memcpy(flipped + (size_t)row * stride,
           rows + (size_t)(h - 1 - row) * stride, stride);
  }
  free(rows);

  skiac_surface* surf = skiac_surface_create_rgba(w, h, 0);
  if (!surf) { free(flipped); sg_mail_set("could not create the encode surface"); return SG_ESKIA; }
  skiac_canvas* canvas = skiac_surface_get_canvas(surf);
  skiac_canvas_put_image_data(canvas, w, h, flipped, stride, total,
                              0.0f, 0.0f, 0.0f, 0.0f, (float)w, (float)h,
                              0, false);
  free(flipped);

  skiac_sk_data png;
  png.ptr = NULL; png.size = 0; png.data = NULL;
  skiac_surface_png_data(surf, &png);
  if (!png.ptr || png.size == 0) {
    skiac_surface_destroy(surf);
    sg_mail_set("png encode failed");
    return SG_ESKIA;
  }
  FILE* f = fopen(file, "wb");
  if (!f) {
    if (png.data) skiac_sk_data_destroy(png.data);
    skiac_surface_destroy(surf);
    sg_mail_set("could not open png path for writing");
    return SG_ERANGE;
  }
  const size_t wrote = fwrite(png.ptr, 1, png.size, f);
  fclose(f);
  if (png.data) skiac_sk_data_destroy(png.data);
  skiac_surface_destroy(surf);
  if (wrote != png.size) { sg_mail_set("short write encoding png"); return SG_ERANGE; }
  return SG_OK;
}

uint32_t sg_gl_hash_pixels(int32_t x, int32_t y, int32_t w, int32_t h) {
  if (w <= 0 || h <= 0) return 0;
  const size_t n = (size_t)w * (size_t)h * 4;
  uint8_t* buf = (uint8_t*)malloc(n);
  if (!buf) return 0;
  glReadPixels(x, y, w, h, GL_RGBA, GL_UNSIGNED_BYTE, buf);
  /* FNV-1a: the harness only needs a stable digest to compare against the
   * Node+webgl-node run, not a cryptographic one. */
  uint32_t hash = 2166136261u;
  for (size_t i = 0; i < n; i++) {
    hash ^= buf[i];
    hash *= 16777619u;
  }
  free(buf);
  return hash;
}

}  // extern "C"
