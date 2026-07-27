/* The string mailbox: how text comes BACK across a boundary that cannot
 * return strings.
 *
 * A producing call (an error, a pad name, a version) writes into one static
 * buffer shim-side; TS then reads its length and its bytes. The buffer is
 * overwritten by the next producing call, so it must be drained IMMEDIATELY
 * after the call that filled it, never held across one.
 */
import * as ffi from "./ffi.js";

/** Drains the mailbox as a string. Call right after the producing call. */
export function readMailbox(): string {
  const n = ffi.strLen();
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(ffi.strByte(i));
  return s;
}

/** Drains the text-input mailbox (UTF-8 bytes of one SG_EV_TEXT event). */
export function readTextEvent(): string {
  const n = ffi.textEventLen();
  if (n === 0) return "";
  const bytes: number[] = [];
  for (let i = 0; i < n; i++) bytes.push(ffi.textEventByte(i));
  return decodeUtf8(bytes);
}

/* SDL hands us UTF-8; scriptc strings are UTF-16-ish, so multi-byte
 * sequences need decoding rather than a byte-per-char copy. Only the
 * three-byte BMP range is handled plus surrogate pairs for astral planes,
 * which covers everything a keyboard or IME produces. */
function decodeUtf8(bytes: number[]): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      // Astral plane: emit the surrogate pair.
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10));
      out += String.fromCharCode(0xdc00 + (v & 0x3ff));
      i += 4;
    } else {
      i += 1;  // malformed byte; skip rather than emit a replacement
    }
  }
  return out;
}
