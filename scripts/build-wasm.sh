#!/bin/sh
# Builds engine/playfair.wasm from the vendored C sources using the official Emscripten image.
# Used by .github/workflows/build-wasm.yml (runs in the cloud, so no local compiler/signing is needed).
set -eu
cd "$(dirname "$0")/../engine"
emcc -O2 -Iplayfair pf_wrapper.c playfair/playfair.c playfair/omg_hax.c playfair/hand_garble.c \
  playfair/modified_md5.c playfair/sap_hash.c \
  -s STANDALONE_WASM=1 -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s EXPORTED_FUNCTIONS=_pf_m3,_pf_ct,_pf_out,_pf_decrypt --no-entry -o playfair.wasm
sha256sum playfair.wasm | tee playfair.wasm.sha256
