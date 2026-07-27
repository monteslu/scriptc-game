/* Audio file decoding: mp3, wav, flac, ogg.
 *
 * webaudio-node's own audio_decoders.cpp is not built (it hard-includes
 * opusfile and libxaac headers with no guard, which would drag ~600 codec
 * sources in), so this file uses the SAME header-only libraries upstream uses
 * for everything except opus and aac. Identical decoders, identical output.
 *
 * The decoded samples never cross the FFI: bulk float data cannot, and a
 * three-minute track is 90MB of float32. Instead the file is decoded here,
 * handed straight to the engine's registerBuffer, and TS gets back a buffer
 * id plus the frame/channel/rate counts through scalar getters.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sg_skia.h"

#define DR_MP3_IMPLEMENTATION
#include "dr_mp3.h"
#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"
#define DR_FLAC_IMPLEMENTATION
#include "dr_flac.h"

/* stb_vorbis defines its own STB_VORBIS_HEADER_ONLY-less implementation and
 * pulls in <stdlib.h>/<math.h>; the pushdata API is unused here. */
#define STB_VORBIS_NO_PUSHDATA_API
#include "stb_vorbis.c"

extern "C" {
void registerBuffer(int graph_id, int buffer_id, float* buffer_data,
                    int buffer_frames, int buffer_channels);
}

/* Set by the last successful decode, read by TS immediately after. Same
 * latch-then-read pattern as the transform and metrics getters. */
static uint32_t g_dec_frames;
static uint32_t g_dec_channels;
static uint32_t g_dec_rate;

extern "C" uint32_t sg_decode_frames(int32_t unused)   { (void)unused; return g_dec_frames; }
extern "C" uint32_t sg_decode_channels(int32_t unused) { (void)unused; return g_dec_channels; }
extern "C" uint32_t sg_decode_rate(int32_t unused)     { (void)unused; return g_dec_rate; }

/** Case-insensitive suffix test, for picking a decoder by extension. */
static bool ends_with(const char* s, const char* suffix) {
  size_t ls = strlen(s), lx = strlen(suffix);
  if (lx > ls) return false;
  const char* tail = s + (ls - lx);
  for (size_t i = 0; i < lx; i++) {
    char a = tail[i], b = suffix[i];
    if (a >= 'A' && a <= 'Z') a = (char)(a - 'A' + 'a');
    if (a != b) return false;
  }
  return true;
}

/* Decodes a file to interleaved float32 and registers it with the graph.
 *
 * Returns the buffer id (>0), or a negative status. The caller reads
 * sg_decode_frames/channels/rate right after for the metadata.
 *
 * The format is chosen by EXTENSION rather than by sniffing: every decoder
 * here will happily mis-parse another format's header and produce noise, and
 * a wrong-but-plausible decode is worse than a clean failure.
 */
extern "C" int32_t sg_audio_decode_file(uint32_t graph_id, uint32_t buffer_id,
                                        const uint8_t* path, size_t path_len) {
  char file[1024];
  if (path_len >= sizeof(file)) { sg_mail_set("audio path too long"); return SG_ERANGE; }
  memcpy(file, path, path_len);
  file[path_len] = 0;

  float*   samples = NULL;   /* interleaved float32, malloc'd by the decoder */
  uint64_t frames = 0;
  uint32_t channels = 0;
  uint32_t rate = 0;
  bool     free_with_drlibs = true;

  if (ends_with(file, ".mp3")) {
    drmp3_config cfg;
    memset(&cfg, 0, sizeof(cfg));
    drmp3_uint64 n = 0;
    samples = drmp3_open_file_and_read_pcm_frames_f32(file, &cfg, &n, NULL);
    if (!samples) { sg_mail_set("mp3 decode failed"); return SG_EDECODE; }
    frames = n; channels = cfg.channels; rate = cfg.sampleRate;

  } else if (ends_with(file, ".wav")) {
    unsigned int ch = 0; unsigned int sr = 0; drwav_uint64 n = 0;
    samples = drwav_open_file_and_read_pcm_frames_f32(file, &ch, &sr, &n, NULL);
    if (!samples) { sg_mail_set("wav decode failed"); return SG_EDECODE; }
    frames = n; channels = ch; rate = sr;

  } else if (ends_with(file, ".flac")) {
    unsigned int ch = 0; unsigned int sr = 0; drflac_uint64 n = 0;
    samples = drflac_open_file_and_read_pcm_frames_f32(file, &ch, &sr, &n, NULL);
    if (!samples) { sg_mail_set("flac decode failed"); return SG_EDECODE; }
    frames = n; channels = ch; rate = sr;

  } else if (ends_with(file, ".ogg")) {
    int ch = 0, sr = 0;
    short* pcm = NULL;
    int n = stb_vorbis_decode_filename(file, &ch, &sr, &pcm);
    if (n < 0 || !pcm) { sg_mail_set("ogg decode failed"); return SG_EDECODE; }
    /* stb_vorbis gives int16; the engine wants float32. */
    size_t total = (size_t)n * (size_t)ch;
    samples = (float*)malloc(total * sizeof(float));
    if (!samples) { free(pcm); sg_mail_set("out of memory decoding ogg"); return SG_EAUDIO; }
    for (size_t i = 0; i < total; i++) samples[i] = (float)pcm[i] / 32768.0f;
    free(pcm);
    frames = (uint64_t)n; channels = (uint32_t)ch; rate = (uint32_t)sr;
    free_with_drlibs = false;

  } else {
    sg_mail_set("unsupported audio format (want .mp3, .wav, .flac or .ogg)");
    return SG_EDECODE;
  }

  if (frames == 0 || channels == 0) {
    if (samples) { if (free_with_drlibs) drwav_free(samples, NULL); else free(samples); }
    sg_mail_set("decoded file is empty");
    return SG_EDECODE;
  }

  /* registerBuffer COPIES into engine-owned storage, so the decoder's
   * allocation is released immediately after. */
  registerBuffer((int)graph_id, (int)buffer_id, samples, (int)frames, (int)channels);
  if (free_with_drlibs) drwav_free(samples, NULL);
  else free(samples);

  g_dec_frames = (uint32_t)frames;
  g_dec_channels = channels;
  g_dec_rate = rate;
  return (int32_t)buffer_id;
}
