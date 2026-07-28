/* Fog.
 *
 * API-compatible with three: `new Fog(color, near, far)` for linear fog and
 * `new FogExp2(color, density)` for exponential-squared. Assign either to
 * `scene.fog` and every lit material picks it up.
 *
 * WHY A GAME WANTS THIS. Fog is the cheapest depth cue there is. A long
 * corridor rendered without it reads as a flat wall of geometry, because
 * nothing distinguishes a surface ten metres away from one at eighty. Fog
 * separates them, hides the far clip plane, and makes a tunnel feel deep
 * rather than merely long.
 *
 * The two kinds are genuinely different and both are here because three
 * has both:
 *
 *   Fog      linear between `near` and `far`. Predictable, and easy to
 *            match to a level's actual dimensions -- set `far` to the
 *            length of the longest sightline and nothing beyond it shows.
 *
 *   FogExp2  density-driven, thickening with the SQUARE of distance. This
 *            is what atmosphere really does, and it never fully clears, so
 *            it suits open space and smoke better than a corridor.
 *
 * Both are applied in the fragment shader against the VIEW-space depth,
 * so they cost one mix per fragment and nothing per object.
 */
import { Color } from "../math/Color.js";

/** Discriminates the two fog types in the renderer without a downcast. */
export const FOG_LINEAR = 1;
export const FOG_EXP2 = 2;

export class Fog {
  readonly isFog = true;
  /** FOG_LINEAR or FOG_EXP2; the renderer branches on this. */
  fogType: number = FOG_LINEAR;

  color: Color;
  /** Distance at which fog starts. Linear only. */
  near: number;
  /** Distance at which fog is total. Linear only. */
  far: number;
  /** Thickness per unit distance. Exp2 only. */
  density: number;

  constructor(color: number = 0xcccccc, near: number = 1, far: number = 1000) {
    this.color = new Color(color);
    this.near = near;
    this.far = far;
    this.density = 0.00025;
  }
}

/* Exponential-squared fog. three ships this as a separate class, so it is
 * one here too -- but it carries the same fields, because the dialect
 * cannot narrow `scene.fog` back to a subclass (SC1090) and the renderer
 * has to read whichever it was given. `fogType` is what it branches on. */
export class FogExp2 extends Fog {
  readonly isFogExp2 = true;

  constructor(color: number = 0xcccccc, density: number = 0.00025) {
    super(color, 1, 1000);
    this.fogType = FOG_EXP2;
    this.density = density;
  }
}
