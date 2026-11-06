# Facebook ページ / Instagram を接続する

このページでは、Sokuto に Facebook ページ (Messenger とページ投稿へのコメント) と Instagram プロアカウント (DM・コメント・ストーリー) をつなぐ手順を説明します。

> **正直に書くと、ここが Sokuto で一番大変な部分です。** Meta (Facebook) のボットを動かすには、自分で「Meta 開発者アプリ」を作る必要があります。自分や登録したテスターだけで試すのは比較的かんたんですが、**一般のお客さんに返信するには、アプリを「ライブモード」にし、多くの場合 Meta の「アプリレビュー」を通す必要があります。** レビューには数日〜数週間かかり、追加の書類やビジネス認証を求められることもあります。
>
> Meta の画面は頻繁に変わります。このページの画面名と違う場合は、似た名前のメニューを探してください。

## 用意するもの

- Facebook アカウント (個人)
- 接続したい **Facebook ページ** の管理者権限
- Instagram も使う場合: **プロアカウント (ビジネスまたはクリエイター)** で、上の Facebook ページとリンク済みのもの
- Sokuto の管理画面にログインできる状態

Sokuto の管理画面の **「チャネル接続」** を開くと、この手順で使う値 (Webhook URL、検証トークン、プライバシーポリシー URL、データ削除 URL) が表示され、「コピー」ボタンでコピーできます。

## 全体の流れ

1. Meta 開発者アプリを作る
2. アプリの基本設定 (プライバシーポリシー URL など) をする
3. Messenger を追加し、Facebook ページをつないでページアクセストークンを作る
4. Sokuto に貼り付ける
5. Webhook を設定する
6. (Instagram を使う場合) Instagram の準備をする
7. テストする
8. 一般公開する (ライブモードとアプリレビュー)

---

## 1. Meta 開発者アプリを作る

1. https://developers.facebook.com/ を開き、Facebook アカウントでログインします。初めての場合は開発者として登録します。
2. 右上の **「マイアプリ」** → **「アプリを作成」** を押します。
3. 用途 (ユースケース) を聞かれたら **「その他」** を選び、アプリの種類は **「ビジネス」** を選びます。
   - 画面によっては、最初から「Messenger からメッセージを送受信する」などのユースケースを選ぶ形になっています。その場合はそれを選んでも構いません。
4. アプリ名 (例: 「〇〇ショップ bot」) と連絡先メールアドレスを入力し、ビジネスポートフォリオ (ビジネスアカウント) があれば選びます。
5. **「アプリを作成」** を押します。

## 2. アプリの基本設定

1. 左メニューの **「アプリの設定」 › 「ベーシック」** を開きます。
2. 次の値をコピーして、メモしておきます。
   - **アプリ ID**
   - **app secret** (「表示」を押すと見えます。人に見せないでください)
3. 同じ画面で、次を入力します。値は Sokuto の「チャネル接続」画面からコピーできます。
   - **プライバシーポリシーの URL**: `https://<あなたの Worker の URL>/privacy`
   - **データ削除の URL** (「データ削除の手順 URL」): `https://<あなたの Worker の URL>/data-deletion`
   - **カテゴリ**: 「ビジネス・ページ」「メッセージ」など、近いものを選びます。
   - アプリアイコン (1024×1024) は、ライブモードにするときに必要になることがあります。
4. **「変更を保存」** を押します。

> `/privacy` と `/data-deletion` は Sokuto に最初から入っている日本語・英語のページです。内容はお店の実情に合わせて変えてもよく、その場合はリポジトリの `admin/public/privacy.html` と `admin/public/data-deletion.html` を編集してください。

## 3. Messenger を追加してページアクセストークンを作る

1. アプリのダッシュボードで **「製品を追加」** (またはユースケースの「カスタマイズ」) から **「Messenger」** を追加します。
2. 左メニューの **「Messenger」 › 「Messenger API の設定」** (または「設定」) を開きます。
3. **「アクセストークン」** の欄で **「ページを追加」** (「ページを接続」) を押し、Facebook のログイン画面で接続したいページを選んで許可します。
   - **Instagram も使う場合**は、このとき Instagram アカウントへのアクセスも許可してください。表示されるアクセス許可はすべてオンのままにします。
4. 接続したページの横の **「トークンを生成」** を押し、表示された **ページアクセストークン** をコピーします。
   - トークンは一度しか表示されないことがあります。すぐにコピーしてください。

## 4. Sokuto に貼り付ける

1. Sokuto の管理画面で **「チャネル接続」** を開きます。
2. **「Facebook ページ / Instagram」** の枠に、次の 3 つを入れます。
   - **アプリ ID**
   - **app secret**
   - **ページアクセストークン**
3. **「接続する」** を押します。
4. 「接続済み: (ページ名) / @(Instagram ユーザー名). Subscribe OK」と表示されれば成功です。

このとき Sokuto は次のことを自動で行います。

- トークンを Meta に問い合わせ、**ページ名と、そのページにリンクされた Instagram ビジネスアカウント**を読み取ります。Instagram がリンクされていれば、Instagram も自動で有効になります。
- ページをアプリに登録 (購読) します。購読する項目は `messages`, `messaging_postbacks`, `messaging_referrals`, `messaging_optins`, `feed` です。

> 接続後にトークンを入れ替えたいとき (Instagram をあとからリンクした場合など) は、**「接続を解除」** を押してから、新しいトークンでもう一度 **「接続する」** を押してください。

## 5. Webhook を設定する

Meta から Sokuto にメッセージを届けるための設定です。

### Facebook ページ (Messenger とコメント)

1. Meta のアプリ画面で **「Messenger」 › 「Messenger API の設定」** を開き、**「Webhook を設定」** (「コールバック URL」の欄) を探します。
2. 次を入力します。値は Sokuto の「チャネル接続」画面からコピーします。
   - **コールバック URL**: `https://<あなたの Worker の URL>/webhooks/meta`
   - **検証トークン**: Sokuto に表示されている **検証トークン (Verify Token)**
3. **「確認して保存」** を押します。エラーが出なければ成功です。
4. ページの Webhook の購読項目 (「Webhook フィールド」「購読を編集」) で、次をオンにします。
   - `messages`
   - `messaging_postbacks`
   - `messaging_referrals`
   - `messaging_optins`
   - `feed` (ページ投稿へのコメントを受け取るため)

### Instagram

1. 左メニューの **「Webhooks」** (または「Messenger」 › 「Instagram の設定」) を開き、オブジェクトの種類で **「Instagram」** を選びます。
2. コールバック URL と検証トークンに、Facebook と**同じ値**を入れて **「確認して保存」** を押します。
3. 次の項目を購読します。
   - `messages`
   - `comments`
   - (表示されていれば) `messaging_postbacks`

## 6. Instagram の準備 (Instagram を使う場合)

1. Instagram アカウントが **プロアカウント (ビジネスまたはクリエイター)** になっていることを確認します。Instagram アプリの「設定」→「アカウントの種類とツール」から切り替えられます。
2. Instagram アカウントを **Facebook ページにリンク** します。Facebook ページの「設定」→「リンク済みのアカウント」→「Instagram」から行えます。
3. Instagram アプリで **「設定」→「メッセージとストーリーへの返信」→「メッセージのリクエスト」→「接続ツール」** (表記はアプリのバージョンにより異なります) を開き、**「メッセージへのアクセスを許可」をオン**にします。これがオフだと、DM が Sokuto に届きません。
4. Instagram をリンクしたのが手順 3 (トークンの生成) より後の場合は、**ページアクセストークンを作り直し**、Sokuto で「接続を解除」→「接続する」をやり直してください。

## 7. テストする

1. Sokuto の **「チャネル接続」** で、Facebook の枠にある **「接続を確認」** を押します。トークンが有効か、ページの購読ができているかを確認します。
2. アプリが **開発モード** のあいだは、アプリの **管理者・開発者・テスター** の役割を持つ人のメッセージにだけ返信されます。テストは自分のアカウントで行うか、「アプリの役割」→「役割」でテスターを追加してください。
3. Sokuto で **「自動化」→「テンプレートから作る」→「コメント「価格」→ DM で案内」** を作って **「公開する」** を押します。
4. 自分の Facebook アカウントで、ページの投稿に「価格」とコメントします。コメントに公開返信が付き、Messenger に DM が届けば成功です。
5. Messenger でページにメッセージを送ると、Sokuto の **「受信箱」** に表示されます。

## 8. 一般公開する (ライブモードとアプリレビュー)

開発モードのままでは、**アプリの役割を持つ人以外のお客さんには返信できません。** 一般のお客さんに返信するには、次の作業が必要です。

1. アプリダッシュボード上部の **「アプリモード」を「ライブ」** に切り替えます。プライバシーポリシー URL、データ削除 URL、カテゴリ、アイコンなどが未設定だと切り替えられません (手順 2 を確認)。
2. **アプリレビュー** で、必要なアクセス許可の **「アドバンスアクセス」** を申請します。Sokuto の機能に応じて、一般的に次のような許可が必要になります。
   - Messenger: `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`
   - Facebook コメントへの返信: `pages_read_user_content`, `pages_manage_engagement`
   - Instagram: `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`
   - 必要な許可の名前や組み合わせは Meta 側で変わることがあります。アプリレビュー画面の案内に従ってください。
3. 申請では、**ボットが実際に動いている様子の画面録画**と、各許可を何に使うかの説明を求められます。Sokuto の管理画面で自動化を作る様子と、Messenger / Instagram で返信が届く様子を録画するとよいでしょう。
4. **ビジネス認証** (ビジネスポートフォリオの本人確認) を求められることがあります。
5. 審査の結果を待ちます。却下された場合は、指摘された点を直して再申請します。

> 自分のお店のページだけで使う場合でも、お客さんに返信するにはこの手順が必要です。これは Meta の仕組みによるもので、Sokuto 側では省略できません。

## 9. はじめるボタン・あいさつ・固定メニュー・会話スターター

接続後、**「チャネル接続」** の Facebook の枠の下にある **「プロフィール設定」** で、Messenger の次の項目を設定できます。

- **あいさつ文**: 初めて会話を開いた人に、メッセージを送る前に表示される文 (160 文字まで)。
- **「はじめる」ボタン**: 初めての人に表示されるボタン。押されると選んだ自動化が始まります。
- **固定メニュー** (3 件まで): 入力欄の横のメニュー。項目ごとに「自動化を始める」か「リンクを開く」を選びます。Messenger では **固定メニューを使うには「はじめる」ボタンの設定が必要** です。
- **会話スターター** (4 件まで): 会話の最初に表示される質問。押されると選んだ自動化が始まります。

「Instagram にも適用」をオンにすると、会話スターターと固定メニューを Instagram の DM にも設定します (Instagram にはあいさつ文と「はじめる」ボタンはありません)。

**「保存して適用」** を押すと、Sokuto に保存し、Meta の Messenger Profile API (`/me/messenger_profile`) にすぐ反映します。空にした項目は Meta 側からも削除されます。**「Meta 側の設定を削除」** は 4 項目をすべて削除します。

- 項目を押したときは、選んだ自動化が (トリガーに関係なく) 始まります。自動化は **公開中** にしてください。下書きの自動化は動きません。
- 表示が変わるまで時間がかかることがあります。Messenger アプリを再起動するか、別のアカウントで確認してください。

---

## うまくいかないとき

### Webhook の「確認して保存」でエラーになる (verification failed)

- コールバック URL が `https://<Worker の URL>/webhooks/meta` になっているか確認してください (末尾に余計な `/` や空白がないか)。
- 検証トークンを Sokuto の「チャネル接続」画面からコピーし直してください。
- Worker の URL をブラウザで開いて、Sokuto の画面が表示されるか確認してください。Cloudflare の無料枠を超えている場合も失敗します。

### 「接続する」で invalid_token と表示される

- **ページアクセストークン**ではなく、ユーザーアクセストークンやアプリトークンを貼っていないか確認してください。Messenger の設定画面の「トークンを生成」で作ったものを使います。
- Facebook のパスワードを変えた、ページの管理者権限を外れた、などの理由でトークンが無効になることがあります。トークンを作り直してください。

### Subscribe NG と表示される

- ページへのアクセス許可 (`pages_manage_metadata` など) が足りない可能性があります。手順 3 でページを接続し直し、表示された許可をすべてオンにしてからトークンを作り直してください。

### (#10) や (#200) の権限エラーが出る

受信箱のメッセージや「レポート」のエラーに `Meta 10: ...` や `Meta 200: ...` と出る場合です。

- **アプリが開発モードで、相手がアプリの役割を持っていない**: テスターに追加するか、ライブモードにしてアドバンスアクセスを取得してください (手順 8)。
- **必要な許可がない**: アプリレビューで該当する許可のアドバンスアクセスを申請してください。
- **「24 時間の範囲外」という内容のエラー**: 下の「24 時間ルール」を見てください。

### 24 時間ルールでメッセージが送れない

- Messenger / Instagram では、お客さんの**最後のメッセージから 24 時間以内**しか通常のメッセージを送れません。
- Sokuto の一斉配信は、24 時間以内にメッセージをくれた人にだけ送ります。それ以外の人は「失敗/対象外」として数えられます。配信画面の「今すぐ届く」で、何人に届くか事前に確認できます。
- 24 時間を超える **待機** ステップのあとのメッセージは送れず、エラーになります。Messenger / Instagram 向けの自動化では、待機を 24 時間未満にしてください。
- 受信箱からの手動返信も、24 時間を過ぎると送れません。

### コメントに反応したのに、2 通目以降の DM が届かない

- コメントへの**プライベート返信 (DM) は、1 つのコメントにつき 1 回だけ**です。Sokuto は、コメントで始まった自動化の最初のメッセージだけをプライベート返信として送ります。
- Facebook では、お客さんがその DM に返事をする (またはボタンを押す) までは、続けてメッセージを送れません。そのため、コメント用の自動化は「コメントに公開返信」→「**ボタン付き**のメッセージ」の順にし、続きはボタンを押したあとに送るようにしてください。テンプレート「コメント「価格」→ DM で案内」がこの形になっています。
- 同じコメントには 2 回目のプライベート返信はできません。テストするときは新しいコメントを書いてください。

---

## English summary

This is the hardest part of Sokuto: you must create your own Meta developer app, and **replying to the general public requires switching the app to Live mode and usually passing App Review for Advanced Access**.

1. At developers.facebook.com create an app (use case "Other", type **Business**).
2. **App settings › Basic**: copy the App ID and App secret; set the privacy policy URL `https://<worker>/privacy`, the data deletion URL `https://<worker>/data-deletion` (both pages ship with Sokuto) and a category.
3. Add the **Messenger** product; in Messenger API settings connect your Page (grant Instagram access too if needed) and **generate a Page access token**.
4. In Sokuto **Channels**, paste App ID, App secret and Page token and click **Connect**. Sokuto reads the Page and its linked Instagram business account and subscribes the Page to the app (`messages, messaging_postbacks, messaging_referrals, messaging_optins, feed`). To replace the token, disconnect and connect again.
5. **Webhooks**: callback URL `https://<worker>/webhooks/meta` and the verify token shown in Sokuto; subscribe Page fields `messages, messaging_postbacks, messaging_referrals, messaging_optins, feed`, and for the Instagram object `messages, comments`.
6. Instagram: professional account linked to the Page, "Allow access to messages" turned on in the Instagram app.
7. Test with an account that has a role on the app (Development mode only answers app admins/developers/testers).
8. Go Live and request Advanced Access (typically `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`; Meta changes these names, follow the review screen). Expect a screencast and possibly Business Verification.
9. Optional: under **Profile** in the Facebook card set the Messenger greeting (≤160), the Get Started flow, a persistent menu (≤3 items, a flow or a URL; Messenger requires Get Started for it) and ice breakers (≤4). "Save and apply" stores it and calls the Messenger Profile API (`/me/messenger_profile`, `platform=instagram` for Instagram's ice breakers and menu when enabled). Tapping an item starts the chosen live flow.

Troubleshooting: verification failure = wrong callback URL or verify token; `(#10)`/`(#200)` = development mode or missing permission; the 24-hour rule blocks messages (broadcasts skip people outside the window, delays over 24 h fail); only one private reply per comment, so put a button in the first DM.
