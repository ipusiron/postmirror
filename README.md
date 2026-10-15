<!--
---
id: day115
slug: postmirror

title: "PostMirror"

subtitle_ja: "郵便物のバーコードから住所の何が読めるかを確かめる"
subtitle_en: "See What the Barcode on Your Mail Reveals"

description_ja: "郵便物のカスタマバーコードのバーを1本ずつ入力して解読し、郵便番号と住所表示番号の内訳と、一部を隠したときに読める文字を確かめる自己点検ツール"
description_en: "A self-check tool that decodes a Japan Post customer barcode entered bar by bar, showing each character of the postal code and address number and what stays readable when parts are hidden"

category_ja:
  - プライバシー
  - 符号理論
category_en:
  - Privacy
  - Coding Theory

difficulty: 2

tags:
  - customer-barcode
  - japan-post
  - barcode
  - postal-code
  - privacy
  - check-digit
  - osint
  - education
  - client-side

repo_url: "https://github.com/ipusiron/postmirror"
demo_url: "https://ipusiron.github.io/postmirror/"

hub: false
---
-->

[English](README.en.md) · 日本語

# PostMirror - 郵便物のバーコードから住所の何が読めるかを確かめる

**Day115 - 生成AIで作るセキュリティツール200**

PostMirror（ポストミラー）は、郵便物に印字されたカスタマバーコード（カスタマーバーコードとも書かれます）のバーを入力して解読し、郵便番号と住所表示番号を1文字ずつ確かめるツールです。
バーコードの一部を隠したときに読める文字とチェックデジットから戻る文字を示し、「座学」タブではバーの読み方、チェックデジットの計算、隠し方を学べます。
まずは手元にある自分宛ての郵便物で試してください。

名前のPostは、郵便とSNSの投稿の両方を指します。投稿の前に自分の郵便物を映して確かめる鏡、という意味です。

> 現在は開発準備中です。解読タブと座学タブはまだ実装していません。公開ページもまだありません。

## ⚠️ 注意

PostMirrorは個人が作成したツールで、日本郵便株式会社とは関係がありません。
カスタマバーコードの仕様は、日本郵便が公開している「郵便番号・バーコードマニュアル」に基づきます。

作者は悪用を勧めません。
郵便物の写真やバーコードを扱ってよいかどうかは、国・地域の法令や状況によって異なります。

## 📁 ディレクトリー構造

```text
postmirror/
├── .gitignore    # 秘密情報やローカルの生成物をGitの管理から外す
├── LICENSE       # MIT License全文
├── README.md     # 日本語版（YAMLメタデータを持つ）
└── README.en.md  # 英語版
```

## 📄 ライセンス

MIT Licenseです。全文は[LICENSE](LICENSE)を参照してください。

## 🛠️ このツールについて

本ツールは、「生成AIで作るセキュリティツール200」プロジェクトの一環として開発しています。
このプロジェクトでは、AIの支援を活用しながら、セキュリティに関連するさまざまなツールを100日間にわたり制作・公開していく取り組みを行っています。

プロジェクトの詳細や他のツールについては、以下のページをご覧ください。

🔗 [https://akademeia.info/?page_id=44607](https://akademeia.info/?page_id=44607)
