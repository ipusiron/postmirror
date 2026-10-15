# PostMirrorの開発ガイド

PostMirror（ポストミラー）は、日本郵便のカスタマバーコードを手入力で解読し、郵便物の写真から読める情報を確かめる防犯のための自己点検ツールです。
自分宛ての郵便物で試すことを勧め、作者は悪用を勧めない旨を画面とREADMEに記載します。
現在は第1弾の段階②まで実装しています。画面は日本語固定で、言語の切り替えは段階④で追加します。

## 構成

第1弾の完成形は次のとおりです。
「段階②以降に追加」と記したファイルは、現在のリポジトリーにはありません。

```text
postmirror/                         # ツールのルート
├── .github/                        # GitHubの設定
│   └── workflows/                  # GitHub Actionsのワークフロー
│       └── test.yml                # pushとpull_requestでNode 22のnpm testを実行
├── .gitignore                      # 機密ファイルとnode_modules/などを除外
├── CLAUDE.md                       # 開発者向けの構成、コマンド、仕様と規則
├── LICENSE                         # MIT License全文
├── README.md                       # YAMLメタデータ付きの日本語版
├── README.en.md                    # 英語版
├── package.json                    # 依存なし、scripts.testはnode --test
├── index.html                      # バーの入力画面（座学とCSPは段階④で追加）
├── style.css                       # モバイル優先の配色と配置（ダークは段階④で追加）
├── barcode-core.js                 # 対応表、チェックデジット、解読と符号化
├── extract-core.js                 # 住所表示番号の抜き出し規則
├── samples.js                      # 版付きの公式例と抜き出しの例
├── messages.js                     # 日英の文言辞書
├── app.js                          # 画面、入力と描画（言語の切り替えは段階④で追加）
├── assets/                         # READMEの日本語画面例（段階②以降に追加）
│   ├── screenshot.png              # 解読タブ（段階②以降に追加）
│   ├── screenshot2.png             # 座学タブ（段階②以降に追加）
│   ├── screenshot3.png             # 隠したバーの点検（段階②以降に追加）
│   ├── screenshot4.png             # 解読タブのダーク表示（段階②以降に追加）
│   └── en/                         # READMEの英語画面例（段階②以降に追加）
│       ├── screenshot.png          # 英語表示の解読タブ（段階②以降に追加）
│       ├── screenshot2.png         # 英語表示の座学タブ（段階②以降に追加）
│       └── screenshot3.png         # 英語表示の隠したバーの点検（段階②以降に追加）
└── test/                           # node:testのテスト
    ├── official-vectors.json       # 公式例21件と全バー列9件の独立した期待値
    ├── core.test.js                # 対応表、既知解答、復元、候補数、向きと性質
    ├── extract.test.js             # 抜き出しの段階と公式17例
    ├── readme.test.js              # 日英READMEの数値、構成と表記（段階②以降に追加）
    ├── html.test.js                # HTMLと保存先の静的検査（CSPは段階④で追加）
    ├── i18n.test.js                # 日英辞書と日本語リテラルの検査
    ├── format.test.js              # 最長行と行数の下限
    └── contrast.test.js            # ライトとダークのコントラスト（段階②以降に追加）
```

| ファイル | グローバル名 | 役割 |
|---|---|---|
| barcode-core.js | PostMirrorCore | 解読、符号化、向きの変換、文字の遮蔽、検算式の部品 |
| extract-core.js | PostMirrorExtract | 住所Bから住所表示番号を抜き出し、8段階の中間結果を返す |
| samples.js | PostMirrorSamples | 公開例のデータ |
| messages.js | PostMirrorMessages | 日英の文言 |

コアはUMD形式の通常スクリプトです。
`globalThis`へ公開し、CommonJSでは`module.exports`から同じAPIを返します。
コアはDOM、Date、乱数、ストレージ、通信に触れず、公開する定数を`Object.freeze`で固定します。
`extract-core.js`は`barcode-core.js`に依存しません。
画面は`barcode-core.js`、`extract-core.js`、`samples.js`、`messages.js`、`app.js`をこの順で`defer`付きの通常スクリプトとして読み込みます。

## コマンド

Node.js 22以上で、リポジトリーのルートから実行します。
依存パッケージのインストールは不要です。

```sh
npm test
node --check barcode-core.js
node --check extract-core.js
node --check samples.js
node --check messages.js
node --check app.js
```

`file://`で開くには、`index.html`をブラウザーで開きます。
ローカルHTTPは次を実行して`http://localhost:8000/`へアクセスします。

```sh
python -m http.server
```

## 仕様の要点

- 公式の番号は1＝ロングバー、2＝セミロングバー（上）、3＝セミロングバー（下）、4＝タイミングバー。4ステイト3バーの19記号を使う
- 構成はスタート2本、郵便番号7文字、住所表示番号13文字、チェックデジット1文字、ストップ2本の計67本。1文字は3本
- スタートは13、ストップは31。文字の添え字は0〜20で、文字iのバーの添え字は2+3i〜4+3i
- 対応表の値は数字0〜9が0〜9、ハイフンが10、CC1〜CC8が11〜18。20文字の合計SからCD＝(19−(S mod 19)) mod 19を求める
- 英字はCC1〜CC3と数字の2文字分。CC1はA〜J、CC2はK〜T、CC3はU〜Z。CC3と6〜9の組には英字を割り当てない
- 住所表示番号は英字を展開して13文字まで使い、足りなければCC4で埋める。20けた目の制御コードは残し、超過分を切り捨てる
- `bars[67]`の値は1〜4または不明を示すnull。画面の未入力はundefinedとし、未入力が残る間は解読コアへ渡さない
- 全体の状態はok、recovered、undetermined、invalid。見えた文字、チェックデジットで復元した文字、候補が残る文字を区別する
- 隠れた文字の位置の候補は郵便番号10記号、住所表示番号15記号、CDは19記号。候補数はBigIntと動的計画法で求める。並びの規則で候補を減らさない
- 向きは自動補正しない。解読結果のalternativesから利用者が操作したときだけ変換する。ok・recovered・undeterminedで、左右反転した結果がinvalidでなく郵便番号に数字が1けた以上あるときはmirror-ambiguousを出す
- `checksum.knownSum`とunknownCountは復元前の21文字を対象とする。`explainChecksum`はCDを除く20文字を対象とし、復元した文字もnullの項として残す
- 抜き出しは住所Bを入力とし、正規化、a〜zの大文字化、記号の除去、漢数字、置換、ハイフンの圧縮、先頭のハイフン除去、英字の連結の8段階。住所Aとの分割は行わない
- 漢数字は指定された接尾辞の直前の1〜99だけを変換する。非対応の並びは推測せず警告する。末尾のハイフンは残す

仕様の出典は[日本郵便の郵便番号・バーコードマニュアル](https://www.post.japanpost.jp/service/search/zipcode/zipmanual/)です。
対応表はp11、構成とチェックデジットはp12とp21、抜き出しはp19、切り捨てはp20、検証例はp25を参照します。
独立した19行の対応表を`core.test.js`に持ち、`official-vectors.json`は改変しません。
期待値の書き換えでテストを通さず、実装を仕様に合わせます。

## 守ること

- 入力したバー、郵便番号、住所表示番号、解読結果を端末外へ送らず、URLやストレージに入れない
- localStorageは言語設定の`postmirror.lang`（jaまたはen）だけに使い、読み書きをtry/catchで包む。sessionStorage、IndexedDB、Cookieは使わない
- URLから読むのは`?lang=ja|en`と読み込み時の`#learn`だけ。入力の共有リンク、解読結果のコピーボタン、郵便番号検索への値の受け渡しを作らない
- 文言は`messages.js`に集め、コアはコードと数値を返す。`barcode-core.js`にはコメントを含めて日本語を置かない
- 描画はtextContent、createElement、createElementNS、setAttributeを使う。innerHTML、インラインのイベントハンドラー、style属性を使わない
- CSPでconnect-srcをnoneにする。依存パッケージ、CDN、外部フォント、バンドラー、TypeScript、フレームワークを足さない
- file://での動作を保ち、type="module"、fetch、Workerを使わない。package.jsonにtype: moduleを追加しない
- 郵便番号データを同梱せず、地名を表示しない。第1弾に画像からの読み取りを足さない
- `test/`にブラウザー操作のスクリプトや補助のJavaScriptを置かない。node --testが自動実行するため、補助データはJSONで持つ
- 最長行はJavaScriptとCSSが160文字、HTMLが250文字。行数の下限はbarcode-core.jsが200行、extract-core.jsが60行。後続段階で対象を追加する
- 読めない文字の復元は、ほかの文字が正しく読めていることを前提とする。チェックデジットを誤り訂正や住所の実在確認として説明しない

## 素材の規則

- サンプル、スクリーンショット、テストは日本郵便の公開例と架空のデータを使う
- 本人の郵便物の写真や情報をリポジトリーに入れない
- マニュアルの画像を転載せず、図は対応表の値から自作する
- 公開例の住所の全文は、出典ページを付けて座学とテストだけに使う。READMEと画面例では符号の中身を示す
- 公開するファイルやコミットメッセージに、個人の端末のローカルパスと内部資料のパスを記載しない

## 表記

公式表記の「カスタマバーコード」と「4ステイト」を使います。
郵便のマークや日本郵便を連想させる配色、ロゴを使わず、非公式の個人作成ツールであることを明記します。
日本語はサーバー、ユーザー、ブラウザー、フォルダー、リポジトリー、パラメーター、エディター、マネージャー、インターフェイスと書きます。
「すべて」「ない」「すでに」、理解の意味の「わかる」、数字と「カ所」を使い、日本語と英数字の間に空白を入れません。
文末に全角コロンを置きません。
