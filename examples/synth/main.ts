/* synth: a playable Web Audio graph.
 *
 * The other examples use audio; this one is ABOUT audio. A keyboard row is
 * a two-octave keyboard, the signal path is oscillator -> filter -> delay ->
 * gain -> destination, and every knob is a real AudioParam you can hear
 * move. The graph is drawn on screen as it is wired.
 *
 * Deliberately no images and no game loop state: this is the audio surface
 * on its own, so a bug in it cannot hide behind something else moving.
 *
 * Browser code throughout, and `./browser/test.sh synth` runs this exact
 * file in a page.
 */
import {
  window, document, KeyboardEvent, AudioContext, FontFace, Math,
  OscillatorNode, GainNode, BiquadFilterNode, DelayNode, AnalyserNode,
} from "../../web/globals.js";

const FONT = "DejaVu Sans";

/* Two octaves on the home and top rows, laid out like a piano: the black
 * keys sit on the number row above their white neighbours. */
const KEYS: string[] = [
  "KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT",
  "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ",
  "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon",
];
const SHARP: boolean[] = [
  false, true, false, true, false, false, true,
  false, true, false, true, false,
  false, true, false, true, false,
];
/* Semitones above A3 (220Hz) for each key above. */
const SEMI: number[] = [
  0, 1, 2, 3, 4, 5, 6,
  7, 8, 9, 10, 11,
  12, 13, 14, 15, 16,
];

/* The letter printed on each key. Spelled out rather than derived from the
 * KeyCode with .replace(): string replace needs the dynamic engine (SC2012),
 * and a literal table is clearer than a transform either way. */
const LABELS: string[] = [
  "A", "W", "S", "E", "D", "F", "T",
  "G", "Y", "H", "U", "J",
  "K", "O", "L", "P", ";",
];

const WAVES: string[] = ["sine", "square", "sawtooth", "triangle"];

function noteHz(semitones: number): number {
  // Equal temperament from A3. 2^(n/12) with the pow the static tier fences
  // across to libm.
  return 220 * Math.pow(2, semitones / 12);
}

class Voice {
  osc: OscillatorNode | null = null;
  gain: GainNode | null = null;
  code = "";
  active = false;
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  new FontFace(FONT, "url(DejaVuSans.ttf)").load().then((face) => {
    document.fonts.add(face);
  });

  /* `new AudioContext()` never returns null, exactly as on the web. A
   * device that will not open reports state "suspended" instead, so a
   * headless run still draws the UI and simply makes no sound. */
  const audio = new AudioContext();
  const live = audio.state === "running";

  /* ---- the signal path ----
   *
   *   voices -> filter -> delay -+-> master -> destination
   *                  ^           |
   *                  +--feedback-+
   *
   * Built once and left connected; notes attach and detach at the head. */
  let filter: BiquadFilterNode | null = null;
  let delay: DelayNode | null = null;
  let feedback: GainNode | null = null;
  let master: GainNode | null = null;
  let analyser: AnalyserNode | null = null;

  if (live) {
    filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    filter.Q.value = 6;

    delay = audio.createDelay();
    delay.delayTime.value = 0.24;

    feedback = audio.createGain();
    feedback.gain.value = 0.35;

    master = audio.createGain();
    master.gain.value = 0.5;

    analyser = audio.createAnalyser();

    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);          // the feedback loop IS the echo
    filter.connect(master);
    delay.connect(master);
    master.connect(analyser);
    master.connect(audio.destination);
  }

  let waveIdx = 2;                    // sawtooth: the most obvious filter sweep
  let cutoff = 2200;
  let resonance = 6;
  let echo = 0.35;
  let volume = 0.5;

  const voices: Voice[] = [];
  for (let i = 0; i < KEYS.length; i++) voices.push(new Voice());

  const held = new Map<string, boolean>();

  function noteOn(index: number): void {
    const v = voices[index];
    if (v.active || !live) { v.active = true; return; }
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = WAVES[waveIdx];
    osc.frequency.value = noteHz(SEMI[index]);

    /* A short attack rather than an instant one: a square wave switched on
     * at full amplitude clicks, because the step is a broadband impulse. */
    const t = audio.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.012);

    osc.connect(g);
    g.connect(filter!);
    osc.start(t);

    v.osc = osc;
    v.gain = g;
    v.active = true;
  }

  function noteOff(index: number): void {
    const v = voices[index];
    if (!v.active) return;
    v.active = false;
    if (!live) return;
    const g = v.gain;
    const osc = v.osc;
    if (g === null || osc === null) return;
    // Release, then stop: cutting the oscillator dead would click too.
    const t = audio.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.stop(t + 0.2);
    v.osc = null;
    v.gain = null;
  }

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (held.get(e.code) === true) return;    // ignore auto-repeat
    held.set(e.code, true);

    for (let i = 0; i < KEYS.length; i++) {
      if (KEYS[i] === e.code) { noteOn(i); return; }
    }

    if (e.code === "Space") {
      waveIdx = (waveIdx + 1) % WAVES.length;
      for (let i = 0; i < voices.length; i++) {
        const o = voices[i].osc;
        if (o !== null) o.type = WAVES[waveIdx];
      }
    } else if (e.code === "ArrowUp") {
      cutoff = Math.min(12000, cutoff * 1.25);
      if (filter !== null) filter.frequency.value = cutoff;
    } else if (e.code === "ArrowDown") {
      cutoff = Math.max(120, cutoff / 1.25);
      if (filter !== null) filter.frequency.value = cutoff;
    } else if (e.code === "ArrowRight") {
      echo = Math.min(0.85, echo + 0.08);
      if (feedback !== null) feedback.gain.value = echo;
    } else if (e.code === "ArrowLeft") {
      echo = Math.max(0, echo - 0.08);
      if (feedback !== null) feedback.gain.value = echo;
    } else if (e.code === "BracketRight") {
      resonance = Math.min(24, resonance + 1.5);
      if (filter !== null) filter.Q.value = resonance;
    } else if (e.code === "BracketLeft") {
      resonance = Math.max(0.5, resonance - 1.5);
      if (filter !== null) filter.Q.value = resonance;
    } else if (e.code === "Equal") {
      volume = Math.min(1, volume + 0.08);
      if (master !== null) master.gain.value = volume;
    } else if (e.code === "Minus") {
      volume = Math.max(0, volume - 0.08);
      if (master !== null) master.gain.value = volume;
    }
  });

  window.addEventListener("keyup", (e: KeyboardEvent) => {
    held.set(e.code, false);
    for (let i = 0; i < KEYS.length; i++) {
      if (KEYS[i] === e.code) { noteOff(i); return; }
    }
  });

  /* ---- drawing ---- */

  function meter(label: string, x: number, y: number, frac: number,
                 text: string, color: string): void {
    ctx.fillStyle = "#8b96a5";
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(label, x, y - 8);
    ctx.fillStyle = "#1a2230";
    ctx.fillRect(x, y, 150, 10);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 150 * frac, 10);
    ctx.fillStyle = "#cfd8e3";
    ctx.textAlign = "right";
    // Below the bar, not beside the label: at 150px wide the two collide
    // for anything as long as "cutoff [up/down]".
    ctx.fillText(text, x + 150, y + 24);
    ctx.textAlign = "left";
  }

  function drawKeyboard(): void {
    const whiteCount = SHARP.filter((s) => !s).length;
    const kw = (W - 80) / whiteCount;
    const kh = 130;
    const top = H - kh - 40;

    // White keys first, then black on top, the way a piano stacks.
    let wx = 40;
    for (let i = 0; i < KEYS.length; i++) {
      if (SHARP[i]) continue;
      const on = voices[i].active;
      ctx.fillStyle = on ? "#6ee7ff" : "#e8eef5";
      ctx.fillRect(wx, top, kw - 2, kh);
      ctx.strokeStyle = "#0b1016";
      ctx.lineWidth = 1;
      ctx.strokeRect(wx, top, kw - 2, kh);
      ctx.fillStyle = on ? "#06121a" : "#8b96a5";
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(LABELS[i], wx + kw / 2 - 1, top + kh - 12);
      wx += kw;
    }

    wx = 40;
    for (let i = 0; i < KEYS.length; i++) {
      if (SHARP[i]) {
        const on = voices[i].active;
        ctx.fillStyle = on ? "#0ea5c6" : "#161d27";
        ctx.fillRect(wx - kw * 0.28, top, kw * 0.56, kh * 0.62);
        ctx.fillStyle = on ? "#d9f6ff" : "#5a6675";
        ctx.font = `10px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(LABELS[i], wx, top + kh * 0.62 - 8);
      } else {
        wx += kw;
      }
    }
    ctx.textAlign = "left";
  }

  function drawGraph(): void {
    /* The signal path, drawn as the boxes it actually is. Nodes light up
     * while they are carrying signal. */
    const anyVoice = voices.some((v) => v.active);
    const boxes: string[] = ["osc", "filter", "delay", "gain", "out"];
    const lit: boolean[] = [anyVoice, anyVoice, anyVoice && echo > 0.02,
                            anyVoice, anyVoice];
    const bw = 92;
    const bh = 34;
    const gap = 26;
    let x = 40;
    const y = 96;

    for (let i = 0; i < boxes.length; i++) {
      ctx.fillStyle = lit[i] ? "#173042" : "#131a24";
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = lit[i] ? "#6ee7ff" : "#26313f";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = lit[i] ? "#bde9f8" : "#5a6675";
      ctx.font = `13px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(boxes[i], x + bw / 2, y + 22);

      if (i < boxes.length - 1) {
        ctx.strokeStyle = lit[i] ? "#3f7f99" : "#222c38";
        ctx.beginPath();
        ctx.moveTo(x + bw, y + bh / 2);
        ctx.lineTo(x + bw + gap, y + bh / 2);
        ctx.stroke();
      }
      x += bw + gap;
    }

    // The feedback arc from delay back into itself.
    if (echo > 0.02) {
      const dx = 40 + (bw + gap) * 2;
      ctx.strokeStyle = anyVoice ? "#3f7f99" : "#222c38";
      ctx.beginPath();
      ctx.moveTo(dx + bw / 2, y);
      ctx.bezierCurveTo(dx + bw / 2 - 30, y - 42, dx + bw / 2 + 30, y - 42,
                        dx + bw / 2 + 4, y);
      ctx.stroke();
      ctx.fillStyle = "#5a6675";
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("feedback", dx + bw / 2, y - 30);
    }
    ctx.textAlign = "left";
  }

  function frame(): void {
    ctx.fillStyle = "#0b0f15";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#e8eef5";
    ctx.font = `20px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("synth", 40, 44);

    ctx.fillStyle = live ? "#8ee27a" : "#f0a35e";
    ctx.font = `12px ${FONT}`;
    ctx.fillText(live ? "audio: running" : "audio: no device (silent)", 40, 64);

    drawGraph();

    meter("wave  [space]", 40, 190, (waveIdx + 1) / WAVES.length,
          WAVES[waveIdx], "#6ee7ff");
    meter("cutoff  [up/down]", 220, 190, cutoff / 12000,
          `${Math.floor(cutoff)} Hz`, "#ffb86b");
    meter("resonance  [ / ]", 400, 190, resonance / 24,
          `Q ${Math.floor(resonance * 10) / 10}`, "#c792ea");
    meter("echo  [left/right]", 580, 190, echo / 0.85,
          `${Math.floor(echo * 100)}%`, "#8ee27a");
    meter("volume  [- / +]", 40, 252, volume, `${Math.floor(volume * 100)}%`,
          "#f2f6fb");

    drawKeyboard();

    ctx.fillStyle = "#4a5666";
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("A W S E D F T G Y H U J K O L P ;  play    ESC quit",
                 W / 2, H - 14);
    ctx.textAlign = "left";

    window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);
});
