/* Input: events, keyboard/mouse state, and game controllers.
 *
 * Three boundary problems, three solutions:
 *
 *   - SDL events are structs, so one static slot holds the most recent event
 *     and TS reads its fields through scalar getters. Main thread only, so
 *     the slot needs no synchronization.
 *   - Text input is UTF-8 of unbounded length, so it goes through the same
 *     borrowed-span-in-reverse trick as the error mailbox: a byte buffer plus
 *     a length, drained per event.
 *   - Controllers are opaque pointers with hot-plug, so the shim owns a fixed
 *     slot array and TS addresses pads by SLOT INDEX, never by pointer or by
 *     SDL's instance id (which is unbounded and reused).
 */
#include <SDL2/SDL.h>
#include <stdint.h>
#include <string.h>

#include "sg_skia.h"

/* ---- event kinds, mirrored in runtime/input/events.ts ---- */
typedef enum {
  SG_EV_NONE = 0,
  SG_EV_QUIT,
  SG_EV_KEYDOWN,
  SG_EV_KEYUP,
  SG_EV_MOUSEMOVE,
  SG_EV_MOUSEDOWN,
  SG_EV_MOUSEUP,
  SG_EV_MOUSEWHEEL,
  SG_EV_TEXT,
  SG_EV_WINDOW,
  SG_EV_PADADDED,
  SG_EV_PADREMOVED
} sg_event_kind;

/* field indices, mirrored in runtime/input/events.ts */
#define SG_F_SCANCODE 0
#define SG_F_REPEAT   1
#define SG_F_X        2
#define SG_F_Y        3
#define SG_F_BUTTON   4
#define SG_F_WINEVENT 5
#define SG_F_KEYCODE  6
#define SG_F_MODS     7
#define SG_F_WHEEL_X  8
#define SG_F_WHEEL_Y  9
#define SG_F_PAD      10
#define SG_F_COUNT    12

static int32_t g_ev[SG_F_COUNT];

/* ---- text input mailbox ----
 * SDL_TEXTINPUT carries UTF-8 up to 32 bytes; drained immediately by TS
 * after an SG_EV_TEXT, exactly like the error mailbox. */
static char     g_text[64];
static uint32_t g_text_len;

extern "C" uint32_t sg_text_len(int32_t unused) { (void)unused; return g_text_len; }
extern "C" uint32_t sg_text_byte(uint32_t i) {
  return i < g_text_len ? (uint32_t)(uint8_t)g_text[i] : 0u;
}

/* ---- controller slots ----
 *
 * TS addresses a pad by SLOT, which is stable for the pad's lifetime and
 * bounded, unlike SDL's instance id. A disconnected pad leaves its slot
 * empty rather than compacting, so indices already handed to game code never
 * silently refer to a different device. */
#define SG_MAX_PADS 8

typedef struct {
  SDL_GameController* ctrl;
  SDL_JoystickID      instance;   /* 0 when the slot is empty */
} sg_pad;

static sg_pad g_pads[SG_MAX_PADS];

static int slot_of_instance(SDL_JoystickID id) {
  for (int i = 0; i < SG_MAX_PADS; i++) {
    if (g_pads[i].ctrl && g_pads[i].instance == id) return i;
  }
  return -1;
}

/* Opens a controller by DEVICE index into the first free slot.
 *
 * Returns -1 if the device is not a controller, all slots are full, or it is
 * ALREADY OPEN. That last case is not hypothetical: sg_input_init opens the
 * pads present at startup, and initialising the subsystem also queues a
 * CONTROLLERDEVICEADDED for each of them, so without this check one physical
 * pad occupies two slots and appears twice in getGamepads(). */
static int pad_open(int device_index) {
  if (!SDL_IsGameController(device_index)) return -1;

  SDL_JoystickID incoming = SDL_JoystickGetDeviceInstanceID(device_index);
  if (incoming >= 0 && slot_of_instance(incoming) >= 0) return -1;

  for (int i = 0; i < SG_MAX_PADS; i++) {
    if (g_pads[i].ctrl) continue;
    SDL_GameController* c = SDL_GameControllerOpen(device_index);
    if (!c) return -1;
    SDL_Joystick* j = SDL_GameControllerGetJoystick(c);
    g_pads[i].ctrl = c;
    g_pads[i].instance = SDL_JoystickInstanceID(j);
    return i;
  }
  return -1;  /* all slots full */
}

static void pad_close_slot(int slot) {
  if (slot < 0 || slot >= SG_MAX_PADS || !g_pads[slot].ctrl) return;
  SDL_GameControllerClose(g_pads[slot].ctrl);
  g_pads[slot].ctrl = NULL;
  g_pads[slot].instance = 0;
}

/* Opens every controller already present. Called once from sg_input_init so
 * pads connected BEFORE startup are seen; SDL only sends CONTROLLERDEVICEADDED
 * for those at init time if the subsystem was already up. */
extern "C" int32_t sg_input_init(int32_t unused) {
  (void)unused;
  if (SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER | SDL_INIT_JOYSTICK) != 0) {
    sg_mail_set(SDL_GetError());
    return SG_ESDL;
  }
  /* Events are polled explicitly; SDL still needs to be told to generate
   * controller events at all. */
  SDL_GameControllerEventState(SDL_ENABLE);
  SDL_JoystickEventState(SDL_ENABLE);
  for (int i = 0; i < SDL_NumJoysticks(); i++) pad_open(i);
  return SG_OK;
}

extern "C" void sg_input_quit(int32_t unused) {
  (void)unused;
  for (int i = 0; i < SG_MAX_PADS; i++) pad_close_slot(i);
}

/* ---- event pump ---- */
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
        g_ev[SG_F_KEYCODE]  = (int32_t)e.key.keysym.sym;
        g_ev[SG_F_MODS]     = (int32_t)e.key.keysym.mod;
        g_ev[SG_F_REPEAT]   = e.key.repeat ? 1 : 0;
        return e.type == SDL_KEYDOWN ? SG_EV_KEYDOWN : SG_EV_KEYUP;

      case SDL_TEXTINPUT: {
        size_t n = strlen(e.text.text);
        if (n >= sizeof(g_text)) n = sizeof(g_text) - 1;
        memcpy(g_text, e.text.text, n);
        g_text[n] = 0;
        g_text_len = (uint32_t)n;
        return SG_EV_TEXT;
      }

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

      case SDL_MOUSEWHEEL:
        /* SDL flips the sign under SDL_MOUSEWHEEL_FLIPPED; normalize so TS
         * always sees "positive y = wheel away from the user". */
        g_ev[SG_F_WHEEL_X] = e.wheel.x;
        g_ev[SG_F_WHEEL_Y] = e.wheel.y;
        if (e.wheel.direction == SDL_MOUSEWHEEL_FLIPPED) {
          g_ev[SG_F_WHEEL_X] = -g_ev[SG_F_WHEEL_X];
          g_ev[SG_F_WHEEL_Y] = -g_ev[SG_F_WHEEL_Y];
        }
        return SG_EV_MOUSEWHEEL;

      case SDL_WINDOWEVENT:
        g_ev[SG_F_WINEVENT] = e.window.event;
        g_ev[SG_F_X] = e.window.data1;   /* size/position payload */
        g_ev[SG_F_Y] = e.window.data2;
        return SG_EV_WINDOW;

      case SDL_CONTROLLERDEVICEADDED: {
        /* `which` is a DEVICE index here (and an instance id everywhere
         * else), which is SDL's oldest footgun. */
        int slot = pad_open(e.cdevice.which);
        if (slot < 0) continue;          /* not a controller, or no free slot */
        g_ev[SG_F_PAD] = slot;
        return SG_EV_PADADDED;
      }

      case SDL_CONTROLLERDEVICEREMOVED: {
        int slot = slot_of_instance(e.cdevice.which);
        if (slot < 0) continue;
        pad_close_slot(slot);
        g_ev[SG_F_PAD] = slot;
        return SG_EV_PADREMOVED;
      }

      default:
        continue; /* drop events the framework does not model */
    }
  }
  return SG_EV_NONE;
}

extern "C" int32_t sg_evt_i32(uint32_t field) {
  return field < SG_F_COUNT ? g_ev[field] : 0;
}

/* ---- gamepad state ----
 * Polled, not event-driven: game loops want "is A held right now", and the
 * standard-mapping accessors give exactly that without tracking edges in C. */

extern "C" uint32_t sg_pad_connected(uint32_t slot) {
  if (slot >= SG_MAX_PADS || !g_pads[slot].ctrl) return 0;
  return SDL_GameControllerGetAttached(g_pads[slot].ctrl) ? 1u : 0u;
}

/** Button state by SDL_GameControllerButton index. */
extern "C" uint32_t sg_pad_button(uint32_t slot, uint32_t button) {
  if (slot >= SG_MAX_PADS || !g_pads[slot].ctrl) return 0;
  if (button >= SDL_CONTROLLER_BUTTON_MAX) return 0;
  return SDL_GameControllerGetButton(g_pads[slot].ctrl,
                                     (SDL_GameControllerButton)button) ? 1u : 0u;
}

/** Axis as -1..1 (triggers 0..1), by SDL_GameControllerAxis index. */
extern "C" double sg_pad_axis(uint32_t slot, uint32_t axis) {
  if (slot >= SG_MAX_PADS || !g_pads[slot].ctrl) return 0.0;
  if (axis >= SDL_CONTROLLER_AXIS_MAX) return 0.0;
  Sint16 v = SDL_GameControllerGetAxis(g_pads[slot].ctrl,
                                       (SDL_GameControllerAxis)axis);
  /* Sint16 is asymmetric (-32768..32767). Dividing the negative half by
   * 32768 and the positive by 32767 makes both ends reach exactly -1 and 1,
   * which is what the Gamepad API promises. */
  return v < 0 ? (double)v / 32768.0 : (double)v / 32767.0;
}

/** Pad name into the string mailbox. Returns its length. */
extern "C" uint32_t sg_pad_name(uint32_t slot) {
  if (slot >= SG_MAX_PADS || !g_pads[slot].ctrl) { sg_mail_set(""); return 0; }
  const char* n = SDL_GameControllerName(g_pads[slot].ctrl);
  sg_mail_set(n ? n : "");
  return (uint32_t)strlen(n ? n : "");
}

/* Rumble: low and high frequency motors, 0..1, for `ms` milliseconds.
 * Returns SG_OK even when the pad has no motors -- a game asking for haptics
 * it cannot get is not an error, and the Gamepad API's playEffect resolves
 * either way. */
extern "C" int32_t sg_pad_rumble(uint32_t slot, double low, double high,
                                 uint32_t ms) {
  if (slot >= SG_MAX_PADS || !g_pads[slot].ctrl) return SG_EBADHANDLE;
  if (low < 0) low = 0; if (low > 1) low = 1;
  if (high < 0) high = 0; if (high > 1) high = 1;
  SDL_GameControllerRumble(g_pads[slot].ctrl, (Uint16)(low * 65535.0),
                           (Uint16)(high * 65535.0), ms);
  return SG_OK;
}

extern "C" uint32_t sg_pad_has_rumble(uint32_t slot) {
  if (slot >= SG_MAX_PADS || !g_pads[slot].ctrl) return 0;
  return SDL_GameControllerHasRumble(g_pads[slot].ctrl) ? 1u : 0u;
}

/** Adds an SDL controller-mapping string. Returns 1 if new, 0 if updated. */
extern "C" int32_t sg_pad_add_mapping(const uint8_t* text, size_t len) {
  char buf[1024];
  if (len >= sizeof(buf)) { sg_mail_set("mapping string too long"); return SG_ERANGE; }
  memcpy(buf, text, len);
  buf[len] = 0;
  int rc = SDL_GameControllerAddMapping(buf);
  if (rc < 0) { sg_mail_set(SDL_GetError()); return SG_ESDL; }
  return rc;
}

/* ---- text input mode ----
 * Off by default: with text input enabled SDL emits SDL_TEXTINPUT for every
 * keystroke and (on some platforms) shows an IME, which a game that only
 * wants WASD does not want. */
extern "C" int32_t sg_text_input(uint32_t enable) {
  if (enable) SDL_StartTextInput();
  else        SDL_StopTextInput();
  return SG_OK;
}

/* ---- virtual pads (testing) ----
 * SDL can attach a synthetic controller, which is what makes the gamepad
 * path testable in CI with no hardware. Deliberately shipped rather than
 * test-only: it is also how remote/replay input would be fed in. */
extern "C" int32_t sg_pad_attach_virtual(int32_t naxes, int32_t nbuttons) {
  int idx = SDL_JoystickAttachVirtual(SDL_JOYSTICK_TYPE_GAMECONTROLLER,
                                      naxes, nbuttons, 0);
  if (idx < 0) { sg_mail_set(SDL_GetError()); return SG_ESDL; }
  return idx;
}

extern "C" int32_t sg_pad_detach_virtual(int32_t device_index) {
  if (SDL_JoystickDetachVirtual(device_index) != 0) {
    sg_mail_set(SDL_GetError());
    return SG_ESDL;
  }
  return SG_OK;
}

/* Sets a virtual pad's button/axis. Addressed by SLOT (like everything else
 * TS-facing), resolved back to the underlying joystick. */
extern "C" int32_t sg_pad_set_virtual_button(uint32_t slot, uint32_t button,
                                             uint32_t value) {
  if (slot >= SG_MAX_PADS || !g_pads[slot].ctrl) return SG_EBADHANDLE;
  SDL_Joystick* j = SDL_GameControllerGetJoystick(g_pads[slot].ctrl);
  if (!j) return SG_EBADHANDLE;
  if (SDL_JoystickSetVirtualButton(j, (int)button, value ? 1 : 0) != 0) {
    sg_mail_set(SDL_GetError());
    return SG_ESDL;
  }
  return SG_OK;
}

extern "C" int32_t sg_pad_set_virtual_axis(uint32_t slot, uint32_t axis,
                                           double value) {
  if (slot >= SG_MAX_PADS || !g_pads[slot].ctrl) return SG_EBADHANDLE;
  SDL_Joystick* j = SDL_GameControllerGetJoystick(g_pads[slot].ctrl);
  if (!j) return SG_EBADHANDLE;
  if (value < -1) value = -1; if (value > 1) value = 1;
  Sint16 v = (Sint16)(value < 0 ? value * 32768.0 : value * 32767.0);
  if (SDL_JoystickSetVirtualAxis(j, (int)axis, v) != 0) {
    sg_mail_set(SDL_GetError());
    return SG_ESDL;
  }
  return SG_OK;
}

/** Pumps SDL's internal device state; needed after setting virtual inputs. */
extern "C" int32_t sg_pad_update(int32_t unused) {
  (void)unused;
  SDL_GameControllerUpdate();
  return SG_OK;
}
