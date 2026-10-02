# トラブルシューティング

まず `data\taisa-mirror.log`（動作ログ）を見てください。詳しく見たいときは環境変数 `TAISA_VERBOSE=1` で起動すると画面にも出ます。

| 症状 | 原因と対処 |
|---|---|
| ブラウザに「TAISA Mirror を起動してください」 | 裏のプログラムが動いていません。`Start TAISA Mirror.cmd`（またはデスクトップの TAISA Mirror）をダブルクリック |
| iPhoneの画面ミラーリング一覧に出ない | ①PCとiPhoneが**同じWi-Fi**か（ゲストWi-Fi/AP分離は不可）②ブラウザで「接続待機中」になっているか③Windowsのネットワークが**プライベート**か（設定→ネットワーク）④ファイアウォールの許可ダイアログで「プライベート」を許可したか（`scripts\firewall.ps1` でも設定可）⑤VPNを一旦切る |
| 「ポート 7000 が使用中」 | UxPlay や他のAirPlay受信ソフトが動いています。終了してから再度「ミラーリング開始」 |
| 一覧には出るが接続できない/すぐ切れる | `data\taisa-mirror.log` の `pair-verify` `bad NAL` `fp` の行を確認し、Issue に貼ってください（個人情報は含まれません） |
| 映像が出ない（黒/止まる） | Chrome か Edge の最新版を使う。他のタブで重い処理をしない。いったん「切断」→iPhoneから再接続 |
| 映像のデコードでエラー | ブラウザが H.264 の WebCodecs に非対応。Chrome/Edge をお使いください |
| 音が出ない | v0.1 は映像のみです |
| Smart App Control / Defender の警告 | 実行されるネイティブは OpenJS Foundation 署名の `runtime\node.exe` だけです。**SAC/Defender を OFF にしないでください。** 警告が出る場合は `BUILD-INFO.json` と `SHA256SUMS.txt` で配布物を照合し、署名を `Get-AuthenticodeSignature runtime\node.exe` で確認 |
| iPhone名が「TAISA Mirror」と別の名前で出る | 起動時に環境変数 `TAISA_NAME` で変更できます |

## 診断コマンド
```
node scripts\mdns-probe.js _airplay._tcp.local    # PCが自分のAirPlay広告を出しているか（LAN上の他機器も表示）
node scripts\fake-iphone.js 127.0.0.1 5            # 偽iPhoneで通しテスト（要ffmpeg、先に「ミラーリング開始」を押す）
```
