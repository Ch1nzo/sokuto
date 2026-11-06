# AI 応答ステップと意図トリガー

Sokuto の自動化では、LLM (大規模言語モデル) を 2 か所で使えます。

- **AI 応答 (会話) ステップ** (`ai`): 指示と参考情報 (FAQ など) をもとに、AI がお客さんと何往復か会話します。会話が終わったら次のステップへ進みます。
- **意図 (AI が判定) トリガー** (`intent`): キーワードに一致しないメッセージでも、「配送について質問している」のような意図を AI が判定して自動化を始めます。

どちらも、設定で登録した AI プロバイダーを呼び出します。**呼び出しごとにプロバイダーの料金がかかります** (管理画面のテストや MCP の `test_flow` でも同じです)。

---

## 1. プロバイダーを選ぶ

| プロバイダー | 必要なもの | 既定のモデル | 料金 |
| --- | --- | --- | --- |
| Anthropic (Claude) | API キー ([console.anthropic.com](https://console.anthropic.com/)) | `claude-sonnet-5-5` | 入出力トークン量に応じた従量課金 |
| OpenAI 互換 | API キー、モデル名 (必須)、必要なら Base URL | なし | 各サービスの従量課金。Base URL を変えれば OpenAI 互換 API ならどれでも使えます |
| Cloudflare Workers AI | なし (Worker の `AI` バインディングを使います) | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 1 日約 10,000 ニューロンまで無料。超えると Workers の無料プランではエラー、有料プランでは従量課金 |

目安:

- 日本語の会話の質を重視するなら Anthropic か OpenAI 互換の上位モデル。
- 費用をかけずに試すなら Workers AI。ただし小さめのモデルは指示 (返答の JSON 形式) を守らないことがあります (6 を参照)。
- `npm run dev` (ローカル) では Workers AI は動きません (「Binding AI needs to be run remotely」)。ローカルでは Anthropic / OpenAI 互換を使うか、デプロイ先で試してください。

## 2. 設定する

1. 管理画面の **設定** → **AI 応答 (LLM)** を開きます。
2. **プロバイダー** を選び、**API キー** (Workers AI では不要)、必要なら **モデル** と **Base URL** を入力して **保存** します。API キーは暗号化して保存され、画面にも API にも二度と表示されません。AI の設定はワークスペースごとです (ワークスペースごとに別のプロバイダーや API キーを使えます)。
3. **接続テスト** を押し、「応答: OK」のようにモデルの返事が表示されれば完了です。

設定を削除すると、AI 応答ステップは何も送らずに次へ進み、意図トリガーは反応しなくなります。

## 3. AI 応答 (会話) ステップの書き方

ステップの種類で **AI 応答 (会話)** を選び、次を入力します。

- **AI への指示 (役割・ルール)** (必須、4,000 文字まで): AI の役割と、答えてよい範囲・答え方を書きます。`{{first_name}}` や `{{bot.hours}}` などの変数も使えます。
  - 例: 「あなたはカフェ○○の案内係です。営業時間 ({{bot.hours}}) と予約についてだけ答え、わからなければ担当者を案内してください。」
- **参考情報** (任意、20,000 文字まで): FAQ やメニュー、料金表などをそのまま貼り付けます。AI はここに書かれたことをもとに答えます。
- **最大やり取り回数** (1〜20、既定 5): AI が返事をする回数の上限です。
- **次のステップ**: 会話が終わったら進むステップです。

動き方:

1. ステップに入ると、そこに来たきっかけのメッセージ (キーワードに一致した文や、直前の質問への答え) に AI が返事をします。メッセージがない場合 (ボタンのタップや待機の後など) はあいさつから始めます。
2. そのあとはお客さんのメッセージごとに 1 回 AI を呼んで返事をします (テスト画面では「AI 応答中」と表示されます)。
3. AI が「会話の目的を果たした」「相手が終わりたがっている」と判断したとき (例: 「ありがとう」)、または最大やり取り回数に達したときに、次のステップへ進みます。

知っておくこと:

- AI は相手が書いた言語で返事をします。
- AI が覚えているのは、このステップでの直近 12 メッセージだけです。受信箱の過去の会話や、他のステップの内容は渡しません。
- 会話の途中でも「担当者」などの担当者呼び出しキーワードは先に処理され、ボットが停止します。
- ボタンのタップは AI ではなく、そのボタンの処理に回ります。
- AI が未設定・API のエラー・返事が空のときは、**何も送らず**エラーを記録して (レポートの「エラー」) 次のステップへ進みます。テストでは「notes」に `ai ai1: ai_not_configured` のように表示されます。
- シーケンス (ステップ配信) では使えません (返事を待つステップのため)。

## 4. 意図 (AI が判定) トリガーの仕組み

トリガーの種類で **意図 (AI が判定)** を選び、**意図の説明** (必須、300 文字まで。例: 「配送や送料について質問している」) と、必要なら **例文** (10 個まで) を入力します。

メッセージが届くと、次の順で判定します。

1. キーワードやコメントなどの具体的なトリガーに一致したら、それを使います (AI は呼びません)。
2. 一致しなかった場合、**会話の途中ではなく** (待機中のセッションがない)、テキストが **2 文字以上** なら、公開中の自動化 (そのチャネル向け) にある意図トリガーを**すべてまとめて 1 回の AI 呼び出し**で比べ、当てはまる自動化を始めます。
3. どれにも当てはまらなければ、これまでどおり「初めてのメッセージ」「すべてのメッセージ」のトリガーが使われます。

費用: 公開中の自動化に意図トリガーが 1 つでもあると、キーワードに一致しない 2 文字以上のメッセージのたびに AI を 1 回呼びます。意図トリガーがなければ AI は呼びません。メッセージが多いアカウントでは、よく来る質問をキーワードトリガーでも拾うと呼び出しを減らせます。

テストでは、テストしている自動化の意図トリガーだけを候補にして判定します。

## 5. テストでも課金されます

管理画面の **テスト** と MCP の `test_flow` は、LINE や Meta には何も送りませんが、AI 応答ステップと意図トリガーは**設定した AI を実際に呼び出します** (やり取り 1 回・判定 1 回ごとに 1 回)。AI を設定していないと、AI 応答ステップは notes に記録して飛ばされ、意図トリガーは反応しません。

## 6. 指示どおりの形式で返事をしないモデル

AI 応答ステップは、モデルに `{"reply": "返事", "done": true/false}` の JSON で答えるよう指示しています。コードフェンス (```json) や前後の文章が付いていても JSON の部分を読み取ります。

それでも JSON で答えないモデルの場合は、**返事の文章をそのまま送り、会話は続いている (done=false) とみなします**。この場合、会話は最大やり取り回数に達するまで終わりません。最大やり取り回数を小さめにするか、より指示に従うモデルを選んでください。意図トリガーで JSON が読めない、または候補にない ID が返ったときは「一致なし」として扱います。

---

## English summary

- **AI reply step** (`ai`): `{ "type": "ai", "instructions": "…" (≤4000; only `{{bot.*}}` placeholders are expanded, never contact data, so a customer cannot rewrite the instructions), "knowledge"?: "FAQ…" (≤20000), "maxTurns"?: 5 (1–20), "next" }`. The model answers the message that reached the step (or greets), then one API call per incoming message, until it returns `done: true` or `maxTurns` replies were sent; then the flow goes to `next`. History is the step's last 12 messages only. Hand-over keywords still win; button taps go to their buttons. If the AI is not configured or fails, nothing is sent, an `error` event is logged (dry runs: `notes`) and the flow continues. Not allowed in sequences.
- **Intent trigger** (`intent`): `{ "type": "intent", "description": "asks about shipping" (≤300), "examples"?: [...] (≤10) }`. When a message (2+ characters, no waiting session) matches no specific trigger, one AI call classifies it against the intent triggers of all live flows on that channel and starts the match; otherwise `first_message` / `any_message` apply. With at least one live intent trigger, every unmatched message costs one call.
- **Providers**: Anthropic (API key, default `claude-sonnet-5-5`), any OpenAI-compatible API (key + model, optional Base URL) or Cloudflare Workers AI (`AI` binding, free daily allowance; not available under `npm run dev`). Set it up in **Settings → AI replies (LLM)** and use **Test connection**; the key is stored encrypted. The AI settings are per workspace.
- **Costs**: each turn and each classification is billed by the provider, including runs from the admin tester and MCP `test_flow` (nothing is sent to LINE/Meta, but the AI is called for real).
- **Models that ignore the JSON format**: fenced or wrapped JSON is still parsed; plain text is sent as is and treated as `done: false`, so the conversation ends at `maxTurns`. Unparsable intent replies count as no match.
