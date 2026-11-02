# AI (ChatGPT / Claude) から flowmaker を操作する (MCP)

**MCP (Model Context Protocol)** は、AI アシスタントが外部のツールを安全に呼び出すための共通の仕組みです。flowmaker は MCP サーバーを内蔵しているので、Claude や ChatGPT に「こういう自動化を作って」と日本語で頼むと、AI が自動化を作成し、テストし、公開まで行えます。

- MCP の URL: `https://<あなたの Worker の URL>/mcp`
- 認証: HTTP ヘッダー `Authorization: Bearer <トークン>`
- 方式: Streamable HTTP (リモート MCP サーバー)

---

## 1. トークンを発行する

1. flowmaker の管理画面で **「設定」** を開きます。
2. **「AI 連携 (MCP)」** の欄で **「トークンを発行」** を押します。
3. 表示された **MCP URL** と **トークン** (`fm_` で始まる文字列) をコピーします。
   - **トークンは一度しか表示されません。** なくした場合は「トークンを再発行」を押してください (古いトークンは使えなくなります)。

## 2. AI アシスタントに登録する

以下の例では、`https://flowmaker.example.workers.dev/mcp` を自分の MCP URL に、`fm_xxxxxxxx` を自分のトークンに置き換えてください。

### Claude Code

ターミナルで次を実行します。

```bash
claude mcp add --transport http flowmaker https://flowmaker.example.workers.dev/mcp \
  --header "Authorization: Bearer fm_xxxxxxxx"
```

`claude mcp list` で `flowmaker` が表示されれば登録できています。Claude Code の中で `/mcp` を実行すると接続状態を確認できます。

### Claude Desktop

Claude Desktop の設定ファイル `claude_desktop_config.json` は、ローカルで起動するコマンド形式の MCP サーバーを登録する場所です。リモートの MCP サーバーにヘッダー付きで接続するには、中継ツール [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) を使うのが確実です (パソコンに Node.js が必要です)。

1. Claude Desktop で **「設定」→「開発者」→「設定を編集」** を押し、`claude_desktop_config.json` を開きます。
2. 次のように書いて保存します。

```json
{
  "mcpServers": {
    "flowmaker": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://flowmaker.example.workers.dev/mcp",
        "--header",
        "Authorization: Bearer ${FLOWMAKER_TOKEN}"
      ],
      "env": {
        "FLOWMAKER_TOKEN": "fm_xxxxxxxx"
      }
    }
  }
}
```

3. Claude Desktop を再起動します。チャット入力欄のツールの一覧に flowmaker が表示されれば成功です。

> Claude の「コネクタ」画面 (カスタムコネクタの追加) は、OAuth で認証するサーバー向けです。flowmaker は現在、固定のトークン (Bearer) だけに対応しているため、上の設定ファイルの方法を使ってください。

### ChatGPT

ChatGPT では、**開発者モード** を有効にすると、リモート MCP サーバーを「コネクタ (アプリ)」として追加できます。開発者モードは有料プラン (Plus / Pro / Business など) でのみ使える場合があり、対応プランや画面は OpenAI 側で変わります。

1. ChatGPT の **「設定」→「アプリとコネクタ」→「詳細設定」** で **開発者モード** をオンにします。
2. **「作成」** (コネクタを追加) を押し、名前に `flowmaker`、MCP サーバーの URL に自分の MCP URL を入れます。
3. 認証方式で、固定のヘッダー (API キー / Bearer トークン) を設定できる場合は `Authorization: Bearer fm_xxxxxxxx` を設定します。

> 注意: 執筆時点では、ChatGPT のコネクタの認証方式は OAuth または「認証なし」が中心で、固定の Bearer トークンを入力できない場合があります。その場合、flowmaker の MCP サーバーには ChatGPT から直接接続できません (flowmaker は OAuth にまだ対応していません)。Claude Code / Claude Desktop / Cursor を使ってください。

### Cursor

`~/.cursor/mcp.json` (またはプロジェクトの `.cursor/mcp.json`) に次を書きます。

```json
{
  "mcpServers": {
    "flowmaker": {
      "url": "https://flowmaker.example.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer fm_xxxxxxxx"
      }
    }
  }
}
```

Cursor の **「設定」→「MCP」** で flowmaker が有効になっていることを確認します。

### その他のクライアント

Streamable HTTP 方式のリモート MCP サーバーに、任意のヘッダーを付けて接続できるクライアントであれば使えます。URL に MCP URL を、ヘッダーに `Authorization: Bearer <トークン>` を設定してください。

---

## 3. 使えるツール

| ツール | 内容 |
| --- | --- |
| `get_overview` | ボット名、接続済みチャネル、公開中の自動化数、直近 7 日の連絡先・メッセージ数 |
| `get_flow_schema` | 自動化 (フロー) の JSON の書き方 (トリガー・ステップ・変数・コツ)。作成や編集の前に読みます |
| `list_templates` | 用意されているテンプレート 6 種類の定義 |
| `list_flows` | すべての自動化の一覧 (状態、チャネル、トリガー、ステップ数) |
| `get_flow` | 1 つの自動化の定義全体 |
| `create_flow` | 自動化を **下書き** として作成 (定義は検証され、誤りがあればエラーを返します) |
| `update_flow` | 自動化の名前・チャネル・定義を更新 (公開中のものは公開のまま) |
| `publish_flow` | 自動化を公開し、実際のお客さんに反応させる |
| `unpublish_flow` | 自動化を下書きに戻す |
| `delete_flow` | 自動化を完全に削除 |
| `test_flow` | お客さんになりきって会話を試す (メッセージ、コメント、友だち追加、ボタンのタップなど)。LINE や Meta には何も送られません |
| `list_contacts` | 連絡先を名前・タグ・チャネルで検索 |
| `get_contact` | 1 人の連絡先 (フィールド、タグ、最近のメッセージ 30 件) |
| `tag_contact` | 連絡先にタグを付ける / 外す |
| `set_bot_paused` | その連絡先のボットを停止 (担当者に引き継ぎ) / 再開 |
| `list_conversations` | 最近の会話と最後のメッセージ (すべて / 未読 / 担当者対応中) |
| `send_message` | 連絡先に人としてテキストを送信。`keepBot` を指定しない限り、その相手のボットは停止します。Meta は 24 時間以内のみ |
| `get_reports` | 自動化ごとの数字 (起動・送信・ボタン・回答・完了・エラー)、日別メッセージ数、最近のエラー |
| `broadcast_reach` | 一斉配信が今何人に届くか (Meta は 24 時間以内にメッセージをくれた人のみ) |
| `create_broadcast` | タグ (または全員) へのメッセージ配信を予約。1 分ごとの定期処理で送信されます |
| `list_notifications` | 「担当者に通知」アクションや担当者呼び出しで作られた通知 |

## 4. 会話の例

あなた:

> 「価格」とコメントした人に DM で価格を送って、電話番号を聞いてタグ付けして。価格は 18,900 円。

AI が行うこと (おおよその流れ):

1. **`get_flow_schema`** を呼び出し、自動化の書き方を確認します。
2. 必要なら **`list_templates`** で似たテンプレート (「コメント「価格」→ DM で案内」) を参考にします。
3. **`create_flow`** で、次のような自動化を下書きとして作ります。
   - トリガー: `comment` (キーワード「価格」「値段」など)
   - ステップ: `comment_reply` (「DM で価格をお送りしました」) → `message` (価格とボタン「注文したい」) → `question` (電話番号を `phone` に保存) → `action` (タグ `interested` を付け、担当者に通知) → `message` (お礼)
4. **`test_flow`** で、たとえば次の入力を試し、返信内容・保存されたフィールド・付いたタグを確認します。
   ```json
   [
     { "type": "comment", "text": "価格はいくらですか?" },
     { "type": "message", "button": "注文したい" },
     { "type": "message", "text": "090-1234-5678" }
   ]
   ```
5. 結果に問題がなければ、あなたに確認したうえで **`publish_flow`** で公開します。

AI に「公開する前に確認して」と伝えておくと、勝手に公開されるのを防げます。

## 5. セキュリティについて

- **トークンは管理者パスワードと同じくらい強い権限を持ちます。** トークンがあれば、自動化の作成・削除、連絡先の閲覧、お客さんへのメッセージ送信、一斉配信ができます。MCP だけでなく管理画面用の API (`/api/*`) にも使えます。
- トークンをチャットや SNS、公開リポジトリに貼らないでください。
- 漏れたかもしれない場合は、**「設定」→「AI 連携 (MCP)」→「トークンを再発行」** を押してください。古いトークンはすぐに使えなくなります。使わなくなったら **「無効化」** を押してください。
- トークンの再発行と無効化は、管理画面にパスワードでログインしているときだけ行えます (トークン自身では再発行できません)。
- flowmaker はトークンそのものを保存せず、ハッシュ値 (SHA-256) だけを KV に保存しています。

---

## English summary

flowmaker includes a remote MCP server (Streamable HTTP) at `https://<worker>/mcp`, authenticated with `Authorization: Bearer <token>`. Generate the token in **Settings → AI (MCP)**; it is shown only once and can be rotated or revoked there (session login required).

- **Claude Code**: `claude mcp add --transport http flowmaker https://<worker>/mcp --header "Authorization: Bearer <token>"`
- **Claude Desktop**: use `mcp-remote` in `claude_desktop_config.json` (`npx -y mcp-remote <url> --header "Authorization: Bearer ${FLOWMAKER_TOKEN}"`). Custom connectors in the Claude UI expect OAuth, which flowmaker does not support yet.
- **ChatGPT**: Developer mode connectors (may require a paid plan). If the connector UI only offers OAuth or no auth, it cannot connect to flowmaker yet.
- **Cursor**: `mcp.json` with `url` and `headers`.

21 tools: `get_overview`, `get_flow_schema`, `list_templates`, `list_flows`, `get_flow`, `create_flow`, `update_flow`, `publish_flow`, `unpublish_flow`, `delete_flow`, `test_flow`, `list_contacts`, `get_contact`, `tag_contact`, `set_bot_paused`, `list_conversations`, `send_message`, `get_reports`, `broadcast_reach`, `create_broadcast`, `list_notifications`. A typical build loop is `get_flow_schema` → `create_flow` (draft) → `test_flow` (dry run, nothing is sent) → `publish_flow`. The token grants full access (MCP and `/api/*`); only its SHA-256 hash is stored.
