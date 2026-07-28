/* orbits: a playable 3D arcade game.
 *
 * You pilot a ship around a central star, collecting energy motes and
 * avoiding mines. Thrust is real: you accelerate, the star pulls you in,
 * and staying alive means managing an orbit rather than steering directly.
 *
 * The second playable 3D example, and deliberately NOT another runner: it
 * covers the parts of threeTS-lite the runner does not.
 *
 *   Sprite         the ship, motes and mines are camera-facing billboards
 *                  with real textures, not boxes.
 *   InstancedMesh  the asteroid belt: 600 rocks in one draw call.
 *   Points         the starfield.
 *   Line           the orbit-prediction trail.
 *
 * Controls:
 *   arrows / WASD / left stick   thrust
 *   SPACE / gamepad A            boost (burns energy)
 *   ENTER / START                restart after a game over
 */
import {
  window, document, navigator, requestAnimationFrame, KeyboardEvent,
  AudioContext, FontFace, fetch, AudioBuffer, Image, Math, Gamepad,
  performance, MouseEvent,
} from "../../web/globals.js";
import { pickup, hit, dash as dashSfx, gameOver } from "../../engine/sfx.js";
import { Context2D } from "../../web/canvas/context.js";

import { Scene } from "../../three/core/Scene.js";
import { PerspectiveCamera } from "../../three/core/PerspectiveCamera.js";
import { Mesh } from "../../three/objects/Mesh.js";
import { InstancedMesh } from "../../three/objects/InstancedMesh.js";
import { Sprite, LineSegments, Points } from "../../three/objects/Sprite.js";
import { Raycaster } from "../../three/core/Raycaster.js";
import { BoxGeometry } from "../../three/geometries/BoxGeometry.js";
import { SphereGeometry } from "../../three/geometries/SphereGeometry.js";
import { BufferGeometry } from "../../three/core/BufferGeometry.js";
import { BufferAttribute } from "../../three/core/BufferAttribute.js";
import {
  MeshLambertMaterial, MeshBasicMaterial, SpriteMaterial,
  LineBasicMaterial, PointsMaterial,
} from "../../three/materials/Material.js";
import { AmbientLight, PointLight, DirectionalLight } from "../../three/lights/Light.js";
import { WebGLRenderer } from "../../three/renderer/WebGLRenderer.js";
import { Texture } from "../../three/textures/Texture.js";
import { Matrix4 } from "../../three/math/Matrix4.js";
import { Quaternion } from "../../three/math/Quaternion.js";
import { Vector3 } from "../../three/math/Vector3.js";
import { Color } from "../../three/math/Color.js";

/* ---- tuning ---- */
const STAR_PULL = 260;        // gravity constant; tuned for a playable orbit
const THRUST = 34;
const BOOST_THRUST = 78;
const MAX_SPEED = 30;
const DRAG = 0.06;            // a little, so the orbit decays without input
const SHIP_RADIUS = 1.1;
const MOTE_RADIUS = 1.0;
const MINE_RADIUS = 1.2;
const STAR_RADIUS = 3.4;
const ARENA = 46;             // soft boundary: past this you are pulled back
const MOTE_COUNT = 14;
const MINE_COUNT = 9;
const ROCK_COUNT = 600;
const START_LIVES = 3;
const BOOST_MAX = 100;
const HUD_W = 512;
const HUD_H = 256;
const FONT = "DejaVu Sans";

const BTN_A = 0;
const BTN_START = 9;
const AXIS_X = 0;
const AXIS_Y = 1;

class Mote {
  sprite: Sprite | null = null;
  texture: Texture | null = null;
  x = 0; y = 0; z = 0;
  alive = false;
  bob = 0;
}

class Mine {
  sprite: Sprite | null = null;
  /* An invisible box that follows the sprite, so the mine can be PICKED.
   * The Raycaster tests triangles, and a Sprite is a camera-facing quad
   * built in the vertex shader with no world-space geometry to hit -- so
   * pickable sprites need a collider. This is that collider: never
   * rendered, only raycast against. */
  collider: Mesh | null = null;
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0;
  alive = false;
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const W = canvas.width;
  const H = canvas.height;

  const gl = canvas.getContextGL();
  if (gl === null) {
    console.log("orbits: WebGL2 is unavailable");
    return;
  }

  new FontFace(FONT, "url(DejaVuSans.ttf)").load().then((face) => {
    document.fonts.add(face);
  });

  /* ---- audio ---- */
  const audio = new AudioContext();
  const hasAudio = audio.state === "running";

  if (hasAudio) {
    fetch("music.mp3")
      .then((res) => res.arrayBuffer())
      .then((bytes) => audio.decodeAudioData(bytes))
      .then((track: AudioBuffer) => {
        const bus = audio.createGain();
        bus.gain.value = 0.34;
        bus.connect(audio.destination);
        const src = audio.createBufferSource();
        src.buffer = track;
        src.loop = true;
        src.connect(bus);
        src.start(0);
      });
  }

  function sfx(fn: (c: AudioContext, v: number) => void, vol: number): void {
    if (hasAudio) fn(audio, vol);
  }

  /* ---- renderer ---- */
  const renderer = new WebGLRenderer(gl);
  renderer.setSize(W, H);
  renderer.setClearColor(0x05070f);

  const scene = new Scene();
  const camera = new PerspectiveCamera(58, W / H, 0.1, 400);

  scene.addLight(new AmbientLight(0x2a3450, 1));
  /* decay=1 (linear), NOT the physically-correct 2.
   *
   * Inverse-square is right for a real light in metres. Here the belt sits
   * 30-42 units from the star, where inverse-square gives an attenuation of
   * ~0.0008: the rocks render black unless the intensity runs into the
   * thousands, and anything close to the star then blows out. Linear decay
   * keeps the whole playfield readable, which is what `decay` is exposed
   * for. `distance` bounds the light so it stops at the arena edge. */
  const starLight = new PointLight(0xffd9a0, 26, 150, 1);
  starLight.position.set(0, 0, 0);
  scene.addLight(starLight);
  const key = new DirectionalLight(0x8fa8ff, 0.5);
  key.position.set(0.3, 1, 0.6);
  scene.addLight(key);

  /* ---- the star ---- */
  const starMat = new MeshBasicMaterial();
  starMat.color.setHex(0xffcf7a);
  const star = new Mesh(new SphereGeometry(STAR_RADIUS, 24, 16), starMat);
  scene.addMesh(star);

  const coronaMat = new MeshBasicMaterial();
  coronaMat.color.setHex(0xff9a3c);
  coronaMat.transparent = true;
  coronaMat.opacity = 0.22;
  const corona = new Mesh(new SphereGeometry(STAR_RADIUS * 1.7, 20, 12), coronaMat);
  scene.addMesh(corona);

  /* ---- starfield (Points) ---- */
  let seed = 0x51f2b3;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  scene.addPoints(makeStarfield(rand));

  /* ---- asteroid belt (InstancedMesh) ----
   *
   * 600 rocks in ONE draw call. They orbit as a rigid ring, so the whole
   * belt is a single matrix rebuild per frame rather than 600 objects. */
  const rockMat = new MeshLambertMaterial();
  rockMat.color.setHex(0xffffff);
  const belt = new InstancedMesh(new BoxGeometry(1, 1, 1), rockMat, ROCK_COUNT);
  const rockAngle: number[] = [];
  const rockRadius: number[] = [];
  const rockY: number[] = [];
  const rockSpin: number[] = [];
  const rockScale: number[] = [];
  const rockColor = new Color(0xffffff);
  for (let i = 0; i < ROCK_COUNT; i++) {
    rockAngle.push(rand() * Math.PI * 2);
    rockRadius.push(30 + rand() * 12);
    rockY.push((rand() - 0.5) * 5);
    rockSpin.push(0.3 + rand() * 1.4);
    rockScale.push(0.35 + rand() * 0.8);
    const g = 0.42 + rand() * 0.3;
    rockColor.setRGB(g * 1.05, g * 0.92, g * 0.8);
    belt.setColorAt(i, rockColor);
  }
  scene.addInstancedMesh(belt);

  /* ---- sprites: ship, motes, mines ----
   *
   * Textures come from the shared example assets, loaded as ordinary
   * Images. Sprites are camera-facing, so these read as real objects from
   * any angle without any per-frame orientation work in game code. */
  const shipTex = loadTexture("player.png");
  const mineTex = loadTexture("hazard.png");

  /* coin.png is a 64x16 SHEET: four 16x16 frames of a spin. Sampling the
   * whole image would squeeze all four onto one quad (they render as
   * slivers, which reads as a squashed sprite rather than an obvious
   * mistake). repeat=(0.25,1) selects one frame; the offset below steps
   * through them. Each mote gets its OWN Texture so they can animate out
   * of phase. */
  const MOTE_FRAMES = 4;

  const shipMat = new SpriteMaterial();
  shipMat.map = shipTex;
  shipMat.transparent = true;
  const ship = new Sprite(shipMat);
  ship.scale.set(2.6, 2.6, 1);
  scene.addSprite(ship);

  const motes: Mote[] = [];
  for (let i = 0; i < MOTE_COUNT; i++) {
    const m = new Mote();
    const mat = new SpriteMaterial();
    const tex = loadTexture("coin.png");
    tex.setRepeat(1 / MOTE_FRAMES, 1);
    mat.map = tex;
    m.texture = tex;
    mat.transparent = true;
    const sp = new Sprite(mat);
    sp.scale.set(1.9, 1.9, 1);
    m.sprite = sp;
    scene.addSprite(sp);
    motes.push(m);
  }

  /* Shared by every collider: never drawn, so its appearance is irrelevant
   * and one instance keeps the material count down. */
  const colliderMat = new MeshBasicMaterial();
  const colliders: Mesh[] = [];
  const mines: Mine[] = [];
  for (let i = 0; i < MINE_COUNT; i++) {
    const m = new Mine();
    const mat = new SpriteMaterial();
    mat.map = mineTex;
    mat.transparent = true;
    const sp = new Sprite(mat);
    sp.scale.set(2.3, 2.3, 1);
    m.sprite = sp;
    scene.addSprite(sp);

    /* The collider is added to the scene's mesh list but kept invisible:
     * the renderer skips it, the Raycaster still finds it. */
    const col = new Mesh(new BoxGeometry(2.2, 2.2, 2.2), colliderMat);
    col.visible = false;
    m.collider = col;
    scene.addMesh(col);
    colliders.push(col);

    mines.push(m);
  }

  /* ---- trail (Line) ----
   *
   * A prediction of where the ship is heading under gravity, which is what
   * makes the orbit playable rather than guesswork. */
  const TRAIL_STEPS = 48;
  const trailPos: number[] = [];
  const trailCol: number[] = [];
  const trailNrm: number[] = [];
  for (let i = 0; i < TRAIL_STEPS * 2; i++) {
    trailPos.push(0, 0, 0);
    trailNrm.push(0, 0, 1);
    const f = 1 - (i / (TRAIL_STEPS * 2));
    trailCol.push(0.35 * f, 0.75 * f, 1.0 * f);
  }
  const trailGeo = new BufferGeometry();
  const trailPosAttr = new BufferAttribute(trailPos, 3, false);
  trailGeo.setAttribute("position", trailPosAttr);
  trailGeo.setAttribute("normal", new BufferAttribute(trailNrm, 3, false));
  trailGeo.setAttribute("color", new BufferAttribute(trailCol, 3, false));
  const trailMat = new LineBasicMaterial();
  trailMat.vertexColors = true;
  trailMat.transparent = true;
  const trail = new LineSegments(trailGeo, trailMat);
  scene.addLine(trail);

  /* ---- HUD (2D canvas as a texture) ---- */
  const hudCanvas = document.createElement("canvas");
  if (hudCanvas !== null) {
    hudCanvas.width = HUD_W;      // the default is 300x150; see WEBGL-AND-3D.md
    hudCanvas.height = HUD_H;
  }
  const hudCtx = hudCanvas === null ? null : hudCanvas.getContext("2d");
  const hudTexture = hudCtx === null ? null : Texture.fromCanvas(hudCtx);
  const hudMat = new MeshBasicMaterial();
  hudMat.transparent = true;
  if (hudTexture !== null) hudMat.map = hudTexture;
  const hud = new Mesh(new BoxGeometry(0, 0, 0), hudMat);
  scene.addMesh(hud);
  buildHudQuad(hud);

  /* ---- state ---- */
  let shipX = 22;
  let shipY = 0;
  let shipVX = 0;
  let shipVY = 11;
  let lives = START_LIVES;
  let score = 0;
  let best = 0;
  let boost = BOOST_MAX;
  let invuln = 0;
  let over = false;
  let beltAngle = 0;
  let elapsed = 0;

  const keys: string[] = [];
  const scratch = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3(1, 1, 1);
  const axis = new Vector3(0.3, 1, 0.2);
  const camTarget = new Vector3();

  function keyDown(name: string): boolean { return keys.indexOf(name) >= 0; }

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (keys.indexOf(e.key) < 0) keys.push(e.key);
    if ((e.key === "Enter") && over) restart();
  });
  /* Click a mine to detonate it: the Raycaster in a real game.
   *
   * The mouse position is converted to NORMALISED DEVICE coordinates
   * (-1..1, +y UP, hence the flip on y) exactly as in three, then
   * setFromCamera builds the world ray. */
  const picker = new Raycaster();
  window.addEventListener("mousedown", (e: MouseEvent) => {
    if (over) return;
    const ndcX = (e.clientX / W) * 2 - 1;
    const ndcY = -(e.clientY / H) * 2 + 1;
    picker.setFromCamera(ndcX, ndcY, camera);
    /* firstHitOnly: this only needs to know WHAT was clicked, not the full
     * sorted list, so the triangle loop can stop at the first hit. */
    picker.firstHitOnly = true;
    const picked = picker.intersectObjects(colliders);
    if (picked.length === 0) return;
    for (let i = 0; i < mines.length; i++) {
      const m = mines[i];
      if (!m.alive || m.collider !== picked[0].object) continue;
      spawnMine(m);
      score += 5;
      sfx(pickup, 0.4);
      break;
    }
  });

  window.addEventListener("keyup", (e: KeyboardEvent) => {
    const i = keys.indexOf(e.key);
    if (i >= 0) keys.splice(i, 1);
  });

  function spawnMote(m: Mote): void {
    const a = rand() * Math.PI * 2;
    const r = 10 + rand() * 26;
    m.x = Math.cos(a) * r;
    m.y = Math.sin(a) * r;
    m.z = (rand() - 0.5) * 6;
    m.bob = rand() * Math.PI * 2;
    m.alive = true;
  }

  function spawnMine(m: Mine): void {
    const a = rand() * Math.PI * 2;
    const r = 16 + rand() * 26;
    m.x = Math.cos(a) * r;
    m.y = Math.sin(a) * r;
    m.z = (rand() - 0.5) * 4;
    // Drifting perpendicular to the radius: a lazy retrograde orbit.
    m.vx = Math.sin(a) * (2 + rand() * 3);
    m.vy = -Math.cos(a) * (2 + rand() * 3);
    m.alive = true;
  }

  for (let i = 0; i < motes.length; i++) spawnMote(motes[i]);
  for (let i = 0; i < mines.length; i++) spawnMine(mines[i]);

  function restart(): void {
    shipX = 22; shipY = 0; shipVX = 0; shipVY = 11;
    lives = START_LIVES; score = 0; boost = BOOST_MAX;
    invuln = 0; over = false;
    for (let i = 0; i < motes.length; i++) spawnMote(motes[i]);
    for (let i = 0; i < mines.length; i++) spawnMine(mines[i]);
  }

  function die(): void {
    lives -= 1;
    invuln = 1600;
    sfx(hit, 0.5);
    shipVX *= 0.2;
    shipVY *= 0.2;
    if (lives <= 0) {
      over = true;
      if (score > best) best = score;
      sfx(gameOver, 0.5);
    }
  }

  let last = performance.now();

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;

    /* ---- input ---- */
    let ax = 0;
    let ay = 0;
    let boosting = false;

    if (keyDown("ArrowLeft") || keyDown("a") || keyDown("A")) ax -= 1;
    if (keyDown("ArrowRight") || keyDown("d") || keyDown("D")) ax += 1;
    if (keyDown("ArrowUp") || keyDown("w") || keyDown("W")) ay += 1;
    if (keyDown("ArrowDown") || keyDown("s") || keyDown("S")) ay -= 1;
    if (keyDown(" ")) boosting = true;

    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad === null) continue;
      const hx = pad.axes[AXIS_X];
      const hy = pad.axes[AXIS_Y];
      if (hx > 0.2 || hx < -0.2) ax += hx;
      if (hy > 0.2 || hy < -0.2) ay -= hy;
      if (pad.buttons[BTN_A].pressed) boosting = true;
      if (pad.buttons[BTN_START].pressed && over) restart();
      break;
    }

    if (!over) {
      /* ---- physics ----
       *
       * Gravity toward the star plus thrust. Inverse-square would make the
       * playfield unforgiving near the centre, so the pull is inverse-
       * LINEAR with a floor: still a real orbit, but recoverable. */
      const distSq = shipX * shipX + shipY * shipY;
      const dist = Math.sqrt(distSq);
      const safe = Math.max(STAR_RADIUS * 1.6, dist);
      const pull = STAR_PULL / (safe * safe);
      shipVX -= (shipX / safe) * pull * dt;
      shipVY -= (shipY / safe) * pull * dt;

      const alen = Math.sqrt(ax * ax + ay * ay);
      if (alen > 0.001) {
        let power = THRUST;
        if (boosting && boost > 0) {
          power = BOOST_THRUST;
          boost = Math.max(0, boost - 46 * dt);
          if (boost > 0 && Math.floor(elapsed * 8) % 2 === 0) sfx(dashSfx, 0.13);
        }
        shipVX += (ax / alen) * power * dt;
        shipVY += (ay / alen) * power * dt;
      }
      if (!boosting) boost = Math.min(BOOST_MAX, boost + 17 * dt);

      shipVX -= shipVX * DRAG * dt;
      shipVY -= shipVY * DRAG * dt;

      const sp = Math.sqrt(shipVX * shipVX + shipVY * shipVY);
      if (sp > MAX_SPEED) {
        shipVX = (shipVX / sp) * MAX_SPEED;
        shipVY = (shipVY / sp) * MAX_SPEED;
      }

      shipX += shipVX * dt;
      shipY += shipVY * dt;

      // Soft arena boundary: pulled back rather than stopped dead.
      const rr = Math.sqrt(shipX * shipX + shipY * shipY);
      if (rr > ARENA) {
        shipVX -= (shipX / rr) * 60 * dt;
        shipVY -= (shipY / rr) * 60 * dt;
      }

      if (invuln > 0) invuln -= dt * 1000;

      // Falling into the star.
      if (rr < STAR_RADIUS + SHIP_RADIUS && invuln <= 0) {
        die();
        shipX = 22; shipY = 0; shipVX = 0; shipVY = 11;
      }

      /* ---- motes ---- */
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        if (!m.alive) continue;
        m.bob += dt * 2.4;
        const dx = m.x - shipX;
        const dy = m.y - shipY;
        if (dx * dx + dy * dy < (SHIP_RADIUS + MOTE_RADIUS) * (SHIP_RADIUS + MOTE_RADIUS)) {
          m.alive = false;
          score += 10;
          boost = Math.min(BOOST_MAX, boost + 8);
          sfx(pickup, 0.35);
          spawnMote(m);
        }
      }

      /* ---- mines ---- */
      for (let i = 0; i < mines.length; i++) {
        const m = mines[i];
        if (!m.alive) continue;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const mr = Math.sqrt(m.x * m.x + m.y * m.y);
        if (mr > ARENA || mr < STAR_RADIUS) spawnMine(m);
        const dx = m.x - shipX;
        const dy = m.y - shipY;
        if (invuln <= 0 &&
            dx * dx + dy * dy < (SHIP_RADIUS + MINE_RADIUS) * (SHIP_RADIUS + MINE_RADIUS)) {
          spawnMine(m);
          die();
        }
      }
    }

    /* ---- belt ---- */
    beltAngle += dt * 0.12;
    for (let i = 0; i < ROCK_COUNT; i++) {
      const a = rockAngle[i] + beltAngle;
      const r = rockRadius[i];
      pos.set(Math.cos(a) * r, Math.sin(a) * r, rockY[i]);
      q.setFromAxisAngle(axis, elapsed * rockSpin[i]);
      const s = rockScale[i];
      scl.set(s, s, s);
      scratch.compose(pos, q, scl);
      belt.setMatrixAt(i, scratch);
    }

    /* ---- sprite placement ---- */
    ship.position.set(shipX, shipY, 0);
    ship.visible = over || invuln <= 0 || Math.floor(invuln / 110) % 2 === 0;
    /* The sprite spins to face its velocity. `rotation` on a SpriteMaterial
     * is a SCREEN-space spin, which is exactly right for a top-down ship. */
    shipMat.rotation = Math.atan2(shipVY, shipVX) - Math.PI / 2;

    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      const sp = m.sprite;
      if (sp === null) continue;
      sp.visible = m.alive;
      sp.position.set(m.x, m.y, m.z + Math.sin(m.bob) * 0.5);
      // Step the spin animation; `bob` already runs at a per-mote phase.
      const tex = m.texture;
      if (tex !== null) {
        const f = Math.floor(m.bob * 1.6) % MOTE_FRAMES;
        tex.setOffset(f / MOTE_FRAMES, 0);
      }
    }
    for (let i = 0; i < mines.length; i++) {
      const m = mines[i];
      const sp = m.sprite;
      if (sp === null) continue;
      sp.visible = m.alive;
      sp.position.set(m.x, m.y, m.z);
      const col = m.collider;
      if (col !== null) {
        col.position.set(m.x, m.y, m.z);
        /* `raycastable`, not `visible`: the collider must never be drawn
         * (setting visible would render a white box over the mine) but a
         * dead mine must not be clickable either. */
        col.raycastable = m.alive;
      }
    }

    /* ---- trail: integrate the ship forward under the same gravity ---- */
    let tx = shipX;
    let ty = shipY;
    let tvx = shipVX;
    let tvy = shipVY;
    const step = 0.05;
    for (let i = 0; i < TRAIL_STEPS; i++) {
      const d = Math.max(STAR_RADIUS * 1.6, Math.sqrt(tx * tx + ty * ty));
      const pull = STAR_PULL / (d * d);
      tvx -= (tx / d) * pull * step;
      tvy -= (ty / d) * pull * step;
      const nx = tx + tvx * step;
      const ny = ty + tvy * step;
      // LineSegments: each step is its own pair, so the strip cannot join
      // the end of the trail back to its start.
      const base = i * 6;
      trailPos[base] = tx;
      trailPos[base + 1] = ty;
      trailPos[base + 2] = 0;
      trailPos[base + 3] = nx;
      trailPos[base + 4] = ny;
      trailPos[base + 5] = 0;
      tx = nx;
      ty = ny;
    }
    trailGeo.updatePosition();
    trail.visible = !over;

    /* ---- camera: above the plane, following the ship loosely ---- */
    camera.position.set(shipX * 0.35, shipY * 0.35 - 16, 54);
    camTarget.set(shipX * 0.25, shipY * 0.25, 0);
    camera.lookAt(camTarget);

    /* ---- HUD ---- */
    if (hudCtx !== null && hudTexture !== null) {
      drawHud(hudCtx, score, best, lives, boost, over);
      hudTexture.needsUpdate = true;
    }
    placeHud(hud, camera, over);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});

/* ---- helpers ---- */

function loadTexture(url: string): Texture {
  const img = new Image();
  img.src = url;
  return new Texture(img);
}

function makeStarfield(rand: () => number): Points {
  const p: number[] = [];
  const n: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < 900; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = 120 + rand() * 90;
    const s = Math.sqrt(1 - u * u);
    p.push(r * s * Math.cos(th), r * s * Math.sin(th), r * u);
    n.push(0, 0, 1);
    const b = 0.45 + rand() * 0.55;
    c.push(b * 0.85, b * 0.9, b);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(p, 3, false));
  geo.setAttribute("normal", new BufferAttribute(n, 3, false));
  geo.setAttribute("color", new BufferAttribute(c, 3, false));
  const mat = new PointsMaterial();
  mat.size = 0.5;
  mat.sizeAttenuation = false;   // fixed pixel size: a real starfield
  mat.vertexColors = true;
  return new Points(geo, mat);
}

/* The HUD is a flat quad in front of the camera. A BoxGeometry(0,0,0) is a
 * placeholder the constructor needs; the real quad is written here. */
function buildHudQuad(hud: Mesh): void {
  const w = 1.15;
  const h = 0.575;
  const p = [-w, -h, 0, w, -h, 0, w, h, 0, -w, h, 0];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  const n = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const idx = [0, 1, 2, 0, 2, 3];
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(p, 3, false));
  geo.setAttribute("uv", new BufferAttribute(uv, 2, false));
  geo.setAttribute("normal", new BufferAttribute(n, 3, false));
  geo.setIndex(new BufferAttribute(idx, 1, false));
  hud.geometry = geo;
}

/* Pinned to the camera: the HUD sits a fixed distance down the view axis,
 * so it never intersects the world however the camera moves. */
function placeHud(hud: Mesh, camera: PerspectiveCamera, over: boolean): void {
  const d = 2.6;
  const fwd = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  hud.position.copy(camera.position);
  hud.position.addScaledVector(fwd, d);
  hud.position.addScaledVector(up, over ? 0.1 : 0.86);
  hud.quaternion.copy(camera.quaternion);
  const s = over ? 1.25 : 1;
  hud.scale.set(s, s, 1);
}

function drawHud(ctx: Context2D, score: number, best: number,
                 lives: number, boost: number, over: boolean): void {
  ctx.clearRect(0, 0, HUD_W, HUD_H);

  ctx.fillStyle = "rgba(6,10,22,0.82)";
  ctx.fillRect(0, 0, HUD_W, 96);

  ctx.fillStyle = "#dbe7ff";
  ctx.font = `54px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${score}`, 26, 62);

  ctx.fillStyle = "#7f93bf";
  ctx.font = `18px ${FONT}`;
  ctx.fillText("SCORE", 28, 84);

  // Lives as pips.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < lives ? "#ff5a7a" : "#2a3350";
    ctx.beginPath();
    /* The dialect has no optional parameters, so the spec defaults are
     * written out: anticlockwise=false, fill rule "nonzero". */
    ctx.arc(HUD_W - 40 - i * 34, 34, 11, 0, Math.PI * 2, false);
    ctx.fill("nonzero");
  }

  // Boost bar.
  ctx.fillStyle = "#1b2440";
  ctx.fillRect(HUD_W - 210, 62, 180, 12);
  ctx.fillStyle = "#54d6ff";
  ctx.fillRect(HUD_W - 210, 62, 180 * (boost / BOOST_MAX), 12);
  ctx.fillStyle = "#7f93bf";
  ctx.font = `15px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("BOOST", HUD_W - 30, 90);

  if (over) {
    ctx.fillStyle = "rgba(4,7,16,0.9)";
    ctx.fillRect(0, 96, HUD_W, 160);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6f8b";
    ctx.font = `46px ${FONT}`;
    ctx.fillText("GAME OVER", HUD_W / 2, 156);
    ctx.fillStyle = "#8ef0a8";
    ctx.font = `26px ${FONT}`;
    ctx.fillText(`best  ${best}`, HUD_W / 2, 196);
    ctx.fillStyle = "#96a8cf";
    ctx.font = `20px ${FONT}`;
    ctx.fillText("ENTER or START to fly again", HUD_W / 2, 230);
  }
}

