# W08 Git 協作 — 互動教學網站

互動程式設計（19755）W08「版本控制」50 分鐘的教學網站。純靜態檔案（HTML + CSS + JS），**沒有 build、不需要 CDN、不需要網路字型**，教室電腦用瀏覽器打開就能用。

這個資料夾的內容會成為組織裡一個**公開 repo 的根目錄**（預設名稱 `w08-git`），由 GitHub Pages 發佈到 `https://<org>.github.io/w08-git/`。

## 內容（對應 50 分鐘流程）

| 段落 | 時間 | 內容 |
|---|---|---|
| 1 為什麼 | 5′ | 混亂檔名動畫、三張翻面卡片 |
| 2 概念 | 5′ | 七個關鍵字＋12 步故事播放器（可點的 commit 圖、PR 卡片、衝突檔案） |
| 3 沙盒 | 5′ | 瀏覽器裡的模擬 Git（終端機＋即時 commit 圖），5 個挑戰，完成有彩帶 |
| 4 簽名牆 | 10′ | 每人開一個 PR 新增 `wall/<帳號>.txt`，合併後自動出現在牆上 |
| 5 小組實作 | 25′ | 選組別 → 連結、瀏覽器／Colab／Codespaces／本機四種路線、角色任務清單、功能檔產生器、FAQ |

**助教模式**：按 🎓（或鍵盤 `T`、或網址加 `#ta`）→ 分段計時器（5/5/5/10/25）、每段講稿、課前準備清單。

## 本機預覽

```bash
cd site
python3 -m http.server 8000
# 打開 http://localhost:8000/        助教模式：http://localhost:8000/#ta
```
直接雙擊 `index.html`（file://）也能用；簽名牆會顯示內建的範例資料。
本機預覽時組織名稱用 `assets/config.js` 的 `org`；也可以用網址參數暫時覆蓋：`?org=my-org`。

## 設定

`assets/config.js`：

| 欄位 | 說明 |
|---|---|
| `org` | 組織名稱。部署在 `*.github.io` 時會**自動偵測**，這裡只是本機預覽用的備用值 |
| `siteRepo` | 這個網站的 repo 名稱（簽名牆的 PR 會開在這裡）。部署時同樣自動偵測 |
| `teams` / `teamRepo` | 組別與 repo 名稱規則（預設 `G1`…`G6`） |
| `classSize` | 簽名牆進度圈的分母（42） |
| `wallPollSeconds` | 簽名牆多久重新抓一次 `wall.json`（20 秒） |

## 簽名牆怎麼運作

```
學生開 PR：新增 wall/<帳號>.txt
  └─ wall-check（pull_request_target）：只能動自己的檔案、≤80 字、不能有網址／學號／HTML
       └─ ✅ → 學生自己按 Merge（main 規則：要 PR + wall-check 通過，0 個 approve）
            └─ Deploy site（push 到 main）：scripts/build_wall.py 產生 wall.json → GitHub Pages
                 └─ 網頁每 20 秒抓一次 wall.json，新卡片飛上牆
```

- 不在瀏覽器呼叫 GitHub API：全班 42 人共用教室 IP，很快就會撞到 API 限額。只抓同網域的靜態 `wall.json`。
- 每人一個檔案 → 42 個 PR 彼此不會衝突。
- `wall-check` 用 `pull_request_target`，所以檢查程式來自 main，PR 改不了規則；PR 的檔案只用 git 當資料讀，不會被執行。
- `build_wall.py` 會跳過不合規的檔案，所以就算有人繞過檢查，網頁也不會壞。
- 短時間內大量合併時，Pages 部署會排隊、只保留最新一次，大約 1 分鐘內更新。

## 檔案

```
index.html              頁面
assets/style.css        樣式（淺色／深色、手機／桌機）
assets/git-engine.js    Git 模擬器（commit/branch/merge/三方合併/衝突/push/PR）
assets/graph.js         SVG commit 圖
assets/app.js           頁面互動（故事、沙盒、簽名牆、小組實作、助教模式）
assets/config.js        設定
wall/                   簽名牆的資料（每人一個 .txt）
wall.sample.json        本機預覽用的範例資料
scripts/                build_wall.py、check_wall_pr.py、wall_rules.py
.github/workflows/      pages.yml（部署）、wall-check.yml（檢查 PR）
```

進度（挑戰、任務清單、選的組別、主題）只存在學生自己瀏覽器的 localStorage，無痕模式或被封鎖時頁面照常運作，只是不會記住。
