# Firebase 連線設定指南（階段 0）

> Seven Hand Poker 連線對戰用 **Firebase Realtime Database (RTDB)**。
> 本文件是「你（專案擁有者）要在 Firebase Console 手動做的事」。做完把 **設定值** 給 Claude，程式部分由 Claude接。
> 架構與資料模型見 [SPEC.md](SPEC.md) §6。

---

## 為什麼要這步
- RTDB 免費額度（Spark 方案）足夠給朋友玩：同時連線 100、每月 10GB 傳輸。
- **Firebase 網頁設定值（apiKey 等）本來就是公開的**——它不是密碼，安全性靠「資料庫規則」，不是靠藏設定。放進前端/公開 repo 是正常做法。

---

## 步驟

### 1. 建立 Firebase 專案
1. 前往 <https://console.firebase.google.com/>，用 Google 帳號登入。
2. 點 **「建立專案 / Add project」**。
3. 專案名稱輸入 `seven-hand-poker`（或你喜歡的名字）→ 下一步。
4. **Google Analytics 可以關掉**（這遊戲用不到）→ 建立專案 → 等它跑完 → 繼續。

### 2. 建立 Realtime Database（注意：不是 Firestore！）
1. 左側選單 **「建構 / Build」→「Realtime Database」**。
2. 點 **「建立資料庫 / Create Database」**。
3. **位置**：選 **Singapore (asia-southeast1)**（離台灣近、延遲低）。若清單沒有就選預設 `us-central1` 也可以。
4. 安全規則：先選 **「以測試模式開始 / Start in test mode」**（我們下一步會換成正式規則）→ 啟用。
5. 建好後，頁面上方會有一個網址，長得像：
   - `https://seven-hand-poker-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app`（Singapore）
   - 或 `https://seven-hand-poker-xxxx-default-rtdb.firebaseio.com`（US）
   - **這個 `databaseURL` 很重要，等下要給 Claude。**

### 3. 貼上安全規則
1. 在 Realtime Database 頁面點上方 **「規則 / Rules」** 分頁。
2. 把整段內容換成下面這段，然後 **發布 / Publish**：

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        ".validate": "$roomId.matches(/^[0-9]{3}$/)"
      }
    }
  }
}
```

> 說明：v1「給朋友玩」，任何人知道 3 碼房號就能讀寫該房（符合 SPEC §6.3 接受的限制）。房號限定 3 位數字。日後要更嚴（匿名登入 + 房主才能寫核心狀態）可再升級，架構已預留。

### 4. 取得網頁應用程式設定值
1. 左上角齒輪 **⚙ → 專案設定 / Project settings**。
2. 往下捲到 **「你的應用程式 / Your apps」**，點 **`</>`（Web）** 圖示新增網頁應用程式。
3. 暱稱輸入 `web` → 註冊應用程式（**不用**勾 Firebase Hosting）。
4. 它會顯示一段 `firebaseConfig`，長這樣：

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "seven-hand-poker-xxxx.firebaseapp.com",
  databaseURL: "https://seven-hand-poker-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "seven-hand-poker-xxxx",
  storageBucket: "seven-hand-poker-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
```

> 如果這裡的 config **沒有** `databaseURL` 那一行（有時會漏），就用步驟 2 記下的資料庫網址補上。

---

## 做完後：把這些給 Claude

把上面那段 `firebaseConfig` **整段貼回對話**即可（七個欄位都要，特別是 `databaseURL`）。Claude 會：
- 建立 `.env`（放這些值、加入 `.gitignore` 不進 repo）與 `.env.example`（給協作者參考）。
- 寫 `src/net/firebase.ts` 初始化，接上建房/加房流程。

> 這些值會被打包進前端（GitHub Pages 上是公開的），這是 Firebase 網頁應用的正常情況；真正的防護是上面的資料庫規則。
