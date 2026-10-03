# ロールバック / アンインストール

MirrorX はシステムに何もインストールしません（ドライバ・サービス・レジストリ変更なし）。

1. 画面上部の「終了」ボタンを押す（または、ブラウザを閉じて10分待つ）。
2. フォルダごと削除。デスクトップの `MirrorX.lnk` も削除。
3. （`scripts\firewall.ps1` を使った場合のみ）`powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1 -Remove`
4. Windowsが初回に自動追加した「Node.js JavaScript Runtime」の許可ルールは、Windowsセキュリティ → ファイアウォール → 詳細設定 → 受信の規則から削除できます。
5. 設定・鍵は `data\` だけに保存されます（`identity.json` = このPCの識別用ランダム鍵）。消せば初期状態です。

## 以前のバージョンに戻す
GitHub Releases から以前の ZIP をダウンロードし、`SHA256SUMS.txt` で照合してから展開するだけです。
