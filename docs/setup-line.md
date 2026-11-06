# LINE 公式アカウントを接続する

このページでは、Sokutō に LINE 公式アカウントをつなぐ手順を説明します。プログラミングの知識は必要ありません。所要時間は 10〜15 分ほどです。

> LINE の画面の名前や配置は、LINE 側の変更で変わることがあります。見つからないときは、似た名前のメニューを探してください。

## 用意するもの

- LINE アカウント (個人の LINE で構いません)
- Sokutō の管理画面にログインできる状態 (README の「5 分でインストール」を完了していること)

## 全体の流れ

1. LINE 公式アカウントを作り、Messaging API を有効にする
2. チャネルシークレットとチャネルアクセストークン (長期) を確認する
3. Sokutō の管理画面に貼り付ける (Webhook URL は自動で登録されます)
4. LINE Official Account Manager で「応答メッセージ」をオフ、「Webhook」をオンにする
5. 友だち追加してテストする

---

## 1. Messaging API チャネルを作る

2024 年 9 月以降、LINE Developers コンソールから直接 Messaging API チャネルを新しく作ることはできなくなり、**LINE Official Account Manager から作る**のが基本の手順になりました。

### 方法 A: LINE Official Account Manager から作る (現在の標準)

1. https://manager.line.biz/ を開き、LINE アカウントでログインします。
2. LINE 公式アカウントをまだ持っていない場合は、「作成」から公式アカウントを作ります (アカウント名、業種などを入力)。
3. 作った公式アカウントを開き、画面右上の **「設定」** を押します。
4. 左メニューの **「Messaging API」** を押し、**「Messaging API を利用する」** を押します。
5. **プロバイダー**を選ぶ画面が出ます。初めてなら新しいプロバイダーを作ります (お店や会社の名前で構いません)。
   - プロバイダーはあとから変更できません。よく考えて選んでください。
6. プライバシーポリシーと利用規約の URL を聞かれた場合は、空欄のままでも進めます。入れる場合は、Sokutō の `https://<あなたの Worker の URL>/privacy` を使えます。
7. 「OK」を押すと、Messaging API が有効になります。これで LINE Developers コンソールにも同じ名前の「チャネル」ができます。

### 方法 B: LINE Developers コンソールから見る (既存のチャネルがある場合)

1. https://developers.line.biz/console/ を開き、LINE アカウントでログインします。
2. **プロバイダー**を選びます。
3. 一覧から **Messaging API** の種類のチャネルを選びます。
   - 以前に作った Messaging API チャネルがあれば、それをそのまま使えます。
   - 方法 A で作ったチャネルもここに表示されます。

## 2. チャネルシークレットとチャネルアクセストークンを確認する

LINE Developers コンソール (https://developers.line.biz/console/) で、対象のチャネルを開きます。

1. **「チャネル基本設定」** タブを開き、下の方にある **「チャネルシークレット」** をコピーします。メモ帳などに一時的に貼っておきます。
2. **「Messaging API 設定」** タブを開き、一番下の **「チャネルアクセストークン (長期)」** の **「発行」** ボタンを押します。
3. 表示された長い文字列をコピーします。

> チャネルシークレットとチャネルアクセストークンは、ボットを操作できる「鍵」です。人に見せたり、SNS に貼ったりしないでください。Sokutō では暗号化して保存されます。

## 3. Sokutō に貼り付ける

1. Sokutō の管理画面を開き、左メニューの **「チャネル接続」** を押します。
2. **「LINE 公式アカウント」** の枠に、次の 2 つを貼り付けます。
   - **チャネルシークレット**
   - **チャネルアクセストークン (長期)**
3. **「接続する」** を押します。
4. 「接続済み: (アカウント名). Webhook OK」と表示されれば成功です。

このとき Sokutō は次のことを自動で行います。

- トークンが正しいかを LINE に問い合わせ、公式アカウントの名前と ID を表示します。
- LINE に **Webhook URL** (`https://<あなたの Worker の URL>/webhooks/line/<ワークスペース ID>`) を登録します。自分で入力する必要はありません。

> Webhook URL の末尾の数字は、いま開いているワークスペースの ID です (ワークスペースごとに別の LINE 公式アカウントをつなげます)。手で設定するときは、必ず接続したいワークスペースの「チャネル接続」画面に表示されている URL をコピーしてください。ワークスペース機能より前に設定した `…/webhooks/line` (ID なし) は、最初のワークスペース (ID 1) の URL としてそのまま使えます。

「Webhook NG」と表示された場合は、LINE Developers コンソールの「Messaging API 設定」タブで、**Webhook URL** に管理画面に表示されている URL を手で貼り付け、「更新」を押してください。

## 4. LINE Official Account Manager の応答設定を変える

このままだと、LINE 標準の自動応答と Sokutō の両方が返事をしてしまいます。

1. https://manager.line.biz/ で公式アカウントを開き、右上の **「設定」** を押します。
2. 左メニューの **「応答設定」** を押します。
3. 次のように設定します。
   - **応答メッセージ: オフ**
   - **Webhook: オン**
   - **あいさつメッセージ**: Sokutō の「友だち追加」トリガーを使う場合はオフにします (両方送られるのを防ぐため)。
4. LINE Developers コンソールの「Messaging API 設定」タブで、**「Webhook の利用」がオン**になっていることも確認します。

## 5. テストする

1. Sokutō の **「チャネル接続」** で、LINE の枠にある **「接続を確認」** を押します。Webhook URL をもう一度登録し、LINE の「Webhook のテスト」を実行します。結果に `"ok": true` が含まれていれば、LINE から Sokutō へ届いています。
2. LINE Developers コンソールの「Messaging API 設定」タブにある **QR コード** をスマートフォンの LINE で読み取り、ボットを**友だち追加**します。
3. Sokutō で **「自動化」→「テンプレートから作る」→「友だち追加・初回メッセージのあいさつ」** を作り、**「公開する」** を押します。
4. ボットをいったんブロックして解除する (または別のアカウントで友だち追加する) と、あいさつが届きます。メッセージを送ると、Sokutō の **「受信箱」** にも表示されます。

## 6. リッチメニュー

トーク画面の下に表示されるメニュー (リッチメニュー) を、Sokutō から設定できます。**「チャネル接続」** の LINE の枠の下にある **「リッチメニュー」** で設定します。

1. メニューの画像を用意し、インターネットから見える URL に置きます。**JPEG または PNG、1 MB 以下**で、サイズは **大: 2500×1686** または **小: 2500×843** ピクセルです。
2. 画像 URL を入れ、大きさ (大 / 小) と **分割数** (1・2・3・4・6) を選びます。画像は左上から右へ、上の段から下の段へ均等に分けられます (4 は 2×2、6 は 3×2)。
3. **メニューバーの文言** (14 文字まで) を入れます。トーク画面の下でメニューを開くボタンに表示されます。
4. エリアごとに、押したときの動きを選びます。
   - **自動化を始める**: 選んだ自動化が始まります (自動化は公開中にしてください)。
   - **リンクを開く**: URL を開きます。
   - **テキストを送る**: お客さんの代わりにテキストを送ります。キーワードトリガーで受けられます。
   - **payload (上級)**: ボタン payload トリガー用の値を送ります。
5. **「保存して適用」** を押すと、Sokutō が画像を取得して LINE にリッチメニューを作り、すべての友だちの既定のメニューに設定します。前に Sokutō で作ったメニューは削除されます。

**「リッチメニューを削除」** で既定の設定を解除し、メニューを削除します。

> リッチメニューは **LINE Official Account Manager** の「リッチメニュー」でも作れます。その場合は、アクションを「テキスト」にして、送られる文言をキーワードトリガーで受けてください。Messaging API で設定したメニュー (Sokutō で設定したもの) のほうが優先して表示されます。

---

## うまくいかないとき

### 「接続する」で invalid_token と表示される

- チャネルアクセストークンを最後までコピーできていない可能性があります。もう一度「発行」してコピーし直してください。
- 「チャネルアクセストークン (長期)」ではなく、別の種類のトークンを貼っていないか確認してください。

### 署名エラー (bad_signature / 401)

LINE からの Webhook は「チャネルシークレット」で署名されています。Sokutō に保存したシークレットが違うと、すべてのメッセージが 401 で拒否されます。

1. LINE Developers コンソールの「チャネル基本設定」で、チャネルシークレットを確認します。
2. シークレットを「再発行」した場合は、新しい値を Sokutō に入れ直す必要があります。
3. Sokutō の「チャネル接続」で **「接続を解除」** を押し、正しいシークレットとトークンで **もう一度接続** します。

### 友だち追加やメッセージに返事がない

次の順に確認してください。

1. LINE Official Account Manager の応答設定で **Webhook がオン**、**応答メッセージがオフ** になっているか。
2. Sokutō の「受信箱」にメッセージが表示されているか。
   - **表示されていない**: LINE から届いていません。「接続を確認」を押し、Webhook URL が「チャネル接続」画面に表示されている URL (`https://<Worker の URL>/webhooks/line/<ワークスペース ID>`) と同じか確認します。別のワークスペースの URL になっていると、メッセージはそちらに届きます。
   - **表示されている**: 届いていますが、自動化が動いていません。次を確認します。
3. 自動化が **「公開中」** になっているか (下書きのままでは動きません)。
4. 自動化の **チャネル** が「すべて」または「LINE」になっているか。
5. トリガーのキーワードがメッセージに含まれているか。管理画面の **「テスト」** で同じ言葉を入れて試せます。
6. 「設定」で **ボット全体を停止** していないか。
7. その相手のボットが停止していないか。「担当者」「オペレーター」などのキーワードを送ったり、受信箱から人が返信したりすると、その相手のボットは停止します。受信箱で **「ボットを再開」** を押してください。
8. Cloudflare の無料枠を超えていないか (README の「料金と制限」を参照)。

### 一斉配信や待機後のメッセージが届かない (通数の上限)

- 一斉配信、待機ステップのあとのメッセージ、受信箱からの手動返信は **プッシュメッセージ** として送られ、LINE の料金プランの月間通数に数えられます。また、1 つのメッセージへの返事として 2 つ以上のステップを送る場合も、2 つ目以降はプッシュメッセージになります。
- 上限に達すると、送信は LINE からエラー (`LINE 429` など) で拒否されます。エラーは受信箱のメッセージや「レポート」のエラー数で確認できます。
- 今月の送信数は LINE Official Account Manager で確認できます。必要に応じて料金プランを変更してください。
- お客さんのメッセージへの最初の返事 (応答メッセージ) は無料で、通数に数えられません。

---

## English summary

1. Create a LINE Official Account at manager.line.biz, then **Settings → Messaging API → Use Messaging API** and choose a provider (since 2024 this is the standard way to create a Messaging API channel; existing channels can still be opened from developers.line.biz/console).
2. In the LINE Developers console copy the **Channel secret** (Basic settings tab) and issue a **long-lived channel access token** (bottom of the Messaging API tab).
3. In Sokutō open **Channels**, paste both into the LINE card and click **Connect**. Sokutō validates the token and registers the webhook URL `https://<worker>/webhooks/line/<workspace id>` automatically (each workspace has its own URL; copy it from that workspace's Channels page if you set it by hand; the old `/webhooks/line` without an id keeps working for workspace 1).
4. In LINE Official Account Manager → Settings → Response settings: **Auto-reply messages off**, **Webhooks on** (and turn off the greeting message if you use the follow trigger).
5. Click **Test connection** (runs LINE's webhook test), add the bot as a friend via the QR code and publish the welcome template.
6. Optional: set the default **rich menu** in the LINE card (public JPEG/PNG URL ≤1 MB, 2500×1686 or 2500×843, 1/2/3/4/6 areas, each starting a flow, opening a link or sending text). Sokutō downloads the image, creates the menu, uploads the image and sets it as default for all friends. You can also build menus in LINE Official Account Manager (text action + keyword trigger).

Troubleshooting: `bad_signature` means the stored channel secret is wrong (disconnect and reconnect); no reply usually means the webhook is off, the flow is still a draft, the bot is paused for that contact, or the trigger does not match. Push messages (broadcasts, post-delay messages, manual replies, 2nd+ step per incoming message) count against the plan's monthly quota; replies are free.
