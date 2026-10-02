# ダウンロードの確認と、Windows の警告について

TAISA Mirror は **Smart App Control / Windows Defender を OFF にしなくても動きます。OFF にしないでください。**
除外設定も不要です。ここには Windows の正規の手順だけを書きます。

## 1. ZIP が本物か確認する（SHA256）
Releases ページの `SHA256SUMS.txt` と、ダウンロードした ZIP のハッシュを比べます。PowerShell で:
```
Get-FileHash .\taisa-mirror-v0.1.2-win-x64.zip -Algorithm SHA256
```
表示された値が `SHA256SUMS.txt` と**完全に同じ**であることを確認してください。違う場合は使わないでください。

## 2. 展開する前に（インターネットから来たファイルの印）
ダウンロードしたファイルには「インターネットから来た」という印（Mark of the Web）が付き、初回に Windows が確認を出すことがあります。
1. 上の SHA256 を確認したら、ZIP を右クリック →「プロパティ」。
2. 下の方に「このファイルは他のコンピューターから取得したものです…」と出ていれば、内容を確認した上で「許可する」にチェック → OK。
3. その後に展開します。

## 3. 起動時に Windows の確認画面が出たら
- 「WindowsによってPCが保護されました」（SmartScreen）: 配布元（このリポジトリ）と手順 1 の SHA256 を確認済みなら、「詳細情報」→「実行」。
- ファイアウォール: **「プライベート ネットワーク」だけ**許可。「パブリック」は許可しないでください。
- 起動するのは `Start TAISA Mirror.cmd` と同梱の `runtime\node.exe`（公式 Node.js）だけです。

## 4. 同梱の node.exe が正規か確認する
```
Get-AuthenticodeSignature .\runtime\node.exe | Format-List Status, SignerCertificate
```
`Status : Valid`、署名者が `OpenJS Foundation` であること。
`BUILD-INFO.json` には、元にした公式 Node.js ZIP の SHA256 が記録されています（nodejs.org の `SHASUMS256.txt` と一致）。

## 5. WebAssembly（FairPlay 部分）の確認
`engine\playfair.wasm` の SHA256 は `engine\playfair.wasm.sha256` と `BUILD-INFO.json` に記録されています。
このファイルは GitHub Actions（公式 Emscripten イメージ）が `engine\playfair\*.c` から生成したもので、
`.github/workflows/build-wasm.yml` で再現できます。

## 警告が消えない / 動かないとき
`docs/TROUBLESHOOTING.md` を見てください。**警告を無理に回避する設定（保護機能の無効化など）はしないでください。**
