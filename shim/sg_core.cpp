/* Core shim: window, present, timing, events, error mailbox.
 *
 * The flattened skiac wrappers live in sg_skia_gen.cpp (generated) and
 * sg_skia_extra.cpp (hand-written); the shared skiac declarations and status
 * codes are in sg_skia.h.
 *
 * Boundary rules (docs/FFI-SHIM.md):
 *   - no pointer ever crosses; native objects are u32 handles
 *   - borrowed string/bytes spans are never retained past the call
 *   - nothing unwinds; every fallible call returns a status
 *   - strings come back through the mailbox, never as a return value
 */
/* macOS frameworks, declared where they cannot be dropped.
 *
 * Skia's font stack (fontmgr_mac_ct) references CoreText and
 * CoreFoundation, which link as `-framework Foo`. scriptc's FFI manifest
 * cannot say that: system_libraries is validated against
 * /^[A-Za-z0-9_+.-]+$/ and every entry becomes -l<name>.
 *
 * Mach-O objects can carry their own requirements as LC_LINKER_OPTION load
 * commands, which the linker reads out of the archive. The catch is that a
 * member with no referenced symbols is never pulled in, and its load
 * commands go with it -- which is exactly what happened when these lived in
 * their own TU. sg_init is in THIS file and every program calls it, so the
 * member is always linked and the directives always apply.
 *
 * Same mechanism as Rust's #[link(kind = "framework")]. */
#if defined(__APPLE__)
__asm__(".linker_option \"-framework\", \"CoreText\"");
__asm__(".linker_option \"-framework\", \"CoreGraphics\"");
__asm__(".linker_option \"-framework\", \"CoreFoundation\"");
__asm__(".linker_option \"-framework\", \"CoreServices\"");
__asm__(".linker_option \"-framework\", \"AppKit\"");
#endif

#include <SDL2/SDL.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

#include "sg_tables.h"
#include "sg_skia.h"

/* ---- string mailbox ----
 * Shared with the other shim translation units through sg_skia.h, hence the
 * external linkage: every producing call overwrites it and TS drains it
 * immediately after a non-zero status. */
static char     g_mail[4096];
static uint32_t g_mail_len;

extern "C" void sg_mail_set(const char* s) {
  size_t n = strlen(s);
  if (n >= sizeof(g_mail)) n = sizeof(g_mail) - 1;
  memcpy(g_mail, s, n);
  g_mail[n] = 0;
  g_mail_len = (uint32_t)n;
}

#define mail_set sg_mail_set

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
static bool g_gl_novsync = false;
static bool g_gl_headless = false;
static uint8_t* g_pixels;        /* shim-owned RGBA staging buffer */
static size_t   g_pixels_size;

/* ---- init / teardown ---- */
extern "C" int32_t sg_init(uint32_t w, uint32_t h, uint32_t flags) {
  if (w == 0 || h == 0 || w > 16384 || h > 16384) {
    mail_set("window dimensions out of range");
    return SG_ERANGE;
  }
  /* Headless: force SDL onto the dummy video driver BEFORE SDL_Init.
   *
   * The window and renderer are still created (Skia, input and the 2D
   * present path all assume they exist), but the dummy driver never talks
   * to the compositor, so nothing maps and nothing blocks.
   *
   * It must also not create a real GL context: the accelerated renderer
   * binds one to this thread, and the later eglMakeCurrent for the pbuffer
   * then fails with "eglMakeCurrent failed" -- which is exactly what a
   * window-plus-pbuffer version of this did. Dummy gives a software
   * renderer, leaving the thread's GL binding free for EGL.
   *
   * SDL_SetHint rather than setenv: it is the documented knob and does not
   * leak into child processes. */
  if ((flags & 4u) != 0) SDL_SetHint(SDL_HINT_VIDEODRIVER, "dummy");

  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER | SDL_INIT_EVENTS) != 0) {
    mail_set(SDL_GetError());
    return SG_ESDL;
  }
  /* Remembered for the GL context, which is created later and paces its
   * own presents. */
  g_gl_novsync = (flags & 2u) != 0;

  /* flags bit 2: headless GL. The GL context comes from an EGL pbuffer
   * instead of the window, so a 3D benchmark can run with no compositor.
   *
   * Without it a GL game on a machine with a display server still BLOCKS:
   * SDL_CreateWindow succeeds, but the window never maps in a
   * non-interactive shell, and the process sits in poll() at ~0% CPU
   * forever, producing no output. That is not a slow run, it is a hang,
   * and it is why the native benchmark could not be reproduced. */
  g_gl_headless = (flags & 4u) != 0;

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
  /* Logical size letterboxes: the game always draws in w x h, and SDL fits
   * that into whatever the window actually is, with bars on the short axis.
   *
   * Integer scale on top means whole-pixel multiples only (1x, 2x, 3x...),
   * so a 800x600 game on a 4K panel is crisp rather than resampled at 2.7x.
   * The cost is slightly thicker bars, which is the right trade for pixel
   * art and for text: a non-integer scale makes both look soft. */
  SDL_RenderSetLogicalSize(g_renderer, (int)w, (int)h);
  SDL_RenderSetIntegerScale(g_renderer, SDL_TRUE);

  /* Bars are drawn in the renderer's clear colour, so make them black rather
   * than whatever was left in the buffer. */
  SDL_SetRenderDrawColor(g_renderer, 0, 0, 0, 255);

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

/* ---- fullscreen ----
 *
 * Backs the web Fullscreen API. DESKTOP fullscreen (borderless at the
 * desktop resolution) rather than a real mode switch: the logical-size
 * letterbox already fits the game to whatever it gets, and a mode switch is
 * slow, can fail, and disturbs other windows. This is what a browser going
 * fullscreen feels like from the game's side. */
extern "C" int32_t sg_set_fullscreen(uint32_t on) {
  if (!g_window) { mail_set("fullscreen before init"); return SG_ESDL; }
  Uint32 flag = on ? SDL_WINDOW_FULLSCREEN_DESKTOP : 0;
  if (SDL_SetWindowFullscreen(g_window, flag) != 0) {
    mail_set(SDL_GetError());
    return SG_ESDL;
  }
  return SG_OK;
}

extern "C" uint32_t sg_is_fullscreen(int32_t unused) {
  (void)unused;
  if (!g_window) return 0;
  Uint32 f = SDL_GetWindowFlags(g_window);
  return (f & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_FULLSCREEN_DESKTOP)) ? 1u : 0u;
}

/* ---- WebGL2: a GL context on the SAME window ----
 *
 * Verified in the 8.2 spike: SDL_GL_CreateContext succeeds on a
 * renderer-backed window (the renderer's own backend is already opengl),
 * and raw GL interleaves with SDL_RenderPresent across SDL_RenderFlush. So
 * a game can use Canvas 2D, WebGL2, or both, in one window.
 *
 * The ES profile must be requested EXPLICITLY. Without it SDL hands back
 * desktop GL 4.6 Compatibility, and WebGL2 maps to GLES 3.
 */
static SDL_GLContext g_gl_context = NULL;

#if defined(__APPLE__)
/* Point SDL's EGL loader at the ANGLE this binary already links.
 *
 * SDL_EGL_LoadLibrary dlopens "libEGL.dylib" by BARE NAME, and the vendored
 * ANGLE lives in vendor/<target>/angle/lib -- on no search path, so the
 * dlopen fails and the ES context silently degrades to "unavailable". But
 * the binary links ANGLE directly (gen-ffi puts both dylibs in `libraries`),
 * so dyld already knows their absolute paths: read them back from the loaded
 * images and hand them to SDL through its documented env overrides. setenv
 * with overwrite=0 keeps a user's explicit choice winning. */
static void gl_point_sdl_at_linked_angle(void) {
  uint32_t n = _dyld_image_count();
  for (uint32_t i = 0; i < n; i++) {
    const char* path = _dyld_get_image_name(i);
    if (!path) continue;
    const char* base = strrchr(path, '/');
    base = base ? base + 1 : path;
    if (strcmp(base, "libEGL.dylib") == 0) {
      setenv("SDL_VIDEO_EGL_DRIVER", path, 0);
    } else if (strcmp(base, "libGLESv2.dylib") == 0) {
      setenv("SDL_VIDEO_GL_DRIVER", path, 0);
    }
  }
}
#endif

/* Remake the window as a GL window, renderer and all.
 *
 * sg_init cannot know a game will ask for GL (the context is created lazily
 * by the first getContextGL), so it creates the window with no GL flag. On
 * Linux that works BY ACCIDENT: the default render driver is "opengl", and
 * SDL_CreateRenderer recreates the window with SDL_WINDOW_OPENGL as a side
 * effect. On macOS the default is "metal", the window stays a Metal window,
 * and SDL_GL_CreateContext fails with "The specified window isn't an OpenGL
 * window".
 *
 * The fix uses the same side effect deliberately: recreate the renderer
 * with the "opengles2" driver, and SDL_CreateRenderer recreates the window
 * (same SDL_Window*, so every held pointer stays valid) with the GL flag
 * and the EGL/ANGLE machinery loaded. The 2D present path's texture is
 * renderer-owned, so it is remade along with it. */
static int32_t gl_remake_window(void) {
#if defined(__APPLE__)
  gl_point_sdl_at_linked_angle();
#endif
  int driver = -1;
  int n = SDL_GetNumRenderDrivers();
  for (int i = 0; i < n; i++) {
    SDL_RendererInfo info;
    if (SDL_GetRenderDriverInfo(i, &info) == 0 && info.name &&
        strcmp(info.name, "opengles2") == 0) {
      driver = i;
      break;
    }
  }
  if (driver < 0) { mail_set("no opengles2 render driver for a GL window"); return SG_ESDL; }

  if (g_texture)  { SDL_DestroyTexture(g_texture); g_texture = NULL; }
  if (g_renderer) { SDL_DestroyRenderer(g_renderer); g_renderer = NULL; }

  Uint32 rflags = SDL_RENDERER_ACCELERATED;
  if (!g_gl_novsync) rflags |= SDL_RENDERER_PRESENTVSYNC;
  g_renderer = SDL_CreateRenderer(g_window, driver, rflags);
  if (!g_renderer) { mail_set(SDL_GetError()); return SG_ESDL; }
  SDL_RenderSetLogicalSize(g_renderer, (int)g_width, (int)g_height);
  SDL_RenderSetIntegerScale(g_renderer, SDL_TRUE);
  SDL_SetRenderDrawColor(g_renderer, 0, 0, 0, 255);
  g_texture = SDL_CreateTexture(g_renderer, SDL_PIXELFORMAT_ABGR8888,
                                SDL_TEXTUREACCESS_STREAMING,
                                (int)g_width, (int)g_height);
  if (!g_texture) { mail_set(SDL_GetError()); return SG_ESDL; }
  return SG_OK;
}

extern "C" int32_t sg_gl_init_window(int32_t unused) {
  (void)unused;
  if (g_gl_context) return SG_OK;                 /* idempotent */

  /* Headless is dispatched by the GL archive, not here.
   *
   * sg_gl_init_headless lives in libsggl.a, which the linker places BEFORE
   * libsggfx.a (ANGLE ordering depends on it), and an archive is scanned
   * once, left to right. Calling it from this file is a backward reference
   * and fails to link with "undefined reference to sg_gl_init_headless".
   * So the GL side asks us for the flag instead -- see sg_gl_wants_headless
   * and the wrapper in sg_gl_extra.cpp. */
  if (!g_window) { mail_set("GL context before init"); return SG_ESDL; }

  if (!(SDL_GetWindowFlags(g_window) & SDL_WINDOW_OPENGL)) {
    int32_t rc = gl_remake_window();
    if (rc != SG_OK) return rc;
  }

  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
  SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);

  g_gl_context = SDL_GL_CreateContext(g_window);
  if (!g_gl_context) { mail_set(SDL_GetError()); return SG_ESDL; }
  SDL_GL_MakeCurrent(g_window, g_gl_context);

  /* GL PRESENT PACING IS SEPARATE from the 2D renderer's PRESENTVSYNC.
   *
   * A GL game swaps with SDL_GL_SwapWindow, which honours the GL swap
   * INTERVAL and knows nothing about the SDL_Renderer flags -- so
   * SG_NO_VSYNC silently did nothing for 3D, and the benchmark measured
   * the display refresh instead of the work: every configuration reported
   * exactly 33.2ms (30fps) whether it drew 250 cubes or 10000.
   *
   * 0 = present immediately. Setting it can fail on drivers that force
   * composition, so the result is not treated as fatal. */
  SDL_GL_SetSwapInterval(g_gl_novsync ? 0 : 1);
  return SG_OK;
}

/* Present a GL frame: swap the window's buffers directly.
 *
 * The 2D present path blits a Skia raster surface through an SDL texture;
 * a GL frame is already in the window's back buffer, so it only needs the
 * swap. A game using both would present through the 2D path, which SDL
 * flushes around. */
/* Read by the GL archive so it can pick the pbuffer path. Accessors rather
 * than a direct call the other way, because libsggl.a is linked first and
 * cannot be called backwards into. */
extern "C" int32_t sg_gl_wants_headless(void) { return g_gl_headless ? 1 : 0; }
extern "C" uint32_t sg_gl_surface_width(void)  { return g_width; }
extern "C" uint32_t sg_gl_surface_height(void) { return g_height; }

extern "C" int32_t sg_gl_present(int32_t unused) {
  (void)unused;
  /* Nothing to swap without a window. The frame is already complete in the
   * pbuffer, and the benchmark times the drawing, not the presentation. */
  if (g_gl_headless) return SG_OK;
  if (!g_gl_context) { mail_set("GL present before context"); return SG_ESDL; }
  SDL_GL_SwapWindow(g_window);
  return SG_OK;
}

/* The window's DRAWABLE size, packed as (width << 16) | height.
 *
 * Lives here because only sg_core owns the SDL window, and it is read by
 * the GL tier (a separate archive) to fit its viewport. Packing avoids an
 * out-parameter, which FFI format 1 has no class for.
 *
 * The drawable size is NOT the window size on a HiDPI display: SDL reports
 * points for the window and pixels for the drawable, and a viewport wants
 * pixels. */
extern "C" uint32_t sg_drawable_size(int32_t unused) {
  (void)unused;
  if (!g_window) return (g_width << 16) | (g_height & 0xffffu);
  int dw = 0, dh = 0;
  SDL_GL_GetDrawableSize(g_window, &dw, &dh);
  if (dw <= 0 || dh <= 0) { dw = (int)g_width; dh = (int)g_height; }
  return ((uint32_t)dw << 16) | ((uint32_t)dh & 0xffffu);
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
extern "C" int32_t sg_surface_save_png(uint32_t hs, const uint8_t* path,
                                       size_t path_len) {
  /* Handle 0 means the screen surface, so the common case needs no handle
   * plumbing; the conformance harness passes a real offscreen handle. */
  skiac_surface* surf = g_surface;
  if (hs != 0) {
    surf = (skiac_surface*)sg_table_get(SG_T_SURFACE, hs);
    if (!surf) { mail_set("surface handle is stale or invalid"); return SG_EBADHANDLE; }
  }
  if (!surf) { mail_set("save_png before init"); return SG_ESDL; }
  char buf[1024];
  if (path_len >= sizeof(buf)) { mail_set("png path too long"); return SG_ERANGE; }
  memcpy(buf, path, path_len);
  buf[path_len] = 0;

  skiac_sk_data png;
  png.ptr = NULL; png.size = 0; png.data = NULL;
  skiac_surface_png_data(surf, &png);
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

/* Events, keyboard/mouse state and controllers live in sg_input.cpp. */

/* The handle-flattened skiac wrappers that used to live here are now
 * generated into sg_skia_gen.cpp from skia_c.hpp, with the shapes the
 * generator refuses to guess hand-written in sg_skia_extra.cpp. */

/* ---- debug / leak counters ---- */
extern "C" uint32_t sg_debug_live(uint32_t domain) {
  return sg_table_live((sg_domain)domain);
}
extern "C" uint32_t sg_debug_high_water(uint32_t domain) {
  return sg_table_high_water((sg_domain)domain);
}
