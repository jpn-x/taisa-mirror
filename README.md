# TAISA Mirror

**iPhone の画面を、パソコンのブラウザにそのまま映す。** 無料・アカウント不要・広告なし・クラウド不要。家のWi-Fiの中だけで完結します。

> Free, local-only AirPlay screen mirroring from iPhone into your Chrome/Edge tab on Windows 11.
> No account, no cloud, no ads, no telemetry, **zero npm dependencies**, no unsigned native code (works with Smart App Control ON).

## 使い方（初心者向け）

1. ZIP を解凍する（どこでもOK）
2. `Start TAISA Mirror.cmd` をダブルクリック → Chrome（既定のブラウザ）が開く
3. **「ミラーリング開始」** を押す
4. iPhone で **コントロールセンター → 画面ミラーリング → TAISA Mirror**
5. 同じブラウザ画面に iPhone が映る（全画面 / スクリーンショット / クリップボードにコピー / 切断）

* PC と iPhone は同じ Wi-Fi に。初回に Windows のファイアウォール許可が出たら **「プライベート ネットワーク」だけ**許可してください。
* デスクトップに置きたいときは `scripts\create-shortcut.ps1` を右クリック → PowerShellで実行。
* 終了は、黒いウィンドウ（起動したもの）を閉じるだけ。
* うまくいかないときは [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。元に戻すときは [docs/ROLLBACK.md](docs/ROLLBACK.md)。

## v0.1 の範囲

| できる | まだ |
|---|---|
| iPhone/iPad の AirPlay 画面ミラーリング（映像・H.264） | 音声（無音）／ H.265(4K) |
| 接続・切断・再接続・アプリ再起動後の再利用 | 複数端末同時／リモート操作／録画 |
| PNG保存・クリップボードコピー | Android |

## 安全設計

* **Smart App Control / Defender は OFF にしません。** 実行されるネイティブコードは、OpenJS Foundation 署名済みの公式 `node.exe`（ZIP同梱、SHA256検証済み）だけ。自作の exe / DLL / ドライバはありません。他は JavaScript と WebAssembly 1個。
* 管理画面は `127.0.0.1` のみ（LANに公開しない）。AirPlay の待受けは「ミラーリング開始」中だけ開き、接続済みの iPhone 以外の映像接続は拒否。
* 画面データは外部に送られません（外向き通信なし・テレメトリなし）。
* 依存パッケージ 0（Node.js 組み込みのみ）。出所の追える範囲：UxPlay の playfair（GPL-3.0）を GitHub Actions で WASM 化。
* 設計の詳細・比較・リスク: [docs/DESIGN.md](docs/DESIGN.md)

## 開発者向け

```
node server/index.js --open          # 起動（Node 20+）
node scripts/fake-iphone.js          # 偽iPhoneで通しテスト（要ffmpeg）
pwsh scripts/package.ps1             # 配布ZIP + SHA256SUMS.txt を release/ に作成
```

構成: `server/`（AirPlay受信・mDNS・plist・WebSocket）, `web/`（Chrome UI）, `engine/`（UxPlay由来 playfair → `playfair.wasm`）。
映像は H.264 を **再エンコードせず** WebSocket でブラウザへ送り、Chrome の WebCodecs（GPU）で表示します。

## ライセンス

GPL-3.0-or-later。[LICENSE](LICENSE) / [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
AirPlay プロトコル処理は [UxPlay](https://github.com/FDH2/UxPlay)（GPL-3.0）等のオープンソースの成果に基づきます。
"AirPlay" は Apple Inc. の商標です。本プロジェクトは Apple とは無関係の独立したOSSです。
