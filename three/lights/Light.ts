/* Lights.
 *
 * API-compatible with three for the game-sized set: Ambient, Directional,
 * Point, Hemisphere. Per-light-count shader variants with small fixed
 * maxima, as the plan calls for -- a game does not need 200 dynamic lights,
 * and a fixed cap keeps the shader branch-free.
 */
import { Object3D } from "../core/Object3D.js";
import { Color } from "../math/Color.js";

/* A numeric tag rather than three's isAmbientLight/isDirectionalLight
 * booleans: the renderer switches on one integer instead of testing a chain
 * of optional flags, and the dialect cannot narrow by flag anyway. The
 * boolean flags are still present below for API compatibility. */
export const LIGHT_AMBIENT = 1;
export const LIGHT_DIRECTIONAL = 2;
export const LIGHT_POINT = 3;
export const LIGHT_HEMISPHERE = 4;

export class Light extends Object3D {
  color: Color;
  intensity: number;
  lightType = 0;

  /* Point-light falloff. These live on the BASE class, not on PointLight,
   * because the renderer holds a Light[] and the dialect will not narrow it
   * back to PointLight (SC1090) -- the same constraint that makes Scene
   * keep typed registries. They are ignored for other light types.
   *
   * `distance` 0 means no cutoff; `decay` 2 is physically correct
   * inverse-square. Both match three's defaults and meanings. */
  distance = 0;
  decay = 2;

  /* Hemisphere lights only. On the base class because the renderer holds a
   * Light[] and cannot narrow it back down (SC1090). */
  groundColor: Color = new Color(0xffffff);

  constructor(color: number = 0xffffff, intensity: number = 1) {
    super();
    this.isLight = true;
    this.color = new Color(color);
    this.intensity = intensity;
  }
}

/** Uniform light from every direction: the floor for ambient occlusion. */
export class AmbientLight extends Light {
  readonly isAmbientLight = true;
  constructor(color: number = 0xffffff, intensity: number = 1) {
    super(color, intensity);
    this.lightType = LIGHT_AMBIENT;
  }
}

/* A light infinitely far away, so only its DIRECTION matters.
 *
 * three takes the direction from `position` pointing at `target` (the
 * origin by default), which is what this does: the shader gets
 * normalize(position). */
export class DirectionalLight extends Light {
  readonly isDirectionalLight = true;
  constructor(color: number = 0xffffff, intensity: number = 1) {
    super(color, intensity);
    this.lightType = LIGHT_DIRECTIONAL;
  }
}

/** A light at a point, falling off with distance. */
export class PointLight extends Light {
  readonly isPointLight = true;

  constructor(color: number = 0xffffff, intensity: number = 1,
              distance: number = 0, decay: number = 2) {
    super(color, intensity);
    this.lightType = LIGHT_POINT;
    this.distance = distance;
    this.decay = decay;
  }
}

/* Hemisphere light: sky colour from above, ground colour from below.
 *
 * The cheapest believable ambient there is. A flat AmbientLight makes
 * every surface the same brightness regardless of which way it faces, so a
 * scene lit only by it looks pasted-on; this costs one extra dot product
 * and gives upward faces the sky and downward faces the bounce, which is
 * the single biggest readability win for outdoor geometry.
 *
 * `color` is the SKY colour (matching three, where the constructor is
 * `HemisphereLight(skyColor, groundColor, intensity)`), and `groundColor`
 * lives on the base class for the same reason PointLight's distance/decay
 * do: the renderer holds a Light[] and the dialect will not narrow it. */
export class HemisphereLight extends Light {
  readonly isHemisphereLight = true;

  constructor(skyColor: number = 0xffffff, groundColor: number = 0xffffff,
              intensity: number = 1) {
    super(skyColor, intensity);
    this.lightType = LIGHT_HEMISPHERE;
    this.groundColor.setHex(groundColor);
  }
}
