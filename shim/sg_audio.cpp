/* Audio: SDL device + render thread over webaudio-node's C++ graph.
 *
 * THE THREADING CONTRACT
 *
 * SDL calls the audio callback on its own thread. The graph engine is not
 * thread-safe against concurrent mutation, and scriptc's runtime must never
 * be touched off the main thread, so the two sides communicate through ONE
 * lock-free SPSC ring:
 *
 *   main thread  -> enqueue command records (create node, connect, set param)
 *   audio thread -> drain the ring at a QUANTUM BOUNDARY, then render
 *
 * Draining only between quanta is what makes this correct without locks: a
 * command never lands halfway through a render, so the graph the engine sees
 * is always self-consistent. The ring is single-producer/single-consumer with
 * acquire/release atomics, which needs no mutex at all.
 *
 * Anything that must return a value to the caller (creating a node, decoding
 * a buffer) happens on the MAIN thread instead, before the audio thread can
 * see it: node ids come from the engine's own counters, and a node that is
 * not yet connected renders nothing. Only mutations are queued.
 */
#include <SDL2/SDL.h>
#include <atomic>
#include <stdio.h>
#include <stdint.h>
#include <string.h>

#include "sg_skia.h"

/* ---- the engine's C ABI (webaudio-node, built by scripts/build-webaudio.sh) */
extern "C" {
int  createAudioGraph(int sample_rate, int channels, int buffer_size, bool is_realtime);
void destroyAudioGraph(int graph_id);
int  createNode(int graph_id, const char* type_str);
void connectNodes(int graph_id, int source_id, int dest_id, int output_idx, int input_idx);
void disconnectNodes(int graph_id, int source_id, int dest_id);
void startNode(int graph_id, int node_id, double when);
void stopNode(int graph_id, int node_id, double when);
void setNodeParameter(int graph_id, int node_id, int param_id, float value);
/* NOTE the argument order: (kind, VALUE, TIME, timeConstant). The natural
 * reading is (time, value) and getting it backwards silently corrupts every
 * envelope -- a ramp to 0.8 at t=2 becomes a ramp to 2 at t=0.8. Transcribed
 * from the definition in audio_graph_simple.cpp, not guessed. */
void scheduleParamEvent(int graph_id, int node_id, int param_id, int kind,
                        float value, double time, float timeConstant);
void processGraph(int graph_id, float* output, int frame_count);
void setGraphCurrentTime(int graph_id, double time);
void registerBuffer(int graph_id, int buffer_id, float* buffer_data,
                    int buffer_frames, int buffer_channels);
void setNodeBufferId(int graph_id, int node_id, int buffer_id);
void setWaveShaperCurve(int graph_id, int node_id, float* curve_data, int curve_length);
}

/* ---- command ring ---- */
typedef enum {
  CMD_CONNECT = 0,
  CMD_DISCONNECT,
  CMD_START,
  CMD_STOP,
  CMD_SET_PARAM,
  CMD_SCHEDULE_PARAM,
  CMD_SET_BUFFER,
} sg_cmd_kind;

typedef struct {
  int32_t kind;
  int32_t a, b, c, d;      /* node ids, param id, indices */
  double  x, y, z;         /* values, times */
} sg_cmd;

/* Power of two so the wrap is a mask. 1024 commands is far more than a frame
 * ever queues; overflow drops the command and flags it rather than blocking
 * the main thread or corrupting the ring. */
#define SG_CMD_CAP 1024
#define SG_CMD_MASK (SG_CMD_CAP - 1)

static sg_cmd g_ring[SG_CMD_CAP];
static std::atomic<uint32_t> g_head{0};   /* written by main  */
static std::atomic<uint32_t> g_tail{0};   /* written by audio */
static std::atomic<uint32_t> g_dropped{0};

static bool ring_push(const sg_cmd& c) {
  uint32_t head = g_head.load(std::memory_order_relaxed);
  uint32_t tail = g_tail.load(std::memory_order_acquire);
  if (head - tail >= SG_CMD_CAP) {
    g_dropped.fetch_add(1, std::memory_order_relaxed);
    return false;
  }
  g_ring[head & SG_CMD_MASK] = c;
  /* release: the record must be visible before the index that publishes it */
  g_head.store(head + 1, std::memory_order_release);
  return true;
}

/* ---- device state ---- */
static SDL_AudioDeviceID g_dev;
static int      g_graph = -1;
static int      g_rate = 48000;
static int      g_channels = 2;
static double   g_time;            /* audio-thread only, after init */
static std::atomic<uint64_t> g_frames{0};   /* published to the main thread */
static std::atomic<uint32_t> g_underruns{0};

/* Applies one queued command. AUDIO THREAD ONLY. */
static void apply(const sg_cmd& c) {
  switch (c.kind) {
    case CMD_CONNECT:    connectNodes(g_graph, c.a, c.b, c.c, c.d); break;
    case CMD_DISCONNECT: disconnectNodes(g_graph, c.a, c.b); break;
    case CMD_START:      startNode(g_graph, c.a, c.x); break;
    case CMD_STOP:       stopNode(g_graph, c.a, c.x); break;
    case CMD_SET_PARAM:  setNodeParameter(g_graph, c.a, c.b, (float)c.x); break;
    case CMD_SCHEDULE_PARAM:
      /* c.x is the TIME and c.y the VALUE in our command record; the engine
       * wants them the other way round (see its declaration above). */
      scheduleParamEvent(g_graph, c.a, c.b, c.c, (float)c.y, c.x, (float)c.z);
      break;
    case CMD_SET_BUFFER:  setNodeBufferId(g_graph, c.a, c.b); break;
    default: break;
  }
}

static void SDLCALL audio_cb(void* userdata, Uint8* stream, int len) {
  (void)userdata;
  float* out = (float*)stream;
  const int frames = len / (int)(sizeof(float) * g_channels);

  if (g_graph < 0) { memset(stream, 0, len); return; }

  /* Drain EVERY pending command before rendering. This is the quantum
   * boundary: the graph is mutated only here, never mid-render. */
  uint32_t tail = g_tail.load(std::memory_order_relaxed);
  uint32_t head = g_head.load(std::memory_order_acquire);
  while (tail != head) {
    apply(g_ring[tail & SG_CMD_MASK]);
    tail++;
  }
  g_tail.store(tail, std::memory_order_release);

  setGraphCurrentTime(g_graph, g_time);
  memset(stream, 0, len);
  processGraph(g_graph, out, frames);

  g_time += (double)frames / (double)g_rate;
  g_frames.fetch_add((uint64_t)frames, std::memory_order_relaxed);
}

/* ---- lifecycle ---- */

extern "C" int32_t sg_audio_init(uint32_t sample_rate, uint32_t buffer_frames) {
  if (g_dev != 0) return SG_OK;   /* idempotent */

  if (SDL_InitSubSystem(SDL_INIT_AUDIO) != 0) {
    sg_mail_set(SDL_GetError());
    return SG_ESDL;
  }

  SDL_AudioSpec want, have;
  SDL_zero(want);
  want.freq = sample_rate > 0 ? (int)sample_rate : 48000;
  want.format = AUDIO_F32SYS;      /* the engine renders float32 natively */
  want.channels = 2;
  want.samples = buffer_frames > 0 ? (Uint16)buffer_frames : 1024;
  want.callback = audio_cb;

  /* Frequency and channels are NOT negotiable: the graph is built for them
   * and resampling on our side would defeat the parity test. The buffer size
   * is, since it only trades latency against underrun headroom. */
  g_dev = SDL_OpenAudioDevice(NULL, 0, &want, &have,
                              SDL_AUDIO_ALLOW_SAMPLES_CHANGE);
  if (g_dev == 0) { sg_mail_set(SDL_GetError()); return SG_ESDL; }

  g_rate = have.freq;
  g_channels = have.channels;
  g_time = 0;

  /* 128 is the Web Audio render quantum; the engine works in whole quanta,
   * and SDL's buffer is a multiple of it. */
  g_graph = createAudioGraph(g_rate, g_channels, 128, true);
  if (g_graph < 0) {
    sg_mail_set("audio graph creation failed");
    SDL_CloseAudioDevice(g_dev);
    g_dev = 0;
    return SG_EAUDIO;
  }

  SDL_PauseAudioDevice(g_dev, 0);   /* start the callback */
  return SG_OK;
}

extern "C" void sg_audio_quit(int32_t unused) {
  (void)unused;
  if (g_dev != 0) {
    /* Stop the callback BEFORE tearing the graph down, or the audio thread
     * renders through freed memory. */
    SDL_PauseAudioDevice(g_dev, 1);
    SDL_CloseAudioDevice(g_dev);
    g_dev = 0;
  }
  if (g_graph >= 0) { destroyAudioGraph(g_graph); g_graph = -1; }
}

extern "C" uint32_t sg_audio_rate(int32_t unused) { (void)unused; return (uint32_t)g_rate; }
extern "C" uint32_t sg_audio_channels(int32_t unused) { (void)unused; return (uint32_t)g_channels; }

/** Seconds of audio rendered so far: the web's AudioContext.currentTime. */
extern "C" double sg_audio_time(int32_t unused) {
  (void)unused;
  uint64_t f = g_frames.load(std::memory_order_relaxed);
  return g_rate > 0 ? (double)f / (double)g_rate : 0.0;
}

extern "C" uint32_t sg_audio_dropped(int32_t unused) {
  (void)unused;
  return g_dropped.load(std::memory_order_relaxed);
}

extern "C" int32_t sg_audio_suspend(uint32_t suspend) {
  if (g_dev == 0) return SG_EAUDIO;
  SDL_PauseAudioDevice(g_dev, suspend ? 1 : 0);
  return SG_OK;
}

/* ---- node creation: MAIN THREAD, returns a value ----
 *
 * Creating a node is the one mutation that must return something, so it does
 * NOT go through the ring. It is safe because a fresh node is unconnected:
 * the audio thread cannot reach it until a CMD_CONNECT is drained, and the
 * engine's node table only grows. */
extern "C" int32_t sg_audio_create_node(const uint8_t* type, size_t len) {
  if (g_graph < 0) { sg_mail_set("audio not initialised"); return SG_EAUDIO; }
  char buf[64];
  if (len >= sizeof(buf)) { sg_mail_set("node type name too long"); return SG_ERANGE; }
  memcpy(buf, type, len);
  buf[len] = 0;
  int id = createNode(g_graph, buf);
  if (id < 0) { sg_mail_set("unknown or unsupported node type"); return SG_EAUDIO; }
  return id;
}

/* ---- queued mutations ---- */

extern "C" int32_t sg_audio_connect(uint32_t src, uint32_t dst, uint32_t oidx,
                                    uint32_t iidx) {
  sg_cmd c; memset(&c, 0, sizeof(c));
  c.kind = CMD_CONNECT; c.a = (int32_t)src; c.b = (int32_t)dst;
  c.c = (int32_t)oidx;  c.d = (int32_t)iidx;
  return ring_push(c) ? SG_OK : SG_EAUDIO;
}

extern "C" int32_t sg_audio_disconnect(uint32_t src, uint32_t dst) {
  sg_cmd c; memset(&c, 0, sizeof(c));
  c.kind = CMD_DISCONNECT; c.a = (int32_t)src; c.b = (int32_t)dst;
  return ring_push(c) ? SG_OK : SG_EAUDIO;
}

extern "C" int32_t sg_audio_start(uint32_t node, double when) {
  sg_cmd c; memset(&c, 0, sizeof(c));
  c.kind = CMD_START; c.a = (int32_t)node; c.x = when;
  return ring_push(c) ? SG_OK : SG_EAUDIO;
}

extern "C" int32_t sg_audio_stop(uint32_t node, double when) {
  sg_cmd c; memset(&c, 0, sizeof(c));
  c.kind = CMD_STOP; c.a = (int32_t)node; c.x = when;
  return ring_push(c) ? SG_OK : SG_EAUDIO;
}

extern "C" int32_t sg_audio_set_param(uint32_t node, uint32_t param, double value) {
  sg_cmd c; memset(&c, 0, sizeof(c));
  c.kind = CMD_SET_PARAM; c.a = (int32_t)node; c.b = (int32_t)param; c.x = value;
  return ring_push(c) ? SG_OK : SG_EAUDIO;
}

/* kind: 0 setValueAtTime, 1 linearRamp, 2 exponentialRamp, 3 setTarget,
 * 4 cancelScheduled -- matching the engine's own scheduleParamEvent. */
extern "C" int32_t sg_audio_schedule_param(uint32_t node, uint32_t param,
                                           uint32_t kind, double time,
                                           double value, double extra) {
  sg_cmd c; memset(&c, 0, sizeof(c));
  c.kind = CMD_SCHEDULE_PARAM;
  c.a = (int32_t)node; c.b = (int32_t)param; c.c = (int32_t)kind;
  c.x = time; c.y = value; c.z = extra;
  return ring_push(c) ? SG_OK : SG_EAUDIO;
}

/* ---- sample buffers ----
 *
 * A buffer is registered from the MAIN thread (it needs an id back and it
 * copies the samples into engine-owned storage), then attached to a source
 * node through the ring. The float data arrives as a `bytes` span, which is
 * borrowed, so registerBuffer's copy has to happen inside this call. */
static int g_next_buffer_id = 1;

extern "C" int32_t sg_audio_register_buffer(const uint8_t* data, size_t len,
                                            uint32_t frames, uint32_t channels) {
  if (g_graph < 0) { sg_mail_set("audio not initialised"); return SG_EAUDIO; }
  size_t need = (size_t)frames * channels * sizeof(float);
  if (len < need) { sg_mail_set("sample buffer shorter than frames*channels*4"); return SG_ERANGE; }

  int id = g_next_buffer_id++;
  /* registerBuffer copies into engine storage; the const_cast is safe because
   * the engine does not write through this pointer. */
  registerBuffer(g_graph, id, (float*)(void*)data, (int)frames, (int)channels);
  return id;
}

/* The live graph id, for sg_audio_decode.cpp (which registers decoded files
 * straight with the engine rather than passing 90MB of float through TS). */
extern "C" int32_t sg_audio_graph_id(int32_t unused) { (void)unused; return g_graph; }

/** Next free buffer id, so decode and createBuffer cannot collide. */
extern "C" int32_t sg_audio_next_buffer_id(int32_t unused) {
  (void)unused;
  return g_next_buffer_id++;
}

extern "C" int32_t sg_audio_set_node_buffer(uint32_t node, uint32_t buffer_id) {
  sg_cmd c; memset(&c, 0, sizeof(c));
  c.kind = CMD_SET_BUFFER; c.a = (int32_t)node; c.b = (int32_t)buffer_id;
  return ring_push(c) ? SG_OK : SG_EAUDIO;
}

/* WaveShaper curves are set from the main thread: the engine copies the
 * curve, and a shaper with no curve is a pass-through, so there is no
 * intermediate state the audio thread can catch. */
extern "C" int32_t sg_audio_set_curve(uint32_t node, const uint8_t* data,
                                      size_t len) {
  if (g_graph < 0) { sg_mail_set("audio not initialised"); return SG_EAUDIO; }
  int count = (int)(len / sizeof(float));
  if (count < 2) { sg_mail_set("wave shaper curve needs at least 2 points"); return SG_ERANGE; }
  setWaveShaperCurve(g_graph, (int)node, (float*)(void*)data, count);
  return SG_OK;
}

/* ---- offline render ----
 *
 * The parity test's entry point: render N frames with NO device and NO
 * thread, straight into a file. Bulk float data cannot cross the FFI, so the
 * samples never leave native code -- the caller gets a WAV on disk, which is
 * also what makes the output comparable byte-for-byte with the WASM build.
 */
extern "C" int32_t sg_audio_render_offline(const uint8_t* path, size_t path_len,
                                           uint32_t frames) {
  if (g_graph < 0) { sg_mail_set("audio not initialised"); return SG_EAUDIO; }
  char file[1024];
  if (path_len >= sizeof(file)) { sg_mail_set("path too long"); return SG_ERANGE; }
  memcpy(file, path, path_len);
  file[path_len] = 0;

  /* DRAIN THE RING FIRST.
   *
   * Offline rendering has no audio callback, so nothing else ever applies
   * queued commands: without this every connect and start sits in the ring
   * and the render is silent. (Found exactly that way -- the C-level probe
   * worked because it called the engine directly, while the TS path queued
   * its whole graph and rendered nothing.)
   *
   * Safe here because there IS no audio thread in offline mode: this call is
   * the only consumer. */
  {
    uint32_t tail = g_tail.load(std::memory_order_relaxed);
    uint32_t head = g_head.load(std::memory_order_acquire);
    while (tail != head) {
      apply(g_ring[tail & SG_CMD_MASK]);
      tail++;
    }
    g_tail.store(tail, std::memory_order_release);
  }

  const int quantum = 128;
  float buf[128 * 8];
  if (g_channels > 8) { sg_mail_set("too many channels"); return SG_ERANGE; }

  FILE* f = fopen(file, "wb");
  if (!f) { sg_mail_set("could not open output path"); return SG_ERANGE; }

  /* 32-bit float WAV: the engine's native format, so nothing is quantised on
   * the way out and a hash of this file compares exactly. */
  const uint32_t data_bytes = frames * (uint32_t)g_channels * 4u;
  const uint32_t rate = (uint32_t)g_rate;
  const uint16_t ch = (uint16_t)g_channels;
  uint8_t hdr[44];
  memcpy(hdr, "RIFF", 4);
  uint32_t riff = 36 + data_bytes; memcpy(hdr + 4, &riff, 4);
  memcpy(hdr + 8, "WAVEfmt ", 8);
  uint32_t fmt_size = 16;      memcpy(hdr + 16, &fmt_size, 4);
  uint16_t fmt_tag = 3;        memcpy(hdr + 20, &fmt_tag, 2);   /* IEEE float */
  memcpy(hdr + 22, &ch, 2);
  memcpy(hdr + 24, &rate, 4);
  uint32_t byte_rate = rate * ch * 4; memcpy(hdr + 28, &byte_rate, 4);
  uint16_t block = (uint16_t)(ch * 4);  memcpy(hdr + 32, &block, 2);
  uint16_t bits = 32;          memcpy(hdr + 34, &bits, 2);
  memcpy(hdr + 36, "data", 4);
  memcpy(hdr + 40, &data_bytes, 4);
  fwrite(hdr, 1, sizeof(hdr), f);

  double t = 0;
  uint32_t done = 0;
  while (done < frames) {
    uint32_t n = frames - done;
    if (n > (uint32_t)quantum) n = (uint32_t)quantum;
    memset(buf, 0, sizeof(float) * (size_t)quantum * g_channels);
    setGraphCurrentTime(g_graph, t);
    processGraph(g_graph, buf, (int)n);
    fwrite(buf, sizeof(float), (size_t)n * g_channels, f);
    t += (double)n / (double)g_rate;
    done += n;
  }
  fclose(f);
  return SG_OK;
}

/* Offline mode: build a graph with no device, for tests and for rendering
 * faster than real time. */
extern "C" int32_t sg_audio_init_offline(uint32_t sample_rate, uint32_t channels) {
  if (g_graph >= 0) { sg_mail_set("audio already initialised"); return SG_EAUDIO; }
  g_rate = sample_rate > 0 ? (int)sample_rate : 48000;
  g_channels = channels > 0 ? (int)channels : 2;
  g_time = 0;
  g_graph = createAudioGraph(g_rate, g_channels, 128, false);
  if (g_graph < 0) { sg_mail_set("audio graph creation failed"); return SG_EAUDIO; }
  return SG_OK;
}
