/* SPDX-License-Identifier: LGPL-2.1-or-later
 * Tiny wrapper around FFmpeg's native AAC decoder (libavcodec, LGPL) so MirrorX can decode the AAC-ELD audio an iPhone
 * sends during screen mirroring. Built to WebAssembly in CI (scripts/build-aac-wasm.sh); no native code runs on the PC.
 * API (all plain integers, memory is exchanged through two fixed buffers):
 *   mx_in_ptr()/mx_out_ptr()  -> addresses of the input (compressed frame) and output (16-bit interleaved PCM) buffers
 *   mx_aac_init(asc, len, sample_rate, channels) -> 0 on success      (asc is copied from the input buffer)
 *   mx_aac_close()      -> frees the decoder (call mx_aac_init again for a new stream)
 *   mx_aac_decode(len) -> number of PCM samples per channel written to the output buffer, or a negative error
 */
#include <stdint.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavutil/channel_layout.h>
#include <libavutil/mem.h>

#define IN_MAX  8192
#define OUT_MAX 4096   /* samples per channel */
static uint8_t in_buf[IN_MAX + AV_INPUT_BUFFER_PADDING_SIZE];
static int16_t out_buf[OUT_MAX * 2];
static AVCodecContext *ctx;
static AVPacket *pkt;
static AVFrame *frm;

uint8_t *mx_in_ptr(void)  { return in_buf; }
int16_t *mx_out_ptr(void) { return out_buf; }

/* Frees the decoder so mx_aac_init can start a fresh stream in the SAME wasm instance (a new instance costs ~32 MB of address space). */
void mx_aac_close(void) {
  if (ctx) avcodec_free_context(&ctx);
  if (pkt) av_packet_free(&pkt);
  if (frm) av_frame_free(&frm);
}

int mx_aac_init(int asc_len, int sample_rate, int channels) {
  const AVCodec *c;
  mx_aac_close();
  c = avcodec_find_decoder(AV_CODEC_ID_AAC);
  if (!c) return -1;
  ctx = avcodec_alloc_context3(c);
  pkt = av_packet_alloc();
  frm = av_frame_alloc();
  if (!ctx || !pkt || !frm) return -2;
  ctx->extradata = av_mallocz(asc_len + AV_INPUT_BUFFER_PADDING_SIZE);
  if (!ctx->extradata) return -3;
  memcpy(ctx->extradata, in_buf, asc_len);
  ctx->extradata_size = asc_len;
  ctx->sample_rate = sample_rate;
  av_channel_layout_default(&ctx->ch_layout, channels);
  return avcodec_open2(ctx, c, NULL);
}

int mx_aac_decode(int len) {
  int r, n, ch, i;
  if (!ctx || len <= 0 || len > IN_MAX) return -10;
  memset(in_buf + len, 0, AV_INPUT_BUFFER_PADDING_SIZE);
  pkt->data = in_buf; pkt->size = len;
  r = avcodec_send_packet(ctx, pkt);
  if (r < 0) return r;
  r = avcodec_receive_frame(ctx, frm);
  if (r < 0) return r;
  n = frm->nb_samples; if (n > OUT_MAX) n = OUT_MAX;
  ch = frm->ch_layout.nb_channels; if (ch > 2) ch = 2;
  for (i = 0; i < n; i++) {
    int c;
    for (c = 0; c < 2; c++) {
      int src = c < ch ? c : 0;
      float v;
      if (frm->format == AV_SAMPLE_FMT_FLTP) v = ((float *)frm->extended_data[src])[i];
      else if (frm->format == AV_SAMPLE_FMT_FLT) v = ((float *)frm->extended_data[0])[i * frm->ch_layout.nb_channels + src];
      else if (frm->format == AV_SAMPLE_FMT_S16P) v = ((int16_t *)frm->extended_data[src])[i] / 32768.0f;
      else if (frm->format == AV_SAMPLE_FMT_S16) v = ((int16_t *)frm->extended_data[0])[i * frm->ch_layout.nb_channels + src] / 32768.0f;
      else v = 0.0f;
      if (v > 1.0f) v = 1.0f; if (v < -1.0f) v = -1.0f;
      out_buf[i * 2 + c] = (int16_t)(v * 32767.0f);
    }
  }
  av_frame_unref(frm);
  return n;
}
