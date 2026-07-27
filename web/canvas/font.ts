/* The CSS `font` shorthand parser, pure TS.
 *
 * Handles the subset games actually write:
 *
 *   [style] [weight] <size>[unit] <family>
 *   "bold 16px monospace", "italic 12pt 'My Font', sans-serif", "10px serif"
 *
 * Anything unparseable leaves the previous value in place at the call site,
 * matching the browser rule that an invalid `font` assignment is ignored.
 * Line-height (`16px/1.4 serif`) is accepted and the height dropped, since
 * single-line canvas text has nowhere to use it.
 */
import { SLANT_UPRIGHT, SLANT_ITALIC, SLANT_OBLIQUE } from "../../host/skia-enums.js";

export class FontSpec {
  family = "sans-serif";
  size = 10;
  weight = 400;
  slant = SLANT_UPRIGHT;
}

const WEIGHTS = new Map<string, number>([
  ["thin", 100], ["hairline", 100],
  ["extralight", 200], ["ultralight", 200],
  ["light", 300],
  ["normal", 400], ["regular", 400],
  ["medium", 500],
  ["semibold", 600], ["demibold", 600],
  ["bold", 700],
  ["extrabold", 800], ["ultrabold", 800],
  ["black", 900], ["heavy", 900],
]);

/** px per unit, for the absolute units a game might type. */
function unitScale(unit: string): number {
  if (unit === "px" || unit === "") return 1;
  if (unit === "pt") return 96 / 72;
  if (unit === "pc") return 16;
  if (unit === "in") return 96;
  if (unit === "cm") return 96 / 2.54;
  if (unit === "mm") return 96 / 25.4;
  // em/rem/% have no root to resolve against here; treat as px so text still
  // renders at a sane size rather than vanishing.
  return 1;
}

/** Splits a size token like "16px" or "12.5pt" into value and unit. */
function parseSize(tok: string): number {
  let i = 0;
  while (i < tok.length) {
    const c = tok.charAt(i);
    if ((c >= "0" && c <= "9") || c === "." || c === "-" || c === "+") i++;
    else break;
  }
  if (i === 0) return -1;
  const value = parseFloat(tok.substring(0, i));
  if (!(value > 0)) return -1;
  return value * unitScale(tok.substring(i));
}

/** Strips matching quotes from a family name. */
function unquote(s: string): string {
  if (s.length >= 2) {
    const a = s.charAt(0);
    const b = s.charAt(s.length - 1);
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return s.substring(1, s.length - 1);
    }
  }
  return s;
}

export function parseFont(css: string): FontSpec {
  const spec = new FontSpec();
  const text = css.trim();
  if (text.length === 0) return spec;

  // Split off the family list at the first size token: everything before is
  // style/variant/weight, everything after is the family.
  const parts = text.split(" ");
  let sizeIndex = -1;
  let size = -1;
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (tok.length === 0) continue;
    // A size token starts with a digit or a dot; `bold` and `italic` do not.
    const c = tok.charAt(0);
    if ((c >= "0" && c <= "9") || c === ".") {
      // Drop any /line-height before parsing the size.
      const slash = tok.indexOf("/");
      const sizeTok = slash >= 0 ? tok.substring(0, slash) : tok;
      const v = parseSize(sizeTok);
      if (v > 0) { size = v; sizeIndex = i; break; }
    }
  }
  if (sizeIndex < 0) return spec;  // no size: not a valid font shorthand
  spec.size = size;

  // Leading tokens: style and weight, in any order.
  for (let i = 0; i < sizeIndex; i++) {
    const tok = parts[i].toLowerCase();
    if (tok === "italic") spec.slant = SLANT_ITALIC;
    else if (tok === "oblique") spec.slant = SLANT_OBLIQUE;
    else {
      const w = WEIGHTS.get(tok);
      if (w !== undefined) spec.weight = w;
      else {
        const numeric = parseInt(tok, 10);
        if (numeric >= 1 && numeric <= 1000) spec.weight = numeric;
      }
    }
  }

  // Trailing tokens: the family list. Only the first family is used, since
  // skiac takes a single family name and does its own fallback.
  const familyText = parts.slice(sizeIndex + 1).join(" ").trim();
  if (familyText.length > 0) {
    const comma = familyText.indexOf(",");
    const first = comma >= 0 ? familyText.substring(0, comma) : familyText;
    const name = unquote(first.trim());
    if (name.length > 0) spec.family = name;
  }
  return spec;
}
