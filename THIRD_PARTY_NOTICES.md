# Third-party notices

MirrorX is licensed under the **GNU General Public License v3.0 or later** (see `LICENSE`).

## Included code / binaries

| Component | Where | License | Notes |
|---|---|---|---|
| **UxPlay** (FDH2/UxPlay) – `lib/playfair/*` (playfair FairPlay SAP routines) | `engine/playfair/`, compiled to `engine/playfair.wasm` | GPL-3.0 (`engine/playfair/LICENSE.md`) | Vendored source from UxPlay commit `d8d99555473dc3fdfd3e23cdfd3d0ba3e7a8c209`. The WASM is built from exactly these sources by `.github/workflows/build-wasm.yml`. |
| **UxPlay** – `lib/fairplay_playfair.c` reply tables | `server/fp_tables.js` | GPL-3.0 | FairPlay phase-1 reply constants, extracted from UxPlay. |
| **UxPlay / RPiPlay / shairplay** protocol knowledge | `server/airplay.js` | GPL-3.0 / LGPL-2.1+ | The AirPlay mirroring protocol handling is a JavaScript re-implementation following UxPlay's open-source behaviour (pairing, key derivation, packet framing). |
| **Node.js** (official signed `node.exe`) | `runtime/node.exe` (release ZIP only) | MIT (`runtime/NODE-LICENSE.txt`) | Downloaded from nodejs.org, SHA-256 verified against the official `SHASUMS256.txt`, Authenticode-signed by the OpenJS Foundation. |

## Lineage of the FairPlay code (as documented by UxPlay)

`playfair` was created by **EstebanKubata** (<https://github.com/EstebanKubata/playfair>, GNU GPL), carried into
**shairplay** (Juho Vähä-Herttua and contributors, LGPL-2.1+), **RPiPlay** (FD-), **AirplayServer** (KqsMea8),
**antimof/UxPlay** and finally **UxPlay** (<https://github.com/FDH2/UxPlay>, GPL-3.0). We vendor it from UxPlay
(commit above) unmodified; the only addition is `engine/pf_wrapper.c`. Thank you to all of them.

## npm / other dependencies

**None.** The server uses only Node.js built-in modules (`net`, `dgram`, `http`, `crypto`, `fs`, …).
The browser UI loads nothing from the network.

## Source offer (GPL)

The complete corresponding source of every file in the release ZIP is in this repository
(<https://github.com/jpn-x/taisa-mirror>) and inside the ZIP itself (`server/`, `web/`, `engine/`, `scripts/`).
The only non-source artefacts are `runtime/node.exe` (upstream Node.js, MIT) and `engine/playfair.wasm`
(reproducibly built from `engine/playfair/*.c` + `engine/pf_wrapper.c` with the official Emscripten image).

Statements about licensing in this repository reflect a general understanding of open-source licences, not legal advice.

"AirPlay" and "Apple" are trademarks of Apple Inc. MirrorX is an independent open-source project and is not
affiliated with or endorsed by Apple.
