<p align="center">

  <img src="docs/logo.svg" alt="DeepSeek Harness Remote" width="600">
</p>

<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <a href="README.zh.md">中文</a>
  &nbsp;·&nbsp;
  <strong>日本語</strong>
  &nbsp;·&nbsp;
  <a href="docs/README.md">ドキュメント</a>
  &nbsp;·&nbsp;
  <a href="https://dsh.r2049.cn/app">Web</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/releases/latest">Android</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/issues/20">iOS</a>
</p>

<p align="center">
  <a href="apps/server/README.md">セルフホスティング</a>
  &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/ds-harness-remote">npm</a>
  &nbsp;·&nbsp;
  <a href="https://dshfind.com/zh/plugins/liguobao/ds-harness-remote?ref=badge"><img src="https://dshfind.com/api/badge/liguobao/ds-harness-remote?metric=downloads&amp;lang=zh" alt="dshfind ダウンロード数" width="137" height="20" align="absmiddle"></a>
</p>

## 一度つなげば、いつでも使える

スマートフォン、パソコン、ブラウザーから、お使いの DeepSeek Harness をそのまま利用できます。どのデバイスからでも、同じ Harness セッションの続きを始められます。

Harness は作業用パソコン上で動作し続け、ワークスペース、ツール、プロジェクト設定もそのままです。DS Harness Remote は、その環境にアクセスするためのもう一つの窓です。

DeepSeek Harness デスクトップ版に対応しています。最新リリースをインストールしてください。

`ds-harness-remote@0.6.0`

## 主な機能

- Web、パソコン、モバイル端末からローカルの Harness にアクセスできます。DSH を中心に、Codex、Cursor、Antigravity にも対応しています。
- DeepSeek Harness Desktop に対応し、インストール後すぐにネイティブ UI を利用できます。独自のデスクトップ会話 UI は追加しません。
- ワークスペースの作成、モデルの設定、会話モデルの切り替えを、ローカルと同じ流れで行えます。
- Harness Host に公開待ち受けポートやパブリック IP は不要です。インターネット接続があれば、双方向のエンドツーエンド暗号化チャネルでどこからでも接続できます。
- P2P 接続を優先し、世界各地の TURN 中継ノードを利用できます。必要に応じて複数の Server Relay にフォールバックします。
- ネイティブの Harness サイドバーから、ワークスペースのファイル、読み取り専用プレビュー、リモートターミナル、許可されたローカル開発サービスのプレビューにアクセスできます。
- Remote Tool のコンテキスト注入により、Host とワークスペースの検出、Harness セッションの作成・管理、履歴の読み取り、実行待機、中断要求、許可されたファイルの転送が可能です。[詳細](packages/plugin/README.md#remote-agent-tools)。
- DeepSeek Harness に加え、ACP 連携を通じて Codex、Cursor、Google Antigravity、Pi、OpenCode、Claude Code、Hermes Agent などのネイティブワークスペースを利用でき、リモートファイル閲覧やターミナルにも対応します。
- Android、iOS、Web、ネイティブ DSH 向けのクライアントを提供しています。
- 複数のクライアントから同じ Harness Host に同時接続でき、RPC 呼び出しとストリームは接続ごとに分離されます。

## 目次

- [一度つなげば、いつでも使える](#一度つなげばいつでも使える)
- [主な機能](#主な機能)
- [対応クライアント](#対応クライアント)
- [インストール](#インストール)
- [クイックスタート](#クイックスタート)
- [スクリーンショット](#スクリーンショット)
- [仕組み](#仕組み)
- [実験的な ACP ワークスペース](#実験的な-acp-ワークスペース)
- [エンドツーエンド暗号化](#エンドツーエンド暗号化)
- [ネットワークと通信方式](#ネットワークと通信方式)
- [セキュリティ](#セキュリティ)
- [よくある質問](#よくある質問)
- [ドキュメント](#ドキュメント)
- [関連リンク](#関連リンク)
- [Star History](#star-history)
- [プロジェクトの位置づけと商標](#プロジェクトの位置づけと商標)
- [ライセンス](#ライセンス)

## 対応クライアント

| クライアント | 形式 | 状態 | 備考 |
| --- | --- | --- | --- |
| DSH Desktop プラグイン | Remote サイドバー | 対応 | `ds-harness-remote@0.6.0` をインストールします。このパソコンを Host としても利用できます |
| Web | ブラウザーページ | 対応 | [https://dsh.r2049.cn](https://dsh.r2049.cn) を開きます。ネイティブの Harness UI を再利用します |
| Android | ネイティブアプリ | 対応 | [Releases](https://github.com/liguobao/ds-harness-remote/releases/latest) から APK をダウンロードできます。[Android ガイド](apps/android/README.md)を参照してください |
| DSH Go | ccch1mneyyy 氏の力作 | 対応済み | 詳細：[ccch1mneyyy/dsh-go: DeepSeek Harness の Android クライアント。スマートフォンで直接実行したり、パソコン上の DSH をリモート操作したりできます。](https://github.com/ccch1mneyyy/dsh-go) |
| iOS | TestFlight ベータ | ベータ | 一般公開はまだ行っていません。[Issue #20](https://github.com/liguobao/ds-harness-remote/issues/20) を参照してください |
| ブラウザー拡張機能 | Chrome | アクセス入口のみ | ログイン済み Web の認可を独立したデバイス認証情報に交換し、オンラインの Host を一覧表示して同一オリジンの Remote Web を開きます。拡張機能自体に会話 UI はありません |
| dsh-TUI | ターミナル専用 CLI | 対応 | Host として利用できます。[dsh-TUI Remote ガイド](docs/dsh-tui.md)を参照してください。インストーラーが自動的に Web サービスを作成することはありません |
| Linux | クラウドサーバー | 対応 | [公式サイト](https://dsh.r2049.cn/)にログインすると、設定不要のワンコマンド無人インストールを利用できます。 |

複数のクライアントから同じ Host に同時接続できます。RPC 呼び出しとストリームは接続ごとに分離されます。

## インストール

### DeepSeek Harness Desktop

DeepSeek Harness Desktop の **Extensions / Plugin management** を開き、npm からのインストールを選択して、次のパッケージを入力します。

`ds-harness-remote@0.6.0`

インストール後に Desktop を再起動してください。公式の `dsh` ランチャーでも、`dsh plugin --profile desktop add -w ds-harness-remote@0.6.0` を実行して指定バージョンをインストールできます。

### Linux ワンコマンドインストール

[公式サイト](https://dsh.r2049.cn/)にログインし、ワンコマンドインストール用の認可コードを取得してインストールしてください。

### dsh-TUI Host

[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) を使ったターミナル Host のセットアップは、[dsh-TUI Remote ガイド](docs/dsh-tui.md)を参照してください。

### ネイティブ Android クライアント

複数のワークスペースで同時に接続して会話を続けられます。[Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot) を利用した **Bot モード**も搭載しています。

[GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest) から最新の APK をダウンロードし、同じアカウントでログインすると Host が表示されます。

## DSH Go — DeepSeek Harness をポケットに。スマートフォンで実行し、パソコンもリモート操作。

[ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go) は ds-harness-remote プロトコルを内蔵しており、スマートフォン上で DeepSeek Harness を実行したり、パソコンにリモート接続したりできます。

スマートフォンの DSH Go に ds-harness-remote プラグインをインストールすると、パソコンや Web からスマートフォン上の DSH にもリモート接続でき、Mobile Use をスムーズに利用できます。

### iOS クライアント

- [ベータに参加する](https://github.com/liguobao/ds-harness-remote/issues/20)

## クイックスタート

1. DeepSeek Harness のサイドバーから **Remote** を開きます。
2. 知乎、GitHub、Google の認可ログイン、またはアカウントとパスワードでログインします。アカウント登録には招待コードが必要です。リポジトリの作者にメールで申請できます。
3. 別のデバイスの DeepSeek Harness に同じプラグインをインストールし、手順 1〜2 と同じ方法でログインします。Remote Web、iOS、Android、DSH Go のクライアントなら、プラグインのインストールなしですぐに利用できます。
4. オンラインの Host を選び、既存のワークスペースを選択するか、リモートのディレクトリを参照して開きます。

デフォルトでは、本プロジェクトが運営する Server [https://dsh.r2049.cn](https://dsh.r2049.cn) を使用します。

セルフホスティングには、このリポジトリの[最小構成 Server](apps/server/README.md) を利用できます。現在のバージョンには P2P 接続調整と Relay Server が含まれますが、ホスト型 Remote Web の全機能は提供しません。

## スクリーンショット

### Desktop

別のパソコンでオンラインの Host を選び、そのワークスペースを開きます。ネイティブの Harness UI で開かれ、ヘッダーに接続先の Host と暗号化接続の状態が表示されます。

<p align="center">
  <img src="docs/images/host-list.png" alt="オンラインの Host を表示する Remote ワークスペース選択画面" width="40%">
  <img src="docs/images/remote.png" alt="暗号化されたリモート接続で利用する Harness の会話画面" width="40%">
</p>

このパソコンから他の Host を操作できないようにするには、[https://dsh.r2049.cn/](https://dsh.r2049.cn/) のホスト一覧で「被操作専用（仅被控）」を有効にしてください。このデバイスからは同じアカウントの他のデバイスが見えなくなりますが、Web や他のクライアントからこのデバイスへのリモート接続は引き続き利用できます。

### Android

テキストや画像のプロンプト送信、モデルの切り替え、対応するワークスペースのファイルやターミナルへのアクセスが可能です。

UI はシステム言語に従い、英語、簡体字・繁体字中国語、日本語、スペイン語、ドイツ語、フランス語に対応しています。言語設定で「More ...」をタップすると、すべての言語が表示されます。詳細は [Android ガイド](apps/android/README.md)を参照してください。

<p align="center">
  <img src="docs/images/mobile-list.jpg" alt="オンラインとオフラインのパソコンを表示する Android クライアント" width="30%">
  <img src="docs/images/image-msg.jpg" alt="Android クライアントから画像プロンプトを送信" width="30%">
  <img src="docs/images/image-result.jpg" alt="Android クライアントで画像への応答を表示" width="30%">
</p>

モバイルの設定には、全体に適用される **Compact conversations**（会話のコンパクト表示）スイッチがあります。デフォルトは無効で、次に会話を開くときに反映されます。

対応する Host は、メッセージとツールの状態を保持したまま、履歴のツール詳細を短縮します。設定を無効にして会話を開き直すと、完全な履歴を読み込めます。

## 仕組み

```text
DSH Desktop / Remote Web / Android
  ↔ 認証済みのエンドツーエンド暗号化チャネル
Host 上の Remote プラグイン
  ↔ 対応する Harness またはオプションの Codex ワークスペース連携
Harness のセッション／ワークスペース、または Codex のプロジェクト
```

Harness Host に公開待ち受けポートは不要です。インターネット接続があれば、ds-harness-remote の双方向エンドツーエンド暗号化チャネルでどこからでも接続できます。

クライアントの接続先を選択した Host のネイティブ Harness API に切り替えるため、元のワークスペース、ツール、権限確認の流れはそのパソコン上に残ります。

Host に登録されたすべての設定セクションも、公式の Harness 設定 API を通じてリモート設定でき、ほとんどのプラグイン設定に完全対応しています。

## 実験的な ACP ワークスペース

Host はローカルの ACP 対応 Agent を起動し、ds-harness-remote を通じてプロンプト、ストリーミング応答、承認要求を転送します。各 Agent は自身のワークスペースとセッションを使用し、DSH 向けのセッション変換のみを行います。Harness のストレージには書き込みません。

対応バックエンド:

- **Codex** — 独立した App Server インターフェースを通じて接続し、同じワークスペース入口から利用できます。
- **Cursor** — CLI の ACP インターフェースを通じて接続します。
- **Antigravity (AGY)** — stream-json CLI を ACP ゲートウェイに接続するアダプターを使用します。
- **Pi Agent（実験的）** — Host に `@earendil-works/pi-coding-agent` と `pi-acp` をインストールし、Pi のプロバイダーをローカルで設定してください。Remote 設定で明示的に無効化しない限り、Pi を自動検出して初期化します。ワークスペースは ACP の初期化に成功した場合にのみ利用できます。独立した ACP データプレーンを使用します。ツールは Host ユーザーの権限で実行されます。ツールごとの確認には Pi 拡張機能が必要で、デフォルトでは有効ではありません。
- **OpenCode** — `opencode acp` を通じて接続し、ワークスペースの検出と履歴の復元に対応します。Host 起動時に CLI の対応オプションを確認し、ネイティブリスナー方式と stdio 専用方式の両方の ACP ビルドに対応します。Desktop／Android からのネイティブなセッションアーカイブには、認証付きループバック API が必要です。非対応ビルドではアーカイブを利用できないことを通知します。アーカイブ状態は OpenCode が保存し、履歴は保持されます。アーカイブ解除はまだ提供していません。
- **Claude** — Host 上でローカル認証済みの `claude-agent-acp` を使用します。Remote 設定で有効にしてください。Desktop／Android でワークスペース、履歴、テキストプロンプト、承認に対応します。画像入力と Files／Terminal への直接アクセスは利用できません。
- **Hermes** — Hermes Agent 自身の ACP サーバー（`hermes acp`）を通じて接続します。Remote 設定で有効にしてください。Desktop／Android でワークスペース、履歴、思考とツール出力のストリーミング、テキストプロンプト、承認、モデル選択に対応します。画像入力と Files／Terminal への直接アクセスは利用できません。

セットアップとアダプター開発については、[Agent ワークスペース連携ガイド](docs/acp-integration.md)を参照してください。

Desktop／Android での Cursor、Claude、Hermes、Pi、OpenCode、AGY のモデル選択には Host の実際のモデル一覧を使用し、Agent の ACP インターフェースに従います。

推論の強度（Effort）の選択肢は、バックエンドが実際に提供するものに従います。Cursor はセッションごとに別のプロセスを使用するため、モデルの変更が他の会話に影響することはありません。

## エンドツーエンド暗号化

Harness の業務データはクライアントで暗号化され、選択した Host でのみ復号されます。暗号スイートは `Noise_IK_25519_ChaChaPoly_SHA256` に固定されています。

接続には、同一アカウントへの所属関係と、ローカルに固定されたデバイス識別鍵の両方の検証が必要です。

サービスは接続の調整と必要なネットワークメタデータの確認を行えますが、セッションメッセージ、プロンプト、ツール出力、ワークスペースのパス、リモートファイルの内容は読み取れません。

ハンドシェイク、鍵のライフサイクル、可視メタデータ、リプレイ対策、セキュリティ上の制限は、[エンドツーエンド暗号化](docs/end-to-end-encryption.md)を参照してください。

## ネットワークと通信方式

Host は外向きの接続のみを開始し、公開ポートで待ち受けません。ルーターのポート転送も不要です。

Remote は `LAN -> P2P -> TURN -> Relay` の順で通信経路を選びます。

WebRTC が利用できない場合や接続できない場合は、暗号化された WebSocket Relay にフォールバックします。

すべての経路で同じ Noise 暗号文を転送し、Host／Client の識別・認可の境界を維持します。

構成、制御・データプレーン、NAT の動作、フォールバック、再接続の仕様、現在の検証状況は、[ネットワークと通信方式](docs/network.md)を参照してください。

## セキュリティ

- LAN・P2P 接続では、接続調整の指示を除き、データは Server を経由しません。TURN はオープンソースの coturn サーバーを使用し、Relay モードは WebSocket で転送します。
- セッションの通信はエンドツーエンドで暗号化されます。サービスは暗号文を中継し、セッションの平文やデバイスの秘密鍵を保存しません。
- 接続には、Server 上の所属関係と Host にローカル保存された接続相手の識別情報の両方による認可が必要です。
- [Remote Tools の注入](docs/remote-tools.md)：オプションの `remote_*` セッションツールです。デフォルトで有効で、Remote の詳細設定から変更できます。
- 対話型ターミナルは Host ローカルの `terminal.enabled` 設定を使用します（デフォルトは有効）。Agent の承認とは独立して、Host ユーザーの権限で動作します。
- 汎用ツール RPC とリモートデスクトップは公開していません。
- ワークスペース選択画面はフォルダーのみを一覧表示し、上限付きの読み取り専用ディレクトリメタデータを返します。
- リモートファイルプレビューから、書き込み、削除、アップロード、実行、外部アプリでパスを開く操作はできません。
- Codex Remote / Agent ACP はオプションで、無効化できます。Remote の他の機能と同じ暗号化・Host 権限の境界に従います。
- デバイスを削除すると、その認証情報、所属関係、有効な Remote 接続が失効します。

## よくある質問

**パブリック IP やポート転送は必要ですか？**

いいえ。Host は外向きの接続のみを開始し、公開ポートでは待ち受けません。

**サービス運営者は会話を読めますか？**

いいえ。サービスは暗号文のみを中継します。ルーティング、認可、オンライン状態の管理、レート制限には、アカウントとデバイスの所有関係、オンライン状態、接続時刻、`connectionId` などの制御メタデータが必要です。一方、プロンプト、会話内容、ツールの入出力、ワークスペースのパス、ファイルプレビューの内容は読み取れません。

**どのマシンを Host にできますか？**

Remote プラグインをインストールしてログインした Harness インスタンスなら、Windows、macOS、Linux、さらには DSH Go でも Harness Remote Host として利用できます。

**複数のデバイスから同じ Host に同時接続できますか？**

現在、同時接続台数に制限はありません。複数のクライアントが同時接続でき、RPC 呼び出しとストリームは接続ごとに分離されます。

**対応する Harness のバージョンは？**

現在の基準バージョンは `dsh-v0.2.1-rc.5` で、`0.2.0` rc.2 / rc.1 と互換性があります。[互換性ガイド](docs/compatibility.md)を参照してください。

Host プラグイン、同梱の Remote クライアント、Android では、Harness `0.1.1-rc.2` の ApiProxy 対応を削除しました。公式の Typert Remote carrier を提供する Host を使用してください。ApiProxy のみを提供する Host や機能検出に対応しない旧 Host への接続は拒否され、フォールバックは行いません。

CodeX／ACP は独立したデータプレーンを維持し、Desktop のメモリ内表示には Typert を使用します。

**Linux インストーラーに root 権限が必要なのはなぜですか？**

systemd のシステムサービスを設定するためです。そのため Host、Agent のツール、リモートターミナルは root 権限で動作します。信頼できるアカウントにのみアクセスを許可してください。

**iOS アプリを直接インストールできますか？**

現在は TestFlight ベータで、一般公開はまだ行っていません。[Issue #20](https://github.com/liguobao/ds-harness-remote/issues/20) を参照してください。

**frp、トンネル、リモートデスクトップとの違いは？**

一般的な Server 経由の TCP ポート転送では、通信が Server を経由するため、その帯域幅がボトルネックになり得ます。

本プロジェクトは 4 つの接続方式を順番に試し、複雑なネットワーク環境でも P2P 直接接続を確立できるようにします。

リモートデスクトップでは、パソコンの画面全体を取得してクライアント側で再現するため、上り・下りの帯域幅とパソコンの処理性能が必要です。

本プロジェクトは、ネイティブの Harness 会話 UI に必要なメッセージのみを暗号化してリモートに送信します。汎用ツール RPC やデスクトップ操作は公開せず、権限と承認は Host 側に残ります。

Tailscale、CF Turn、UU Remote も優れたソリューションです。用途に合わせてお選びください。

## おすすめのプラグイン

### Intelligent UI

[Intelligent UI](https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui) を使うと、モデルがカード・表・グラフ・フォームで回答できます。Android クライアントはこれらをネイティブ表示し、**プラグイン → Remote 対応** に表示されたプラグインのオン・オフやライブ設定を変更できます。

### [Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)

DS Bot は DeepSeek Harness（dsh）を bot として利用できるようにするプラグインです。自分で作成した bot と会話したり、作業したりできます。

## ドキュメント

- [プラグインガイド](packages/plugin/README.md)
- [インストールガイド](docs/installation.md)
- [dsh-TUI Remote ガイド](docs/dsh-tui.md)
- [Codex Remote 技術ノート](docs/codex-remote.md)
- [ACP Remote / Agent アダプターノート](docs/acp-remote.md)
- [ドキュメント一覧](docs/README.md)
- [エンドツーエンド暗号化](docs/end-to-end-encryption.md)
- [ネットワークと通信方式](docs/network.md)
- [Remote プロトコル](docs/protocol.md)
- [開発状況とロードマップ](docs/TODO.md)
- [変更履歴](docs/CHANGELOG.md)
- [プライバシーポリシー](docs/PRIVACY.md)
- [Android ガイド](apps/android/README.md)
- 現在の開発基準は `dsh-v0.2.1-rc.5` です。検証範囲は[互換性ガイド](docs/compatibility.md)に記載しています。

## 関連リンク

- 関連プロジェクト: [DSH Go](https://github.com/ccch1mneyyy/dsh-go) — DeepSeek Harness をポケットに。スマートフォン上で直接実行でき、パソコンのリモート操作も可能です。Remote 連携に対応しています。
- 関連プロジェクト: [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — Remote 連携に対応しています。[dsh-TUI Remote ガイド](docs/dsh-tui.md)を参照してください。
- 相互リンク: [LINUX DO](https://linux.do/)
- 相互リンク: [Cyber Liu Kanshan](https://kanshan.r2049.cn/)

## Star History

<a href="https://www.star-history.com/?repos=liguobao%2Fds-harness-remote&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&legend=top-left" />
   <img alt="GitHub スター数の推移" src="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&legend=top-left" />
 </picture>
</a>

## プロジェクトの位置づけと商標

本プロジェクトは独立したコミュニティプロジェクトであり、DeepSeek の公式製品ではありません。
DeepSeek および関連する名称・商標は、それぞれの権利者に帰属します。

## ライセンス

[MIT](packages/plugin/LICENSE)
