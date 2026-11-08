<p align="center">

  <img src="docs/logo.svg" alt="DeepSeek Harness Remote" width="600">
</p>

<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <a href="README.zh.md">中文</a>
  &nbsp;·&nbsp;
  <strong>日本語</strong>
</p>

<p align="center">
  <a href="docs/README.md"><img src="https://img.shields.io/badge/%E3%83%89%E3%82%AD%E3%83%A5%E3%83%A1%E3%83%B3%E3%83%88-blue?logo=googledocs&amp;logoColor=white" alt="ドキュメント"></a>
  <a href="https://dsh.r2049.cn/app"><img src="https://img.shields.io/badge/Web-4D6BFE?logo=googlechrome&amp;logoColor=white" alt="Web"></a>
  <a href="https://github.com/liguobao/ds-harness-remote/releases/latest"><img src="https://img.shields.io/badge/Android-3DDC84?logo=android&amp;logoColor=white" alt="Android"></a>
  <a href="https://github.com/liguobao/ds-harness-remote/issues/20"><img src="https://img.shields.io/badge/iOS-000000?logo=apple&amp;logoColor=white" alt="iOS"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ds-harness-remote"><img src="https://img.shields.io/npm/v/ds-harness-remote?color=CB3837&amp;logo=npm" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue" alt="License: MIT"></a>
  <a href="apps/server/README.md"><img src="https://img.shields.io/badge/%E3%82%BB%E3%83%AB%E3%83%95%E3%83%9B%E3%82%B9%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0-Docker-2496ED?logo=docker&amp;logoColor=white" alt="セルフホスティング"></a>
  <a href="https://dshfind.com/ja/plugins/liguobao/ds-harness-remote?ref=badge"><img src="https://dshfind.com/api/badge/liguobao/ds-harness-remote?metric=downloads&amp;lang=ja" alt="dshfind ダウンロード数"></a>
</p>

## 一度つなげば、いつでも使える

スマートフォン、パソコン、ブラウザーから、お使いの DeepSeek Harness をそのまま利用できます。どのデバイスからでも、同じ Harness セッションの続きを始められます。

Harness は作業用パソコン上で動作し続け、ワークスペース、ツール、プロジェクト設定もそのままです。DS Harness Remote は、その環境にアクセスするためのもう一つの窓です。

DeepSeek Harness デスクトップ版に対応しています。最新リリースをインストールしてください。

`ds-harness-remote@0.6.4`

## 主な機能

- Web、パソコン、モバイル端末からローカルの Harness にアクセスできます。DSH を中心に、Codex、Cursor、Antigravity にも対応しています。
- DeepSeek Harness Desktop に対応し、インストール後すぐにネイティブ UI を利用できます。独自のデスクトップ会話 UI は追加しません。
- ワークスペースの作成、モデルの設定、会話モデルの切り替えを、ローカルと同じ流れで行えます。
- Harness Host に公開待ち受けポートやパブリック IP は不要です。インターネット接続があれば、双方向のエンドツーエンド暗号化チャネルでどこからでも接続できます。
- P2P 接続を優先し、世界各地の TURN 中継ノードを利用できます。必要に応じて複数の Server Relay にフォールバックします。
- ネイティブの Harness サイドバーから、ワークスペースのファイル、読み取り専用プレビュー、リモートターミナル、許可されたローカル開発サービスのプレビューにアクセスできます。
- Remote Tool のコンテキスト注入により、Host とワークスペースの検出、Harness セッションの作成・管理、履歴の読み取り、実行待機、中断要求、許可されたファイルの転送が可能です。[詳細](packages/plugin/README.md#remote-agent-tools)。
- DeepSeek Harness に加え、ACP 連携を通じて Codex、Cursor、Google Antigravity、Pi、OpenCode、Claude Code、Harness Agent などのネイティブワークスペースを利用でき、リモートファイル閲覧やターミナルにも対応します。
- Android、iOS、Web、ネイティブ DSH 向けのクライアントを提供しています。
- 複数のクライアントから同じ Harness Host に同時接続でき、RPC 呼び出しとストリームは接続ごとに分離されます。

## 対応クライアント

| クライアント | 形式 | 状態 | 備考 |
| --- | --- | --- | --- |
| DSH Desktop プラグイン | Remote サイドバー | 対応 | `ds-harness-remote@0.6.4` をインストールします。このパソコンを Host としても利用できます |
| Web | ブラウザーページ | 対応 | [https://dsh.r2049.cn](https://dsh.r2049.cn) を開きます。ネイティブの Harness UI を再利用します |
| Android | ネイティブアプリ | 対応 | [Releases](https://github.com/liguobao/ds-harness-remote/releases/latest) から APK をダウンロードできます。[Android ガイド](apps/android/README.md)を参照してください |
| Harmony&nbsp;7.* | ネイティブアプリ | 対応 | ソースは [apps/harmony](apps/harmony) です。HarmonyOS 7.0（API 26）以降と DevEco Studio でビルドします。詳細は [HarmonyOS ガイド](docs/harmony-client.md) を参照してください |
| DSH Go | ccch1mneyyy 氏の力作 | 対応済み | 詳細：[ccch1mneyyy/dsh-go: DeepSeek Harness の Android クライアント。スマートフォンで直接実行したり、パソコン上の DSH をリモート操作したりできます。](https://github.com/ccch1mneyyy/dsh-go) |
| iOS | TestFlight ベータ | ベータ | 一般公開はまだ行っていません。[Issue #20](https://github.com/liguobao/ds-harness-remote/issues/20) を参照してください |
| ブラウザー拡張機能 | Chrome | アクセス入口のみ | ログイン済み Web の認可を独立したデバイス認証情報に交換し、オンラインの Host を一覧表示して同一オリジンの Remote Web を開きます。拡張機能自体に会話 UI はありません |
| dsh-TUI | ターミナル専用 CLI | 予定 | このリリースには統合を含まず、後続バージョンで個別に提供します。インストーラーが自動的に Web サービスを作成することはありません |
| Linux | クラウドサーバー | 対応 | [公式サイト](https://dsh.r2049.cn/)にログインすると、ワンコマンドでインストールできます。 |

複数のクライアントから同じ Host に同時接続できます。RPC 呼び出しとストリームは接続ごとに分離されます。

## インストール

### DeepSeek Harness Desktop

DeepSeek Harness Desktop の **Extensions / Plugin management** を開き、npm からのインストールを選択して、次のパッケージを入力します。

`ds-harness-remote@0.6.4`

インストール後に Desktop を再起動してください。公式の `dsh` ランチャーでも、`dsh plugin --profile desktop add -w ds-harness-remote@0.6.4` を実行して指定バージョンをインストールできます。

DSH 0.2.2 以降では、npm からインストールしたプラグインのバージョン確認とワンクリック更新をプラグイン管理画面から行えます。ホットアップデートに失敗した場合、DSH は旧バージョンへの復元を試みます。GitHub／ローカル link からのインストールは、先に npm に切り替える必要があります。[オンライン更新の説明](docs/installation.md#online-updates-in-dsh-plugin-management)を参照してください。

### Linux ワンコマンドインストール

[公式サイト](https://dsh.r2049.cn/)にログインし、ワンコマンドインストール用の認可コードを取得してインストールしてください。

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

セルフホスティングには、このリポジトリの[最小構成 Server](apps/server/README.md) を利用できます。現在のバージョンには WebRTC の LAN/P2P/TURN 接続調整（TURN は別途 coturn のデプロイが必要）と暗号化 Relay Server が含まれますが、ホスト型 Remote Web の全機能は提供しません。

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

Host 上の Harness やプラグインの設定もリモートで変更できます。編集できる項目は、Harness と各プラグインが公式設定 API で公開している内容によって異なります。

## 実験的な ACP ワークスペース

Host はローカルの ACP 対応 Agent を起動し、ds-harness-remote を通じてプロンプト、ストリーミング応答、承認要求を転送します。各 Agent は自身のワークスペースとセッションを使用し、DSH 向けのセッション変換のみを行います。Harness のストレージには書き込みません。

対応バックエンド:

- **Codex** — App Server 経由で接続し、共通のワークスペース入口から利用できます。
- **Cursor** — CLI の ACP インターフェース経由で接続します。
- **Antigravity（AGY）** — CLI の stream-json インターフェースをアダプター経由で接続します。
- **Pi Agent（実験的）** — Pi と `pi-acp` のインストール・設定後に自動検出され、設定で無効化できます。ツールは Host ユーザーの権限で実行され、デフォルトではツールごとの確認はありません。
- **OpenCode** — `opencode acp` 経由でワークスペースと履歴を利用できます。会話のアーカイブには認証 API を提供するバージョンが必要で、アーカイブ解除は未対応です。
- **Claude** — ローカル認証済みの `claude-agent-acp` 経由で接続し、設定で有効化します。テキストと承認に対応し、画像は未対応です。
- **Hermes** — `hermes acp` 経由で接続し、設定で有効化します。テキスト、画像、ストリーミング出力、承認、モデル選択に対応します。

Claude と Hermes はファイルとターミナルへの直接アクセスにも対応し、Host のワークスペース境界とターミナル設定に従います。

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
- 同一アカウントのデバイスは追加確認なしで接続できます。詳細は[デバイスの信頼と権限](docs/end-to-end-encryption.md#2-设备身份与信任)を参照してください。
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

現在の基準バージョンは `dsh-v0.2.2-rc.1` です。`dsh-v0.2.1-rc.5` と `0.2.0` rc.2 / rc.1 は同じ公式 carrier 上で引き続き互換です。[互換性ガイド](docs/compatibility.md)を参照してください。

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
- 現在の開発基準は `dsh-v0.2.2-rc.1` です。検証範囲は[互換性ガイド](docs/compatibility.md)に記載しています。

## 関連リンク

- 関連プロジェクト: [DSH Go](https://github.com/ccch1mneyyy/dsh-go) — DeepSeek Harness をポケットに。スマートフォン上で直接実行でき、パソコンのリモート操作も可能です。Remote 連携に対応しています。
- 関連プロジェクト: [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — ターミナル優先の Harness クライアントです。Remote 連携は後続バージョンで提供予定です。
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

## 接続のトラブルシューティング

Android：問題を再現した後、**設定 → 診断 → 接続ログをエクスポート** を開き、保存先のフォルダーを選んで `.txt` ファイルを保存します。ログには現在のアプリプロセスの起動以降、直近 500 件の接続診断が保持されます。アプリを再起動すると消去され、認証情報や会話内容は含まれません。

Host：**プラグイン → Remote 設定** で **Debug ログ** を有効にします。設定は即座に反映され、保存されます。調査後は無効にしてください（`info` レベルに戻ります）。ログには `[ds-harness-remote]` の接頭辞が付き、Desktop では `desktop.log` で確認できます。手動設定では `logLevel: debug` を指定できます。

## ライセンス

[MIT](packages/plugin/LICENSE)
