# MirrorX v0.1 設計メモ（実装前に決めたこと）

## A. 採用するAirPlayエンジン
**自前の JavaScript 実装（Node.js、依存パッケージ0）＋ UxPlay 由来の FairPlay 部分だけ WebAssembly 化。**
UxPlay / uxplay-windows を「そのまま使う」案は、下記 SAC の実測により不採用（H参照）。

## B. 採用理由（比較）
| 候補 | 結果 |
|---|---|
| UxPlay を MSYS2 でソースビルド | **不可**。Smart App Control(SAC)が MSYS2 の未署名 `cc.exe` や各種DLLをブロック（実測、2026-10-02）。ビルドしても出来上がる `uxplay.exe` は未署名で同様に止まる見込み |
| uxplay-windows などの配布バイナリ | 未署名exe/DLL＋GStreamer多数のDLL。以前SACで止まった経験と同じ構造。不採用 |
| AirPlayServer(xenos1337) 等のC++製 | 未署名exe＋Bonjour必須＋VS2026ビルド。同上 |
| **Node.js(署名済み) ＋ 純JS ＋ WASM** | **採用**。実行されるネイティブコードは OpenJS Foundation 署名の `node.exe` のみ。WASM は SAC の対象外のデータ扱い |

## C. ライセンス
GPL-3.0-or-later（UxPlay の playfair を含むため）。`LICENSE` / `THIRD_PARTY_NOTICES.md` 参照。無料配布・再配布OK、ソース同梱。

## D. Windows 11 相性
Node.js 24 / Windows 11 で動作確認済み（この開発機）。mDNS(UDP 5353) は `SO_REUSEADDR` で Windows 標準の mDNS と共存できることを確認。Bonjour 不要。

## E/F. ブラウザ表示方式・映像転送方式
| 方式 | 遅延 | 実装 | CPU/GPU | 画質 | 安定 | 将来(スクショ/音声/配布) |
|---|---|---|---|---|---|---|
| **WebSocket(H.264そのまま) + WebCodecs** ← 採用 | 低 | 小 | Chromeが**GPUデコード**、Node側はAES復号のみ | **無劣化**（再エンコード無し） | 高 | canvas→PNG簡単。音声は WebAudio で後付け可。サーバ側にデコーダ不要＝配布物が増えない |
| MJPEG | 中 | 小 | サーバで H.264→JPEG の再エンコードが必要（ネイティブのデコーダ/ffmpegが要る＝SAC問題） | 劣化 | 高 | 同上 |
| WebRTC | 最低 | 大（ICE/DTLS/SRTP自作 or 依存追加） | 良 | 良 | 中 | 過剰（同一PC内なのでNAT越え不要） |
| native decode + bridge | 低 | 大 | 良 | 良 | 中 | 未署名ネイティブが必要 |

ブラウザは Chrome / Edge（WebCodecs の H.264 対応）。

## G. localhost 構成
```
Chrome ──http/ws──► 127.0.0.1:7878 (server/index.js: UIとWebSocketのみ。LANに公開しない)
                         │
                  AirPlay受信(同一プロセス)  tcp 7000 (RTSP/HTTP) / tcp 7100 (映像) / udp 5353(mDNS) 7101-7103
                         ▲
                       iPhone（同じWi-Fi）
```
- UI は `127.0.0.1` のみ bind。`Host`/`Origin` ヘッダ検証で DNS rebinding・他サイトからのWebSocket接続を拒否。
- AirPlay の待受け（7000等）は「ミラーリング開始」を押した間だけ開く。「キャンセル」で閉じる。映像ポートは接続した iPhone の IP 以外を拒否。

## H. Smart App Control 対策
- **実測**: MSYS2 の `cc.exe`、gdk-pixbuf のローダDLL等が「アプリケーション制御ポリシーによってブロック」された。→ ローカルビルドの未署名ネイティブは動かせない前提で設計。
- **採用策**: 実行するネイティブは署名済み `node.exe` だけ。自作exe/DLL/ドライバ無し。Web UI が主役なのでネイティブGUI問題も無い。
- WASM は CI(GitHub Actions)で公式 Emscripten イメージからビルドし、SHA256 を記録（`engine/playfair.wasm.sha256`）。
- 未検証（ドキュメント上の理解）: 自己署名証明書・Developer Mode は SAC の信頼判定を満たさない／MSIX も署名が必要。**SAC を OFF にする案は採らない。**

## I. Firewall 構成
Windows が初回に出す許可ダイアログで **「プライベート ネットワーク」のみ** 許可。より絞る場合は `scripts/firewall.ps1`（Private ＋ ローカルサブネット ＋ node.exe 限定、必要ポートのみ）。パブリック全開はしない。

## J. dependency
npm 依存 **0**。Node.js 組み込みモジュールのみ。同梱バイナリは公式 `node.exe`（SHA256検証済み）のみ。

## K. repo 構成
独立repo `jpn-x/taisa-mirror`（Windowsアプリ＋ローカルWeb UI＋CI＋配布の単位が独立しており、NO REPO SPAGHETTI の「別サービスとして配布」に該当）。

```
engine/   playfair C ソース(UxPlay由来) + wrapper + ビルド済み playfair.wasm
server/   Node.js: AirPlay受信・mDNS・plist・WebSocket・HTTP
web/      Chrome UI（index.html 1枚）
scripts/  package.ps1 / create-shortcut.ps1 / firewall.ps1 / build-wasm.sh / fake-iphone.js(自己テスト) / mdns-probe.js
docs/     設計・トラブルシュート・ロールバック
```

## L. build 方式
ビルド不要（JavaScript）。WASM だけ `.github/workflows/build-wasm.yml`（Emscripten公式Docker）。

## M. 配布方式
`scripts/package.ps1` → `release/mirrorx-vX.Y.Z-win-x64.zip` ＋ `SHA256SUMS.txt` ＋ `BUILD-INFO.json`。GitHub Releases に置く。

## v0.1 の割り切り
スクリーンショット/クリップボード機能は入れていません（ShareX 等で足りるため。UI を軽く保つ）。ボタンは「ミラーリング開始」「キャンセル」「全画面」「切断」だけ。

## N. 大佐の出番（人間にしかできないもの）
1. iPhone で コントロールセンター → 画面ミラーリング → MirrorX を選ぶ（実機テスト）
2. （初回のみ）Windows ファイアウォールの許可ダイアログが出たら「プライベート」だけにチェックして許可
3. repo を public にして Release を公開する最終GO

## O. 想定リスク
- **実機未検証部分**: FairPlay/ペアリング/映像パケットは UxPlay のソースに忠実に実装し、偽iPhone(scripts/fake-iphone.js)で通しテスト済みだが、本物の iOS との相性は実機テストが必要（iOS更新で挙動が変わる可能性）。
- 音声は v0.1 では未対応（無音）。
- H.265(4K)は未対応（H.264のみ）。
- 他のミラーリングソフトが 7000 / 5353 を占有していると起動できない（画面にエラー表示）。

## P. v0.1 工程
調査 → 設計 → 実装 → 偽iPhoneで自己テスト → 配布物 → ドキュメント → GitHub → 実機テスト(大佐) → 修正 → v0.1.0 公開。

## Q. 代替案（今回は不採用）
UxPlay＋GStreamer（SAC不可）／ MJPEG（再エンコードにネイティブ要）／ WebRTC（過剰）／ 有料ソフト（目的外）。
