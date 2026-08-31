# 兩岸交流活動追蹤看板（GitHub Actions 免費排程版）

功能跟 Firebase 排程版完全一樣（Google News RSS 搜尋 + 福建省台辦直接爬取 +
排除清單/白名單過濾），差別只在：**排程抓取的工作改由 GitHub Actions 執行，
不需要 Firebase Blaze 方案、不需要綁信用卡**。

## 為什麼要這樣改

Firebase 的排程函式（Scheduled Functions）規定一定要 Blaze（用量計費）方案
才能用，即使實際費用是 $0 也需要先綁信用卡才能啟用。如果不想綁卡，就不能用
Cloud Functions 排程。

改用 GitHub Actions 之後：
- **Firestore 資料庫**、**Hosting 看板網頁** 都留在 Firebase 的 **Spark（免費）
  方案**額度內，不需要 Blaze。
- 排程抓取的邏輯（原本在 `functions/index.js` 裡）搬到 `scripts/fetch.js`，
  由 GitHub Actions 每 12 小時自動執行一次（`.github/workflows/fetch.yml`），
  完全免費（公開倉庫的 GitHub Actions 排程無限制使用）。
- 腳本執行時用「服務帳戶金鑰」透過 `firebase-admin` 直接寫入 Firestore，
  不需要透過 Cloud Functions。

## 部署步驟

### 1. 建立 Firebase 專案（只需要 Spark 免費方案，不用升級）

到 [Firebase 主控台](https://console.firebase.google.com/) 建立新專案，啟用：
- **Firestore Database**（正式模式即可）
- **Hosting**

### 2. 取得服務帳戶金鑰

Firebase 主控台 → 齒輪圖示「專案設定」→「服務帳戶」分頁 → 點「產生新的
私密金鑰」，會下載一個 JSON 檔案。**這個檔案很重要，不要外流、不要傳到公開
的地方**，等一下要用它的內容設定 GitHub Secret。

### 3. 填入前端連線設定

Firebase 主控台 → 專案設定 → 一般 → 你的應用程式 → 網頁圖示「</>」新增網頁
應用程式，取得 `firebaseConfig`。把裡面的 apiKey、authDomain、projectId 等
複製貼到 `public/index.html` 裡對應的 `firebaseConfig` 位置。

### 4. 建立 GitHub 倉庫

把這整個資料夾上傳到 GitHub（新建一個 repo，可以是公開或私人倉庫，公開倉庫
的 Actions 排程完全免費、無使用限制；私人倉庫每月有一定免費額度，這個工具的
用量遠低於額度上限）。

### 5. 設定 GitHub Secret（把服務帳戶金鑰交給 GitHub Actions）

到你的 GitHub 倉庫 → **Settings** → 左側選單 **Secrets and variables** →
**Actions** → 點 **New repository secret**：
- Name 填：`FIREBASE_SERVICE_ACCOUNT`
- Secret 填：打開步驟 2 下載的 JSON 檔案，把**整個檔案內容**複製貼上去

### 6. 啟用 GitHub Pages（看板網頁）

倉庫 → **Settings** → **Pages** → Source 選擇你的分支（通常是 `main`），
資料夾選 `/public`（如果 GitHub Pages 設定不支援選子資料夾，改用步驟 7 的
Firebase Hosting 也可以，兩種擇一即可）。

### 7.（替代方案）用 Firebase Hosting 部署看板網頁

如果不想用 GitHub Pages，也可以用 Firebase Hosting（一樣是 Spark 免費方案）：
```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only hosting,firestore:rules
```

### 8. 手動測試一次抓取

不想等排程自動跑，到 GitHub 倉庫頁面 → **Actions** 分頁 → 左側選「兩岸交流
活動抓取」→ 右上角 **Run workflow** 按鈕，手動觸發一次。跑完可以點進去看
執行紀錄，確認有沒有成功、抓了幾筆。

## 自訂與擴充

- **關鍵字**：`scripts/fetch.js` 裡的 `KEYWORDS` 陣列
- **排除/白名單字眼**：`EXCLUDE_KEYWORDS` / `REQUIRE_KEYWORDS`
- **新增直接爬取來源**：`DIRECT_SOURCES` 陣列
- **排程頻率**：`.github/workflows/fetch.yml` 裡的 `cron` 設定

修改後直接 push 到 GitHub 就會生效，不用額外部署指令。

## 看板功能

- 搜尋框、地區/領域篩選
- 狀態分頁（全部/未查證/已確認/已略過），點卡片上的圓形標記可循環切換
- 頂部跑馬燈顯示最新未查證訊息
