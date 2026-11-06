# 返信ボット Soku

**Soku** (ソク) は、お客さんから届いたメッセージに AI が自動で返信するボットです。登録した FAQ・ドキュメント (Web ページや貼り付けた文章)・商品の情報だけをもとに答え、答えられないときやお客さんが人を希望したときは担当者に引き継ぎます。表示名は設定で変えられます (既定は `Soku`)。

- 管理画面: サイドバーの **「Soku」** (概要 / 返信ルール / ナレッジ / 商品 / プレイグラウンド)。受信箱には「下書きを頼む」「商品を送る」ボタンが加わります。
- コード: `src/bot.ts` (検索・プロンプト・返信の解釈・実行)、設定は `src/settings.ts` の `botConfigSchema` (設定行 `ws:<ID>:bot`)。
- AI プロバイダーは [ai.md](ai.md) の設定 (「設定」→「AI 応答 (LLM)」) を使います。**返信 1 回ごとにプロバイダーの料金がかかります。**

---

## 1. Soku が返信する条件

受信したメッセージは、まず公開中の自動化が処理します ([architecture.md](architecture.md) の「受信から返信まで」)。Soku が返信するのは、次の条件をすべて満たすときだけです。

1. 返信ルールで **Soku が有効** で、メッセージのチャネルが **対象チャネル** に入っている。
2. **AI プロバイダーが設定済み** (未設定なら何もしません。エラーも記録しません)。
3. ボット全体が停止中でなく、その連絡先が **担当者対応中 (ボット停止) でない**。担当者が受信箱から返信した相手、担当者呼び出しキーワードを送った相手、Soku が担当者に渡した相手には返信しません。
4. **公開中の自動化が一致しなかった** (キーワード・意図などのトリガー、`first_message` / `any_message` のどれにも一致しない)。自動化のほうが優先です。
5. 待機中のセッション (質問の答え待ちなど) がない。
6. **テキストメッセージ** である。コメント、ボタンのタップ (postback)、テキストのない画像・スタンプには反応しません。
7. 対象セグメントを指定していれば、その連絡先がセグメントの条件に合う。

## 2. 返信ルール (`/bot/rules`、`PUT /api/bot`)

| 項目 | 既定値 | 内容 |
| --- | --- | --- |
| `enabled` | `false` | 有効にすると、実際のお客さんに返信し始めます |
| `name` | `Soku` | 名前 (1〜30 文字)。AI への指示と、受信箱の送信元の表示に使います |
| `channels` | LINE / Messenger / Instagram | 返信するチャネル |
| `language` | `auto` | `auto` は相手の言語に合わせる。`ja` / `en` は常にその言語 |
| `segmentId` | `null` | 対象セグメント (`null` は全員)。セグメントを削除すると誰にも返信しません |
| `persona` | 空 | 役割と、会社・お店・商品の説明 (2,000 文字まで)。例: 「表参道のカフェ『ハル』の案内係。営業は 10〜19 時、火曜定休」 |
| `guidelines` | なし | 返信ガイドライン (口調・長さ・構成)。20 件まで、各 200 文字まで |
| `guardrails` | なし | してはいけないこと (例: 「返金や割引の約束をしない」)。20 件まで、各 200 文字まで |
| `unknownAction` | `handoff` | ナレッジにない質問のとき、担当者に渡す (`handoff`) か、代わりの返信を送る (`fallback`) か |
| `handoffMessage` | 担当者におつなぎします。少々お待ちください。 | 担当者に渡すときに送る文 (500 文字まで。空なら送らない) |
| `fallbackMessage` | 申し訳ありません、その内容にはお答えできません。… | `fallback` のときに送る文 (500 文字まで) |
| `maxTurns` | `10` | 同じ連絡先に 24 時間で返信する回数の上限 (1〜50)。超えると担当者に渡します |
| `autoClose` | `true` | 解決したら会話を「完了」(`status = closed`) にする |
| `resolveMessage` | 空 | 解決したときに追加で送る文 (空なら送らない) |
| `recommendProducts` | `true` | 返信に合う商品をカードで送る |
| `suggestFaqs` | `false` | 会話が完了したら、その会話から FAQ の候補を AI で作る (AI の呼び出しが 1 回増えます) |

`PUT /api/bot` は送った項目だけを変更します。範囲外の値は 400 `invalid_bot_config` (`errors` に項目ごとの理由) です。返信ガイドラインとガードレールの空行は保存時に取り除きます。

### AI に渡すもの

システムプロンプトは、名乗り / ペルソナ / 返信ガイドライン / ルール (ガードレールと固定のルール) / ナレッジ / お客さんの情報 / 出力形式 の順です。固定のルールは「ナレッジにないことは推測せず `unknown` にする」「人を希望する・怒っている・自分ではできない依頼は `handoff` にする」「相手の言語 (または指定の言語) で、チャットに合わせて短く、Markdown を使わない」「商品はナレッジの ID のものだけを薦め、創作しない」です。

- お客さんの情報は **表示名とチャネルとお店の現地時刻 (設定のタイムゾーン) だけ** です。連絡先のカスタムフィールドとボット変数 (`{{bot.*}}`) は渡しません。
- 会話の履歴は、その連絡先のテキストのある直近 12 件です (受信はお客さん、送信はボットとして渡します)。
- AI は JSON (`reply`, `action`: `answer` / `handoff` / `unknown`, `resolved`, `faqIds`, `productIds`, `reason`) で答えます。返ってきた FAQ・商品の ID は、その回に渡したナレッジにあるものだけを使い、それ以外は捨てます。JSON でない返事はそのまま返信として送ります。途中で切れた JSON や空の返事は `unknown` として扱います。

## 3. ナレッジ (`/bot/knowledge`)

### FAQ

- 質問 500 文字・回答 4,000 文字まで。状態は **承認済み** (`approved`、返信に使う) と **提案** (`suggested`、承認するまで使わない) の 2 つです。
- **言い換え** (`variants`): 1 つの回答に、最初の質問とは別の言い方の質問を 10 個 (各 500 文字) まで登録できます。検索ではどの質問も回答と一緒に数え、AI には `[F12] Q: 営業時間は? / 何時まで開いてますか A: …` のようにすべての質問を渡します。最初の質問と同じものや、言い換えどうしで同じもの (大文字小文字と前後の空白は区別しない) は登録できません。一覧・概要・MCP の要約には最初の質問だけを出します。
- 承認済み FAQ の合計 (言い換えを含む) が **6,000 文字以下なら毎回すべて** を AI に渡します。それより多いときは、メッセージとの一致が多い順に 6 件を渡します。
- 一致の数え方: メッセージを NFKC で正規化して小文字にし、英数字の語 (2 文字以上) と、漢字・ひらがな・カタカナの連続から作った 2 文字の組 (2-gram) を取り出します。FAQ・ドキュメントの段落・商品に、そのうちいくつが含まれるかを数えます (0 のものは渡しません)。
- 返信に使われた FAQ は「使用回数」(`uses`) が 1 増えます。
- **FAQ の提案**: (1) 返信ルールの「会話から FAQ を提案」がオンのとき、Soku が解決した会話や、受信箱で「完了」にした会話から最大 3 件、(2) ドキュメントの「FAQ を生成」で、ドキュメントの先頭 12,000 文字から最大 10 件を AI が作ります。それぞれに言い換えを最大 3 個付けます。質問か言い換えのどれかが既存の FAQ の質問・言い換えと同じ (大文字小文字を区別しない) ものは作りません。提案は「承認」(状態を `approved` に変更) するか「却下」(削除) します。

### ドキュメント

- **URL** (https のみ) か **貼り付けた文章** (200,000 文字まで) を登録します。
- URL は登録時に取得します。取得の条件: https のみ (リダイレクト先も https)、10 秒でタイムアウト、2 MB まで、`text/*` か `application/json` だけ。HTML はスクリプト・スタイル・ナビゲーション・ヘッダー・フッター・コメントを除いた本文のテキストにして、200,000 文字までを保存します。**PDF・画像・JavaScript で描画するページの本文は読めません** (PDF の内容は文章を貼り付けてください)。
- 取得に失敗しても登録はされ、状態が「失敗」(`failed`) になり、理由 (`http_404`、`timeout`、`unsupported_content_type`、`too_large`、`no_text`、`url_must_be_https` など) が残ります。失敗したドキュメントは返信に使いません。「再取得」で取り直せます (再取得が失敗したときは、前の本文を残したまま「失敗」になります)。
- 返信では、本文を 1,200 文字程度の段落のまとまりに分け、メッセージとの一致が多い順に 4 つを AI に渡します。
- ドキュメントを削除すると、そこから作った **提案中の** FAQ も削除します (承認済みの FAQ は残ります)。

## 4. 商品 (`/bot/products`)

- 項目: 名前 (100 文字まで、必須)、説明 (1,000 文字まで)、価格 (0 以上の整数、通貨の単位。空なら価格なし)、通貨 (既定 `JPY`)、URL・画像 URL (http / https)、タグ (20 個まで、各 30 文字まで)、SKU、在庫 (在庫ありだけを返信に使います)。
- 返信では、メッセージとの一致が多い順に 5 件を AI に渡し、AI が選んだ商品を **カード** で送ります (LINE はカルーセル、Messenger / Instagram は generic テンプレート、最大 10 枚)。カードは タイトル (40 文字) / 価格と説明 (60 文字) / 画像 / 「詳しく見る」(英語では「View」) ボタンで URL を開きます。**URL のない商品はカードにできない** ので、本文の後ろに「・名前 価格」の形で並べます。LINE はすべてのカードで同じ形が必要なため、画像は全商品に https の画像があるときだけ付けます。
- **CSV 取り込み** (`POST /api/bot/products/import`): 1 行目は見出し。使える列は `name` (必須), `description`, `price`, `currency`, `url`, `imageUrl`, `tags` (`|` か `;` 区切り), `sku`, `inStock` (`true` / `false` / `1` / `0`。空なら在庫あり) で、大文字小文字は問わず、ほかの列は無視します。ダブルクォートで囲んだ値にはカンマ・改行・`""` (引用符) を入れられます。価格の `,`・`¥`・`円` などは取り除きます。1 回 500 行まで (超えた分はエラー 1 件として報告)。**SKU が既存の商品と同じ行は、その商品の CSV にある列だけを更新** し、ほかは新規に追加します。結果は `{ imported, updated, errors: [{ line, error }] }` です。

## 5. 担当者に渡る条件

担当者に渡すと、その連絡先のボットを停止 (担当者対応中) し、待機中のセッションとシーケンスの登録を消し、通知を作り、`handoffMessage` を送ります。記録は `events` の `bot_handoff` (`meta.reason`) です。

| 理由 (`reason`) | いつ |
| --- | --- |
| `customer_request` | お客さんが人を希望した (AI の判断)。通知は「○○ が担当者を希望しています」 |
| `missing_knowledge` | ナレッジに答えがなく、`unknownAction` が `handoff` |
| `policy` | ガードレールやルールのため答えられない |
| `max_turns` | 24 時間の返信回数の上限 (`maxTurns`) に達した |
| `ai_error` | AI の呼び出しが失敗し、`unknownAction` が `handoff` (`fallback` なら何も送りません) |
| `other` | その他 |

`customer_request` 以外の通知は「Soku が ○○ の会話を担当者に渡しました (理由)」です。AI の失敗は `error` イベント (`meta: { op: "bot", error }`) にも記録します。担当者呼び出しキーワード (設定の「担当者呼び出し」) で止まった場合は、これまでどおり停止・通知・返信をしますが、`bot_handoff` は記録しません。再開は受信箱でその相手のボットを再開します。

## 6. 概要の指標 (`/bot`、`GET /api/bot/overview?days=`)

`days` は 1〜90 (既定 30) で、今日を含む UTC の日付 `days` 日分を集計します。

| 指標 | 定義 |
| --- | --- |
| `handled` (対応した会話) | 期間内に Soku が返信した (`bot_reply`) か、担当者に渡した (`bot_handoff`) 連絡先の数 |
| `replies` | 返信の数 (`bot_reply`。代わりの返信 `fallback` を含む) |
| `handoffs` | Soku が担当者に渡した数 (`bot_handoff`) |
| `resolved` | 解決した数 (`bot_resolved`。AI が「依頼が片付き、お客さんが会話の終わりを示した」と判断したとき) |
| `resolutionRate` | `resolved / handled` の百分率 (0〜100 の整数) |
| `handoffRate` | `handoffs / handled` の百分率 (0〜100 の整数) |
| `avgTurns` | `replies / handled` (小数 1 桁) |
| `series` | 日ごとの `replies` / `handoffs` / `resolved` (データのない日も 0) |
| `handoffReasons` | 担当者に渡した理由ごとの件数 (多い順) |
| `topFaqs` | 使用回数の多い FAQ 上位 5 件 (累計) |
| `topProducts` | 期間内の返信でカードを送った回数の多い商品上位 5 件 |
| `knowledge` | 承認済み FAQ・提案中の FAQ・ドキュメント・商品の件数 |

## 7. プレイグラウンド (`/bot/playground`、`POST /api/bot/playground`)

お客さんになりきって Soku と会話を試せます。**LINE / Meta には何も送らず、記録もしません** が、**AI プロバイダーは実際に呼び出すので料金がかかります** (1 往復ごとに 1 回)。Soku が無効でも試せます。結果には、Soku が実際にすること (返信・担当者に渡す (`action: "handoff"`、返信は `handoffMessage`)・代わりの返信 (`action: "unknown"`、返信は `fallbackMessage`))、解決したか、理由、使った FAQ・商品・ドキュメント、AI の生の出力 (`raw`) が入ります。1 日あたりの上限 (`maxTurns`) は確認しません。

## 8. 受信箱での手伝い

- **下書きを頼む** (`POST /api/inbox/:id/draft`): その会話の直近 12 件・ナレッジ・ペルソナから、担当者向けの返信の下書きを作ります (送信はしません)。ナレッジにないところは推測せず `[要確認]` と書くよう指示しています。Soku が無効でも使えます。AI の呼び出し 1 回分の料金がかかります。
- **商品を送る** (`POST /api/inbox/:id/products { productIds, pauseBot? }`): 選んだ商品 (1〜10 件) をカードで送ります (URL のない商品はテキストで並べます)。担当者の送信として記録し (`source: "human"`, `kind: "cards"`)、`pauseBot` が `false` でなければ通常の返信と同じくその相手のボットを停止します。
- Soku の送信は受信箱で `source: "bot"`、`payload.bot` (Soku の名前) 付きで表示されます。カードを送ったときは `payload.cards` が入ります。

## 9. API

すべて管理画面のセッションか MCP トークン (Bearer) で呼べ、開いているワークスペースのデータだけを扱います。エラーは `{ "error": "<snake_case>" }` で、見つからないものは 404 `not_found` です。

| メソッドとパス | 内容 |
| --- | --- |
| `GET /api/bot` | `{ config, aiConfigured, counts: { faqs, suggested, documents, products } }` |
| `PUT /api/bot` | 返信ルールの一部を変更 → `{ config }` (400 `invalid_bot_config` + `errors`) |
| `GET /api/bot/overview?days=30` | 概要の指標 (6 章) |
| `GET /api/bot/faqs?status=approved\|suggested\|all` | `{ faqs }` (更新日時の新しい順) |
| `POST /api/bot/faqs` | `{ question, variants?, answer, status? }` → 201 `{ faq }` (400 `invalid_faq`) |
| `PUT /api/bot/faqs/:id` | `{ question?, variants?, answer?, status? }` → `{ faq }` (`variants` を渡すと一覧ごと置き換え) |
| `DELETE /api/bot/faqs/:id` | `{ ok }` |
| `GET /api/bot/documents` | `{ documents }` (本文は返さず、文字数 `chars`) |
| `POST /api/bot/documents` | `{ name?, url?, text? }` (URL か文章のどちらかが必須) → 201 `{ document }` (400 `invalid_document`。URL の取得失敗は `status: "failed"` で 201) |
| `POST /api/bot/documents/:id/refresh` | 再取得 → `{ document }` (URL がなければ 400 `no_url`) |
| `POST /api/bot/documents/:id/faqs` | FAQ の提案を作る → `{ created }` (400 `ai_not_configured` / 502 `ai_error`) |
| `DELETE /api/bot/documents/:id` | `{ ok }` (そのドキュメントから作った提案中の FAQ も削除) |
| `GET /api/bot/products?q=` | `{ products }` (名前・SKU・タグの部分一致、名前順) |
| `POST /api/bot/products` | 商品 → 201 `{ product }` (400 `invalid_product`) |
| `PUT /api/bot/products/:id` | 一部を変更 → `{ product }` |
| `DELETE /api/bot/products/:id` | `{ ok }` |
| `POST /api/bot/products/import` | `{ csv }` → `{ imported, updated, errors }` (400 `missing_csv` / `csv_too_large`) |
| `POST /api/bot/playground` | `{ messages: [{ role, content }], channel? }` → `{ reply, action, resolved, reason, faqs, products, documents, raw }` (400 `invalid_messages` / `ai_not_configured`、502 `ai_error` + `detail`) |
| `POST /api/inbox/:id/draft` | `{ draft }` (400 `no_messages` / `ai_not_configured`、502 `ai_error`) |
| `POST /api/inbox/:id/products` | `{ productIds, pauseBot? }` → `{ ok }` (400 `invalid_product_ids` / `channel_not_configured`、送信失敗は 502) |

受信箱で会話を「完了」にしたとき (`PATCH /api/contacts/:id { status: "closed" }`) は、`suggestFaqs` がオンで AI が設定済みなら、応答の後にその会話から FAQ の提案を作ります。ワークスペースを削除すると、FAQ・ドキュメント・商品も削除します。

## 10. MCP

`get_bot` (設定と直近 30 日の概要)、`update_bot` (返信ルールの一部を変更)、`list_faqs`、`upsert_faq` (`id` があれば更新。`variants` で言い換えを最大 10 個。`status: "approved"` で提案を承認)、`delete_faq`、`list_products`、`upsert_product`、`delete_product`、`add_document`、`delete_document` の 10 個です。`get_overview` には `bot: { enabled, name }` が入ります。詳しくは [mcp.md](mcp.md)。

## 11. 制限

- 検索は語の一致を数えるだけです (意味の近さは見ません)。言い換えが多い質問は、FAQ に言い換え (`variants`) を足すか、小さい FAQ (合計 6,000 文字以下) にしてください。
- 返信のたびに、承認済み FAQ・状態が「取得済み」のドキュメントの本文・在庫ありの商品をすべて読み込みます。ドキュメントが非常に大きい (合計で数 MB) と、Workers の CPU 時間の上限に近づきます。
- 画像やスタンプの内容は読みません。

---

## English summary

**Soku** is the AI reply bot (`src/bot.ts`, settings row `ws:<id>:bot`, admin **Soku** menu: overview, rules, knowledge, products, playground). It answers inbound **text messages** that no live automation matched (triggers and intent triggers win; no session waiting; not comments, postbacks or attachments without text), only when it is enabled for the channel, an AI provider is configured, the bot is not paused globally or for the contact, and the contact is in the optional target segment. Every reply is billed by the AI provider.

- **Rules** (`PUT /api/bot`, partial update, 400 `invalid_bot_config`): `enabled`, `name` (default `Soku`), `channels`, `language` (`auto` follows the customer), `segmentId`, `persona`, `guidelines` and `guardrails` (≤ 20 × 200 chars), `unknownAction` (`handoff` or `fallback` with `fallbackMessage`), `handoffMessage`, `maxTurns` (replies per contact per 24 h, 1–50, default 10), `autoClose` and `resolveMessage`, `recommendProducts`, `suggestFaqs`.
- **Prompt**: name, persona, guidelines, rules (guardrails plus fixed rules: answer only from the knowledge or say `unknown`, hand over on request / anger / impossible asks, reply in the customer's or the fixed language, short plain text, products only by their ids), knowledge, customer (display name, channel, business local time; never custom fields or bot variables), JSON output (`reply`, `action`, `resolved`, `faqIds`, `productIds`, `reason`). History: the contact's last 12 text messages. Returned ids not in the given knowledge are dropped; non-JSON text is sent as is; empty or cut-off JSON counts as `unknown`.
- **Knowledge**: FAQs (`approved` are used, `suggested` wait for review; each has a primary `question` plus up to 10 `variants`, other phrasings of ≤ 500 chars that may not repeat the question or each other, all scored for retrieval and listed in the prompt as `Q: a / b A: …`; all approved FAQs go into every prompt while they total ≤ 6,000 chars, else the top 6), documents (https URL fetched with a 10 s timeout, 2 MB cap, https redirects only, `text/*` or JSON only, HTML reduced to text, ≤ 200,000 chars; no PDF; failures are stored as `failed` with the reason; pasted text also works; top 4 chunks of ~1,200 chars per reply), products (top 5 in stock; sent as LINE carousel / Meta generic cards with a link button, at most 10, products without a URL listed as text; CSV import with columns `name, description, price, currency, url, imageUrl, tags (| or ;), sku, inStock`, ≤ 500 rows, an sku match updates only the columns present). Ranking counts matched query terms (NFKC, lower case, latin words of 2+ chars and kanji / kana 2-grams). FAQ suggestions come from finished conversations (≤ 3, when `suggestFaqs` is on) and from documents (≤ 10, on request), each with ≤ 3 variants, skipping items whose question or variant already exists as a question or variant.
- **Hand-over**: pauses the bot for the contact, clears its session and sequences, notifies the team, sends `handoffMessage` and records `bot_handoff` with `reason` (`customer_request`, `missing_knowledge`, `policy`, `max_turns`, `ai_error`, `other`). Hand-over keywords keep working as before and do not record `bot_handoff`.
- **Overview** (`GET /api/bot/overview?days=`, UTC days): `handled` = contacts with a `bot_reply` or `bot_handoff` in the period, `replies`, `handoffs`, `resolved`, `resolutionRate` and `handoffRate` (% of handled), `avgTurns`, daily `series`, `handoffReasons`, `topFaqs` (all-time uses), `topProducts` (cards sent in the period), knowledge counts.
- **Playground** (`POST /api/bot/playground`): shows what Soku would do without sending or logging anything, but calls the AI provider (billed). **Inbox**: `POST /api/inbox/:id/draft` drafts a reply for the staff member (billed); `POST /api/inbox/:id/products` sends product cards as a human reply and pauses the bot unless `pauseBot: false`. Closing a conversation in the inbox makes FAQ suggestions when `suggestFaqs` is on.
- **MCP**: `get_bot`, `update_bot`, `list_faqs`, `upsert_faq` (takes `variants`), `delete_faq`, `list_products`, `upsert_product`, `delete_product`, `add_document`, `delete_document`; `get_overview` reports `bot: { enabled, name }`.
