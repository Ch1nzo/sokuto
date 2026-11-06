# アーキテクチャ

Sokuto は 1 つの Cloudflare Worker で動きます。Worker が Webhook の受信、管理画面用の API、MCP サーバー、1 分ごとの定期処理 (Cron) をすべて担当し、データは D1 (SQLite) と KV に保存します。管理画面 (React SPA) は同じ Worker の静的アセットとして配信されます。

## リクエストの流れ

```
                    ┌──────────────────────────── Cloudflare (あなたのアカウント) ────────────────────────────┐
                    │                                                                                          │
 LINE ──POST /webhooks/line (X-Line-Signature)──┐                                                            │
 Meta ──GET  /webhooks/meta (hub.verify_token)──┤                                                            │
 Meta ──POST /webhooks/meta (X-Hub-Signature-256)┤   Worker: src/index.ts (Hono)                               │
                    │                           ├─▶ routes/webhooks.ts ─ 署名検証 ─▶ 200 を即返す             │
                    │                           │        └ waitUntil: channels/*.ts で正規化 ─▶ inbound.ts     │
                    │                           │                                   └▶ flows/engine.ts ─▶ 送信 │
 ブラウザ ──/api/*  (Cookie セッション)──────────┼─▶ auth/index.ts ─▶ routes/api.ts                            │
 AI ─────── /mcp    (Bearer トークン)────────────┼─▶ routes/mcp.ts (MCP ツール)                                 │
 ブラウザ ── それ以外のパス ─────────────────────┼─▶ 静的アセット dist/client (SPA フォールバック)              │
                    │                           │    /privacy, /data-deletion もここから                       │
 Cron (* * * * *) ──────────────────────────────┴─▶ scheduler.ts (待機の再開・一斉配信・古い重複記録の削除)  │
                    │                                                                                          │
                    │        D1 (DB): 連絡先・会話・自動化・統計          KV (KV): 自動生成の鍵・パスワード     │
                    └──────────────────────────────────────────────────────────────────────────────────────────┘
```

- `wrangler.jsonc` の `assets.run_worker_first` に `/api/*`, `/webhooks/*`, `/mcp`, `/mcp/*`, `/health` が指定されており、これらは Worker のコードが処理します。それ以外のパスは静的アセット (`dist/client`) が返され、見つからないパスは `index.html` (SPA) が返されます。
- Webhook は署名を検証したらすぐに応答を返し、実際の処理 (連絡先の作成、自動化の実行、送信) は `ctx.waitUntil` でバックグラウンドで行います。LINE / Meta のタイムアウトを避けるためです。
- `GET /health` は `{ "ok": true, "name": "sokuto" }` を返します。

## データモデル (D1)

定義は `src/db/schema.ts` (Drizzle ORM)、マイグレーションは `migrations/` にあります。日時はすべて ISO 8601 文字列 (UTC) です。

| テーブル | 内容 |
| --- | --- |
| `settings` | キーと JSON 値。`general` (ボット名・言語・タイムゾーン・全体停止・担当者呼び出しキーワードと返信)、`channel:line`、`channel:meta` (トークンは暗号化済み) |
| `contacts` | 連絡先。`channel` + `channel_user_id` で一意。表示名、ユーザー名、カスタムフィールド (JSON)、`bot_paused` / `bot_paused_until`、最終受信・送信日時、未読数 |
| `contact_tags` | 連絡先とタグの対応 (連絡先ごとにタグは一意) |
| `messages` | 会話履歴。`direction` (in/out)、`source` (user/bot/human/system)、`kind` (text/image/postback/comment/event)、送信エラー |
| `flows` | 自動化。名前、チャネル (`any`/`line`/`messenger`/`instagram`)、状態 (`draft`/`live`)、定義 (JSON) |
| `sessions` | 連絡先ごとに 1 つの実行中セッション。どの自動化のどのステップで、何を待っているか (`input`/`button`/`delay`)、再開日時 |
| `broadcasts` | 一斉配信。対象チャネル・タグ、本文、予約日時、状態 (`scheduled`/`running`/`done`/`canceled`)、件数 |
| `broadcast_jobs` | 配信の宛先 1 件ごとの送信状態 (`pending`/`sent`/`failed`/`skipped`) |
| `events` | レポート用の記録。`trigger_fired`, `step_sent`, `button_clicked`, `input_saved`, `flow_completed`, `comment_replied`, `error` |
| `processed_events` | 処理済みの Webhook イベント ID。再送されたイベントを二重に処理しないため。2 日より古いものは定期処理で削除 |
| `notifications` | 「担当者に通知」アクションや担当者呼び出しで作られる通知 |

KV には次のキーが入ります。

| キー | 内容 |
| --- | --- |
| `secret:session_secret` | 管理画面のセッション Cookie の署名鍵 (初回に自動生成) |
| `secret:enc_key` | チャネルのトークンを暗号化する AES-GCM 鍵 (初回に自動生成) |
| `secret:meta_verify_token` | Meta Webhook の検証トークン (初回に自動生成) |
| `admin:password` | 管理者パスワードのハッシュ (PBKDF2) |
| `mcp:token_hash` | MCP トークンの SHA-256 ハッシュ |
| `ratelimit:login:<IP>` | ログイン試行回数 (15 分で消える) |

## フローエンジン

コードは `src/flows/` にあります。

### 定義

自動化は `{ triggers, entry, steps }` という JSON です (`src/flows/types.ts`)。ステップはグラフになっていて、各ステップが次のステップの ID (`next`、条件分岐なら `yes`/`no`、ボタンならボタンごとの `next`) を持ちます。`null` で終了です。

- トリガー 9 種類: `keyword`, `comment`, `first_message`, `follow`, `any_message`, `ref`, `postback`, `story_mention`, `story_reply`
- ステップ 8 種類: `message`, `question`, `condition`, `action`, `delay`, `random`, `goto`, `comment_reply`
- 変数: `{{name}}`, `{{first_name}}`, `{{username}}`, `{{last_input}}`, `{{<フィールド名>}}` (例: `{{phone}}`), `{{bot.<キー>}}` (設定の「ボット変数」。例: `{{bot.hours}}`。未定義のものはそのまま残ります)
- 条件の特殊項目: `channel`, `last_input`, `name`, `is_follower` (Instagram のフォロー状態。他のチャネルは常に `true`), `hour` (設定のタイムゾーンで 0〜23), `weekday` (0=日〜6=土), `days_since_created` (登録からの日数), `days_since_last_inbound` (前回受信からの日数。新規は空)。それ以外は連絡先のフィールド名で、`tag` は `has_tag` / `not_has_tag` と組み合わせます。判定は `src/flows/rules.ts` の純粋関数です。

`src/flows/validate.ts` が Zod で構造を検証し、存在しないステップへの参照や ID の重複をエラーにします。AI 向けの説明文 `FLOW_SCHEMA_DOC` も同じファイルにあり、MCP の `get_flow_schema` で返されます。

### 受信から返信まで (`src/inbound.ts`)

1. `processed_events` でイベント ID を確認し、処理済みなら何もしない。
2. 連絡先を探す / 作る (新規ならプロフィールを取得)。受信メッセージを記録し、未読数を増やす。
3. 設定でボット全体が停止中なら終了。
4. **担当者呼び出しキーワード** (初期値: 担当者・オペレーター・human・agent) を含むメッセージなら、その連絡先のボットを停止し、セッションを消し、通知を作り、設定の返信文を送って終了。
5. その連絡先のボットが停止中なら終了 (`bot_paused_until` を過ぎていれば自動で再開)。
6. **待機中のセッションがあれば続きを実行**。質問の答えならフィールドに保存して次へ、ボタンなら押されたボタンの `next` へ。関係のない入力なら 7 へ進む。
7. **ボタンの payload** (`sk:...`) なら、セッションがなくてもその自動化の続きを実行。
8. **トリガーを照合**。公開中の自動化を ID 順に見て、具体的なトリガー (キーワード、コメントなど) が最初に一致したものを採用。`first_message` / `any_message` は他に一致がないときだけ使う (`first_message` が `any_message` より優先)。`any_message` に `cooldownHours` があり、その連絡先で同じ自動化が指定時間内に起動済み (`events` の `trigger_fired`) なら起動しない。

### セッションと待機

1 人の連絡先につきセッションは 1 つです (`sessions` の主キーが `contact_id`)。実行はステップを順に進め、次のどれかで止まります。

- **`input`**: `question` ステップ。次のメッセージを答えとして指定のフィールドに保存します。選択肢 (`choices`) がある場合、選択肢以外の入力はトリガー照合に回されます。入力チェック (`validate`: email / phone / number / url / date) がある場合は答えを検証して正規化してから保存します (電話番号は記号を除いた数字、日付は `YYYY-MM-DD`)。形式が違えば `retryText` (未設定なら既定の文) を送り、そのまま待ち続けます。`skipLabel` があるとクイックリプライの末尾にスキップボタン (payload `sk-skip`) が付き、押されるとフィールドを保存せずに次のステップへ進みます。
- **`button`**: `next` を持つボタン付きの `message` ステップ。ボタンが押されるのを待ちます。
- **`delay`**: `delay` ステップ。`resume_at` を記録し、定期処理が時刻になったら再開します。10 秒以下の待機は (1 回の実行で合計 20 秒まで) セッションを保存せず、相手に入力中の表示 (Meta `typing_on` / LINE ローディング) を出してその場で待ってから次へ進みます。

1 回の実行で進むステップは最大 50 です (無限ループ防止)。送信に失敗するとセッションは終了します。

### ボタンの payload

ボタンには `sk:<自動化 ID>:<ステップ ID>:<ボタン番号>` という payload が付きます (例: `sk:12:m1:0`)。質問の選択肢には `sk-choice:<選択肢>` が付きます。

payload に自動化とステップの情報が入っているので、**セッションがなくても続きを実行できます**。これは Facebook / Instagram のコメントからの流れで重要です。コメントで始まった自動化の最初のメッセージは、コメントへの「プライベート返信」として Messenger に届きます。コメントの投稿者の ID と Messenger の ID は別物として届くことがあり、セッションとはつながりませんが、お客さんが DM のボタンを押すと payload から自動化とステップがわかるので、Messenger 側で会話を続けられます。

### メッセージの描画

ステップの内容は、チャネルに依存しない `OutboundMessage` (`text`, `imageUrl`, `attachment`, `buttons`, `cards`, `quickReplies`) に変換され、各チャネルのアダプターが実際の形式に変換します。送る順番は 画像 → 添付 → 本文 (+ボタン) → カルーセルで、クイックリプライは最後のメッセージに付きます。

- ボタンが 3 個以下でリンク (URL) ボタンを含む場合はボタンテンプレート、それ以外はクイックリプライ (最大 13 個) になります。
- LINE: ボタンテンプレート (最大 4 個) またはクイックリプライ。
- Messenger: ボタンテンプレート (最大 3 個) またはクイックリプライ。
- Instagram: ボタンテンプレートの代わりに、postback ボタンはクイックリプライ、リンクは generic テンプレートで送ります。
- **カード (`cards`、最大 10 枚)**: LINE はカルーセルテンプレート (タイトル 40 文字・本文 60 文字)、Messenger / Instagram は generic テンプレート (タイトル・サブタイトル 80 文字)。各カードのボタンは 1〜3 個で、LINE の制約によりすべてのカードで同じ数にする必要があります (検証エラー)。ボタン番号はトップレベルのボタンから数え、続けてカード 1 枚目、2 枚目… のボタンに通し番号を振ります (`flattenButtons`)。
- **添付 (`attachment`: video / audio / file)**: Messenger は添付として送ります。Instagram はファイルを送れないので URL をテキストで送ります。LINE は動画 (`previewImageUrl` 必須) と音声 (`durationMs` 必須) のみ送れるため、それらが無い場合とファイルは URL をテキストで送ります (検証時に警告)。

### テスト実行

`src/flows/simulate.ts` は、`RecordingAdapter` (送信内容を記録するだけのアダプター) を使い、仮の連絡先「テスト 太郎」で自動化を実行します。セッション・タグ・通知はメモリ上だけで扱い、D1 にも LINE / Meta にも何も書き込みません。待機ステップは待たずに次へ進みます。管理画面の「テスト」と MCP の `test_flow` が使います。

## チャネルアダプター

コードは `src/channels/` にあります。

- `types.ts`: チャネルに依存しない受信イベント `InboundEvent` と送信メッセージ `OutboundMessage`。
- `adapter.ts`: `ChannelAdapter` インターフェース (`send`, `getProfile`, 任意で `replyToComment`, `sendPrivateReply`, `likeComment`)。`getProfile` が返す `ChannelProfile.followsBusiness` は Instagram のフォロー有無で、条件の `is_follower` が使います (自動化の実行ごとに 1 回だけ取得)。
- `registry.ts`: 保存された設定からアダプターを作る `getAdapter`。
- `line.ts`: 署名検証 (HMAC-SHA256、Base64)、Webhook の解析、送信。送信時は、受信時の **reply token を 1 回だけ使い** (無料)、使用済みや期限切れならプッシュ API で送ります。管理画面用に、Bot 情報の取得、Webhook URL の登録 (`PUT /v2/bot/channel/webhook/endpoint`)、Webhook のテストも実装しています。
- `meta.ts`: 署名検証 (`X-Hub-Signature-256`、HMAC-SHA256 hex)、`page` / `instagram` 両方の Webhook の解析 (メッセージ、postback、クイックリプライ、ref、ストーリーへのメンション・返信、Facebook の `feed` コメント、Instagram の `comments`)、Send API での送信、コメントへの公開返信とプライベート返信、コメントへのいいね (`POST /{comment-id}/likes`。失敗はエラーイベントとして記録)。Instagram のプロフィール取得では `is_user_follow_business` も読みます (相手が DM を送った後にだけ取得できます)。管理画面用に、ページアクセストークンの確認 (ページとリンクされた Instagram ビジネスアカウントの取得) と、ページの購読 (`subscribed_apps`) を実装しています。Graph API のバージョンは環境変数 `META_GRAPH_VERSION` (初期値 `v25.0`) です。

Messenger と Instagram は 1 つの Meta アプリ (1 つの設定 `channel:meta`) を共有し、ページにリンクされた Instagram アカウントがあれば Instagram も有効になります。

## 定期処理 (`src/scheduler.ts`)

Cron で 1 分ごとに実行されます (管理用 API `POST /api/scheduler/run` で手動実行も可能)。

1. **待機の再開**: `resume_at` を過ぎた `delay` セッションを最大 25 件、続きから実行します。自動化が下書きに戻っていたらセッションを消します。10 秒以下の待機は 1 回の実行で合計 20 秒まではその場で待つため、ここに来るのはそれより長い待機だけです。
2. **一斉配信**: 予約時刻を過ぎた配信の宛先 (`broadcast_jobs`) を作り、1 分あたり最大 30 件送信します。
   - Messenger / Instagram の宛先は、最後の受信から 24 時間を過ぎていれば送らずに「対象外 (skipped)」にします (Meta の 24 時間ルール)。
   - LINE はプッシュ API で送ります (料金プランの通数に数えられます)。
3. **掃除**: 2 日より古い `processed_events` を削除します。

注意: 待機の再開時には 24 時間ルールを確認していません。Messenger / Instagram で 24 時間を超える待機のあとに送るメッセージは、Meta 側でエラーになります。

## セキュリティモデル

- **デプロイ時に秘密情報は不要**: セッション署名鍵、暗号化鍵、Meta 検証トークンは、初回に必要になった時点でランダムに生成され、あなたの KV に保存されます (`src/settings.ts` の `getOrCreateSecret`)。`.dev.vars` も通常は不要です。
- **チャネルのトークンは暗号化して D1 に保存**: LINE のチャネルシークレット・アクセストークン、Meta の app secret・ページアクセストークンは、KV にある鍵を使った **AES-GCM** で暗号化して `settings` テーブルに保存します。D1 のデータだけが漏れてもトークンは読めません。
- **管理者パスワード**: **PBKDF2-SHA256 (100,000 回、ランダムなソルト)** でハッシュ化して KV に保存します。8 文字以上が必要です。
- **初回セットアップ**: 管理者パスワードが未設定のとき、最初にアクセスした人がパスワードを設定できます。デプロイ後すぐに設定してください。
- **セッション**: ログインすると、HMAC-SHA256 で署名された有効期限 30 日のトークンが Cookie (`sokuto_session`、HttpOnly、SameSite=Lax、HTTPS では Secure) に入ります。サーバー側にセッションの一覧は持ちません。ログアウトは Cookie を消すだけなので、すべてのセッションを無効にしたいときは KV の `secret:session_secret` を削除します (次のアクセスで新しい鍵が作られます)。
- **ログインの試行制限**: IP アドレスごとに、15 分間で 10 回までです (KV で数えます)。
- **MCP トークン**: `sk_` で始まるランダムな文字列で、KV には SHA-256 ハッシュだけを保存します。MCP (`/mcp`) と管理用 API (`/api/*`) の両方に使えます。再発行と無効化はパスワードでログインしたセッションからだけ行えます。
- **Webhook の検証**: LINE は `X-Line-Signature` (チャネルシークレットによる HMAC)、Meta は `X-Hub-Signature-256` (app secret による HMAC) を、定数時間比較で検証します。署名が合わないリクエストは 401 で拒否します。
- **重複処理の防止**: Webhook の再送で同じイベントが届いても、`processed_events` で 1 回だけ処理します。

---

## English summary

Sokuto is a single Cloudflare Worker (Hono). `run_worker_first` routes `/api/*`, `/webhooks/*`, `/mcp` and `/health` to code; everything else is served from the static admin SPA (`dist/client`, SPA fallback), including `/privacy` and `/data-deletion`. Webhooks are signature-checked, answered immediately, and processed in `waitUntil`.

- **Data**: D1 tables `settings`, `contacts`, `contact_tags`, `messages`, `flows`, `sessions`, `broadcasts`, `broadcast_jobs`, `events`, `processed_events`, `notifications`; KV holds auto-generated secrets, the password hash, the MCP token hash and login rate-limit counters.
- **Flow engine**: a flow is `{ triggers, entry, steps }` (9 triggers, 8 step types). One session per contact waits for `input`, `button` or `delay`. Inbound order: dedupe → contact upsert → global pause → hand-over keywords → per-contact pause → resume session → button payload → trigger match (specific triggers beat `first_message`/`any_message`). Button payloads `sk:<flow>:<step>:<i>` let a conversation continue without a session, which is how Facebook/Instagram comment private replies continue in Messenger. `simulate.ts` dry-runs flows with a recording adapter.
- **Adapters**: `ChannelAdapter` with LINE (reply token used once, then push) and Meta (Messenger + Instagram, comment replies, private replies and likes (`likeComment`), Instagram follow status as `ChannelProfile.followsBusiness` for `is_follower`, page token inspection and page subscription).
- **Scheduler**: every minute, resumes up to 25 due delays (delays ≤10 s run inline), sends broadcasts at 30/minute (skipping Meta contacts outside the 24 h window), and prunes dedupe records. Delay resumes do not check the 24 h window.
- **Security**: no deploy-time secrets; channel tokens AES-GCM encrypted in D1 with a key in KV; PBKDF2 (100k) password hash; HMAC-signed 30-day cookie sessions; 10 login attempts per IP per 15 minutes; MCP token stored as SHA-256 and valid for `/mcp` and `/api/*`; constant-time webhook signature checks.
