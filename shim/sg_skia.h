/* The skiac C ABI subset the shim uses, plus shared status codes.
 *
 * skia_c.hpp itself is NOT included: it pulls the full Skia C++ headers,
 * which the shim deliberately does not depend on (the whole point of the
 * skiac layer is that it is a flat extern "C" surface). Declaring the exact
 * subset here keeps the shim compiling against nothing but a vendored
 * archive, and a mismatch surfaces as a link error rather than silent UB.
 *
 * Kept in sync by hand with vendor/<target>/include/skia_c.hpp; the
 * generator reads that header, so an added wrapper whose declaration is
 * missing here fails the shim build immediately.
 */
#ifndef SG_SKIA_H
#define SG_SKIA_H

#include <stdint.h>
#include <stddef.h>

#include "sg_tables.h"

/* ---- status codes (mirrored in runtime/status.ts) ---- */
#define SG_OK            0
#define SG_EBADHANDLE   -1
#define SG_ESDL         -2
#define SG_ESKIA        -3
#define SG_EAUDIO       -4
#define SG_EDECODE      -5
#define SG_ERANGE       -6

/* ---- opaque skiac types ---- */
typedef struct skiac_surface skiac_surface;
typedef struct skiac_canvas skiac_canvas;
typedef struct skiac_paint skiac_paint;
typedef struct skiac_path skiac_path;
typedef struct skiac_shader skiac_shader;
typedef struct skiac_matrix skiac_matrix;
typedef struct skiac_image skiac_image;
typedef struct skiac_bitmap skiac_bitmap;
typedef struct skiac_path_effect skiac_path_effect;
typedef struct skiac_image_filter skiac_image_filter;
typedef struct skiac_font_collection skiac_font_collection;
typedef struct skiac_data skiac_data;

/* ---- structs passed by pointer or value ---- */
typedef struct {
  uint8_t* ptr;
  size_t   size;
} skiac_surface_data;

typedef struct {
  const uint8_t* ptr;
  size_t         size;
  skiac_data*    data;
} skiac_sk_data;

typedef struct {
  float left;
  float top;
  float right;
  float bottom;
} skiac_rect;

/* Row-major 2D affine transform, Skia's member order. */
typedef struct {
  float a, b, c, d, e, f;
} skiac_transform;

typedef struct {
  float x, y;
} skiac_point;

/* skiac_bitmap_info: the decoder hands back a READY bitmap plus its size, not
 * a raw pixel span. (Assuming a pixels/row_bytes/color_type shape made every
 * decode fail.) */
typedef struct {
  skiac_bitmap* bitmap;
  int           width;
  int           height;
  bool          is_canvas;
} skiac_bitmap_info;

/* skiac_line_metrics as declared in skia_c.hpp: EIGHT FLOATS, nothing else.
 * (Not skparagraph's own LineMetrics, which is a much larger struct with
 * size_t indices -- assuming that shape silently zeroed every measurement.)
 * The layout must match exactly, so the whole struct is mirrored. */
typedef struct {
  float ascent;
  float descent;
  float left;
  float right;
  float width;
  float font_ascent;
  float font_descent;
  float alphabetic_baseline;
} skiac_line_metrics;

typedef struct {
  float x;
  float y;
} skiac_mapped_point;

typedef struct {
  uint32_t axis;
  float    value;
} skiac_font_variation;

#ifdef __cplusplus
extern "C" {
#endif

/* surface */
skiac_surface* skiac_surface_create_rgba_premultiplied(int w, int h, uint8_t cs);
skiac_surface* skiac_surface_create_rgba(int w, int h, uint8_t cs);
void  skiac_surface_destroy(skiac_surface*);
skiac_canvas* skiac_surface_get_canvas(skiac_surface*);
int   skiac_surface_get_width(skiac_surface*);
int   skiac_surface_get_height(skiac_surface*);
void  skiac_surface_read_pixels(skiac_surface*, skiac_surface_data*);
bool  skiac_surface_read_pixels_rect(skiac_surface*, uint8_t* data, int x, int y,
                                     int w, int h, uint8_t cs);
void  skiac_surface_png_data(skiac_surface*, skiac_sk_data*);
skiac_image* skiac_surface_make_image_snapshot(skiac_surface*);
void  skiac_sk_data_destroy(skiac_data*);

/* canvas */
void  skiac_canvas_clear(skiac_canvas*, uint32_t color);
void  skiac_canvas_save(skiac_canvas*);
void  skiac_canvas_restore(skiac_canvas*);
void  skiac_canvas_reset(skiac_canvas*);
void  skiac_canvas_translate(skiac_canvas*, float dx, float dy);
void  skiac_canvas_scale(skiac_canvas*, float sx, float sy);
void  skiac_canvas_rotate(skiac_canvas*, float degrees);
void  skiac_canvas_reset_transform(skiac_canvas*);
void  skiac_canvas_concat(skiac_canvas*, skiac_matrix*);
void  skiac_canvas_set_transform(skiac_canvas*, skiac_matrix*);
skiac_transform skiac_canvas_get_total_transform(skiac_canvas*);
void  skiac_canvas_draw_rect(skiac_canvas*, float x, float y, float w, float h,
                             skiac_paint*);
void  skiac_canvas_draw_path(skiac_canvas*, skiac_path*, skiac_paint*);
void  skiac_canvas_draw_color(skiac_canvas*, float r, float g, float b, float a);
void  skiac_canvas_clip_rect(skiac_canvas*, float x, float y, float w, float h);
void  skiac_canvas_clip_path(skiac_canvas*, skiac_path*);
void  skiac_canvas_draw_surface(skiac_canvas*, skiac_surface*, float left,
                                float top, uint8_t alpha, int blend_mode,
                                int filter_quality);
void  skiac_canvas_draw_surface_rect(skiac_canvas*, skiac_surface*, float sx,
                                     float sy, float sw, float sh, float dx,
                                     float dy, float dw, float dh,
                                     int filter_quality);
void  skiac_canvas_draw_image(skiac_canvas*, skiac_bitmap*, bool is_canvas,
                              float sx, float sy, float s_width, float s_height,
                              float dx, float dy, float d_width, float d_height,
                              bool enable_smoothing, int filter_quality,
                              skiac_paint*);
void  skiac_canvas_put_image_data(skiac_canvas*, int width, int height,
                                  uint8_t* pixels, size_t row_bytes,
                                  size_t length, float x, float y,
                                  float dirty_x, float dirty_y,
                                  float dirty_width, float dirty_height,
                                  uint8_t cs, bool snapshot);
void  skiac_canvas_get_line_metrics_or_draw_text(
    const char* text, size_t text_len, float max_width, float x, float y,
    float canvas_width, skiac_font_collection*, float font_size, int weight,
    int stretch, float stretch_width, int slant, const char* font_family,
    int baseline, int align, int direction, float letter_spacing,
    float world_spacing, skiac_paint*, skiac_canvas*, skiac_line_metrics*,
    const skiac_font_variation* variations, int variations_count, int kerning,
    int variant_caps, const char* lang, int text_rendering);

/* paint */
skiac_paint* skiac_paint_create(void);
skiac_paint* skiac_paint_clone(skiac_paint*);
void  skiac_paint_destroy(skiac_paint*);
void  skiac_paint_set_style(skiac_paint*, int style);
void  skiac_paint_set_color(skiac_paint*, uint8_t r, uint8_t g, uint8_t b, uint8_t a);
void  skiac_paint_set_alpha(skiac_paint*, uint8_t a);
uint8_t skiac_paint_get_alpha(skiac_paint*);
void  skiac_paint_set_anti_alias(skiac_paint*, bool aa);
void  skiac_paint_set_blend_mode(skiac_paint*, int blend_mode);
int   skiac_paint_get_blend_mode(skiac_paint*);
void  skiac_paint_set_shader(skiac_paint*, skiac_shader*);
void  skiac_paint_set_stroke_width(skiac_paint*, float width);
float skiac_paint_get_stroke_width(skiac_paint*);
void  skiac_paint_set_stroke_cap(skiac_paint*, int cap);
int   skiac_paint_get_stroke_cap(skiac_paint*);
void  skiac_paint_set_stroke_join(skiac_paint*, uint8_t join);
uint8_t skiac_paint_get_stroke_join(skiac_paint*);
void  skiac_paint_set_stroke_miter(skiac_paint*, float miter);
float skiac_paint_get_stroke_miter(skiac_paint*);
void  skiac_paint_set_path_effect(skiac_paint*, skiac_path_effect*);
void  skiac_paint_set_image_filter(skiac_paint*, skiac_image_filter*);

/* path */
skiac_path* skiac_path_create(void);
skiac_path* skiac_path_clone(skiac_path*);
void  skiac_path_destroy(skiac_path*);
void  skiac_path_move_to(skiac_path*, float x, float y);
void  skiac_path_line_to(skiac_path*, float x, float y);
void  skiac_path_cubic_to(skiac_path*, float x1, float y1, float x2, float y2,
                          float x3, float y3);
void  skiac_path_quad_to(skiac_path*, float cpx, float cpy, float x, float y);
void  skiac_path_close(skiac_path*);
/* NOTE: skia_c.hpp names these (l, t, r, b) but the implementation calls
 * SkRect::MakeXYWH, so they are really (x, y, WIDTH, HEIGHT). The names in
 * the upstream header are wrong; these are correct. */
void  skiac_path_add_rect(skiac_path*, float x, float y, float width, float height);
void  skiac_path_add_circle(skiac_path*, float x, float y, float r);
void  skiac_path_arc_to(skiac_path*, float left, float top, float right,
                        float bottom, float startAngle, float sweepAngle,
                        bool forceMoveTo);
void  skiac_path_arc_to_tangent(skiac_path*, float x1, float y1, float x2,
                                float y2, float radius);
void  skiac_path_set_fill_type(skiac_path*, int type);
int   skiac_path_get_fill_type(skiac_path*);
bool  skiac_path_is_empty(skiac_path*);
bool  skiac_path_hit_test(skiac_path*, float x, float y, int type);
bool  skiac_path_stroke_hit_test(skiac_path*, float x, float y, float stroke_w);
void  skiac_path_transform_self(skiac_path*, skiac_matrix*);
bool  skiac_path_op(skiac_path* one, skiac_path* two, int op);
bool  skiac_path_simplify(skiac_path*);
bool  skiac_path_equals(skiac_path*, skiac_path* other);
void  skiac_path_get_bounds(skiac_path*, skiac_rect*);
void  skiac_path_round_rect(skiac_path*, float x, float y, float width,
                            float height, float* radii, bool clockwise);
skiac_path_effect* skiac_path_effect_make_dash_path(const float* intervals,
                                                    int count, float phase);
void  skiac_path_effect_destroy(skiac_path_effect*);

/* matrix */
skiac_matrix* skiac_matrix_create(void);
skiac_matrix* skiac_matrix_new(float a, float b, float c, float d, float e, float f);
skiac_matrix* skiac_matrix_clone(skiac_matrix*);
void  skiac_matrix_destroy(skiac_matrix*);
void  skiac_matrix_pre_translate(skiac_matrix*, float dx, float dy);
void  skiac_matrix_pre_scale(skiac_matrix*, float sx, float sy);
void  skiac_matrix_pre_rotate(skiac_matrix*, float degrees);
void  skiac_matrix_pre_concat(skiac_matrix*, skiac_matrix* other);
skiac_transform skiac_matrix_to_transform(skiac_matrix*);

/* shader */
skiac_shader* skiac_shader_make_linear_gradient(const skiac_point* points,
                                                const uint32_t* colors,
                                                const float* positions,
                                                int count, int tile_mode,
                                                uint32_t flags,
                                                skiac_transform ts);
skiac_shader* skiac_shader_make_radial_gradient(skiac_point start_point,
                                                float start_radius,
                                                skiac_point end_point,
                                                float end_radius,
                                                const uint32_t* colors,
                                                const float* positions,
                                                int count, int tile_mode,
                                                uint32_t flags,
                                                skiac_transform ts);
skiac_shader* skiac_shader_make_conic_gradient(float cx, float cy, float radius,
                                               const uint32_t* colors,
                                               const float* positions,
                                               int count, int tile_mode,
                                               uint32_t flags,
                                               skiac_transform ts);
skiac_shader* skiac_bitmap_get_shader(bool is_canvas, skiac_bitmap*,
                                      int repeat_x, int repeat_y, float B,
                                      float C, skiac_transform ts);
void  skiac_shader_destroy(skiac_shader*);

/* image / bitmap */
void  skiac_image_destroy(skiac_image*);
int   skiac_image_get_width(skiac_image*);
int   skiac_image_get_height(skiac_image*);
void  skiac_bitmap_make_from_buffer(const uint8_t* ptr, size_t size,
                                    skiac_bitmap_info*);
skiac_bitmap* skiac_bitmap_make_from_image_data(uint8_t* ptr, size_t width,
                                                size_t height, size_t row_bytes,
                                                size_t size, int ct, int at);
size_t skiac_bitmap_get_width(skiac_bitmap*);
size_t skiac_bitmap_get_height(skiac_bitmap*);
void  skiac_bitmap_destroy(skiac_bitmap*);
void  skiac_image_filter_destroy(skiac_image_filter*);

/* fonts */
skiac_font_collection* skiac_font_collection_create(void);
uint32_t skiac_font_collection_register_from_path(skiac_font_collection*,
                                                  const char* font_path,
                                                  const char* name_alias);
void  skiac_font_collection_destroy(skiac_font_collection*);

#ifdef __cplusplus
}  /* extern "C" */
#endif

/* Shared with the hand-written shim sources. */
#ifdef __cplusplus
extern "C" {
#endif
void sg_mail_set(const char* s);
skiac_font_collection* sg_fonts(void);
#ifdef __cplusplus
}
#endif

#endif /* SG_SKIA_H */
