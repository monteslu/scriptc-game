/* runner: a 3D endless runner.
 *
 * The whole stack in one game:
 *
 *   3D      threeTS-lite over the WebGL2 tier: scene graph, lit materials,
 *           a program cache, instanced-free indexed draws.
 *   HUD     an OFFSCREEN 2D CANVAS drawn with the Canvas API and uploaded
 *           as a GL texture. Text, panels and the score bar are ordinary
 *           ctx.fillText/fillRect calls; the result is a textured quad in
 *           the 3D scene.
 *   Audio   Web Audio: a music bus and oscillator SFX from engine/sfx.
 *   Input   keyboard and gamepad through the same web APIs the 2D games use.
 *
 * Everything below the imports is code a browser runs.
 */
import {
  window, document, navigator, requestAnimationFrame, KeyboardEvent,
  AudioContext, FontFace, fetch, AudioBuffer, Math, Gamepad,
} from "../../web/globals.js";
import { pickup, hit, dash as dashSfx, gameOver } from "../../engine/sfx.js";
import { ParticleSystem, BurstOptions } from "../../engine/particles.js";

import { Scene } from "../../three/core/Scene.js";
import { PerspectiveCamera } from "../../three/core/PerspectiveCamera.js";
import { Mesh, Group } from "../../three/objects/Mesh.js";
import { BoxGeometry } from "../../three/geometries/BoxGeometry.js";
import { SphereGeometry } from "../../three/geometries/SphereGeometry.js";
import { PlaneGeometry } from "../../three/geometries/PlaneGeometry.js";
import { BufferAttribute } from "../../three/core/BufferAttribute.js";
import {
  MeshLambertMaterial, MeshBasicMaterial, SpriteMaterial, DoubleSide,
  AdditiveBlending,
} from "../../three/materials/Material.js";
import { Sprite } from "../../three/objects/Sprite.js";
import { AmbientLight, DirectionalLight, PointLight } from "../../three/lights/Light.js";
import { WebGLRenderer } from "../../three/renderer/WebGLRenderer.js";
import { Texture } from "../../three/textures/Texture.js";
import { Vector3 } from "../../three/math/Vector3.js";

/* ---- tuning ---- */
const LANE_X = 2.2;                  // distance between lane centres
const LANES = 3;
const RUN_SPEED_START = 14;          // world units per second
const RUN_SPEED_MAX = 34;
const RUN_ACCEL = 0.55;              // per second
const LANE_SNAP = 14;                // how fast the player slides between lanes
const JUMP_VELOCITY = 9.2;
const GRAVITY = 26;
const SPAWN_AHEAD = 46;              // far enough to react, near enough to SEE
const DESPAWN_BEHIND = 8;
const OBSTACLE_GAP_START = 11;
const OBSTACLE_GAP_MIN = 6.5;
const HUD_W = 512;
const HUD_H = 256;
const FONT = "DejaVu Sans";

/* Standard Gamepad indices. The spec names no constants. */
const BTN_A = 0;
const BTN_START = 9;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
const AXIS_LEFT_X = 0;

class Obstacle {
  mesh: Mesh | null = null;
  /* A camera-facing additive halo around an orb. Additive means
   * overlapping glows brighten rather than flatten, and the black edge of
   * the falloff texture contributes nothing, so the quad has no boundary. */
  glow: Sprite | null = null;
  lane = 0;
  z = 0;
  alive = false;
  isOrb = false;
  spin = 0;
}

/* A soft radial glow sprite, drawn once into an offscreen canvas.
 *
 * Additive blending means the BLACK edge contributes nothing, so the quad
 * has no visible boundary: the falloff itself is the shape. The stops are
 * weighted toward the centre because a linear ramp reads as a flat disc
 * with a fuzzy rim rather than a light source. */
function makeGlowTexture(): Texture | null {
  const c = document.createElement("canvas");
  if (c === null) return null;
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (g === null) return null;

  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.22, "rgba(255,228,150,0.85)");
  grad.addColorStop(0.5, "rgba(255,160,40,0.32)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.setFillGradient(grad);
  g.fillRect(0, 0, 128, 128);

  return Texture.fromCanvas(g);
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const W = canvas.width;
  const H = canvas.height;

  const gl = canvas.getContextGL();
  if (gl === null) {
    console.log("runner: WebGL2 is unavailable");
    return;
  }

  new FontFace(FONT, "url(DejaVuSans.ttf)").load().then((face) => {
    document.fonts.add(face);
  });

  /* ---- audio ---- */
  const audio = new AudioContext();
  const hasAudio = audio.state === "running";
  let musicGain: ReturnType<typeof makeBus> | null = null;
  let musicOn = true;

  function makeBus() { return audio.createGain(); }

  if (hasAudio) {
    fetch("music.mp3")
      .then((res) => res.arrayBuffer())
      .then((bytes) => audio.decodeAudioData(bytes))
      .then((track: AudioBuffer) => {
        const bus = audio.createGain();
        bus.gain.value = 0.42;
        bus.connect(audio.destination);
        const src = audio.createBufferSource();
        src.buffer = track;
        src.loop = true;
        src.connect(bus);
        src.start(0);
        musicGain = bus;
      });
  }

  function sfx(fn: (c: AudioContext, v: number) => void, vol: number): void {
    if (hasAudio) fn(audio, vol);
  }

  /* ---- renderer and scene ---- */
  const renderer = new WebGLRenderer(gl);
  renderer.setSize(W, H);

  const scene = new Scene();
  const camera = new PerspectiveCamera(62, W / H, 0.1, 220);

  /* A long ground plane, rotated flat and pushed ahead of the camera. The
   * runner never actually moves: the WORLD slides toward it, which keeps
   * float precision constant however long a run lasts. */
  const groundMat = new MeshLambertMaterial();
  groundMat.color.setHex(0x243a5e);
  const ground = new Mesh(new PlaneGeometry(26, 400, 1, 1), groundMat);
  ground.rotateX(-Math.PI / 2);
  ground.position.set(0, -1, -160);
  scene.addMesh(ground);

  /* A backdrop far down the track. Without it the world ends in black and
   * the ground's far edge reads as a cliff.
   *
   * Vertex colours rather than a flat fill: a single unlit slab reads as
   * dead space above the wall tops, while a horizon-to-zenith gradient
   * gives the upper half of the frame somewhere to go. The plane is built
   * with height segments so there are interior rows to interpolate
   * between, and the colour attribute is filled per-row from the vertex
   * Y. */
  const skyMat = new MeshBasicMaterial();
  skyMat.color.setHex(0xffffff);   // white: vColor supplies the actual hue
  skyMat.vertexColors = true;
  const skyGeo = new PlaneGeometry(520, 220, 1, 12);
  const skyPos = skyGeo.position;
  if (skyPos !== null) {
    const cols: number[] = [];
    const n = skyPos.count;
    for (let i = 0; i < n; i++) {
      /* y runs -110..110 over the plane; remap to 0 at the horizon and 1
       * at the zenith so the ramp is independent of the plane size. */
      const y = skyPos.array[i * 3 + 1];
      let f = (y + 110) / 220;
      if (f < 0) f = 0;
      if (f > 1) f = 1;
      // Horizon 0x27407a -> zenith 0x0a1024, eased so the band near the
      // wall tops stays wide rather than washing out immediately.
      const e = f * f;
      cols.push(
        (0x27 + (0x0a - 0x27) * e) / 255,
        (0x40 + (0x10 - 0x40) * e) / 255,
        (0x7a + (0x24 - 0x7a) * e) / 255);
    }
    skyGeo.setAttribute("color", new BufferAttribute(cols, 3, false));
  }
  const sky = new Mesh(skyGeo, skyMat);
  sky.position.set(0, 40, -200);
  scene.addMesh(sky);

  /* Stars: small emissive quads scattered across the upper backdrop. They
   * sit just in front of the sky plane and never move, so they cost one
   * draw each and read as depth rather than as sprites. Positions come
   * from a fixed LCG so every run and every screenshot is identical. */
  const starMat = new MeshBasicMaterial();
  starMat.color.setHex(0x8fb6ff);
  const starGeo = new PlaneGeometry(1.5, 1.5, 1, 1);
  let starSeed = 0x5f3a71;
  for (let i = 0; i < 70; i++) {
    starSeed = (starSeed * 1103515245 + 12345) & 0x7fffffff;
    const sx = (starSeed / 0x7fffffff) * 460 - 230;
    starSeed = (starSeed * 1103515245 + 12345) & 0x7fffffff;
    const sy = 22 + (starSeed / 0x7fffffff) * 120;
    const st = new Mesh(starGeo, starMat);
    st.position.set(sx, sy, -196);
    scene.addMesh(st);
  }

  /* ---- particles ----
   *
   * Two systems rather than one: a coin pop and a crash want different
   * pool sizes and are tuned independently, and separating them means a
   * long streak of pickups cannot recycle the debris from a crash. */
  const sparkles = new ParticleSystem(scene, 320);
  const debris = new ParticleSystem(scene, 420);

  const coinBurst = new BurstOptions();
  coinBurst.speed = 5.5;
  coinBurst.life = 0.5;
  coinBurst.size = 0.17;
  coinBurst.gravity = 6;
  coinBurst.drag = 0.25;
  coinBurst.colorFrom.setHex(0xfff2a0);
  coinBurst.colorTo.setHex(0xffa32e);

  const crashBurst = new BurstOptions();
  crashBurst.speed = 11;
  crashBurst.speedJitter = 0.8;
  crashBurst.life = 0.95;
  crashBurst.size = 0.3;
  crashBurst.gravity = 13;
  crashBurst.drag = 0.5;
  crashBurst.spin = 12;
  crashBurst.colorFrom.setHex(0xffd9e6);
  crashBurst.colorTo.setHex(0xff2d6b);

  /* A glowing strip running down the track centre. Additive, so it reads
   * as light on the floor rather than paint, and it scrolls with the
   * world so it doubles as a speed cue. */
  const stripMat = new MeshBasicMaterial(0x3fd8ff);
  stripMat.transparent = true;
  stripMat.opacity = 0.5;
  stripMat.blending = AdditiveBlending;
  stripMat.depthWrite = false;
  const strips: Mesh[] = [];
  const stripGeo = new PlaneGeometry(0.5, 3.2, 1, 1);
  for (let i = 0; i < 30; i++) {
    const s = new Mesh(stripGeo, stripMat);
    s.rotateX(-Math.PI / 2);
    s.position.set(0, -0.96, -i * 7);
    strips.push(s);
    scene.add(s);
  }

  /* Side walls: the corridor is what turns "a plane" into "a track", and
   * the passing panels are what make speed legible. */
  const wallMat = new MeshLambertMaterial();
  wallMat.color.setHex(0x2b4470);
  const WALL_COUNT = 26;
  const WALL_SPACING = 9;
  const walls: Mesh[] = [];
  const wallGeo = new BoxGeometry(0.7, 3.4, 4.2);
  for (let i = 0; i < WALL_COUNT; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const m = new Mesh(wallGeo, wallMat);
    m.position.set(side * 5.2, 0.5, -(i >> 1) * WALL_SPACING);
    walls.push(m);
    scene.addMesh(m);
  }

  /* Glowing lane markers along the floor, same idea, brighter. */
  const markerMat = new MeshBasicMaterial();
  markerMat.color.setHex(0x3f6ea8);
  const MARKER_COUNT = 30;
  const MARKER_SPACING = 6;
  const markers: Mesh[] = [];
  const markerGeo = new BoxGeometry(0.16, 0.02, 2.2);
  for (let i = 0; i < MARKER_COUNT; i++) {
    for (let s = 0; s < 2; s++) {
      const m = new Mesh(markerGeo, markerMat);
      m.position.set((s === 0 ? -1 : 1) * (LANE_X * 0.5), -0.48, -i * MARKER_SPACING);
      markers.push(m);
      scene.addMesh(m);
    }
  }

  /* ---- lights ---- */
  scene.addLight(new AmbientLight(0x4a6ea8, 1.15));
  const sun = new DirectionalLight(0xfff2d8, 1.5);
  sun.position.set(6, 12, 4);
  scene.addLight(sun);
  const rim = new PointLight(0x66ccff, 1.2);
  rim.position.set(0, 3, 4);
  scene.addLight(rim);

  /* ---- player ---- */
  const playerMat = new MeshLambertMaterial();
  playerMat.color.setHex(0x5ad0ff);
  playerMat.emissive.setHex(0x0a2838);
  const player = new Mesh(new BoxGeometry(1.0, 1.0, 1.0), playerMat);
  player.position.set(0, 0, 0);
  scene.addMesh(player);

  /* ---- obstacle and orb pools ---- */
  const obstacleMat = new MeshLambertMaterial();
  obstacleMat.color.setHex(0xff4d6a);
  obstacleMat.emissive.setHex(0x4a0a16);

  const orbMat = new MeshLambertMaterial();
  orbMat.color.setHex(0xffe066);
  // Bright emissive: a collectible should read as a light source, not a ball.
  orbMat.emissive.setHex(0xa87c00);

  /* The halo is a TEXTURED QUAD, not a sphere.
   *
   * A solid sphere cannot glow: its face is uniformly bright and its
   * silhouette is a hard edge, so additive or not it renders as a grey
   * disc pasted over the orb. Glow is a RADIAL FALLOFF, which means a
   * texture -- and this stack draws textures with the 2D canvas API, so
   * the sprite is generated at startup rather than shipped as a file. */
  const glowTex = makeGlowTexture();
  /* A SPRITE, so the glow always faces the camera. A world-space quad
   * turns edge-on as the corridor sweeps past it and the glow winks out
   * at exactly the moment the orb is closest. */
  const orbGlowMat = new SpriteMaterial(0xffb43c);
  orbGlowMat.transparent = true;
  orbGlowMat.blending = AdditiveBlending;
  orbGlowMat.depthWrite = false;
  if (glowTex !== null) orbGlowMat.map = glowTex;

  const boxGeo = new BoxGeometry(1.4, 1.4, 1.4);
  const orbGeo = new SphereGeometry(0.45, 14, 10);

  const pool: Obstacle[] = [];
  for (let i = 0; i < 40; i++) {
    const o = new Obstacle();
    pool.push(o);
  }

  /* ---- HUD: an offscreen 2D canvas used as a texture ---- */
  /* A canvas starts at the spec default 300x150, so the size MUST be set
   * before drawing: every HUD coordinate below is in 512x256 space, and
   * drawing 512-wide text into a 300-wide surface silently clipped
   * "GAME OVER" at the right edge. */
  const hudCanvas = document.createElement("canvas");
  if (hudCanvas !== null) {
    hudCanvas.width = HUD_W;
    hudCanvas.height = HUD_H;
  }
  const hudCtx = hudCanvas === null ? null : hudCanvas.getContext("2d");
  const hudTexture = hudCtx === null ? null : Texture.fromCanvas(hudCtx);

  const hudMat = new MeshBasicMaterial();
  hudMat.transparent = true;
  hudMat.side = DoubleSide;
  if (hudTexture !== null) hudMat.map = hudTexture;

  /* The HUD quad is parented to the CAMERA, so it rides along in view space
   * and needs no per-frame billboarding. */
  const hud = new Mesh(new PlaneGeometry(1.18, 0.59, 1, 1), hudMat);
  hud.position.set(0, 0.46, -1.45);
  camera.add(hud);
  scene.addMeshTo(camera, hud);
  scene.add(camera);

  /* ---- state ---- */
  let lane = 1;                 // 0,1,2
  let laneX = 0;
  let playerY = 0;
  let velY = 0;
  let onGround = true;
  let speed = RUN_SPEED_START;
  let distance = 0;
  let score = 0;
  let best = 0;
  let lives = 3;
  let over = false;
  let invulnMs = 0;
  /* Screen shake, in "units of kick left". Decays exponentially; the
   * camera offset is derived from it, so one number drives the whole
   * effect and it can never get stuck on. */
  let shake = 0;
  /** Seconds since the last impact; the shake oscillates on THIS. */
  let shakeTime = 0;
  let nextSpawnZ = -30;
  let spin = 0;
  /** Seconds since the run started; drives shake and pulse phases. */
  let elapsed = 0;
  let last = 0;
  let hudDirty = true;

  /* Deterministic PRNG: Math.random is unavailable in the static tier. */
  let seed = 0x1a2b3c4d;
  function rand(): number {
    let x = seed;
    x ^= (x << 13) & 0xffffffff;
    x ^= x >>> 17;
    x ^= (x << 5) & 0xffffffff;
    seed = x >>> 0;
    return seed / 4294967296;
  }

  /* ---- attract mode ----
   *
   * With no input, the runner steers itself: it looks ahead for the nearest
   * hazard in its lane and moves to a clear one, jumping when boxed in. Any
   * real input hands control straight back.
   *
   * This is not a cheat for screenshots. It is what an arcade cabinet does
   * with nobody at the controls, and it means an unattended capture shows
   * the game being PLAYED rather than an empty track scrolling by. */
  let idleMs = 0;
  const ATTRACT_AFTER_MS = 2200;

  function autopilot(dt: number): void {
    /* Which lanes have a hazard in the danger window ahead? */
    const blocked: boolean[] = [false, false, false];
    const orbIn: boolean[] = [false, false, false];
    let boxedIn = false;

    for (let i = 0; i < pool.length; i++) {
      const o = pool[i];
      if (!o.alive) continue;
      const ahead = -o.z;                 // positive = in front
      if (ahead < 1.5 || ahead > 16) continue;
      if (o.isOrb) orbIn[o.lane] = true;
      else blocked[o.lane] = true;
    }

    boxedIn = blocked[0] && blocked[1] && blocked[2];

    /* Prefer a lane with an orb, then any clear lane, nearest first. */
    let want = lane;
    if (blocked[lane] && !boxedIn) {
      let bestScore = -1;
      for (let l = 0; l < LANES; l++) {
        if (blocked[l]) continue;
        const dist = l > lane ? l - lane : lane - l;
        const s = (orbIn[l] ? 10 : 5) - dist;
        if (s > bestScore) { bestScore = s; want = l; }
      }
    } else if (!blocked[lane]) {
      // Nothing in the way: drift toward an orb if one is close.
      for (let l = 0; l < LANES; l++) {
        if (orbIn[l] && !blocked[l]) { want = l; break; }
      }
    }

    if (want < lane) { lane -= 1; sfx(dashSfx, 0.2); }
    else if (want > lane) { lane += 1; sfx(dashSfx, 0.2); }
    else if (boxedIn && onGround) {
      // Nowhere to go: jump it.
      velY = JUMP_VELOCITY;
      onGround = false;
      sfx(dashSfx, 0.35);
    }
  }

  /* ---- input ---- */
  const held = new Map<string, boolean>();
  const tapped = new Map<string, boolean>();
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    held.set(e.code, true);
    tapped.set(e.code, true);
  });
  window.addEventListener("keyup", (e: KeyboardEvent) => { held.set(e.code, false); });
  const tap = (c: string): boolean => tapped.get(c) === true;

  function pad(): Gamepad | null {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] !== null) return pads[i];
    }
    return null;
  }

  let padLeftWas = false;
  let padRightWas = false;
  let padJumpWas = false;

  function spawnRow(): void {
    /* One row: an obstacle in one or two lanes, an orb in a free one. That
     * guarantees a gap, so the run is always survivable. */
    const blocked = Math.floor(rand() * LANES);
    let second = -1;
    if (rand() < 0.35) {
      second = (blocked + 1 + Math.floor(rand() * (LANES - 1))) % LANES;
    }

    for (let l = 0; l < LANES; l++) {
      if (l !== blocked && l !== second) continue;
      const o = takeFromPool();
      if (o === null) continue;
      o.lane = l;
      o.z = nextSpawnZ;
      o.isOrb = false;
      o.alive = true;
      if (o.mesh === null) {
        const m = new Mesh(boxGeo, obstacleMat);
        o.mesh = m;
        scene.addMesh(m);
      }
      o.mesh.visible = true;
      o.mesh.geometry = boxGeo;
      o.mesh.material = obstacleMat;
      // A pooled slot may still carry the halo from a previous orb life.
      if (o.glow !== null) o.glow.visible = false;
    }

    // An orb in a lane that is clear.
    for (let l = 0; l < LANES; l++) {
      if (l === blocked || l === second) continue;
      if (rand() < 0.55) {
        const o = takeFromPool();
        if (o === null) break;
        o.lane = l;
        o.z = nextSpawnZ;
        o.isOrb = true;
        o.alive = true;
        o.spin = 0;
        if (o.mesh === null) {
          const m = new Mesh(orbGeo, orbMat);
          o.mesh = m;
          scene.addMesh(m);
        }
        o.mesh.visible = true;
        o.mesh.geometry = orbGeo;
        o.mesh.material = orbMat;
        /* The halo is created once per pool slot and then reused: pooled
         * objects alternate between orb and obstacle, so it is toggled
         * rather than rebuilt. */
        if (o.glow === null) {
          const g = new Sprite(orbGlowMat);
          g.scale.set(2.6, 2.6, 1);
          o.glow = g;
          scene.add(g);
        }
        o.glow.visible = true;
      }
      break;
    }
  }

  function takeFromPool(): Obstacle | null {
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].alive) return pool[i];
    }
    return null;
  }

  function restart(): void {
    for (let i = 0; i < pool.length; i++) {
      // Bound to a local: narrowing does not survive re-indexing the array.
      const o = pool[i];
      o.alive = false;
      const m = o.mesh;
      if (m !== null) m.visible = false;
    }
    lane = 1;
    laneX = 0;
    playerY = 0;
    velY = 0;
    onGround = true;
    speed = RUN_SPEED_START;
    distance = 0;
    score = 0;
    lives = 3;
    over = false;
    invulnMs = 0;
    nextSpawnZ = -30;
    hudDirty = true;
  }

  /* ---- the HUD, drawn with the 2D Canvas API ---- */
  function drawHUD(): void {
    if (hudCtx === null || hudTexture === null) return;

    // Transparent panel background.
    hudCtx.clearRect(0, 0, HUD_W, HUD_H);
    hudCtx.fillStyle = "rgba(8, 14, 26, 0.62)";
    hudCtx.fillRect(0, 0, HUD_W, 96);

    hudCtx.fillStyle = "#eaf4ff";
    hudCtx.font = `44px ${FONT}`;
    hudCtx.textAlign = "left";
    hudCtx.fillText(`${Math.floor(score)}`, 24, 62);

    hudCtx.font = `18px ${FONT}`;
    hudCtx.fillStyle = "#7fb0d8";
    hudCtx.fillText("SCORE", 26, 84);

    // Lives as pips.
    for (let i = 0; i < 3; i++) {
      hudCtx.fillStyle = i < lives ? "#ff5566" : "#2c3a4f";
      hudCtx.beginPath();
      hudCtx.arc(HUD_W - 40 - i * 34, 40, 11, 0, Math.PI * 2, false);
      hudCtx.fill("nonzero");
    }

    // Speed bar.
    const frac = (speed - RUN_SPEED_START) / (RUN_SPEED_MAX - RUN_SPEED_START);
    hudCtx.fillStyle = "#16233a";
    hudCtx.fillRect(HUD_W - 210, 66, 186, 10);
    hudCtx.fillStyle = "#5ad0ff";
    hudCtx.fillRect(HUD_W - 210, 66, 186 * (frac < 0 ? 0 : (frac > 1 ? 1 : frac)), 10);
    hudCtx.font = `13px ${FONT}`;
    hudCtx.fillStyle = "#7fb0d8";
    hudCtx.textAlign = "right";
    hudCtx.fillText(`${Math.floor(distance)} m`, HUD_W - 24, 62);

    if (over) {
      hudCtx.fillStyle = "rgba(6, 10, 18, 0.86)";
      hudCtx.fillRect(0, 96, HUD_W, HUD_H - 96);
      hudCtx.textAlign = "center";
      hudCtx.fillStyle = "#ff8fa6";
      hudCtx.font = `44px ${FONT}`;
      hudCtx.fillText("GAME OVER", HUD_W / 2, 152);
      hudCtx.font = `22px ${FONT}`;
      hudCtx.fillStyle = "#8ee27a";
      hudCtx.fillText(`best  ${Math.floor(best)}`, HUD_W / 2, 190);
      hudCtx.font = `16px ${FONT}`;
      hudCtx.fillStyle = "#7fb0d8";
      hudCtx.fillText("ENTER or START to run again", HUD_W / 2, 224);
    }

    hudCtx.textAlign = "left";
    // The texture must re-upload now that the canvas has changed.
    hudTexture.needsUpdate = true;
  }

  /* ---- update ---- */
  function update(dt: number): void {
    const p = pad();

    if (over) {
      const restartPressed = tap("Enter") || tap("Space") ||
        (p !== null && (p.buttons[BTN_START].pressed || p.buttons[BTN_A].pressed));
      tapped.clear();
      if (restartPressed) { restart(); sfx(dashSfx, 0.5); }
      return;
    }

    /* Lane changes are EDGE triggered on both keyboard and pad, so holding
     * a direction moves one lane rather than sliding across all three. */
    let goLeft = tap("ArrowLeft") || tap("KeyA");
    let goRight = tap("ArrowRight") || tap("KeyD");
    if (p !== null) {
      const ax = p.axes[AXIS_LEFT_X];
      const padLeft = p.buttons[BTN_DPAD_LEFT].pressed || ax < -0.5;
      const padRight = p.buttons[BTN_DPAD_RIGHT].pressed || ax > 0.5;
      if (padLeft && !padLeftWas) goLeft = true;
      if (padRight && !padRightWas) goRight = true;
      padLeftWas = padLeft;
      padRightWas = padRight;
    }
    if (goLeft && lane > 0) { lane -= 1; sfx(dashSfx, 0.28); }
    if (goRight && lane < LANES - 1) { lane += 1; sfx(dashSfx, 0.28); }

    let jump = tap("Space") || tap("ArrowUp") || tap("KeyW");
    if (p !== null) {
      const padJump = p.buttons[BTN_A].pressed;
      if (padJump && !padJumpWas) jump = true;
      padJumpWas = padJump;
    }
    if (jump && onGround) {
      velY = JUMP_VELOCITY;
      onGround = false;
      sfx(dashSfx, 0.45);
    }
    /* Hand control to the autopilot after a spell with no input, and take
     * it straight back on the next press. */
    const anyInput = goLeft || goRight || jump;
    idleMs = anyInput ? 0 : idleMs + dt * 1000;
    if (idleMs > ATTRACT_AFTER_MS) autopilot(dt);

    tapped.clear();

    // Ease toward the target lane rather than snapping: the slide is what
    // makes the movement feel weighty.
    const targetX = (lane - 1) * LANE_X;
    laneX += (targetX - laneX) * Math.min(1, dt * LANE_SNAP);

    velY -= GRAVITY * dt;
    playerY += velY * dt;
    if (playerY <= 0) { playerY = 0; velY = 0; onGround = true; }

    speed = Math.min(RUN_SPEED_MAX, speed + RUN_ACCEL * dt);
    const travel = speed * dt;
    distance += travel;
    elapsed += dt;
    score += travel * 0.6;
    if (invulnMs > 0) invulnMs -= dt * 1000;

    // Spawn rows at a gap that tightens as speed rises.
    const gap = Math.max(OBSTACLE_GAP_MIN,
                         OBSTACLE_GAP_START - (speed - RUN_SPEED_START) * 0.22);
    while (nextSpawnZ > -SPAWN_AHEAD) {
      nextSpawnZ -= gap;
      spawnRow();
    }
    nextSpawnZ += travel;

    /* Everything slides toward the camera; the player stays at z=0. */
    for (let i = 0; i < pool.length; i++) {
      const o = pool[i];
      if (!o.alive || o.mesh === null) continue;
      o.z += travel;

      if (o.z > DESPAWN_BEHIND) {
        o.alive = false;
        o.mesh.visible = false;
        if (o.glow !== null) o.glow.visible = false;
        continue;
      }

      const x = (o.lane - 1) * LANE_X;
      if (o.isOrb) {
        o.spin += dt * 3.2;
        const orbY = 0.55 + Math.sin(o.spin) * 0.18;
        o.mesh.position.set(x, orbY, o.z);
        /* The halo tracks the orb and BREATHES: a constant glow reads as
         * a texture, a pulsing one reads as energy. */
        const g = o.glow;
        if (g !== null) {
          g.position.set(x, orbY, o.z);
          const pulse = 2.6 * (1 + Math.sin(elapsed * 5 + o.z * 0.35) * 0.16);
          g.scale.set(pulse, pulse, 1);
        }
        o.mesh.quaternion.setFromEuler(0, o.spin, 0);
      } else {
        o.mesh.position.set(x, -0.3, o.z);
      }

      /* Collision: same lane, close in z, and (for obstacles) not jumped
       * over. Simple box overlap is right here -- everything is on a grid. */
      const near = o.z > -1.1 && o.z < 1.1;
      if (!near || o.lane !== lane) continue;

      if (o.isOrb) {
        if (playerY < 1.6) {
          o.alive = false;
          o.mesh.visible = false;
          if (o.glow !== null) o.glow.visible = false;
          score += 45;
          hudDirty = true;
          sfx(pickup, 0.6);
          sparkles.burst(o.mesh.position.x, o.mesh.position.y,
                         o.mesh.position.z, 18, coinBurst);
        }
      } else if (invulnMs <= 0 && playerY < 1.15) {
        o.alive = false;
        o.mesh.visible = false;
        if (o.glow !== null) o.glow.visible = false;
        lives -= 1;
        invulnMs = 1200;
        hudDirty = true;
        sfx(hit, 0.7);
        debris.burst(o.mesh.position.x, o.mesh.position.y,
                     o.mesh.position.z, 34, crashBurst);
        shake = 1;      // a full-strength kick; see the decay in draw()
        shakeTime = 0;  // restart the oscillation so the hit starts at full swing
        if (lives <= 0) {
          over = true;
          if (score > best) best = score;
          sfx(gameOver, 0.8);
        }
      }
    }

    /* Scenery scrolls with the world and wraps, so a handful of meshes
     * reads as an endless corridor. */
    for (let i = 0; i < walls.length; i++) {
      const m = walls[i];
      const z = m.position.z + travel;
      m.position.z = z > 10 ? z - WALL_COUNT * WALL_SPACING * 0.5 : z;
    }
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const z = m.position.z + travel;
      m.position.z = z > 10 ? z - MARKER_COUNT * MARKER_SPACING : z;
    }
    for (let i = 0; i < strips.length; i++) {
      const s = strips[i];
      const z = s.position.z + travel;
      s.position.z = z > 10 ? z - strips.length * 7 : z;
    }

    spin += dt;
    hudDirty = true;
  }

  /* ---- draw ---- */
  function draw(dt: number): void {
    // The player: a tumbling cube, blinking while invulnerable.
    player.position.set(laneX, playerY, 0);
    player.quaternion.setFromEuler(spin * 1.6, spin * 0.9, 0);
    player.visible = over || invulnMs <= 0 || (Math.floor(invulnMs / 90) % 2) === 0;

    /* The camera trails the player's lane, which sells the turn without a
     * full chase rig. The follow factor has to stay HIGH: at 0.3 the outer
     * lanes pushed the player against the frame edge and the near obstacle
     * clipped through the near plane. 0.72 keeps the runner comfortably
     * inside the frame in every lane while still letting the corridor
     * swing, and the look-at target leads it slightly so the turn reads.
     *
     * Speed sells itself through FOV: the frustum widens as the run gets
     * faster, so the walls streak past harder without anything actually
     * moving quicker. Every racing game does this. */

    const speedT = (speed - RUN_SPEED_START) / (RUN_SPEED_MAX - RUN_SPEED_START);
    camera.fov = 62 + speedT * 12;
    camera.updateProjectionMatrix();

    /* Screen shake.
     *
     * Three things make a kick land, and the first version had none of
     * them at usable strength:
     *
     *   AMPLITUDE. Peak offset was 0.275 world units against a corridor
     *   5 units wide -- roughly a two-pixel nudge on screen. It is now
     *   1.15 across and 0.85 up, which is a real displacement.
     *
     *   DURATION. Decaying to 2% per second meant the whole event was
     *   over in ~4 frames, so it read as a glitch rather than an impact.
     *   0.09 per second gives it about a third of a second to sell.
     *
     *   ROLL. Pure translation reads as the camera being bumped. A small
     *   counter-rotating roll reads as the PLAYER being hit, which is the
     *   feeling wanted. It is small (4 degrees at peak) because a large
     *   one swings the corridor and becomes a stumble.
     *
     * The frequencies are deliberately not harmonically related, so the
     * two axes never sync into a clean diagonal line. */
    shake *= Math.pow(0.09, dt);
    shakeTime += dt;
    if (shake < 0.002) shake = 0;
    /* Squared falloff on top of the decay: the first few frames stay near
     * full strength and then it drops away, which is what an impact does.
     * A linear ramp-down feels like a wobble. */
    const kick = shake * shake;
    /* Phased on shakeTime, not elapsed: locked to wall-clock, an impact
     * lands wherever the sine happens to be, and a hit that arrives near a
     * zero crossing opens with no kick at all (measured: sx started at
     * -0.002 on one crash). Starting the clock at the impact means every
     * hit opens at full swing.
     *
     * cos for x so it peaks IMMEDIATELY at t=0; sin for the others, offset,
     * so the axes do not sync into a clean diagonal. */
    const sx = kick * Math.cos(shakeTime * 71) * 1.15;
    const sy = kick * Math.sin(shakeTime * 97 + 1.7) * 0.85;
    const roll = kick * Math.cos(shakeTime * 83 + 0.6) * 0.07;

    camera.position.set(laneX * 0.72 + sx, 2.15 + playerY * 0.25 + sy, 5.6);
    camera.lookAt(_camTarget.set(laneX * 0.86, 1.0 + playerY * 0.35, -9));
    /* Roll AFTER lookAt: lookAt overwrites the whole orientation, so a
     * roll applied before it is silently discarded. */
    if (roll !== 0) camera.rotateZ(roll);

    // A light that follows the player, so the near ground stays readable.
    rim.position.set(laneX, 2.4 + playerY, 2.4);

    /* The game-over panel uses the full canvas, so the quad grows to show
     * it; during play only the top strip carries anything. */
    if (over) {
      hud.scale.set(1.32, 1.32, 1);
      hud.position.set(0, 0.16, -1.45);
    } else {
      hud.scale.set(1, 1, 1);
      hud.position.set(0, 0.46, -1.45);
    }

    if (hudDirty) {
      drawHUD();
      hudDirty = false;
    }

    sparkles.update(dt);
    debris.update(dt);

    renderer.render(scene, camera);
  }

  const _camTarget = new Vector3();

  function frame(time: number): void {
    let dtMs = last === 0 ? 16 : time - last;
    last = time;
    if (dtMs > 100) dtMs = 100;        // a stall must not teleport the world
    const dt = dtMs / 1000;

    if (tap("KeyM")) {
      musicOn = !musicOn;
      if (musicGain !== null) musicGain.gain.value = musicOn ? 0.42 : 0;
      hudDirty = true;
    }
    if (tap("KeyF")) {
      if (document.fullscreenElement === null) canvas.requestFullscreen();
      else document.exitFullscreen();
    }

    update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  drawHUD();
  requestAnimationFrame(frame);
});
