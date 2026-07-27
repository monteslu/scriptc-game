/* Event kinds and field indices, mirrored from shim/sg_input.cpp.
 *
 * These are ABI: the shim returns a kind and TS reads that event's fields by
 * index, so a mismatch here is a silently wrong event rather than a compile
 * error. Keep the two lists in lockstep.
 */

export const EV_NONE = 0;
export const EV_QUIT = 1;
export const EV_KEYDOWN = 2;
export const EV_KEYUP = 3;
export const EV_MOUSEMOVE = 4;
export const EV_MOUSEDOWN = 5;
export const EV_MOUSEUP = 6;
export const EV_MOUSEWHEEL = 7;
export const EV_TEXT = 8;
export const EV_WINDOW = 9;
export const EV_PADADDED = 10;
export const EV_PADREMOVED = 11;

export const F_SCANCODE = 0;
export const F_REPEAT = 1;
export const F_X = 2;
export const F_Y = 3;
export const F_BUTTON = 4;
export const F_WINEVENT = 5;
export const F_KEYCODE = 6;
export const F_MODS = 7;
export const F_WHEEL_X = 8;
export const F_WHEEL_Y = 9;
export const F_PAD = 10;

/* SDL_WindowEventID values the framework reacts to. */
export const WIN_SHOWN = 1;
export const WIN_HIDDEN = 2;
export const WIN_EXPOSED = 3;
export const WIN_MOVED = 4;
export const WIN_RESIZED = 5;
export const WIN_SIZE_CHANGED = 6;
export const WIN_MINIMIZED = 7;
export const WIN_MAXIMIZED = 8;
export const WIN_RESTORED = 9;
export const WIN_ENTER = 10;
export const WIN_LEAVE = 11;
export const WIN_FOCUS_GAINED = 12;
export const WIN_FOCUS_LOST = 13;
export const WIN_CLOSE = 14;

/* SDL_Keymod bits, for modifier queries. */
export const MOD_NONE = 0x0000;
export const MOD_LSHIFT = 0x0001;
export const MOD_RSHIFT = 0x0002;
export const MOD_LCTRL = 0x0040;
export const MOD_RCTRL = 0x0080;
export const MOD_LALT = 0x0100;
export const MOD_RALT = 0x0200;
export const MOD_LGUI = 0x0400;
export const MOD_RGUI = 0x0800;
export const MOD_SHIFT = 0x0003;
export const MOD_CTRL = 0x00c0;
export const MOD_ALT = 0x0300;
export const MOD_GUI = 0x0c00;

/* Mouse buttons, SDL's numbering (1-based). */
export const MOUSE_LEFT = 1;
export const MOUSE_MIDDLE = 2;
export const MOUSE_RIGHT = 3;
export const MOUSE_X1 = 4;
export const MOUSE_X2 = 5;
