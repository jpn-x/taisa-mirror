# TAISA Mirror

**Windows で iPhone の画面を、無料・ローカルで、ブラウザに映す。** (AirPlay ミラーリング受信)
アカウント不要 / 広告なし / クラウド不要 / テレメトリなし / 家の Wi-Fi の中だけで完結。

> 無保証・自己責任でお使いください。Apple とは無関係の個人開発のオープンソースです（"AirPlay" は Apple Inc. の商標）。iOS の更新で動かなくなる可能性があります。

## 使い方（4ステップ）

1. ZIP を展開する（右クリック → すべて展開）
2. **`Start TAISA Mirror.cmd`** をダブルクリック（ブラウザが開きます）
3. ブラウザの **「ミラーリング開始」** を押す
4. iPhone で **画面右上から下にスワイプ → 画面ミラーリング → TAISA Mirror**

映ります。やめるときは「切断」（または iPhone 側で停止）。完全に終了するときは、黒いウィンドウを閉じるだけです。
スクリーンショットは ShareX など、お好きなツールで撮れます。

- **次から素早く開く:** `ショートカットを作る.cmd` をダブルクリック → デスクトップとスタートメニューに「TAISA Mirror」ができます。ピン留めは、スタートメニュー →「すべて」→ TAISA Mirror を右クリック →「スタートにピン留めする」/「その他」→「タスクバーにピン留めする」。
- PC と iPhone は同じ Wi-Fi（同じルーター）に。ゲスト Wi-Fi や AP 分離は不可。
- 初回に Windows のファイアウォール許可が出たら **「プライベート ネットワーク」だけ** 許可。
- ブラウザは Chrome / Edge（映像のデコードに WebCodecs を使います）。

## できること / まだ

| できる | まだ（v0.1 では未対応） |
|---|---|
| iPhone / iPad の画面ミラーリング（映像・H.264） | **音声（無音）** / H.265・4K |
| 接続・切断・再接続、画面オフ→復帰、再起動後の再利用 | 複数台同時 / リモート操作 / 録画 / Android |

## 安全・軽さ

- **Smart App Control / Defender は OFF にしません（OFF にする必要はありません）。** 実行されるネイティブコードは、OpenJS Foundation 署名済みの公式 `node.exe` だけ。自作の exe / DLL / ドライバはありません。他は JavaScript と WebAssembly 1 個。
- 管理画面は `127.0.0.1` のみ。AirPlay の待受けは「ミラーリング開始」中だけ開き、映像の接続は接続済み iPhone 以外を拒否。画面データは外部に送りません（外向き通信なし）。
- 依存パッケージ 0（Node.js 組み込みのみ）。
- 参考実測値（Windows 11 / RTX 5060 / iPhone 15 / Chrome、環境依存）: 待機中 約 45〜55 MB・CPU ほぼ 0%、接続中でも約 60 MB・CPU 0.2% 未満、ZIP 約 34 MB。詳細は [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md)。

## 困ったとき

- Windows の警告 / ZIP の確認方法 → [docs/VERIFY.md](docs/VERIFY.md)
- iPhone に出ない・映らない → [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- 元に戻す（アンインストール）→ [docs/ROLLBACK.md](docs/ROLLBACK.md)
- 設計メモ → [docs/DESIGN.md](docs/DESIGN.md)

## 開発者向け

```
node server/index.js --open     # 起動 (Node 20+)
node scripts/fake-iphone.js     # 偽 iPhone で通しテスト (要 ffmpeg。例: ... 127.0.0.1 3 25 = 25 回再接続)
pwsh scripts/package.ps1        # 配布 ZIP + SHA256SUMS.txt を release/ に作成
```

`server/`（AirPlay 受信・mDNS・plist・WebSocket）, `web/`（UI）, `engine/`（UxPlay 由来 playfair → `playfair.wasm`、GitHub Actions でビルド）。
映像は H.264 を再エンコードせず WebSocket でブラウザへ送り、Chrome の WebCodecs（GPU）で表示します。

## ライセンス

**GPL-3.0-or-later**（[LICENSE](LICENSE)）。FairPlay 部分に [UxPlay](https://github.com/FDH2/UxPlay)（GPL-3.0）由来のコード（playfair）を含むため、配布物全体を GPL で、ソース付きで公開しています（このリポジトリ＝ソース。ZIP にもソースが入っています）。
由来の詳細は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。ライセンスに関する記述は一般的な OSS ライセンスの理解であり、法的助言ではありません。
