/* Core shim: window, present, timing, events, error mailbox, and the
 * flattened skiac wrappers Phase 1 needs.
 *
 * Boundary rules (docs/FFI-SHIM.md):
 *   - no pointer ever crosses; native objects are u32 handles
 *   - borrowed string/bytes spans are never retained past the call
 *   - nothing unwinds; every fallible call returns a status
 *   - strings come back through the mailbox, never as a return value
 */
#include <SDL2/SDL.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "sg_tables.h"

/* ---- skiac C ABI (subset used here; see vendor include/skia_c.hpp) ---- */
typedef struct skiac_surface skiac_surface;
typedef struct skiac_canvas skiac_canvas;
typedef struct skiac_paint skiac_paint;
typedef struct skiac_path skiac_path;

/* skiac_surface_data as declared in skia_c.hpp: pixel span + dimensions. */
typedef struct {
  uint8_t* ptr;
  size_t   size;
} skiac_surface_data;

/* skiac_sk_data: an owned encoded blob plus the handle used to free it. */
typedef struct skiac_data skiac_data;
typedef struct {
  const uint8_t* ptr;
  size_t         size;
  skiac_data*    data;
} skiac_sk_data;

extern "C" {
skiac_surface* skiac_surface_create_rgba_premultiplied(int w, int h, uint8_t cs);
void  skiac_surface_png_data(skiac_surface*, skiac_sk_data*);
void  skiac_sk_data_destroy(skiac_data*);
void  skiac_surface_destroy(skiac_surface*);
skiac_canvas* skiac_surface_get_canvas(skiac_surface*);
int   skiac_surface_get_width(skiac_surface*);
int   skiac_surface_get_height(skiac_surface*);
void  skiac_surface_read_pixels(skiac_surface*, skiac_surface_data*);

void  skiac_canvas_clear(skiac_canvas*, uint32_t color);
void  skiac_canvas_save(skiac_canvas*);
void  skiac_canvas_restore(skiac_canvas*);
void  skiac_canvas_translate(skiac_canvas*, float dx, float dy);
void  skiac_canvas_rotate(skiac_canvas*, float degrees);
void  skiac_canvas_scale(skiac_canvas*, float sx, float sy);
void  skiac_canvas_draw_rect(skiac_canvas*, float x, float y, float w, float h,
                             skiac_paint*);
void  skiac_canvas_draw_path(skiac_canvas*, skiac_path*, skiac_paint*);

skiac_paint* skiac_paint_create(void);
void  skiac_paint_destroy(skiac_paint*);
void  skiac_paint_set_style(skiac_paint*, int style);
void  skiac_paint_set_color(skiac_paint*, uint8_t r, uint8_t g, uint8_t b, uint8_t a);
void  skiac_paint_set_alpha(skiac_paint*, uint8_t a);
void  skiac_paint_set_anti_alias(skiac_paint*, bool aa);
void  skiac_paint_set_stroke_width(skiac_paint*, float w);

skiac_path* skiac_path_create(void);
void  skiac_path_destroy(skiac_path*);
void  skiac_path_move_to(skiac_path*, float x, float y);
void  skiac_path_line_to(skiac_path*, float x, float y);
void  skiac_path_close(skiac_path*);
}

/* ---- status codes (mirrored in runtime/status.ts) ---- */
#define SG_OK            0
#define SG_EBADHANDLE   -1
#define SG_ESDL         -2
#define SG_ESKIA        -3
#define SG_ERANGE       -6

/* ---- string mailbox ---- */
static char     g_mail[4096];
static uint32_t g_mail_len;

static void mail_set(const char* s) {
  size_t n = strlen(s);
  if (n >= sizeof(g_mail)) n = sizeof(g_mail) - 1;
  memcpy(g_mail, s, n);
  g_mail[n] = 0;
  g_mail_len = (uint32_t)n;
}

extern "C" uint32_t sg_str_len(int32_t unused) { (void)unused; return g_mail_len; }
extern "C" uint32_t sg_str_byte(uint32_t i) {
  return i < g_mail_len ? (uint32_t)(uint8_t)g_mail[i] : 0u;
}

/* ---- global window state ---- */
static SDL_Window*   g_window;
static SDL_Renderer* g_renderer;
static SDL_Texture*  g_texture;
static skiac_surface* g_surface;
static uint32_t g_width, g_height;
static uint8_t* g_pixels;        /* shim-owned RGBA staging buffer */
static size_t   g_pixels_size;

/* ---- init / teardown ---- */
extern "C" int32_t sg_init(uint32_t w, uint32_t h, uint32_t flags) {
  if (w == 0 || h == 0 || w > 16384 || h > 16384) {
    mail_set("window dimensions out of range");
    return SG_ERANGE;
  }
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER | SDL_INIT_EVENTS) != 0) {
    mail_set(SDL_GetError());
    return SG_ESDL;
  }
  /* flags bit 0: resizable. Logical size stays w*h regardless. */
  Uint32 winflags = SDL_WINDOW_ALLOW_HIGHDPI;
  if (flags & 1u) winflags |= SDL_WINDOW_RESIZABLE;

  g_window = SDL_CreateWindow("scriptc-game", SDL_WINDOWPOS_CENTERED,
                              SDL_WINDOWPOS_CENTERED, (int)w, (int)h, winflags);
  if (!g_window) { mail_set(SDL_GetError()); return SG_ESDL; }

  /* PRESENTVSYNC is the frame pacer; bit 1 opts out for benchmarks.
   *
   * Drawing is Skia-on-CPU either way, so the renderer only blits the
   * finished frame. ACCELERATED is preferred (it is also what gives us a
   * real vsync), but the headless conformance lane runs under
   * SDL_VIDEODRIVER=dummy, which offers a software renderer only. Falling
   * back keeps one code path for windowed and headless runs rather than
   * bolting a second surface-only mode onto the shim. */
  Uint32 rflags = SDL_RENDERER_ACCELERATED;
  if (!(flags & 2u)) rflags |= SDL_RENDERER_PRESENTVSYNC;
  g_renderer = SDL_CreateRenderer(g_window, -1, rflags);
  if (!g_renderer) {
    rflags = (rflags & ~SDL_RENDERER_ACCELERATED) | SDL_RENDERER_SOFTWARE;
    g_renderer = SDL_CreateRenderer(g_window, -1, rflags);
  }
  if (!g_renderer) { mail_set(SDL_GetError()); return SG_ESDL; }
  SDL_RenderSetLogicalSize(g_renderer, (int)w, (int)h);

  g_texture = SDL_CreateTexture(g_renderer, SDL_PIXELFORMAT_ABGR8888,
                                SDL_TEXTUREACCESS_STREAMING, (int)w, (int)h);
  if (!g_texture) { mail_set(SDL_GetError()); return SG_ESDL; }

  g_surface = skiac_surface_create_rgba_premultiplied((int)w, (int)h, 0);
  if (!g_surface) { mail_set("skia surface creation failed"); return SG_ESKIA; }

  g_pixels_size = (size_t)w * h * 4;
  g_pixels = (uint8_t*)SDL_malloc(g_pixels_size);
  if (!g_pixels) { mail_set("pixel buffer allocation failed"); return SG_ESKIA; }

  g_width = w; g_height = h;
  return SG_OK;
}

extern "C" void sg_quit(int32_t unused) {
  (void)unused;
  if (g_surface)  { skiac_surface_destroy(g_surface); g_surface = NULL; }
  if (g_pixels)   { SDL_free(g_pixels); g_pixels = NULL; }
  if (g_texture)  { SDL_DestroyTexture(g_texture); g_texture = NULL; }
  if (g_renderer) { SDL_DestroyRenderer(g_renderer); g_renderer = NULL; }
  if (g_window)   { SDL_DestroyWindow(g_window); g_window = NULL; }
  SDL_Quit();
}

/* Releases a canvas HANDLE without destroying the canvas.
 *
 * A canvas is borrowed from its surface (skiac_surface_get_canvas hands out
 * an interior pointer the surface owns), so the only thing to reclaim is the
 * table slot. Without this the handle counters never return to zero and a
 * genuine leak would be invisible under the noise. */
extern "C" int32_t sg_canvas_release(uint32_t hc) {
  return sg_table_take(SG_T_CANVAS, hc) ? SG_OK : SG_EBADHANDLE;
}

/* The window's backing canvas, as a handle. */
extern "C" uint32_t sg_screen_canvas(int32_t unused) {
  (void)unused;
  if (!g_surface) return 0;
  skiac_canvas* c = skiac_surface_get_canvas(g_surface);
  return sg_table_alloc(SG_T_CANVAS, c);
}

extern "C" uint32_t sg_screen_width(int32_t unused)  { (void)unused; return g_width; }
extern "C" uint32_t sg_screen_height(int32_t unused) { (void)unused; return g_height; }

/* The display's refresh rate in Hz, or 0 when it cannot be determined
 * (headless/dummy driver, or a compositor that reports nothing).
 *
 * This is NOT cosmetic. With PRESENTVSYNC the present call blocks until the
 * display's next scanout, so the refresh rate IS the frame budget, and a
 * loop that assumes 60 will call every frame on a 30Hz panel a hitch. 4K
 * displays on an HDMI 1.4 link commonly run at 30. */
extern "C" uint32_t sg_display_hz(int32_t unused) {
  (void)unused;
  SDL_DisplayMode dm;
  int idx = g_window ? SDL_GetWindowDisplayIndex(g_window) : 0;
  if (idx < 0) idx = 0;
  if (SDL_GetCurrentDisplayMode(idx, &dm) != 0) return 0;
  return dm.refresh_rate > 0 ? (uint32_t)dm.refresh_rate : 0u;
}

/* ---- present ----
 * One full-frame copy: Skia raster pixels -> streaming texture -> GPU blit.
 * At 1280x720 this is ~3.7MB/frame; measured cost lives in SPIKE-RESULTS.
 * The Ganesh GPU path (Phase 7) removes the copy entirely. */
extern "C" int32_t sg_present(int32_t unused) {
  (void)unused;
  if (!g_surface || !g_renderer) { mail_set("present before init"); return SG_ESDL; }

  skiac_surface_data data;
  data.ptr = g_pixels;
  data.size = g_pixels_size;
  skiac_surface_read_pixels(g_surface, &data);
  if (!data.ptr) { mail_set("surface read_pixels returned no data"); return SG_ESKIA; }

  if (SDL_UpdateTexture(g_texture, NULL, data.ptr, (int)(g_width * 4)) != 0) {
    mail_set(SDL_GetError());
    return SG_ESDL;
  }
  SDL_RenderClear(g_renderer);
  SDL_RenderCopy(g_renderer, g_texture, NULL, NULL);
  SDL_RenderPresent(g_renderer);
  return SG_OK;
}

/* Encode the screen surface to a PNG on disk.
 *
 * This is the readback path that matters: it keeps the pixels native (no
 * per-pixel FFI, no bytes return, which format 1 cannot express anyway) and
 * it is what the conformance harness and every screenshot use. `path` is a
 * borrowed span, valid only for this call, so it is copied before use. */
extern "C" int32_t sg_surface_save_png(const uint8_t* path, size_t path_len) {
  if (!g_surface) { mail_set("save_png before init"); return SG_ESDL; }
  char buf[1024];
  if (path_len >= sizeof(buf)) { mail_set("png path too long"); return SG_ERANGE; }
  memcpy(buf, path, path_len);
  buf[path_len] = 0;

  skiac_sk_data png;
  png.ptr = NULL; png.size = 0; png.data = NULL;
  skiac_surface_png_data(g_surface, &png);
  if (!png.ptr || png.size == 0) { mail_set("png encode failed"); return SG_ESKIA; }

  FILE* f = fopen(buf, "wb");
  if (!f) {
    mail_set("could not open png path for writing");
    if (png.data) skiac_sk_data_destroy(png.data);
    return SG_ERANGE;
  }
  size_t wrote = fwrite(png.ptr, 1, png.size, f);
  fclose(f);
  if (png.data) skiac_sk_data_destroy(png.data);
  if (wrote != png.size) { mail_set("short write encoding png"); return SG_ERANGE; }
  return SG_OK;
}

/* ---- timing ---- */
extern "C" double sg_ticks(int32_t unused) {
  (void)unused;
  static Uint64 freq;
  if (freq == 0) freq = SDL_GetPerformanceFrequency();
  return (double)SDL_GetPerformanceCounter() * 1000.0 / (double)freq;
}

extern "C" void sg_delay(uint32_t ms) { SDL_Delay(ms); }

/* ---- events ----
 * SDL events are structs, which cannot cross. One static slot holds the
 * most recent event and TS reads its fields through scalar getters. Main
 * thread only, so the slot needs no synchronization. */
typedef enum {
  SG_EV_NONE = 0,
  SG_EV_QUIT,
  SG_EV_KEYDOWN,
  SG_EV_KEYUP,
  SG_EV_MOUSEMOVE,
  SG_EV_MOUSEDOWN,
  SG_EV_MOUSEUP,
  SG_EV_WINDOW
} sg_event_kind;

/* field indices, mirrored in runtime/input/events.ts */
#define SG_F_SCANCODE 0
#define SG_F_REPEAT   1
#define SG_F_X        2
#define SG_F_Y        3
#define SG_F_BUTTON   4
#define SG_F_WINEVENT 5

static int32_t g_ev[8];

extern "C" uint32_t sg_poll_event(int32_t unused) {
  (void)unused;
  SDL_Event e;
  while (SDL_PollEvent(&e)) {
    memset(g_ev, 0, sizeof(g_ev));
    switch (e.type) {
      case SDL_QUIT:
        return SG_EV_QUIT;
      case SDL_KEYDOWN:
      case SDL_KEYUP:
        g_ev[SG_F_SCANCODE] = (int32_t)e.key.keysym.scancode;
        g_ev[SG_F_REPEAT]   = e.key.repeat ? 1 : 0;
        return e.type == SDL_KEYDOWN ? SG_EV_KEYDOWN : SG_EV_KEYUP;
      case SDL_MOUSEMOTION:
        g_ev[SG_F_X] = e.motion.x;
        g_ev[SG_F_Y] = e.motion.y;
        return SG_EV_MOUSEMOVE;
      case SDL_MOUSEBUTTONDOWN:
      case SDL_MOUSEBUTTONUP:
        g_ev[SG_F_X]      = e.button.x;
        g_ev[SG_F_Y]      = e.button.y;
        g_ev[SG_F_BUTTON] = e.button.button;
        return e.type == SDL_MOUSEBUTTONDOWN ? SG_EV_MOUSEDOWN : SG_EV_MOUSEUP;
      case SDL_WINDOWEVENT:
        g_ev[SG_F_WINEVENT] = e.window.event;
        return SG_EV_WINDOW;
      default:
        continue; /* drop events the framework does not model yet */
    }
  }
  return SG_EV_NONE;
}

extern "C" int32_t sg_evt_i32(uint32_t field) {
  return field < 8 ? g_ev[field] : 0;
}

/* ---- skiac wrappers (handle-flattened) ---- */
extern "C" int32_t sg_canvas_clear(uint32_t hc, uint32_t color) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) { mail_set("canvas handle is stale or invalid"); return SG_EBADHANDLE; }
  skiac_canvas_clear(c, color);
  return SG_OK;
}

extern "C" int32_t sg_canvas_save(uint32_t hc) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) return SG_EBADHANDLE;
  skiac_canvas_save(c);
  return SG_OK;
}

extern "C" int32_t sg_canvas_restore(uint32_t hc) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) return SG_EBADHANDLE;
  skiac_canvas_restore(c);
  return SG_OK;
}

extern "C" int32_t sg_canvas_translate(uint32_t hc, double dx, double dy) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) return SG_EBADHANDLE;
  skiac_canvas_translate(c, (float)dx, (float)dy);
  return SG_OK;
}

extern "C" int32_t sg_canvas_rotate(uint32_t hc, double degrees) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) return SG_EBADHANDLE;
  skiac_canvas_rotate(c, (float)degrees);
  return SG_OK;
}

extern "C" int32_t sg_canvas_scale(uint32_t hc, double sx, double sy) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  if (!c) return SG_EBADHANDLE;
  skiac_canvas_scale(c, (float)sx, (float)sy);
  return SG_OK;
}

extern "C" int32_t sg_canvas_draw_rect(uint32_t hc, double x, double y,
                                       double w, double h, uint32_t hp) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  skiac_paint*  p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!c || !p) { mail_set("draw_rect: stale canvas or paint handle"); return SG_EBADHANDLE; }
  skiac_canvas_draw_rect(c, (float)x, (float)y, (float)w, (float)h, p);
  return SG_OK;
}

extern "C" int32_t sg_canvas_draw_path(uint32_t hc, uint32_t hpath, uint32_t hp) {
  skiac_canvas* c = (skiac_canvas*)sg_table_get(SG_T_CANVAS, hc);
  skiac_path* pa  = (skiac_path*)sg_table_get(SG_T_PATH, hpath);
  skiac_paint* p  = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!c || !pa || !p) { mail_set("draw_path: stale handle"); return SG_EBADHANDLE; }
  skiac_canvas_draw_path(c, pa, p);
  return SG_OK;
}

/* paint */
extern "C" uint32_t sg_paint_create(int32_t unused) {
  (void)unused;
  skiac_paint* p = skiac_paint_create();
  if (!p) return 0;
  skiac_paint_set_anti_alias(p, true);
  return sg_table_alloc(SG_T_PAINT, p);
}

extern "C" void sg_paint_destroy(uint32_t hp) {
  skiac_paint* p = (skiac_paint*)sg_table_take(SG_T_PAINT, hp);
  if (p) skiac_paint_destroy(p);
}

extern "C" int32_t sg_paint_set_color(uint32_t hp, uint32_t r, uint32_t g,
                                      uint32_t b, uint32_t a) {
  skiac_paint* p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!p) return SG_EBADHANDLE;
  skiac_paint_set_color(p, (uint8_t)r, (uint8_t)g, (uint8_t)b, (uint8_t)a);
  return SG_OK;
}

extern "C" int32_t sg_paint_set_style(uint32_t hp, uint32_t style) {
  skiac_paint* p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!p) return SG_EBADHANDLE;
  skiac_paint_set_style(p, (int)style); /* 0 fill, 1 stroke */
  return SG_OK;
}

extern "C" int32_t sg_paint_set_stroke_width(uint32_t hp, double w) {
  skiac_paint* p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!p) return SG_EBADHANDLE;
  skiac_paint_set_stroke_width(p, (float)w);
  return SG_OK;
}

extern "C" int32_t sg_paint_set_alpha(uint32_t hp, uint32_t a) {
  skiac_paint* p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!p) return SG_EBADHANDLE;
  skiac_paint_set_alpha(p, (uint8_t)a);
  return SG_OK;
}

extern "C" int32_t sg_paint_set_anti_alias(uint32_t hp, uint8_t aa) {
  skiac_paint* p = (skiac_paint*)sg_table_get(SG_T_PAINT, hp);
  if (!p) return SG_EBADHANDLE;
  skiac_paint_set_anti_alias(p, aa != 0);
  return SG_OK;
}

/* path */
extern "C" uint32_t sg_path_create(int32_t unused) {
  (void)unused;
  skiac_path* p = skiac_path_create();
  return p ? sg_table_alloc(SG_T_PATH, p) : 0;
}

extern "C" void sg_path_destroy(uint32_t hp) {
  skiac_path* p = (skiac_path*)sg_table_take(SG_T_PATH, hp);
  if (p) skiac_path_destroy(p);
}

extern "C" int32_t sg_path_move_to(uint32_t hp, double x, double y) {
  skiac_path* p = (skiac_path*)sg_table_get(SG_T_PATH, hp);
  if (!p) return SG_EBADHANDLE;
  skiac_path_move_to(p, (float)x, (float)y);
  return SG_OK;
}

extern "C" int32_t sg_path_line_to(uint32_t hp, double x, double y) {
  skiac_path* p = (skiac_path*)sg_table_get(SG_T_PATH, hp);
  if (!p) return SG_EBADHANDLE;
  skiac_path_line_to(p, (float)x, (float)y);
  return SG_OK;
}

extern "C" int32_t sg_path_close(uint32_t hp) {
  skiac_path* p = (skiac_path*)sg_table_get(SG_T_PATH, hp);
  if (!p) return SG_EBADHANDLE;
  skiac_path_close(p);
  return SG_OK;
}

/* ---- debug / leak counters ---- */
extern "C" uint32_t sg_debug_live(uint32_t domain) {
  return sg_table_live((sg_domain)domain);
}
extern "C" uint32_t sg_debug_high_water(uint32_t domain) {
  return sg_table_high_water((sg_domain)domain);
}
