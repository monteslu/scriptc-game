/* dodge: a small playable game, driven by a gamepad or the keyboard.
 *
 * Move with the left stick or the dpad (WASD / arrows also work). Blocks
 * fall; touching one costs a life and rumbles the pad. Catch the coins.
 * A/space dashes. Start/Enter restarts after a game over.
 *
 * It exists to be PLAYED, so everything here is what a real game does: a
 * fixed-timestep simulation with interpolated drawing, an analog deadzone,
 * per-frame edge detection for the dash, and haptics on impact.
 */
import { Game, GameOptions } from "../../runtime/loop/run.js";
import { Context2D } from "../../runtime/canvas/context.js";
import * as ffi from "../../runtime/ffi.js";
import { sqrt, atan2, PI, TAU } from "../../runtime/math.js";
import {
  AudioContext, createAudioContext, closeAudio, GainNode, AudioBufferSourceNode,
} from "../../runtime/audio/context.js";
import { pickup, hit, dash as dashSfx, gameOver } from "../../runtime/audio/sfx.js";
import { GameImage, decodeImage } from "../../runtime/canvas/image.js";
import { readFileSync } from "node:fs";
import {
  BTN_A, BTN_START, BTN_DPAD_LEFT, BTN_DPAD_RIGHT, BTN_DPAD_UP, BTN_DPAD_DOWN,
  AXIS_LEFT_X, AXIS_LEFT_Y, GamepadEffectParameters, Gamepad,
} from "../../runtime/input/gamepad.js";

const W = 800;
const H = 600;
const FONT = "DejaVu Sans";

const PLAYER_R = 14;
const PLAYER_SPEED = 0.34;      // px per ms
const DASH_SPEED = 0.95;
const DASH_MS = 140;
const DASH_COOLDOWN_MS = 620;

/* Sticks never rest at exactly zero, so anything under the deadzone is
 * treated as centred; past it the value is rescaled so the usable range
 * still runs a full 0..1 and slow movement stays possible. */
const DEADZONE = 0.22;

/* Music sits UNDER the effects: at equal volume a looping track masks the
 * feedback a player actually needs to hear. Half is the brief; the effects
 * go near full so they cut through it. */
const MUSIC_VOLUME = 0.5;
const SFX_VOLUME = 0.9;

function applyDeadzone(v: number): number {
  const mag = v < 0 ? -v : v;
  if (mag < DEADZONE) return 0;
  const scaled = (mag - DEADZONE) / (1 - DEADZONE);
  return v < 0 ? -scaled : scaled;
}

class Faller {
  x = 0; y = 0; vy = 0; size = 0; coin = false; alive = false;
}

class Dodge extends Game {
  px = W / 2;
  py = H - 90;
  vx = 0; vy = 0;

  lives = 3;
  score = 0;
  best = 0;
  over = false;

  dashMs = 0;
  cooldownMs = 0;
  invulnMs = 0;

  spawnMs = 0;
  spawnEvery = 620;
  elapsed = 0;

  /* A fixed pool, never reallocated: a game loop that allocates per frame
   * hands the collector work forever. `alive` marks a slot in use. */
  fallers: Faller[] = [];

  /** null when the device could not be opened; the game stays playable. */
  audio: AudioContext | null = null;
  /* Sprites. null when the art is missing, and every draw falls back to the
   * primitive it replaced -- an example should still run from a clone that
   * skipped the asset step. */
  spritePlayer: GameImage | null = null;
  spriteHazard: GameImage | null = null;
  spriteCoin: GameImage | null = null;
  /** Advances the 4-frame coin spin. */
  coinAnimMs = 0;
  /** Facing, in radians. Eased toward travel so the ship banks, not snaps. */
  heading = -1.5707963267948966;

  /** Music bus, so the track can be ducked or muted independently of SFX. */
  musicGain: GainNode | null = null;
  musicSource: AudioBufferSourceNode | null = null;
  musicOn = true;

  /** Deterministic pseudo-randomness: no Math.random in the static tier. */
  private seed = 0x2f6e2b1;
  private rand(): number {
    // xorshift32, then normalised. Same sequence every run, which also makes
    // the demo reproducible for screenshots.
    let x = this.seed;
    x ^= (x << 13) & 0xffffffff;
    x ^= x >>> 17;
    x ^= (x << 5) & 0xffffffff;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  constructor() {
    super();
    for (let i = 0; i < 64; i++) this.fallers.push(new Faller());
  }

  private pad(): Gamepad | null {
    const pads = this.input.connectedGamepads();
    return pads.length > 0 ? pads[0] : null;
  }

  private rumble(weak: number, strong: number, ms: number): void {
    const p = this.pad();
    if (p === null || !p.hasRumble) return;
    const fx = new GamepadEffectParameters();
    fx.duration = ms;
    fx.weakMagnitude = weak;
    fx.strongMagnitude = strong;
    p.vibrationActuator.playEffect("dual-rumble", fx);
  }

  private restart(): void {
    this.px = W / 2; this.py = H - 90;
    this.vx = 0; this.vy = 0;
    this.lives = 3; this.score = 0;
    this.over = false;
    this.elapsed = 0;
    this.spawnEvery = 620;
    this.dashMs = 0; this.cooldownMs = 0; this.invulnMs = 0;
    for (let i = 0; i < this.fallers.length; i++) this.fallers[i].alive = false;
  }

  update(dtMs: number): void {
    if (this.input.isDown("Escape")) { this.stop(); return; }

    const pad = this.pad();

    // Restart, from either input.
    if (this.over) {
      const restartPressed =
        this.input.wasPressed("Enter") || this.input.wasPressed("Space") ||
        (pad !== null && (pad.buttons[BTN_START].pressed || pad.buttons[BTN_A].pressed));
      if (restartPressed) this.restart();
      return;
    }

    /* ---- steering: stick, dpad, or keyboard, whichever moved ---- */
    let ix = 0;
    let iy = 0;
    if (pad !== null) {
      ix = applyDeadzone(pad.axes[AXIS_LEFT_X]);
      iy = applyDeadzone(pad.axes[AXIS_LEFT_Y]);
      if (pad.buttons[BTN_DPAD_LEFT].pressed) ix = -1;
      if (pad.buttons[BTN_DPAD_RIGHT].pressed) ix = 1;
      if (pad.buttons[BTN_DPAD_UP].pressed) iy = -1;
      if (pad.buttons[BTN_DPAD_DOWN].pressed) iy = 1;
    }
    if (this.input.isDown("ArrowLeft") || this.input.isDown("KeyA")) ix = -1;
    if (this.input.isDown("ArrowRight") || this.input.isDown("KeyD")) ix = 1;
    if (this.input.isDown("ArrowUp") || this.input.isDown("KeyW")) iy = -1;
    if (this.input.isDown("ArrowDown") || this.input.isDown("KeyS")) iy = 1;

    // Normalise so diagonals are not faster than the cardinals.
    const mag = sqrt(ix * ix + iy * iy);
    if (mag > 1) { ix /= mag; iy /= mag; }

    /* ---- dash ---- */
    if (this.cooldownMs > 0) this.cooldownMs -= dtMs;
    const dashPressed =
      this.input.wasPressed("Space") ||
      (pad !== null && pad.buttons[BTN_A].pressed && this.dashMs <= 0 && this.cooldownMs <= 0);
    if (dashPressed && this.cooldownMs <= 0 && (ix !== 0 || iy !== 0)) {
      this.dashMs = DASH_MS;
      this.cooldownMs = DASH_COOLDOWN_MS;
      this.rumble(0.25, 0.15, 70);
      if (this.audio !== null) dashSfx(this.audio, SFX_VOLUME * 0.8);
    }

    let speed = PLAYER_SPEED;
    if (this.dashMs > 0) { speed = DASH_SPEED; this.dashMs -= dtMs; }

    if (ix !== 0 || iy !== 0) {
      /* Ease toward the travel direction through the SHORTEST arc: lerping
       * raw angles spins the long way round when crossing +/-PI. */
      const target = atan2(iy, ix);
      let delta = target - this.heading;
      while (delta > PI) delta -= TAU;
      while (delta < -PI) delta += TAU;
      this.heading += delta * Math.min(1, dtMs * 0.02);
    }

    this.px += ix * speed * dtMs;
    this.py += iy * speed * dtMs;
    if (this.px < PLAYER_R) this.px = PLAYER_R;
    if (this.px > W - PLAYER_R) this.px = W - PLAYER_R;
    if (this.py < PLAYER_R) this.py = PLAYER_R;
    if (this.py > H - PLAYER_R) this.py = H - PLAYER_R;

    /* ---- spawning, ramping up over time ---- */
    this.elapsed += dtMs;
    if (this.spawnEvery > 190) this.spawnEvery -= dtMs * 0.02;
    this.spawnMs -= dtMs;
    if (this.spawnMs <= 0) {
      this.spawnMs = this.spawnEvery;
      this.spawn();
    }

    if (this.invulnMs > 0) this.invulnMs -= dtMs;

    /* ---- fallers ---- */
    for (let i = 0; i < this.fallers.length; i++) {
      const f = this.fallers[i];
      if (!f.alive) continue;
      f.y += f.vy * dtMs;
      if (f.y > H + 40) { f.alive = false; continue; }

      // Circle-vs-square overlap, close enough for a square this small.
      const half = f.size / 2;
      const cx = f.x;
      const cy = f.y;
      const dx = this.px - cx;
      const dy = this.py - cy;
      const near = (dx < 0 ? -dx : dx) < half + PLAYER_R &&
                   (dy < 0 ? -dy : dy) < half + PLAYER_R;
      if (!near) continue;

      if (f.coin) {
        f.alive = false;
        this.score += 10;
        this.rumble(0.15, 0.0, 45);
        if (this.audio !== null) pickup(this.audio, SFX_VOLUME);
      } else if (this.invulnMs <= 0) {
        f.alive = false;
        this.lives -= 1;
        this.invulnMs = 1100;
        this.rumble(0.9, 1.0, 260);
        if (this.audio !== null) hit(this.audio, SFX_VOLUME);
        if (this.lives <= 0) {
          this.over = true;
          if (this.score > this.best) this.best = this.score;
          this.rumble(1.0, 1.0, 520);
          if (this.audio !== null) gameOver(this.audio, SFX_VOLUME * 0.9);
        }
      }
    }

    this.score += dtMs * 0.004;
    this.coinAnimMs += dtMs;
  }

  private spawn(): void {
    for (let i = 0; i < this.fallers.length; i++) {
      const f = this.fallers[i];
      if (f.alive) continue;
      f.alive = true;
      f.coin = this.rand() < 0.22;
      f.size = f.coin ? 16 : 22 + this.rand() * 26;
      f.x = f.size + this.rand() * (W - f.size * 2);
      f.y = -30;
      f.vy = (f.coin ? 0.20 : 0.16) + this.rand() * 0.22 + this.elapsed * 0.000008;
      return;
    }
  }

  draw(ctx: Context2D, _alpha: number): void {
    ctx.clear("#0d1117");

    // A faint grid, so motion is legible.
    ctx.strokeStyle = "#161d27";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= W; gx += 50) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy <= H; gy += 50) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    for (let i = 0; i < this.fallers.length; i++) {
      const f = this.fallers[i];
      if (!f.alive) continue;
      if (f.coin) {
        if (this.spriteCoin !== null) {
          /* One strip, four 16px frames: drawImageRect picks the frame, so
           * the whole animation is a single decode and a single handle. */
          const frame = Math.floor(this.coinAnimMs / 90) % 4;
          ctx.drawImageRect(this.spriteCoin, frame * 16, 0, 16, 16,
                            f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
        } else {
          ctx.fillStyle = "#ffd257";
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.size / 2, 0, TAU, false);
          ctx.fill("nonzero");
          ctx.strokeStyle = "#a8761f";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        if (this.spriteHazard !== null) {
          ctx.drawImageScaled(this.spriteHazard, f.x - f.size / 2, f.y - f.size / 2,
                              f.size, f.size);
        } else {
          ctx.fillStyle = "#e5484d";
          ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
          ctx.strokeStyle = "#7d2226";
          ctx.lineWidth = 2;
          ctx.strokeRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
        }
      }
    }

    // The player. Blinks while invulnerable, glows while dashing.
    const blink = this.invulnMs > 0 && (this.invulnMs % 200) > 100;
    if (!blink) {
      if (this.spritePlayer !== null) {
        /* 3.2x the collision radius, not 2x: the art has transparent margin
         * and a narrow nose, so a frame sized to the hitbox renders a ship
         * visibly smaller than the hazards it dodges. Measured from a
         * screenshot rather than guessed. */
        const size = PLAYER_R * 3.2;
        ctx.save();
        ctx.translate(this.px, this.py);
        /* The art faces up, so heading 0 is -PI/2 in atan2 terms. Banking
         * toward travel is the whole reason to rotate rather than blit. */
        ctx.rotate(this.heading + 1.5707963267948966);
        // Dashing tints the ship by drawing a green wash over it.
        ctx.drawImageScaled(this.spritePlayer, -size / 2, -size / 2, size, size);
        ctx.restore();
        if (this.dashMs > 0) {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = "#8ee27a";
          ctx.beginPath();
          ctx.arc(this.px, this.py, PLAYER_R, 0, TAU, false);
          ctx.fill("nonzero");
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillStyle = this.dashMs > 0 ? "#8ee27a" : "#58a6ff";
        ctx.beginPath();
        ctx.arc(this.px, this.py, PLAYER_R, 0, TAU, false);
        ctx.fill("nonzero");
        ctx.strokeStyle = this.dashMs > 0 ? "#3f7a34" : "#1f5fa8";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    this.drawHud(ctx);
    if (this.over) this.drawGameOver(ctx);
  }

  private drawHud(ctx: Context2D): void {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#e6edf3";
    ctx.font = `20px ${FONT}`;
    ctx.fillText(`score ${Math.floor(this.score)}`, 16, 32);

    ctx.fillStyle = "#e5484d";
    for (let i = 0; i < this.lives; i++) {
      ctx.beginPath();
      ctx.arc(24 + i * 26, 52, 8, 0, TAU, false);
      ctx.fill("nonzero");
    }

    // Dash cooldown, as a bar.
    const ready = this.cooldownMs <= 0;
    ctx.fillStyle = "#1c2430";
    ctx.fillRect(W - 156, 24, 140, 12);
    ctx.fillStyle = ready ? "#8ee27a" : "#3d5570";
    const frac = ready ? 1 : 1 - this.cooldownMs / DASH_COOLDOWN_MS;
    ctx.fillRect(W - 156, 24, 140 * frac, 12);
    ctx.fillStyle = "#7d8590";
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(ready ? "dash ready" : "dash", W - 16, 52);

    ctx.textAlign = "left";
    ctx.fillStyle = "#4d5866";
    const pad = this.pad();
    ctx.fillText(pad === null ? "keyboard: arrows/WASD, space to dash"
                              : `pad: ${pad.id}`, 16, H - 14);
    ctx.textAlign = "right";
    ctx.fillText(this.musicOn ? "M: music on" : "M: music off", W - 16, H - 14);
    ctx.textAlign = "left";
  }

  private drawGameOver(ctx: Context2D): void {
    ctx.fillStyle = "rgba(5,8,12,0.78)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = "#e6edf3";
    ctx.font = `44px ${FONT}`;
    ctx.fillText("game over", W / 2, H / 2 - 30);

    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = "#8ee27a";
    ctx.fillText(`score ${Math.floor(this.score)}   best ${Math.floor(this.best)}`, W / 2, H / 2 + 12);

    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = "#7d8590";
    ctx.fillText("start / enter to play again    ESC to quit", W / 2, H / 2 + 52);
    ctx.textAlign = "left";
  }
}

function main(): void {
  ffi.fontRegister("test/assets/DejaVuSans.ttf");

  const game = new Dodge();
  /* 1024 frames is ~21ms at 48kHz: low enough that a hit sounds immediate,
   * high enough that a frame spike cannot starve the mixer. Failure is not
   * fatal -- a machine with no sound card should still play the game. */
  game.audio = createAudioContext(48000, 1024);
  if (game.audio === null) console.log("audio unavailable; running silent");

  /* Music on its own gain bus, looping. Decoding is synchronous native work;
   * a 2:38 track at 48kHz takes a moment, which is what a load screen is for. */
  if (game.audio !== null) {
    const track = game.audio.decodeAudioFile("examples/dodge/assets/music.mp3");
    if (track === null) {
      /* Not committed: example asset audio is gitignored, since the track is
       * the user's own file. Drop any mp3/ogg/wav/flac in as music.mp3. */
      console.log("no music at examples/dodge/assets/music.mp3; running without it");
    } else {
      console.log(`music: ${track.duration.toFixed(1)}s, ${track.numberOfChannels}ch @ ${track.sampleRate}Hz`);
      const bus = game.audio.createGain();
      bus.gain.value = MUSIC_VOLUME;
      bus.connect(game.audio.destination);
      const src = game.audio.createBufferSource();
      src.buffer = track;
      src.loop = true;
      src.connect(bus);
      src.start(0);
      game.musicGain = bus;
      game.musicSource = src;
    }
  }

  /* Sprites are plain PNGs decoded at startup: no bundling, no packing step.
   * readFileSync gives a Buffer, which is exactly what the `bytes` FFI param
   * wants, and Skia sniffs the format from the bytes (png/jpg/webp/bmp/gif
   * all work -- see test/imagetest.ts). */
  const art: string[] = ["player", "hazard", "coin"];
  const loaded: GameImage[] = [];
  for (let i = 0; i < art.length; i++) {
    const img = decodeImage(readFileSync(`examples/dodge/assets/${art[i]}.png`));
    if (!img.valid) console.log(`sprite ${art[i]}.png failed to load; using shapes`);
    loaded.push(img);
  }
  if (loaded[0].valid) game.spritePlayer = loaded[0];
  if (loaded[1].valid) game.spriteHazard = loaded[1];
  if (loaded[2].valid) game.spriteCoin = loaded[2];

  const opts = new GameOptions();
  opts.width = W;
  opts.height = H;

  const framesEnv = process.env["SG_MAX_FRAMES"];
  if (framesEnv !== undefined) opts.maxFrames = parseInt(framesEnv, 10);
  const shotEnv = process.env["SG_SHOT"];
  if (shotEnv !== undefined) opts.shotPath = shotEnv;
  const shotFrameEnv = process.env["SG_SHOT_FRAME"];
  if (shotFrameEnv !== undefined) opts.shotFrame = parseInt(shotFrameEnv, 10);

  const rc = game.run(opts);
  closeAudio();
  console.log(`final score ${Math.floor(game.score)} (best ${Math.floor(game.best)})`);
  process.exit(rc);
}

main();
