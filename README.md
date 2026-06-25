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

## Cloud Deploy

This repository can deploy to GitHub Pages from the `main` branch root.

Expected URL:

```text
https://tsdesignltd.github.io/monoral_insta/
```

After pushing, enable Pages in the GitHub repository settings:

```text
Settings > Pages > Build and deployment
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

## Google Drive Sync

1. Google Cloud ConsoleでGoogle Drive APIを有効化します。
2. OAuth同意画面を設定します。
3. OAuth Client IDを作成します。
   - Application type: Web application
   - Authorized JavaScript origins:
     - `http://127.0.0.1:5174`
     - `https://tsdesignltd.github.io`
4. アプリ画面の `Google OAuth Client ID` にClient IDを入力します。
5. `Drive同期` を押し、GoogleアカウントでDrive読み取り権限を許可します。

同期対象はDrive folder `1-qyygiLBAEwG8_Po0dwhog-PgkVqfiWX` の直下サブフォルダです。直下サブフォルダ名を撮影者名として扱い、各撮影者フォルダ配下のサブフォルダまで辿って画像ファイルを読み込みます。

## Instagram Publishing

投稿ボタンはInstagram APIを使います。

Required:

- Instagramプロアカウント
- Metaアプリ
- Instagram Account ID: `17841403518578706`
- `instagram_business_content_publish` を含むAccess Token
- Meta側から取得できる公開画像URL

画面の `Metaでトークン取得` からMeta Graph API Explorerを開き、対象のMetaアプリとInstagramアカウントを選択して、`instagram_business_content_publish` を含むトークンを生成します。取得したトークンをアプリへ貼り付けると、同じブラウザのローカルストレージに保存され、次回起動時に復元されます。

保存トークンは同じブラウザプロフィールを利用できる人から参照できるため、共有PCでは `保存トークンを削除` を使用してください。Client Secretを必要とするOAuthコード交換は静的Webアプリ内では安全に実行できないため、完全な自動取得にはバックエンドまたはサーバーレス関数が必要です。

Drive画像が非公開、またはHEICなどGraph APIが受け付けない形式の場合、投稿は失敗します。その場合はキュー内にエラーを表示します。

## Current Scope

- 投稿先: https://www.instagram.com/monoral_outdoor/
- 写真ソース: Google Drive folder `1-qyygiLBAEwG8_Po0dwhog-PgkVqfiWX`
- Drive直下のサブフォルダを撮影者として扱う
- 各撮影者フォルダ配下のサブフォルダまで画像を読み込む
- 各撮影者の最新30枚を一覧表示するUI
- 全画像一覧は3行分を表示し、一覧内を縦スクロール
- 撮影者・写真サムネール・採用/保留状態をブラウザにキャッシュし、再起動時に復元
- Drive同期時は前回キャッシュと比較し、新規・更新・削除の差分を反映
- 採用/保留の選別UI
- キャプション、ハッシュタグ、承認キュー、即時投稿、日時指定、JSON書き出し
- Instagram Graph APIによるフィード投稿

日時指定の予約はブラウザのローカルストレージに保存されます。指定時刻の自動投稿は、このアプリをブラウザで開いている間に実行されます。
