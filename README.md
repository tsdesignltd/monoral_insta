# INSTA for MONORAL OUTDOOR

Google Drive上のMONORAL OUTDOOR写真フォルダから、Instagram投稿候補を選別するためのローカルWebアプリです。

## Run

```bash
python3 -m http.server 5174
```

Open:

```text
http://127.0.0.1:5174/
```

## Google Drive Sync

1. Google Cloud ConsoleでGoogle Drive APIを有効化します。
2. OAuth同意画面を設定します。
3. OAuth Client IDを作成します。
   - Application type: Web application
   - Authorized JavaScript origins: `http://127.0.0.1:5174`
4. アプリ画面の `Google OAuth Client ID` にClient IDを入力します。
5. `Drive同期` を押し、GoogleアカウントでDrive読み取り権限を許可します。

同期対象はDrive folder `1-qyygiLBAEwG8_Po0dwhog-PgkVqfiWX` の直下サブフォルダです。直下サブフォルダ名を撮影者名として扱い、各撮影者フォルダ配下のサブフォルダまで辿って画像ファイルを読み込みます。

## Instagram Publishing

投稿ボタンはInstagram Graph APIを使います。

Required:

- Instagramプロアカウント
- Metaアプリ
- Instagram Business Account ID
- Content publishingに必要な権限を持つAccess Token
- Meta側から取得できる公開画像URL

Drive画像が非公開、またはHEICなどGraph APIが受け付けない形式の場合、投稿は失敗します。その場合はキュー内にエラーを表示します。

## Current Scope

- 投稿先: https://www.instagram.com/monoral_outdoor/
- 写真ソース: Google Drive folder `1-qyygiLBAEwG8_Po0dwhog-PgkVqfiWX`
- Drive直下のサブフォルダを撮影者として扱う
- 各撮影者フォルダ配下のサブフォルダまで画像を読み込む
- 各撮影者の最新10枚を一覧表示するUI
- 採用/保留の選別UI
- キャプション、ハッシュタグ、承認キュー、JSON書き出し
- Instagram Graph APIによるフィード投稿
