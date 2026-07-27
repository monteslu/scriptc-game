/* AudioParam ids, transcribed from webaudio-node's PARAM_ID_MAP.
 *
 * These are ABI: the engine takes an int, so a wrong value here silently
 * modulates the wrong parameter. Source of truth is
 * src/wasm-integration/WasmAudioEngine.js and the enum at the top of
 * src/wasm/audio_graph_simple.cpp, which agree.
 */
export const P_FREQUENCY = 0;
export const P_DETUNE = 1;
export const P_GAIN = 2;
export const P_Q = 3;
export const P_DELAY_TIME = 4;
export const P_PAN = 5;
export const P_OFFSET = 6;
export const P_TYPE = 7;
export const P_PLAYBACK_OFFSET = 8;
export const P_PLAYBACK_DURATION = 9;
export const P_LOOP = 10;
export const P_LOOP_START = 11;
export const P_LOOP_END = 12;
export const P_REF_DISTANCE = 13;
export const P_MAX_DISTANCE = 14;
export const P_ROLLOFF_FACTOR = 15;
export const P_CONE_INNER_ANGLE = 16;
export const P_CONE_OUTER_ANGLE = 17;
export const P_CONE_OUTER_GAIN = 18;
export const P_THRESHOLD = 19;
export const P_KNEE = 20;
export const P_RATIO = 21;
export const P_ATTACK = 22;
export const P_RELEASE = 23;
export const P_POSITION_X = 24;
export const P_POSITION_Y = 25;
export const P_POSITION_Z = 26;
export const P_ORIENTATION_X = 27;
export const P_ORIENTATION_Y = 28;
export const P_ORIENTATION_Z = 29;

/* scheduleParamEvent kinds, matching the engine's own switch. */
export const EV_SET_VALUE = 0;
export const EV_LINEAR_RAMP = 1;
export const EV_EXPONENTIAL_RAMP = 2;
export const EV_SET_TARGET = 3;
export const EV_CANCEL = 4;

/** Oscillator `type` as the engine's numeric encoding. */
export const WAVE_SINE = 0;
export const WAVE_SQUARE = 1;
export const WAVE_SAWTOOTH = 2;
export const WAVE_TRIANGLE = 3;

export function waveTypeOf(name: string): number {
  if (name === "square") return WAVE_SQUARE;
  if (name === "sawtooth") return WAVE_SAWTOOTH;
  if (name === "triangle") return WAVE_TRIANGLE;
  return WAVE_SINE;
}
