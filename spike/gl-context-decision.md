# 8.2 decision: context and present

Both lanes verified by running them, not chosen on paper.

## Windowed: ONE window serves 2D and GL

The 2D path draws Skia raster into an SDL *renderer* texture, and the
renderer owns a GL context, so the open question was whether a WebGL2 game
needs its own window. It does not:

| Check | Result |
| --- | --- |
| `SDL_GL_CreateContext` on a renderer-backed window | succeeds (renderer backend already reports `opengl`) |
| raw `glClear` interleaved with `SDL_RenderPresent` | correct across `SDL_RenderFlush`, SDL's documented seam |
| `SDL_GL_CONTEXT_PROFILE_ES` 3.0 requested | real **OpenGL ES 3.2** context; `glGenVertexArrays` works, no error |

Without the explicit ES profile request SDL hands back desktop GL 4.6
Compatibility, which is not what WebGL2 maps to. Requesting it matters.

A game can therefore use Canvas 2D, WebGL2, or both in one window, and the
existing present path needs no change for this phase.

## Headless: EGL device platform + pbuffer

`SDL_VIDEODRIVER=dummy` cannot create a GL context ("Invalid window"), so
the 2D headless trick does not carry over.

EGL's device platform needs no display server at all and works today:
3 devices enumerated, EGL 1.5, an ES 3.2 context on a pbuffer, and
`glReadPixels` returning the expected clear colour (25/51/76/255 from a
0.1/0.2/0.3 clear; the off-by-one is float-to-byte rounding).

Same shape as native-gles's `egl_context.cpp`, which already does device
enumeration and pbuffer setup, so the plan's "compile it into the shim"
holds.

xvfb is the alternative, and CI already installs it for the browser proof.
EGL is preferred: no X server, and it keeps the readback lane honestly on
the GPU.

## Consequence

The 8.4 readback-parity gate runs on the pbuffer lane, so it needs no
display and fits CI as-is.
