# 開発ガイド

Sokuto をローカルで動かしたり、改造したり、手動でデプロイしたりする人向けのページです。Deploy to Cloudflare ボタンで使うだけなら、このページは読まなくて構いません。

## 必要なもの

- Node.js 22 以上
- npm
- (手動デプロイする場合) Cloudflare アカウント

## 使っている技術

- 実行環境: Cloudflare Workers (`nodejs_compat`)、D1、KV、Cron Triggers、静的アセット
- サーバー: [Hono](https://hono.dev/)、[Drizzle ORM](https://orm.drizzle.team/) (D1)、[Zod](https://zod.dev/)、MCP TypeScript SDK + `@hono/mcp`
- 管理画面: React 19、React Router、Vite
- テスト: Vitest
- 設定: `wrangler.jsonc`

## セットアップ

```bash
git clone https://github.com/OWNER/sokuto.git   # OWNER は実際のリポジトリに置き換え
cd sokuto
npm install            # postinstall で wrangler types が実行され、worker-configuration.d.ts が作られます
npm run migrate:local  # ローカルの D1 にテーブルを作る
```

秘密情報の設定は不要です。セッション鍵・暗号化鍵・Meta の検証トークンは、初回アクセス時に自動で作られてローカルの KV に保存されます。Graph API のバージョンを変えたいときだけ、`.dev.vars.example` を `.dev.vars` にコピーして `META_GRAPH_VERSION` を設定します。

## ローカルで動かす

### Worker と管理画面をまとめて動かす

```bash
npm run dev
```

管理画面をビルド (`vite build` → `dist/client`) してから `wrangler dev` を起動します。http://localhost:8787 を開くと、管理者パスワードの設定画面が表示されます。D1 と KV はローカルのシミュレーター (`.wrangler/` 以下) が使われ、本番のデータには触れません。

### 管理画面を編集しながら動かす

```bash
# ターミナル 1
npm run dev        # Worker を :8787 で起動

# ターミナル 2
npm run dev:ui     # Vite の開発サーバーを :5173 で起動
```

http://localhost:5173 を開くと、管理画面の変更がすぐに反映されます。`/api`、`/webhooks`、`/mcp` へのリクエストは Vite が http://localhost:8787 へ転送します (`vite.config.ts`)。

### 定期処理 (Cron) を試す

ローカルでは Cron は自動で動きません。管理画面にログインした状態で `POST /api/scheduler/run` を呼ぶか、`npx wrangler dev --test-scheduled` で起動して `http://localhost:8787/__scheduled` にアクセスすると、定期処理を 1 回実行できます。

### LINE / Meta の Webhook を試す

LINE と Meta はインターネットから到達できる HTTPS の URL にしか Webhook を送れません。ローカルで試す場合は `cloudflared tunnel --url http://localhost:8787` などのトンネルを使います。多くの場合は、管理画面の「テスト」機能 (`src/flows/simulate.ts`) で十分です。

## テストと型チェック

```bash
npm test           # Vitest (tests/**/*.test.ts)
npm run typecheck  # Worker (tsconfig.json) と管理画面 (admin/tsconfig.json) の型チェック
```

## データベースを変更する

1. `src/db/schema.ts` を編集します。
2. マイグレーションを生成します。

   ```bash
   npm run db:generate   # drizzle-kit generate → migrations/ に SQL が追加される
   ```

3. ローカルに適用します。

   ```bash
   npm run migrate:local
   ```

本番では、`npm run deploy` が最初に `wrangler d1 migrations apply DB --remote` を実行するので、デプロイ時に自動で適用されます。Deploy to Cloudflare ボタンでインストールした人も、リポジトリに変更が push されると Cloudflare のビルドで同じスクリプトが実行されます。

## 手動でデプロイする

Deploy to Cloudflare ボタンを使わずに、自分のパソコンからデプロイする方法です。

1. Cloudflare にログインします。

   ```bash
   npx wrangler login
   ```

2. D1 データベースと KV を作ります。

   ```bash
   npx wrangler d1 create sokuto-db
   npx wrangler kv namespace create KV
   ```

3. 表示された ID を `wrangler.jsonc` の `d1_databases[0].database_id` と `kv_namespaces[0].id` に書き込みます (リポジトリの値はダミーの `0000...` です)。
4. デプロイします。

   ```bash
   npm run build    # 管理画面をビルド
   npm run deploy   # D1 マイグレーションを本番に適用 → wrangler deploy
   ```

5. 表示された `https://sokuto.<あなたのサブドメイン>.workers.dev` を開き、管理者パスワードを設定します。

## npm スクリプト一覧

| スクリプト | 内容 |
| --- | --- |
| `build` | `vite build`。管理画面を `dist/client` にビルド |
| `deploy` | `wrangler d1 migrations apply DB --remote && wrangler deploy` |
| `dev` | `vite build && wrangler dev` (http://localhost:8787) |
| `dev:ui` | `vite` (http://localhost:5173、API は :8787 へ転送) |
| `migrate:local` | ローカルの D1 にマイグレーションを適用 |
| `db:generate` | `drizzle-kit generate`。スキーマからマイグレーションを生成 |
| `typecheck` | Worker と管理画面の型チェック |
| `test` | `vitest run` |
| `cf-typegen` | `wrangler types` でバインディングの型 (`worker-configuration.d.ts`) を生成 |

## ディレクトリ構成

```
sokuto/
├── wrangler.jsonc            # Worker の設定 (D1: DB, KV: KV, Cron 毎分, 静的アセット, META_GRAPH_VERSION)
├── package.json              # スクリプトと、Deploy ボタン用のバインディング説明 ("cloudflare.bindings")
├── vite.config.ts            # 管理画面のビルド設定 (root: admin, 出力: dist/client)
├── drizzle.config.ts         # drizzle-kit の設定
├── migrations/               # D1 のマイグレーション SQL
├── src/                      # Worker
│   ├── index.ts              # エントリポイント (ルーティングと scheduled ハンドラー)
│   ├── env.ts                # 環境変数・バインディングの型
│   ├── auth/index.ts         # 初回パスワード設定、ログイン、Cookie セッション、MCP Bearer 認証
│   ├── routes/
│   │   ├── webhooks.ts       # POST /webhooks/line, GET/POST /webhooks/meta
│   │   ├── api.ts            # 管理画面用 REST API (/api/*)
│   │   └── mcp.ts            # MCP サーバー (/mcp) とツール定義
│   ├── channels/
│   │   ├── types.ts          # InboundEvent / OutboundMessage など共通の型
│   │   ├── adapter.ts        # ChannelAdapter インターフェースとテスト用 RecordingAdapter
│   │   ├── registry.ts       # 設定からアダプターを作る getAdapter
│   │   ├── line.ts           # LINE Messaging API
│   │   └── meta.ts           # Messenger / Instagram (Graph API)
│   ├── flows/
│   │   ├── types.ts          # フロー定義の型 (トリガー・ステップ・アクション)
│   │   ├── validate.ts       # Zod による検証と、AI 向け説明 FLOW_SCHEMA_DOC
│   │   ├── engine.ts         # フローの実行 (トリガー照合、ステップ実行、セッション)
│   │   ├── simulate.ts       # テスト実行 (何も送らない)
│   │   └── templates.ts      # テンプレート 6 種類
│   ├── inbound.ts            # 受信イベントの処理 (重複排除、担当者呼び出し、トリガー照合)
│   ├── scheduler.ts          # 定期処理 (待機の再開、一斉配信)
│   ├── contacts.ts           # 連絡先・タグ・フィールド・ボット停止
│   ├── settings.ts           # 設定、チャネル設定の暗号化保存、自動生成の秘密情報
│   ├── crypto.ts             # HMAC、PBKDF2、署名付きトークン、AES-GCM
│   └── db/                   # Drizzle のスキーマと接続
├── admin/                    # 管理画面 (React SPA)
│   ├── index.html
│   ├── public/               # privacy.html, data-deletion.html, favicon.svg (そのまま配信)
│   └── src/
│       ├── App.tsx           # ルーティングとサイドメニュー
│       ├── pages/            # 各画面 (ダッシュボード、チャネル接続、自動化 など)
│       └── lib/              # API クライアント、i18n (日本語 / 英語)
├── tests/                    # Vitest のテスト (*.test.ts)
└── docs/                     # ドキュメント
```

管理画面は Vite のエイリアス `@shared` で `src/` の型 (例: `@shared/flows/types`) を参照しています。

## 新しいチャネルを追加する

例として、新しいメッセージングサービス `foo` を追加する場合の手順です。

1. **型**: `src/channels/types.ts` の `Channel` と `CHANNELS` に `'foo'` を追加します。
2. **アダプター**: `src/channels/foo.ts` を作り、次を実装します。
   - 署名検証の関数 (例: `verifyFooSignature`)
   - Webhook 本文を `InboundEvent[]` に変換する関数 (戻り値は `ParsedWebhook`)
   - `ChannelAdapter` を実装したクラス (`send`, `getProfile`。コメント機能があれば `replyToComment`, `sendPrivateReply`)。`OutboundMessage` のボタン・クイックリプライをサービスの形式に変換します。ボタンの `payload` (`sk:...`) はそのまま返ってくるようにしてください。
3. **設定**: `src/settings.ts` に `FooConfig` 型を追加し、`ChannelConfigs` に `foo` を加えます。秘密の値のフィールド名を `SECRET_FIELDS` に追加すると、自動で暗号化されます。`configuredChannels` にも追加します。
4. **レジストリ**: `src/channels/registry.ts` の `getAdapter` で `FooAdapter` を返すようにします。
5. **Webhook**: `src/routes/webhooks.ts` に `POST /foo` を追加します。署名を検証し、`processAll` に渡してください (処理は `waitUntil` で行い、すぐに 200 を返します)。`/webhooks/*` は `run_worker_first` に含まれているので、`wrangler.jsonc` の変更は不要です。
6. **管理 API**: `src/routes/api.ts` に `POST/DELETE /channels/foo` (と必要なら `/channels/foo/test`) を追加し、`GET /channels` の応答に状態と Webhook URL を加えます。
7. **検証と MCP**: `src/flows/validate.ts` の `flowChannelSchema`、`src/routes/mcp.ts` の `z.enum(['line', 'messenger', 'instagram'])` (`test_flow`, `list_contacts`) に `'foo'` を追加します。
8. **管理画面**: `admin/src/pages/Channels.tsx` に接続フォームを、`admin/src/lib/i18n.ts` に `channel_foo` などの文言を追加します。
9. **テスト**: `tests/` に署名検証と Webhook 解析のテストを追加します。
10. **ドキュメント**: `docs/setup-foo.md` を書きます。

## 新しいステップを追加する

例として、ステップ `typing` (入力中の表示) を追加する場合の手順です。

1. **型**: `src/flows/types.ts` の `Step` に `{ id: string; type: 'typing'; seconds: number; next?: string | null }` を追加し、`STEP_TYPES` にも加えます。
2. **検証**: `src/flows/validate.ts` の `stepSchema` に Zod の定義を追加し、`validateFlow` の `switch` で `next` の参照チェックを追加します。
3. **AI 向け説明**: 同じファイルの `FLOW_SCHEMA_DOC` に書式と使い方を追加します。AI はこの説明だけを見てフローを作るので、例を含めて具体的に書いてください。
4. **実行**: `src/flows/engine.ts` の `runFrom` の `switch` に処理を追加します。
   - すぐ次へ進むなら `current = step.next ?? null` として `break`。
   - お客さんの入力を待つなら `saveSession(ctx, { stepId, waiting: '...' })` して `return` し、`resumeSession` に再開の処理を追加します。
   - `ctx.dryRun` が true のとき (テスト実行) は、外部への送信や D1 への書き込みをしないようにします。
5. **管理画面**: 自動化の編集画面にフォームを追加し、`admin/src/lib/i18n.ts` に `step_typing` の文言 (日本語・英語) を追加します。
6. **テスト**: `tests/` に検証とテスト実行 (`simulateFlow`) のテストを追加します。

---

## English summary

- Prerequisites: Node 22+, npm. `npm install` (runs `wrangler types`), then `npm run migrate:local`. No secrets are needed; keys are generated into local KV on first use. `.dev.vars` is only for overriding `META_GRAPH_VERSION`.
- `npm run dev` builds the admin and starts `wrangler dev` on :8787. `npm run dev:ui` starts Vite on :5173 and proxies `/api`, `/webhooks` and `/mcp` to :8787. Trigger the scheduler with `POST /api/scheduler/run` (logged in) or `wrangler dev --test-scheduled` + `/__scheduled`. Use a tunnel such as `cloudflared` to receive real webhooks locally.
- `npm test` (Vitest, `tests/**/*.test.ts`), `npm run typecheck` (worker and admin).
- After editing `src/db/schema.ts`, run `npm run db:generate` and `npm run migrate:local`; `npm run deploy` applies migrations remotely before deploying.
- Manual deploy: `npx wrangler login`, create the D1 database and KV namespace, put their IDs into `wrangler.jsonc` (the repo has dummy IDs), then `npm run build && npm run deploy`.
- Adding a channel: extend `Channel`, write an adapter implementing `ChannelAdapter` plus signature check and webhook parser, add a config type (secret fields listed in `SECRET_FIELDS` are encrypted), wire `registry.ts`, `routes/webhooks.ts`, `routes/api.ts`, `flowChannelSchema`, the MCP enums, the admin Channels page and i18n.
- Adding a step type: extend `Step`/`STEP_TYPES`, `stepSchema` and reference checks in `validateFlow`, document it in `FLOW_SCHEMA_DOC`, implement it in `runFrom` (respect `ctx.dryRun`; use `saveSession`/`resumeSession` if it waits), then add the editor UI, i18n strings and tests.
