#!/bin/sh
# Builds engine/aac_eld.wasm: FFmpeg's native AAC decoder (LGPL) + engine/aac_wrapper.c, compiled to WebAssembly.
# Runs in CI inside the official Emscripten image (.github/workflows/build-aac-wasm.yml), so no compiler is needed on the PC.
set -eu
FFMPEG_TAG=n7.1.1
SRC=/src
git clone --depth 1 --branch "$FFMPEG_TAG" https://github.com/FFmpeg/FFmpeg.git /tmp/ffmpeg
cd /tmp/ffmpeg
git rev-parse HEAD | tee "$SRC/engine/aac_eld.ffmpeg-commit"
emconfigure ./configure --target-os=none --arch=x86_32 --enable-cross-compile \
  --disable-asm --disable-x86asm --disable-inline-asm --disable-stripping --disable-debug --disable-runtime-cpudetect \
  --disable-autodetect --disable-network --disable-pthreads --disable-programs --disable-doc \
  --disable-all --enable-avcodec --enable-avutil --enable-decoder=aac \
  --nm=llvm-nm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc \
  --extra-cflags=-O2
emmake make -j"$(nproc)"
cd "$SRC/engine"
emcc -O2 -I/tmp/ffmpeg aac_wrapper.c /tmp/ffmpeg/libavcodec/libavcodec.a /tmp/ffmpeg/libavutil/libavutil.a \
  -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s INITIAL_MEMORY=25165824 -s EXPORTED_FUNCTIONS=_mx_in_ptr,_mx_out_ptr,_mx_aac_init,_mx_aac_close,_mx_aac_decode --no-entry -lm -o aac_eld.wasm
sha256sum aac_eld.wasm | tee aac_eld.wasm.sha256
ls -l aac_eld.wasm
