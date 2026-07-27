/* Hand-written skiac wrappers: the shapes the generator refuses to guess.
 *
 * Every function here has an entry in codegen/skia-allowlist.json's `manual`
 * map saying WHY, so this file is auditable rather than a dumping ground.
 * The recurring reasons are: array parameters, structs passed or returned by
 * value, and struct out-parameters, none of which FFI format 1 can express.
 *
 * The shared technique is a small set of shim-owned scratch buffers that TS
 * fills with scalar calls and then "commits" with one call that does the real
 * work. Nothing here retains a borrowed pointer past its call.
 */
#include <stdint.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "sg_skia.h"

/* ---- math ----
 *
 * scriptc's static tier keeps only the Math functions that lower to a single
 * instruction or a trivial comparison: abs, floor, ceil, round, trunc, min,
 * max. Everything TRANSCENDENTAL -- sqrt, sin, cos, tan, atan2, pow, exp,
 * log, hypot -- is fenced (SC2012: "runs in the embedded dynamic engine")
 * and would drag a ~620KB interpreter into the binary.
 *
 * Games need those constantly (vector length, rotation, easing), so they
 * cross the FFI to libm instead. At the measured ~3ns of call overhead this
 * costs about as much as the libm call itself, and it keeps the fully-static
 * guarantee intact. runtime/math.ts wraps these.
 */
extern "C" double sg_sqrt(double x)  { return sqrt(x); }
extern "C" double sg_sin(double x)   { return sin(x); }
extern "C" double sg_cos(double x)   { return cos(x); }
extern "C" double sg_tan(double x)   { return tan(x); }
extern "C" double sg_asin(double x)  { return asin(x); }
extern "C" double sg_acos(double x)  { return acos(x); }
extern "C" double sg_atan(double x)  { return atan(x); }
extern "C" double sg_atan2(double y, double x) { return atan2(y, x); }
extern "C" double sg_pow(double x, double y)   { return pow(x, y); }
extern "C" double sg_exp(double x)   { return exp(x); }
extern "C" double sg_log(double x)   { return log(x); }
extern "C" double sg_log2(double x)  { return log2(x); }
extern "C" double sg_log10(double x) { return log10(x); }
extern "C" double sg_hypot(double x, double y) { return hypot(x, y); }
extern "C" double sg_fmod(double x, double y)  { return fmod(x, y); }

/* ---- scratch: gradient stops ----
 * A gradient is built by pushing stops one at a time, then making the shader.
 * At ~3ns/call, 8 stops cost ~50ns to upload; a stops ARRAY would need a
 * bytes param plus a parallel float array, which is more machinery for less
 * clarity. */
#define SG_MAX_STOPS 64
static uint32_t g_stop_colors[SG_MAX_STOPS];
static float    g_stop_offsets[SG_MAX_STOPS];
static uint32_t g_stop_count;

extern "C" int32_t sg_grad_reset(int32_t unused) {
  (void)unused;
  g_stop_count = 0;
  return SG_OK;
}

extern "C" int32_t sg_grad_add_stop(double offset, uint32_t argb) {
  if (g_stop_count >= SG_MAX_STOPS) {
    sg_mail_set("too many gradient stops");
    return SG_ERANGE;
  }
  g_stop_offsets[g_stop_count] = (float)offset;
  g_stop_colors[g_stop_count] = argb;
  g_stop_count++;
  return SG_OK;
}

/* The identity transform every gradient is created with: canvas gradients are
 * specified in user space and the canvas CTM is applied at draw time, so a
 * local matrix here would double-transform. */
static skiac_transform identity_ts(void) {
  skiac_transform t;
  t.a = 1.0f; t.b = 0.0f; t.c = 0.0f;
  t.d = 1.0f; t.e = 0.0f; t.f = 0.0f;
  return t;
}

extern "C" uint32_t sg_shader_linear_gradient(double x0, double y0, double x1,
                                              double y1, int32_t tile_mode) {
  if (g_stop_count < 2) { sg_mail_set("gradient needs at least 2 stops"); return 0; }
  skiac_point pts[2];
  pts[0].x = (float)x0; pts[0].y = (float)y0;
  pts[1].x = (float)x1; pts[1].y = (float)y1;
  skiac_shader* s = skiac_shader_make_linear_gradient(
      pts, g_stop_colors, g_stop_offsets, (int)g_stop_count, (int)tile_mode, 0,
      identity_ts());
  return s ? sg_table_alloc(SG_T_SHADER, s) : 0;
}

extern "C" uint32_t sg_shader_radial_gradient(double x0, double y0, double r0,
                                              double x1, double y1, double r1,
                                              int32_t tile_mode) {
  if (g_stop_count < 2) { sg_mail_set("gradient needs at least 2 stops"); return 0; }
  skiac_point start, end;
  start.x = (float)x0; start.y = (float)y0;
  end.x = (float)x1;   end.y = (float)y1;
  skiac_shader* s = skiac_shader_make_radial_gradient(
      start, (float)r0, end, (float)r1, g_stop_colors, g_stop_offsets,
      (int)g_stop_count, (int)tile_mode, 0, identity_ts());
  return s ? sg_table_alloc(SG_T_SHADER, s) : 0;
}

extern "C" uint32_t sg_shader_conic_gradient(double cx, double cy,
                                             double start_angle_deg,
                                             int32_t tile_mode) {
  if (g_stop_count < 2) { sg_mail_set("gradient needs at least 2 stops"); return 0; }
  skiac_shader* s = skiac_shader_make_conic_gradient(
      (float)cx, (float)cy, (float)start_angle_deg, g_stop_colors,
      g_stop_offsets, (int)g_stop_count, (int)tile_mode, 0, identity_ts());
  return s ? sg_table_alloc(SG_T_SHADER, s) : 0;
}

/* A pattern is a shader over a bitmap; repeat_x/repeat_y are Skia tile modes
 * (0 clamp, 1 repeat, 2 mirror, 3 decal), which is what "repeat"/"repeat-x"/
 * "repeat-y"/"no-repeat" map onto TS-side. */
extern "C" uint32_t sg_shader_from_bitmap(uint32_t hb, int32_t repeat_x,
                                          int32_t repeat_y) {
  skiac_bitmap* b = (skiac_bitmap*)sg_table_get(SG_T_BITMAP, hb);
  if (!b) { sg_mail_set("bitmap handle is stale or invalid"); return 0; }
  /* B and C are the Mitchell cubic resampler coefficients skia uses for
   * smooth sampling; (1/3, 1/3) is Skia's documented "Mitchell" default. */
  skiac_shader* s = skiac_bitmap_get_shader(false, b, (int)repeat_x,
                                            (int)repeat_y, 1.0f / 3.0f,
                                            1.0f / 3.0f, identity_ts());
  return s ? sg_table_alloc(SG_T_SHADER, s) : 0;
}

/* ---- null-safe paint setters ----
 *
 * skiac_paint_set_shader and skiac_paint_set_path_effect both do
 * `sk_sp<T> p(reinterpret_cast<T*>(handle)); p->ref();` with NO null check,
 * so passing NULL segfaults (found the hard way: a stroke with no dash
 * pattern crashed on frame 1). Handle 0 means "no shader" / "solid line",
 * which is the COMMON case, and skiac exposes no "clear" entry point --
 * napi-rs/canvas never needs one because it builds a fresh SkPaint per draw.
 *
 * The shim keeps a POOLED paint instead (paint creation is the expensive
 * part), so clearing is done by swapping in a pristine SkPaint and replaying
 * the cheap scalar state onto it. The handle is preserved: the table slot is
 * repointed, so TS-side handles stay valid across a reset.
 */
extern "C" int32_t sg_paint_reset(uint32_t hp) {
  skiac_paint* old = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!old) { sg_mail_set("paint handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_paint* fresh = skiac_paint_create();
  if (!fresh) { sg_mail_set("paint allocation failed"); return SG_ESKIA; }
  if (!sg_table_replace(SG_T_PAINT, hp, fresh)) {
    skiac_paint_destroy(fresh);
    sg_mail_set("paint handle replace failed");
    return SG_EBADHANDLE;
  }
  skiac_paint_destroy(old);
  return SG_OK;
}

extern "C" int32_t sg_paint_set_shader_opt(uint32_t hp, uint32_t hshader) {
  if (hshader == 0) return SG_OK;  /* caller resets the paint to clear */
  skiac_paint* p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!p) { sg_mail_set("paint handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_shader* s = (skiac_shader*)sg_table_get(SG_T_SHADER, hshader);
  if (!s) { sg_mail_set("shader handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_paint_set_shader(p, s);
  return SG_OK;
}

extern "C" int32_t sg_paint_set_path_effect_opt(uint32_t hp, uint32_t heffect) {
  if (heffect == 0) return SG_OK;  /* caller resets the paint to clear */
  skiac_paint* p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!p) { sg_mail_set("paint handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_path_effect* e = (skiac_path_effect*)sg_table_get(SG_T_PATH_EFFECT, heffect);
  if (!e) { sg_mail_set("path effect handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_paint_set_path_effect(p, e);
  return SG_OK;
}

/* ---- scratch: line dash ---- */
#define SG_MAX_DASH 32
static float    g_dash[SG_MAX_DASH];
static uint32_t g_dash_count;

extern "C" int32_t sg_dash_reset(int32_t unused) {
  (void)unused;
  g_dash_count = 0;
  return SG_OK;
}

extern "C" int32_t sg_dash_push(double interval) {
  if (g_dash_count >= SG_MAX_DASH) { sg_mail_set("dash pattern too long"); return SG_ERANGE; }
  g_dash[g_dash_count++] = (float)interval;
  return SG_OK;
}

/* Returns a path-effect handle, or 0 when the pattern is empty (which is the
 * canvas "solid line" state, not an error: TS clears the paint's effect). */
extern "C" uint32_t sg_dash_make(double phase) {
  if (g_dash_count == 0) return 0;
  skiac_path_effect* e =
      skiac_path_effect_make_dash_path(g_dash, (int)g_dash_count, (float)phase);
  return e ? sg_table_alloc(SG_T_PATH_EFFECT, e) : 0;
}

/* ---- transforms: struct-by-value in both directions ---- */

/* getTransform: six scalars out through six getters would be six calls and a
 * torn read if anything drew in between, so the value is latched once into
 * shim storage and read back component-wise. */
static skiac_transform g_ts_out;

extern "C" int32_t sg_canvas_latch_transform(uint32_t hc) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) { sg_mail_set("canvas handle is stale or invalid"); return SG_EBADHANDLE; }
  g_ts_out = skiac_canvas_get_total_transform(c);
  return SG_OK;
}

extern "C" double sg_ts_component(uint32_t i) {
  switch (i) {
    case 0: return (double)g_ts_out.a;
    case 1: return (double)g_ts_out.b;
    case 2: return (double)g_ts_out.c;
    case 3: return (double)g_ts_out.d;
    case 4: return (double)g_ts_out.e;
    case 5: return (double)g_ts_out.f;
    default: return 0.0;
  }
}

/* setTransform/transform: build a matrix from six scalars, apply, drop it.
 * `replace` picks setTransform (true) vs transform/concat (false). */
extern "C" int32_t sg_canvas_apply_transform(uint32_t hc, double a, double b,
                                             double c, double d, double e,
                                             double f, uint32_t replace) {
  skiac_canvas* cv = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!cv) { sg_mail_set("canvas handle is stale or invalid"); return SG_EBADHANDLE; }
  /* ARGUMENT ORDER IS NOT PASS-THROUGH.
   *
   * Canvas's transform(a,b,c,d,e,f) is column-major:
   *     | a  c  e |
   *     | b  d  f |
   * skiac_matrix_new feeds SkMatrix::MakeAll(a,b,c,d,e,f,0,0,1), which fills
   * a ROW-major matrix:
   *     | a  b  c |
   *     | d  e  f |
   * So the canvas tuple (a,b,c,d,e,f) must be reordered to (a,c,e,b,d,f).
   * Caught by conformance: sheared rectangles landed at the wrong origin. */
  skiac_matrix* m = skiac_matrix_new((float)a, (float)c, (float)e,
                                     (float)b, (float)d, (float)f);
  if (!m) { sg_mail_set("matrix allocation failed"); return SG_ESKIA; }
  if (replace) skiac_canvas_set_transform(cv, m);
  else         skiac_canvas_concat(cv, m);
  skiac_matrix_destroy(m);
  return SG_OK;
}

/* ---- path bounds: struct out-param ---- */
static skiac_rect g_rect_out;

extern "C" int32_t sg_path_latch_bounds(uint32_t hp) {
  skiac_path* p = (skiac_path*)sg_table_get(SG_T_PATH, hp);
  if (!p) { sg_mail_set("path handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_path_get_bounds(p, &g_rect_out);
  return SG_OK;
}

extern "C" double sg_rect_component(uint32_t i) {
  switch (i) {
    case 0: return (double)g_rect_out.left;
    case 1: return (double)g_rect_out.top;
    case 2: return (double)g_rect_out.right;
    case 3: return (double)g_rect_out.bottom;
    default: return 0.0;
  }
}

/* ---- roundRect: radii array ---- */
extern "C" int32_t sg_path_round_rect(uint32_t hp, double x, double y, double w,
                                      double h, double r_tl, double r_tr,
                                      double r_br, double r_bl,
                                      uint32_t clockwise) {
  skiac_path* p = (skiac_path*)sg_table_get(SG_T_PATH, hp);
  if (!p) { sg_mail_set("path handle is stale or invalid"); return SG_EBADHANDLE; }
  /* Skia wants 8 scalars: an x- and y-radius per corner, starting top-left
   * and running clockwise. Canvas roundRect takes one radius per corner, so
   * each is duplicated into both axes. */
  float radii[8] = {
      (float)r_tl, (float)r_tl, (float)r_tr, (float)r_tr,
      (float)r_br, (float)r_br, (float)r_bl, (float)r_bl,
  };
  skiac_path_round_rect(p, (float)x, (float)y, (float)w, (float)h, radii,
                        clockwise != 0);
  return SG_OK;
}

/* ---- fonts ---- */

/* One process-wide font collection, created on demand. Skia's collection owns
 * the registered typefaces; the shim never hands it across the boundary. */
static skiac_font_collection* g_fonts;

extern "C" skiac_font_collection* sg_fonts(void) {
  if (!g_fonts) g_fonts = skiac_font_collection_create();
  return g_fonts;
}

/* Returns 0 on success, negative on failure.
 *
 * NOT the typeface id: that is a CONTENT HASH (FNV-1a over the file), so it
 * uses the full uint32 range and reinterpreting it as int32 makes perfectly
 * good ids look like errors. Nothing needs the id yet -- fonts are addressed
 * by family name -- so it is deliberately not surfaced. */
extern "C" int32_t sg_font_register(const uint8_t* path, size_t path_len) {
  skiac_font_collection* fc = sg_fonts();
  if (!fc) { sg_mail_set("font collection unavailable"); return SG_ESKIA; }
  char buf[1024];
  if (path_len >= sizeof(buf)) { sg_mail_set("font path too long"); return SG_ERANGE; }
  memcpy(buf, path, path_len);
  buf[path_len] = 0;
  uint32_t id = skiac_font_collection_register_from_path(fc, buf, NULL);
  if (id == 0) { sg_mail_set("font registration failed (missing or unreadable)"); return SG_EDECODE; }
  return SG_OK;
}

/* ---- text ----
 *
 * skiac_canvas_get_line_metrics_or_draw_text is one 26-parameter entry point
 * that both measures and draws: passing a canvas draws, passing NULL fills the
 * line-metrics struct instead. Rather than marshal 26 arguments per call, the
 * shim keeps a text-state block that TS sets once per style change and a
 * commit call that does the work.
 */
typedef struct {
  char   family[128];
  char   text[4096];
  size_t text_len;
  float  size;
  int    weight;
  int    slant;
  int    align;
  int    baseline;
  float  letter_spacing;
  float  max_width;
} sg_text_state;

static sg_text_state g_text = {
    "sans-serif", "", 0, 16.0f, 400, 0, 0, 0, 0.0f, 1.0e9f,
};
static skiac_line_metrics g_metrics;

extern "C" int32_t sg_text_set_font(const uint8_t* family, size_t family_len,
                                    double size, int32_t weight, int32_t slant) {
  if (family_len >= sizeof(g_text.family)) {
    sg_mail_set("font family name too long");
    return SG_ERANGE;
  }
  memcpy(g_text.family, family, family_len);
  g_text.family[family_len] = 0;
  g_text.size = (float)size;
  g_text.weight = (int)weight;
  g_text.slant = (int)slant;
  return SG_OK;
}

extern "C" int32_t sg_text_set_layout(int32_t align, int32_t baseline,
                                      double letter_spacing, double max_width) {
  g_text.align = (int)align;
  g_text.baseline = (int)baseline;
  g_text.letter_spacing = (float)letter_spacing;
  /* 0 means "unbounded" TS-side; Skia wants a real number. */
  g_text.max_width = max_width > 0.0 ? (float)max_width : 1.0e9f;
  return SG_OK;
}

extern "C" int32_t sg_text_set_string(const uint8_t* text, size_t len) {
  if (len >= sizeof(g_text.text)) { sg_mail_set("text too long"); return SG_ERANGE; }
  memcpy(g_text.text, text, len);
  g_text.text[len] = 0;
  g_text.text_len = len;
  return SG_OK;
}

/* hc == 0 measures (fills the metrics block); otherwise draws with hp. */
static int32_t text_run(uint32_t hc, uint32_t hp, double x, double y,
                        double canvas_width) {
  skiac_font_collection* fc = sg_fonts();
  if (!fc) { sg_mail_set("font collection unavailable"); return SG_ESKIA; }

  skiac_canvas* cv = NULL;
  if (hc != 0) {
    cv = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
    if (!cv) { sg_mail_set("canvas handle is stale or invalid"); return SG_EBADHANDLE; }
  }

  /* The paint is NOT optional, even when only measuring: the implementation
   * does `text_style.setForegroundColor(*PAINT_CAST)` unconditionally, so a
   * NULL paint segfaults. Measuring therefore borrows a shim-owned scratch
   * paint rather than passing NULL. */
  skiac_paint* pt = NULL;
  if (hp != 0) {
    pt = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
    if (!pt) { sg_mail_set("paint handle is stale or invalid"); return SG_EBADHANDLE; }
  } else {
    static skiac_paint* measure_paint;
    if (!measure_paint) measure_paint = skiac_paint_create();
    if (!measure_paint) { sg_mail_set("paint allocation failed"); return SG_ESKIA; }
    pt = measure_paint;
  }

  memset(&g_metrics, 0, sizeof(g_metrics));
  skiac_canvas_get_line_metrics_or_draw_text(
      g_text.text, g_text.text_len, g_text.max_width, (float)x, (float)y,
      (float)canvas_width, fc, g_text.size, g_text.weight,
      /* stretch */ 5, /* stretch_width */ 0.0f, g_text.slant, g_text.family,
      /* TextDirection is { kRtl = 0, kLtr = 1 }: LTR is ONE. Passing 0 here
       * laid every string out right-to-left from MAX_LAYOUT_WIDTH and then
       * compensated, which shifted text off the left edge. */
      g_text.baseline, g_text.align, /* direction LTR */ 1,
      g_text.letter_spacing, /* word spacing */ 0.0f, pt, cv, &g_metrics,
      /* variations */ NULL, 0, /* kerning */ 0, /* variant_caps */ 0,
      /* lang */ "", /* text_rendering */ 0);
  return SG_OK;
}

extern "C" int32_t sg_text_draw(uint32_t hc, uint32_t hp, double x, double y,
                                double canvas_width) {
  if (hc == 0) { sg_mail_set("text_draw needs a canvas"); return SG_EBADHANDLE; }
  return text_run(hc, hp, x, y, canvas_width);
}

extern "C" int32_t sg_text_measure(double canvas_width) {
  return text_run(0, 0, 0.0, 0.0, canvas_width);
}

/* Index order matches TextMetrics in runtime/canvas/metrics.ts. skiac
 * already reports ascent/descent in canvas orientation (positive above the
 * baseline), so no sign flip is needed here or on the TS side. */
extern "C" double sg_text_metric(uint32_t i) {
  switch (i) {
    case 0: return (double)g_metrics.width;
    case 1: return (double)g_metrics.ascent;
    case 2: return (double)g_metrics.descent;
    case 3: return (double)g_metrics.font_ascent;
    case 4: return (double)g_metrics.font_descent;
    case 5: return (double)g_metrics.left;
    case 6: return (double)g_metrics.right;
    case 7: return (double)g_metrics.alphabetic_baseline;
    default: return 0.0;
  }
}

/* ---- images ----
 *
 * Decoding takes encoded bytes (png/jpeg/webp/...) and produces a bitmap.
 * skiac_bitmap_make_from_buffer fills a bitmap_info struct rather than
 * returning a handle, so the shim owns the struct and re-wraps the pixels
 * into a real bitmap object.
 */
extern "C" uint32_t sg_image_decode(const uint8_t* data, size_t len) {
  if (!data || len == 0) { sg_mail_set("empty image data"); return 0; }
  skiac_bitmap_info info;
  memset(&info, 0, sizeof(info));
  /* The decoder allocates and returns a finished SkBitmap; there is nothing
   * to re-wrap. It also premultiplies alpha on the way out, which is what
   * keeps transparent PNG borders from bleeding black under bilinear
   * sampling in drawImage. */
  skiac_bitmap_make_from_buffer(data, len, &info);
  if (!info.bitmap || info.width <= 0 || info.height <= 0) {
    sg_mail_set("image decode failed (unsupported or corrupt)");
    return 0;
  }
  return sg_table_alloc(SG_T_BITMAP, info.bitmap);
}

/* drawImage's 9-argument form; the 3- and 5-arg forms are the same call with
 * source/destination rects filled in TS-side. */
extern "C" int32_t sg_canvas_draw_bitmap(uint32_t hc, uint32_t hb, double sx,
                                         double sy, double sw, double sh,
                                         double dx, double dy, double dw,
                                         double dh, uint32_t smoothing,
                                         int32_t filter_quality, uint32_t hp) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) { sg_mail_set("canvas handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_bitmap* b = (skiac_bitmap*)sg_table_get(SG_T_BITMAP, hb);
  if (!b) { sg_mail_set("bitmap handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_paint* p = NULL;
  if (hp != 0) {
    p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
    if (!p) { sg_mail_set("paint handle is stale or invalid"); return SG_EBADHANDLE; }
  }
  skiac_canvas_draw_image(c, b, false, (float)sx, (float)sy, (float)sw,
                          (float)sh, (float)dx, (float)dy, (float)dw, (float)dh,
                          smoothing != 0, (int)filter_quality, p);
  return SG_OK;
}

/* putImageData: pixels IN is the supported FFI direction. The span is
 * borrowed, and skiac wants a mutable pointer, so it is copied into
 * shim-owned storage for the duration of the call. */
extern "C" int32_t sg_canvas_put_image_data(uint32_t hc, const uint8_t* pixels,
                                            size_t len, uint32_t width,
                                            uint32_t height, double x,
                                            double y) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) { sg_mail_set("canvas handle is stale or invalid"); return SG_EBADHANDLE; }
  size_t need = (size_t)width * height * 4;
  if (len < need) { sg_mail_set("pixel buffer shorter than width*height*4"); return SG_ERANGE; }

  uint8_t* copy = (uint8_t*)malloc(need);
  if (!copy) { sg_mail_set("out of memory copying pixels"); return SG_ESKIA; }
  memcpy(copy, pixels, need);
  skiac_canvas_put_image_data(c, (int)width, (int)height, copy,
                              (size_t)width * 4, need, (float)x, (float)y,
                              0.0f, 0.0f, (float)width, (float)height, 0,
                              false);
  free(copy);
  return SG_OK;
}

/* ---- readback (debug tier) ----
 *
 * getImageData's shape demands bulk data OUT, which format 1 cannot express.
 * One rect is read into shim storage, then pixels come back one scalar call
 * at a time. Documented as debug-speed: real screenshots use save_png, which
 * never crosses the boundary at all.
 */
static uint8_t* g_readback;
static size_t   g_readback_size;
static uint32_t g_readback_w, g_readback_h;

extern "C" int32_t sg_readback_begin(uint32_t hs, int32_t x, int32_t y,
                                     uint32_t w, uint32_t h) {
  skiac_surface* surf = (skiac_surface*)sg_table_get(SG_T_SURFACE, hs);
  if (!surf) { sg_mail_set("surface handle is stale or invalid"); return SG_EBADHANDLE; }
  if (w == 0 || h == 0) { sg_mail_set("readback rect is empty"); return SG_ERANGE; }

  size_t need = (size_t)w * h * 4;
  if (need > g_readback_size) {
    uint8_t* grown = (uint8_t*)realloc(g_readback, need);
    if (!grown) { sg_mail_set("out of memory for readback"); return SG_ESKIA; }
    g_readback = grown;
    g_readback_size = need;
  }
  if (!skiac_surface_read_pixels_rect(surf, g_readback, x, y, (int)w, (int)h, 0)) {
    sg_mail_set("read_pixels_rect failed");
    return SG_ESKIA;
  }
  g_readback_w = w;
  g_readback_h = h;
  return SG_OK;
}

/* One pixel as 0xAABBGGRR (the RGBA byte order Skia wrote). */
extern "C" uint32_t sg_readback_pixel(uint32_t i) {
  if (!g_readback) return 0;
  size_t count = (size_t)g_readback_w * g_readback_h;
  if (i >= count) return 0;
  uint32_t px;
  memcpy(&px, g_readback + (size_t)i * 4, 4);
  return px;
}

/* ---- offscreen surfaces ----
 * sg.createCanvas(w, h): a surface whose canvas can be drawn into and later
 * used as a drawImage source. */
extern "C" uint32_t sg_surface_create(uint32_t w, uint32_t h) {
  if (w == 0 || h == 0 || w > 16384 || h > 16384) {
    sg_mail_set("surface dimensions out of range");
    return 0;
  }
  skiac_surface* s = skiac_surface_create_rgba_premultiplied((int)w, (int)h, 0);
  if (!s) { sg_mail_set("surface creation failed"); return 0; }
  return sg_table_alloc(SG_T_SURFACE, s);
}
