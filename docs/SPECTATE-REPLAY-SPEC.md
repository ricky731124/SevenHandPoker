# 觀戰 · 賽事精華 · 在線人數 · 人機系統 開發規格書

> 版本：Draft 1（2026-09-04）
> 作者：與使用者多輪討論後彙整，供開發時逐項照做。
> 讀者：實作此功能的工程 session（讀完可直接開發，力求一次過）。
>
> **本規格涵蓋四大塊，彼此有依賴，建議照順序做：**
> 1. **在線人數改造**（心跳制）— 地基，先做。
> 2. **人機系統改造**（15 隻固定人機 + 租借 + 配對時序 + 節奏）— 觀戰/棋譜要靠它。
> 3. **觀戰 + Live 版**（含彈幕）— 主功能一。
> 4. **賽事精華（回放）** — 主功能二。
>
> 免費方案紅線（Firebase RTDB Spark）：**同時連線 100 / 儲存 1GB / 每月下載 10GB**。本規格所有設計都在此約束下；真正要留意的是「同時連線 100」，其餘餘裕極大。

---

## 0. 名詞與現況地圖

| 名詞 | 意義 |
|---|---|
| **host / guest** | 真人連線對局中的主機端（權威）/ 客端。見 `src/net/netgame.ts`。 |
| **casual bot / 人機** | 快速配對 30 秒（將改為 16–23 秒）沒配到真人時，本機開的 AI 對局。見 `src/game/casualBots.ts`、`src/ui/screens/Matchmaking.tsx`。 |
| **broadcaster / 廣播端** | 「把對局寫給觀眾看」的那一端。真人局＝host；人機局＝本機玩家。 |
| **spectator / 觀眾** | 只看不能操作的人，可能是登入玩家或訪客。 |
| **spec view / 全開視角** | 觀眾看的視角：**雙方手牌、雙方對決區暗牌全部翻正**，牌堆只給數量。 |

**關鍵現況（開發前必讀）：**

- **對局同步是「host 權威 + 完整快照」**：host 每次引擎變動就 `set(rooms/{code}/game, guestView)`（見 `netgame.ts:60` `writeGame`、`sync.ts:74` `serializeForGuest`）。`game` 是「藏 host 手牌」的 guest 視角。觀眾要的是**另一份全開視角**。
- **人機局是純本地**：`Matchmaking.tsx` 的 `startBot()` 呼叫 `useGameStore.getState().startCasualBotMatch(...)` + `launchGame({ mode:'ai', casualBot:true })`，**完全沒有 RTDB 房間**。要讓人機局能被觀戰，需讓本機額外「廣播」（見 §3、§4）。
- **引擎 transition 全是純函式**（`src/game/state.ts` 已 export）：`createGame` / `applyPick` / `applyPlace` / `resolveShowdown` / `applyDraw` / `applySwap` / `applySuit` / `applyClubs` / `markSpecialUsed` / `checkWin` / `validatePick` / `validatePlace`。回放驅動器直接組這些即可。
- **唯一的非決定性來源**：`applySwap`（`state.ts:334`）、`applyClubs`（`state.ts:383`）預設 `rng = Math.random`（把牌塞回牌堆隨機位置）。回放要處理這點，見 §6.3。
- **設計 token 全在 `src/ui/theme/tokens.css`**：所有新 UI 一律用這些變數，不得寫死顏色/字型。清單見 §7。
- **玩家名片**：`cards/{uid}`（`src/platform/cards.ts`，型別 `PlayerCard`）。人機要仿造這個結構（見 §3）。
- **在線人數現況**：`presence/{uid}/{connId}=true` + `onDisconnect().remove()`，count = `presence` 節點的 `.size`（`src/net/presence.ts`、`OnlineCount.tsx`）。問題：開著不關的分頁永遠算在線 → 只增不減。改造見 §2。

---

## 1. RTDB 資料模型（全部新增/變更節點）

> 全部掛在**同一個 Firebase 專案、同一個 RTDB**。不新增任何伺服器、不用 Cloud Functions。

### 1.1 新增節點

```
liveIndex/{code}                     # Live 版的卡片 metadata（真人局 + 人機局共用）
  p1: { name, avatar, uid|null, wins, winRate }   # 左方＝廣播端玩家（真人）
  p2: { name, avatar, uid|null, wins, winRate, isBot }  # 右方＝對手（真人 or 人機）
  status: 'live' | 'ended'
  isBot: boolean                     # p2 是否為人機（僅內部用；UI 不顯示破綻）
  startedAt: <serverTimestamp>
  endedAt: <serverTimestamp> | null
  winner: 'p1' | 'p2' | null         # ended 時填
  spectators: <number>               # 由廣播端寫入（見 §4.4）

spectate/{code}/spec                 # 全開視角（SpecView，見 §4.1）。廣播端在「有觀眾時」才寫。
spectate/{code}/danmaku/{pushId}     # 彈幕：{ text, by, at }，臨時、不長存，讀取用 limitToLast(20)
spectate/{code}/notice/{pushId}      # 進/出場提示：{ kind:'join'|'leave', name, at }
spectate/{code}/watch/{watcherId}    # 觀眾在席：true，arm onDisconnect().remove()。廣播端數 .size → 寫回 liveIndex.spectators

bots/{botId}                         # 15 隻固定人機（見 §3.1）。公開讀。
  name, avatarId, loadout[], achievements[{id,tier}], wins, games

botLease/{botId}                     # 人機租借鎖：{ by:<uid>, at:<serverTimestamp> }（不存在＝空閒）

replays/{pushId}                     # 全站賽事精華（見 §6.1）。公開讀，顯示 limitToLast(10)。
```

- **`code` 的來源**：真人局＝沿用該房的 3 碼房號；人機局＝本機產生一個新 key（用 `spec_` + 亂數，**避開 3 碼房號空間**，因為人機局不需要被 join）。真人與人機都掛在 `liveIndex/` 與 `spectate/` 兩棵樹下，彼此不衝突。
- **為什麼把觀戰放獨立的 `spectate/` 樹、不塞進 `rooms/`**：人機局沒有 `rooms/{code}`，統一用 `spectate/` 兩者共用；真人局的 host 則同時寫 `rooms/{code}/game`（給 guest）與 `spectate/{code}/spec`（給觀眾）。

### 1.2 變更節點

```
presence/{uid}/lastActive : <serverTimestamp>   # 改為「心跳時間戳」（見 §2）
                                                 # 舊的 presence/{uid}/{connId}=true 作法淘汰
```

### 1.3 `database.rules.json` 需新增/調整

```jsonc
{
  "rules": {
    // ...既有 rooms / users / usernames / leaderboard / presence / cards / matchmaking 保留...

    "liveIndex": {
      ".read": true,
      "$code": { ".write": "auth != null" }        // 廣播端寫；spectators 也由廣播端寫
    },
    "spectate": {
      "$code": {
        ".read": true,
        ".write": "auth != null"                    // spec 由廣播端寫；watch/danmaku/notice 由觀眾寫
      }
    },
    "bots": {
      ".read": true,
      "$botId": { ".write": "auth != null" }         // 真人打完用 transaction 累加勝負場
    },
    "botLease": {
      ".read": "auth != null",
      "$botId": { ".write": "auth != null" }          // 租借/釋放
    },
    "replays": {
      ".read": true,
      "$id": { ".write": "auth != null", ".validate": "newData.hasChildren(['seed','moves'])" }
    }
  }
}
```

> ⚠️ 規則改完要在 Firebase 主控台**發布**，否則新節點寫入會被拒。
> ⚠️ 安全取捨（使用者已同意）：`spectate/{code}/spec` 是全開的、公開可讀，理論上對手玩家可直接讀 RTDB 偷看你手牌。以現況（casual、無賭注）接受；真正的解法要伺服器端過濾（要錢），不在本期。

---

## 2. 在線人數改造（心跳制）— 先做

### 2.1 目標
- 真人數要「自己漲、自己退」：走掉的人會自動消失，不再只增不減。
- **絕不登出、不斷線、不重發 uid**——這只是「計數」，與登入/連線/身分完全無關。
- 加上 15 隻固定人機當保底（永遠在線、不佔真連線）。

### 2.2 心跳規則（**每連線一個子節點**，避免雙開閃退）
- 每個分頁（連線）在 `.info/connected` 為 true 時，`push` 一個子節點：
  ```
  presence/{uid}/{connId} = { lastActive: serverTimestamp() }
  onDisconnect(presence/{uid}/{connId}).remove()   // 乾淨關分頁秒清
  ```
- 之後**只在 `document.visibilityState === 'visible'` 時**，每 **4 分鐘**更新自己那個 connId 的 `lastActive`。
- 分頁切走/最小化/鎖屏 → **停止心跳**（過期後自動退出計數）。
- 回到前景（`visibilitychange` → visible）→ 立即補寫一次。
- **為什麼每連線一個子節點**：雙開時關掉分頁 A，只移除 A 的子節點，B 的子節點還在 → 該 uid 不會短暫消失（無閃退）。單分頁關掉則整個 uid 立即消失（秒清）。

### 2.3 在線人數計算
- 訂閱 `presence` 整包 + 用 `.info/serverTimeOffset` 校時。
- **線上人數 = （任一連線 lastActive 在最近 10 分鐘內的 distinct uid 數）+ BOTS_ONLINE(15)**。
- **⚠️ 只認新格式**：舊格式 `presence/{uid}/{connId}=true`（改版前「只增不減」累積的殘留）**一律不算**，否則會把舊垃圾算回來（實測正式庫殘留約 39 筆，會把數字灌到 50+）。`fetchIsOnline` 同理只認新格式。舊垃圾會在那些連線斷開時被 onDisconnect 清掉，或使用者重整進新版後被覆蓋，不影響計數，**不需要手動清空 presence**。
- **presence 改為公開可讀**（`database.rules.json` → `presence/.read: true`，寫入仍限本人）。這樣純訪客（尚無 uid）也**看得到**人數；auth 時序類 bug 也一併消失。⚠️ 需發佈規則。
- **維持 lazy auth（不製造孤兒）**：uid 只在「需要存檔的動作」（開房/開始遊戲/配對 → `ensureAccount`）時才生成，登入門的「訪客進入」**不**提前建帳號（避免只是進來看看的訪客留下孤兒匿名帳號——這是既有的刻意設計，不改）。
  - 結果：純訪客在主畫面 **看得到** 人數（公開可讀）但 **尚未被算**（沒 uid 就無法寫時戳）；一旦他實際「開始遊戲/開房/配對」→ 生 uid → 心跳 → 才 +1。
  - 登出 → uid=null（不自動建匿名，維持既有設計）。**登出不會產生新 uid**（不會有「登出→生訪客 uid」的孤兒 loop）。
  - **登出即時 −1**：`platformStore.logout` 在 `signOut` **之前**先 `clearPresence(uid)`（趁還有 auth、寫得動 owner-write 規則）刪掉自己的 presence → 別人立即看到 −1；否則 signOut 後已無 auth、刪不掉自己，只能等 10 分鐘窗口過期。
    - ⚠️ **`clearPresence` 必須先「停掉還在跑的 tracker」再刪**：`signOut` 會讓 RTDB 重新驗證、blips `.info/connected`，若舊 `trackPresence` 還活著，它的 connected handler 會在那瞬間把 presence 寫回去（「−1 又馬上 +1」bug）。所以 presence.ts 用一個 module 級 `_activeCleanup`，`clearPresence` 先呼叫它（unsub 心跳+connected handler、清掉自己那筆）再 `remove` 整個節點；`trackPresence` 的 cleanup 做成 idempotent（logout 與 App effect 都會呼叫）。best-effort，失敗退回窗口過期、絕不擋登出。實測登入 19→登出 18 穩住不彈回。
- **心跳寫入是全 app（非只主畫面）**：`trackPresence` 掛在 App 根部 `useEffect([uid])`，跟畫面無關——遊戲中、個人化設定、排行榜…只要有 uid + 分頁在前景都在寫時戳。只有「顯示那行數字」限主畫面（`OnlineCount` 於 `screen==='menu'`）。
- **首次顯示緩衝**：`OnlineCount` 訂閱後緩衝 ~1s 才首次顯示（`revealed` 旗標），讓初始 presence 寫入沉澱、「算好再呈現」，避免數字從只有人機(15)跳到含真人。被權限擋（例如登出）時 `onError` 直接清成 null（隱藏），不留凍結假數字。effect 依 `uid` 重訂（登入/登出/換帳號時重接）。
- ⚠️ 過期不觸發 DB 事件 → 每 **60 秒**自行重算一次（純本地計算、無 DB 讀取、成本可忽略），不能只在 DB 變動時算。已放在 `subscribeOnlineCount` 內。
- 懶人清潔工（可選、非必要）：順手刪掉整組都過期/皆為舊格式的 `presence/{uid}`（純資料衛生，不影響計數）。

### 2.4 實際改的檔（已完成）
- `src/net/presence.ts`：
  - `trackPresence` → 每連線 `push` 一個 `{lastActive}` 子節點、可見時每 4 分鐘心跳、visibility 監聽、`onDisconnect().remove()`；保留 `cards/{uid}/lastOnline`（#5）。cleanup 做成 idempotent，並登記到 module 級 `_activeCleanup`。
  - `subscribeOnlineCount(cb, onError?)` → 讀 `presence` + `.info/serverTimeOffset`，算「任一連線 10 分內活躍的 distinct uid + BOTS_ONLINE」，onValue 變動即時重算 + 每 60 秒輪詢重算；只認新格式（舊 `true` 忽略）；讀取被擋時走 `onError`。
  - `clearPresence(uid)` → 先呼叫 `_activeCleanup`（停掉還在跑的 tracker、避免 signOut blip 寫回）再 `remove` 整個 `presence/{uid}`。`export const ONLINE_WINDOW_MS`。
- `src/platform/cards.ts`：`fetchIsOnline` 改判「任一連線 lastActive 在 `ONLINE_WINDOW_MS` 內」（舊 `true` 不算在線）。
- `src/ui/components/OnlineCount.tsx`：依 `uid` 重訂閱；訂閱後 ~1s `revealed` 緩衝才首次顯示（算好再呈現）；`onError` 清成 null（隱藏、不凍結）。
- `src/state/platformStore.ts`：`logout` 在 `signOut` 前先 `await clearPresence(uid)`（登出即時 −1）。
- `src/game/bots.ts`：新增，`BOTS_ONLINE`（§2 用）+ persona 骨架（§3 補完）。
- `database.rules.json`：`presence/.read` → `true`（**需發佈**；寫入仍限本人）。
- ⚠️ 維持 lazy auth：`AccountButton.tsx` 的「訪客進入」**不**改（不提前建帳號）。

### 2.5 驗收（已通過）
- 主畫面右下角人數 = 15 人機 + 活躍真人（實測 16/17…）；純訪客（公開可讀後）看得到、開始玩才被算。
- 不再閃 15→17（緩衝生效）；登入→登出 **−1 穩住不彈回**（實測 19→18）；雙開關一個不閃退；背景 >10 分過期 −1、回前景 +1；全程不登出/不換 uid。
- ⚠️ 正式站要記得**發佈 presence 公開可讀規則**，純訪客才看得到數字。

---

## 3. 人機系統改造

### 3.1 15 隻固定人機（`bots/{botId}`）

- 新增 `src/game/bots.ts`：定義 15 隻**固定身分**的人機。
  ```ts
  export interface BotPersona {
    id: string          // 穩定 key，如 'bot_sparrow'
    name: string        // 顯示名（使用者提供 15 個，見 §9）
    avatarId: string    // 固定頭像（開發者自配一個既有 avatar id）
    loadout: string[]   // 預設牌組展示（開發者隨意配 ≤3 張特殊卡 id）
    achievements: { id: string; tier: number }[] // 展示成就（開發者配 1~2 個銅/銀）
  }
  export const BOTS: BotPersona[] = [ /* 15 筆，名字見下 */ ]
  export const BOTS_ONLINE = BOTS.length   // 在線人數保底（15）
  ```
- **15 個名字（使用者提供，定案）**：山石宮分、我要驗牌、海Chris爛、無法顯示名稱、金色狂蜂、沒事call文哲、常威打旺福、你在大聲什麼啦、夢醒淑芬、新資料夾(2)、鍵盤柯南、玉皇Daddy、乂煞氣a屁孩卍、陶敬凱、穹道穗宮原。
  - `id` 由開發者給穩定 key（如 `bot_01`…`bot_15` 或有意義的英數 slug）；`avatarId` / `loadout` / `achievements` 開發者自配（沿用既有 avatar/特殊卡/成就 id，展示用假資料，銅/銀 1~2 個）。
- **首次啟動時把 15 隻寫進 `bots/{botId}`**（若不存在才寫，冪等）：`name/avatarId/loadout/achievements` + `wins:0, games:0`。可在 app 啟動流程做一次 seed（僅補缺，不覆蓋既有 wins/games）。
- **身分固定、大腦隨機**：每次配對時，人機的 name/avatar/record 用固定的那隻；但 boss 大腦（風格/執行力）仍照 `rollCasualBot` 每局隨機 roll（保留現有難度混搭手感）。

### 3.2 人機戰績
- **有**：場次 `games`、勝場 `wins`、勝率（= wins/games，前端算，0 場顯示 `—`）。
- **無**：不發鑽、不算成就數量、**四大排行榜一律不上**。
- 人機的名片（點擊 Live 卡/未來任何地方）從 `bots/{botId}` 讀，套用現有 `PlayerInfoCard` UI，展示 loadout + achievements（假資料）+ 場次/勝場/勝率。
- **寫入時機**：真人局（人打人機）結束時，由**真人這端**寫 `bots/{botId}`：
  ```ts
  runTransaction(ref(db, `bots/${botId}`), (cur) => {
    if (!cur) return cur
    cur.games = (cur.games ?? 0) + 1
    if (humanLost) cur.wins = (cur.wins ?? 0) + 1  // 人機贏了才加
    return cur
  })
  ```
  用 transaction 避免兩人同時打完同一隻時搶寫。

### 3.3 人機互斥（租借 `botLease/{botId}`）
- 配對到人機時（§3.4 觸發後），**先挑一隻「空閒」的人機**：
  1. 讀 `botLease`，找出未被租的 botId（`bots` 全集 − `botLease` 現有 key）。
  2. 對選定 botId 做 transaction 佔用：`if cur exists → abort（被搶）; else set {by:uid, at:ts}`。
  3. 佔用成功 → 用這隻的固定身分開局；失敗 → 換下一隻重試。
- **持有期間**：整個快速配對對局期間持有（**含 rematch**，同一隻繼續陪打）。
- **釋放**（`net/bots.ts` 用 module 級 `_leasedBotId` 追蹤，`releaseLeasedBot()` 釋放）：
  - **下次配對** `leaseBot` 會先自動釋放上一隻（`leaseBot` 開頭呼叫 `releaseLeasedBot`）。
  - **回主畫面/離開對局** → `gameStore.reset()` 呼叫 `releaseLeasedBot()`。
  - **關分頁/當機** → `onDisconnect(botLease/{botId}).remove()`（`leaseBot` 佔用成功時 arm）。
  - 中途離開若漏接，**下次快速配對會自動釋放**（自我修復）。
- **戰績**：每場對局結束（不是離開）在 `gameStore` 結算處 `recordBotResult(botId, humanWon)`（見 §3.2），與租借週期獨立。
- **全被佔滿（15 隻都在打）**：`leaseBot` 回 `null` → `Matchmaking.startBot` 每 3 秒重試、維持「尋找對手中…」，使用者可自行取消。**不做保底無名人機**（使用者定案）。

### 3.4 快速配對時序改造（15 / 16–23 秒）
- 現況：`Matchmaking.tsx` 等 30 秒（`SEARCH_SECS=30`）→ `onTimeout` → `startBot()`。`matchmaking.ts` 的 `TIMEOUT_MS=30_000`。
- 改為：
  - **0–15 秒**：純等真人（維持現有 `joinMatchmaking` claim 邏輯）。
  - **過 15 秒**：**繼續等真人的同時**，在 **16–23 秒之間隨機挑一個時間點** `T` 觸發配人機。實作：`const T = 16000 + Math.random()*7000`；`setTimeout(startBotWithPersona, T)`。
  - **真人可插隊**：15 秒後到人機真正配上的那一刻之前，只要有真人配上就走真人（人機的 `setTimeout` 取消）。例：random 到 22 秒、還沒配到人機時來了真人 → 走真人。✅（使用者確認的模式）
  - **最晚不超過 23 秒**配到人機。
- 目的：避免「每次剛好 30 秒才配到」被看穿是人機，且縮短空等。
- `phaseText`（配對中文案，使用者定案兩段）：**0–15「請耐心等候…」、16–23「即將配對完成…」**。
- 要改：`src/net/matchmaking.ts`（`TIMEOUT_MS` 相關）、`src/ui/screens/Matchmaking.tsx`（`SEARCH_SECS`、`startBot` 改為 `startBotWithPersona`：先租一隻 persona，再 `startCasualBotMatch`，foe 用 persona 的 name/avatar）。

### 3.5 人機出手節奏（casualFoe 才套用；主線/一般 AI 維持 850ms）
- **選牌（出牌，需思考）**：隨機 **1.5～4 秒**；**15% 機率長考**（**只在選牌時、一場最多一次**）→ **6～8 秒**。
- **放牌（不需思考）**：只加 **0～1 秒**（決策 `aiPlace` 即時算出，只避免瞬間貼上，**不疊加思考時間**）。
- 實作：`Game.tsx` 的 AI driver effect 依 `g.casualFoe` 決定 delay；長考旗標 `longThinkUsedRef` 於每場 `coinToss` 重置。
- 快速配對限時維持 **99 秒**（`FREE_MATCH_TIME_LIMIT=99`）。

### 3.6 驗收（Chunk A 已測、Chunk B 已測資料層）
- ✅ 配對 16–23 秒隨機、真人可插隊；phaseText 兩段。
- ✅ 出手節奏：選牌 1–3.5 秒、15% 一場一次長考 6–8 秒；放牌 0–1 秒。
- ✅ 對手＝固定 persona（名字+固定頭像+botId）、大腦隨機。
- ✅ seed：15 隻寫進 `bots/{botId}`（wins/games=0 + 假牌組/成就）。
- ✅ 租借（強化）：`leaseBot` 寫 `botLease`、多重釋放（onDisconnect + reconcile `releaseBotById` + EndModal `reset` + 下次 lease + **15 分鐘 TTL**）→ 不會累積殭屍把 15 隻佔滿。
- ✅ 戰績：打完 `recordBotResult` → `games+1`（人機贏再 `wins+1`），transaction。
- ✅ 名片：點人機讀 `bots/{botId}` 顯示戰績、強制線上。
- **⚠️ 重開分頁後配對卡 23 秒**（詳見 §3.7 坑 6，2026-09-06 破案）：真兇=`ensureProfile` 的 `applyLocally:false` transaction 卡在「等永遠不來的乾淨伺服器值」(因 boot 補判剛 `update` 過 users/{uid} 留了 pending write)→ `ensureAccount` 掛 → 配對進不到 `joinMatchmaking`。修法=**get-first**:`ensureProfile` 先 `get`,已存在只 plain `update` bump、缺才 transaction 建檔(+ `withTimeout` + 不外拋);reconcile/Matchmaking 包 try/catch;`recordMatchResult` 加 `silentDaily`(補判不發每日獎)。**⚠️ 兩顆雷都要避:不可 `applyLocally:false`(卡23秒)、也不可無腦拿掉直接跑 transaction(名字消失)。**
- 待使用者真機/真流程測：快速配對整條龍（配到→打完→點對手名片看戰績→再配一場換persona）。

---

## 3.7 中離 / 判敗 / 斷線重連（五模式統一規則）— 本次連帶確立

> 由「快速配對算真人」延伸，確立**所有模式**的判輸判贏，堵住「偷看開局再落跑」刷戰績。
> 補充既有 online 斷線重連文件（[SPEC.md §6.5 / 6.6](SPEC.md)、[DESIGN.md §7.3](DESIGN.md)）——那兩份寫的是 online 部分，本節是**五模式統一版 + 本地模式擴充**。

### 判定線（重點改動）
- **判敗線 = 「已發牌」**：`engine` 存在且 `phase !== 'ended'`（＝擲硬幣結束、手牌已發）。**擲硬幣前 / 未發牌**離開一律不計。
- 這條**取代舊的「放過牌才算」**（`forfeitOnline` 舊的 `anyPlaced/placementsDone/pendingPick` 閘門已移除）——因為能被刷的資訊（手牌 + 先後攻）一發牌就看得到。
- soloGames/soloWins ＝ 打電腦（主線 + 建立房打電腦）；pvpGames/pvpWins ＝ 真人（**含快速配對，不管遇真人或人機**）。

### 判定表（A＝離開者，B＝對手）
| 模式 | B | 手動離開（按鈕，發牌後） | 關分頁（發牌後、不再回來） |
|---|---|---|---|
| 主線 | boss（無戰績） | A：series 敗 + **solo 敗** | A：series 敗 + solo 敗（Phase 2 marker 補判） |
| 建立房打電腦 | 電腦（無戰績） | A：**solo 敗** | A：solo 敗（Phase 2 marker 補判） |
| 建立房打真人 | 真人 | A：pvp 敗；B：pvp 勝 | B 當下判勝；A 下次登入自補 pvp 敗（openMatch，已有） |
| 快速配對遇真人 | 真人 | 同上（有真房） | 同上（已有） |
| 快速配對遇人機 | 人機 persona | A：pvp 敗；人機 games+1 且勝 | A 下次開 app 補判：A pvp 敗 + 人機 games+1 勝（Phase 2 marker） |

- 五模式的「手動離開（發牌後）」都跳**「離開會判敗場」確認框**（已通關主線重打除外）。
- 自然打完照常結算（主線/打電腦→solo；打真人→雙方 pvp；快配→A pvp + 人機各記）。

### 斷線 / 重連模型（統一）
- **「連回」＝同分頁重整（F5）**：對局快照存 **sessionStorage**（重整留、關分頁清）→ 重整能續玩、**不判敗**。
- **關分頁 = sessionStorage 沒了 = 連不回 = 判敗**：online 由對手（最多等 **90 秒** overlay）判勝、A 下次登入補敗；**本地（主線/打電腦/快配人機）沒有 90 秒**（無對手在等），由 A 下次開 app 靠 **localStorage marker** 補判（快配人機同時補寫人機勝場——人機無 client，只能由 A 補）。
- **90 秒只存在於 online**（對手等待時間）；本地重整不限時、關分頁即判。
- ⚠️ 快配人機關分頁後「A 再也不開 app」→ 那場人機勝場永不寫（無人在場能寫），無傷。

### 實作狀態
- **Phase 1（已完成、可測）**：五模式「發牌後手動離開＝判敗」＋確認框。
  - 檔案：`gameStore.forfeitLocal`（casual→pvp 敗+人機勝+釋放租借；plain AI→solo 敗）、`forfeitOnline` 閘門改「已發牌」、`campaignStore.forfeit` 加 solo 敗、`TopBar` 統一 `dealt` 閘門 + 路由本地 forfeit。
- **Phase 2（已完成、已測資料層）**：本地三模式的 marker 補判（關分頁）＋ (a) 對局快照續玩（重整）。
  - **新檔 `net/localMatch.ts`**（純持久化）：`saveLocalMatch`（寫 sessionStorage 快照 + localStorage marker）/`readLocalSnapshot`/`readLocalOpen`/`clearLocalMatch`/`newLocalMatchId`。
  - **新檔 `net/localResume.ts`**（開機編排）：`resumeLocalMatch()`（有快照→還原對局續玩，campaign 另從快照的 series 還原 campaignStore + 重接 onMatchEnd）；`reconcileAbandonedLocal()`（無快照但 marker 在→補判：casual pvp 敗+人機勝、solo 敗、campaign solo 敗+series 敗；去重用 room.ts 的 settled-set）。
  - **gameStore**：新增 `campaignSubId/campaignSeries/localMatchId` 欄位 + `restoreLocal` action；`finishCoinToss` 發牌即存快照+marker；`applyEngine` 每步更新快照、自然結束清快照+標記已結算;`forfeitLocal`/`reset` 清快照+去重；`startCampaignMatch` 收 `subId/series`。
  - **campaignStore.launchMatch**：帶入 `subId + 賽前 series` 給 gameStore（供補判/還原）。
  - **App 開機**：`tryReconnect()`(online) → `resumeLocalMatch()`(本地重整) → 皆無則 `reconcileAbandonedMatch()`(online 補判) + `reconcileAbandonedLocal()`(本地補判)。
  - **實測（真實 DB）**：重整 → 對局續玩不判敗 ✅;模擬關分頁 → 不續玩、回主畫面、marker 清除、人機 games/wins +1 ✅。
  - 清除機制：marker/快照在「結算/離開/補判」清;sessionStorage 關分頁自動清;settled 集合裁切上限 → 不累積。
  - ⚠️ 已知小殘角:casual 重整後未重新 lease 該人機(reload 時 onDisconnect 已釋放)——§4 廣播前無影響;casual 關分頁後「玩家再也不開 app」→ 該場人機勝場永不寫入（無人補），無傷。
  - **⚠️ 兩個必踩的坑（已修）**:
    1. **補判必須等 auth settle**:boot 的 reconcile 若在 Firebase 還原 session 前跑,`ensureAccount/ensureUser` 會 `signInAnonymously` 建新匿名帳號、**蓋掉正在還原的登入**（症狀:關分頁再開變登出、線上人數虛增、補判寫到錯 uid → 自己看不到敗場）。修法:`App` boot 先 `await whenAuthReady()`（等 `platformStore.ready`）再跑 `reconcileAbandonedMatch()` + `reconcileAbandonedLocal()`;此時 uid 已還原,`ensureAccount` 為 no-op。
    2. **判定線一律用 `status === 'playing'`（不是「engine 存在」）**:⚠️ **online host 在擲硬幣階段 `engine` 就已建好**（`startOnlineHost`），只看「engine 存在」會讓對手在**發牌前**就判勝。五處統一:`Game.tsx matchStarted`、`gameStore forfeitOnline`、`gameStore forfeitLocal`、`TopBar dealt`、`TopBar doLeave.isDealt` 全部 `status === 'playing' && engine && phase !== 'ended'`。
    3. **online 離開者補判要「發牌就記 openMatch」**:`trackOpenMatch` 原本要「放過牌」才寫 openMatch,和判定線(已發牌)不一致 → 發牌後沒放牌就關 → 沒補判。改成「engine 未結束就記」;並在 `finishCoinTossOnline`(host 發牌)`setOpenMatch`。guest 由 `applyGuestView` 收到首個 view 時經 `trackOpenMatch` 記。
    4. **人機租借要能自我修復**:onDisconnect 釋放不可靠 → 累積殭屍租借把 15 隻佔滿 → 永遠配不到人。`leaseBot` 加 **15 分鐘 TTL**（過期租借視為可搶）;`reconcileAbandonedLocal`(casual)補 `releaseBotById`;EndModal 離開本地局改叫 `reset()`(釋放)。多重保險:onDisconnect + reconcile + EndModal-reset + 下次 lease 自動釋放 + TTL。
    5. **絕不可在 profile 未載入時寫 stats**:`recordMatchResult` 讀 `profile.stats`,未載入=空 `{}` → read-modify-write 把真實累積**洗成 1/0**。守門:`recordMatchResult` profile null 直接 return;boot 補判 `await whenProfileReady()`(等 ready + profile 都到位)。
    6. **重開分頁後配對卡 23 秒——真兇是 `ensureProfile` 的 `applyLocally:false` transaction(2026-09-06 兩人分頁實測破案,前兩版診斷都錯)**:
       - **重現**:快配 **遇人機**(對局到 `status==='playing'`)→ **遊戲中關分頁** → 開新分頁 → 再快配 → 卡在 23 秒(顯示上限秒數就不動)。console:`Uncaught (in promise) Error: maxretry`(from `repoRerunTransactionQueue`)。**對照組**:快配遇真人但**擲硬幣前**(沒到 playing)關分頁 → 開新分頁再配 → **正常**。
       - **關鍵差異**=有沒有到 `playing`:到 playing 才會寫 `shp.localopen`(localStorage,**跨分頁存活**)→ 新分頁 boot 跑 `reconcileAbandonedLocal` → 它用 `writeMatchRecord`(`update` users/{uid})補判 → **users/{uid} 上留了一筆「伺服器還沒 ack 的本地寫入」**。
       - **真根因**:接著配對時 `ensureAccount` → `ensureProfile` 對 **users/{uid}** 跑一顆帶 **`{ applyLocally:false }`** 的 transaction。`applyLocally:false` 會「**等一個乾淨的伺服器值才套用**」,但同 path 有未 ack 的本地寫入時,那個乾淨值**永遠不來** → transaction **永久掛住**(實測:一般 transaction 139ms 回、這顆 12s+ 不回;而**讀取/`.info/connected` 都正常**——所以不是 socket 死)→ `ensureProfile` 掛 → `ensureAccount` 掛 → 配對 useEffect 在 `joinMatchmaking` 之前就卡住 → **timer 沒設、onTimeout 沒觸發、leaseBot 根本沒被呼叫**(這也是為何前兩版改 leaseBot/入列都沒用——**它們從沒被執行到**)。對照組沒補判、users/{uid} 沒 pending write → `ensureProfile` 秒回 → 正常。
       - **正解(最終版 get-first,`ensureProfile` 兩顆雷都要避)**:
         - ⚠️ **雷1**:不可用 `applyLocally:false`(上面那顆,卡 23 秒)。
         - ⚠️ **雷2**:也**不可「無腦拿掉 applyLocally:false 直接跑 transaction」**——cache 尚空時(剛開分頁 profile 還沒載入),`if(cur===null) return freshProfile` 會把**樂觀的 freshProfile 丟給 subscribeProfile → 顯示名/戰績瞬間被清空 → 主畫面名字消失、變 guest、每日任務亂跳**(但排行榜仍是真名 → 純顯示 desync)。這正是當初加 applyLocally:false 要防的。**(這是「先拿掉」那一版引發的回歸 bug,實測到。)**
         - ✅ **最終做法 = get-first**:`ensureProfile` 先 `get` 判斷 profile 在不在(讀取即使在剛重開分頁也正常、很快)。**已存在 → 只用 plain `update` bump `lastActive`/`isAnonymous`(不跑 transaction、絕不冒出 freshProfile)**;**真的缺(首跑)才用 transaction 建檔**(此時 freshProfile 就是正確初值)。全程 `withTimeout(4s)` + 交易失敗不外拋 → 永不卡住 `ensureAccount`/配對,也永不清空顯示名。讀失敗時保守當「已存在」→ 只 bump,永不誤建蓋掉真檔。
         - ②`reconcileAbandonedLocal` 整段包 try/catch(補判 best-effort,交易失敗不變 uncaught)。③`Matchmaking` 的 `ensureAccount` 包 try/catch(保險)。④移除前一版誤加的 `waitForConnected` `goOffline/goOnline` 強制重連(基於錯誤診斷、會 abort 進行中寫入的全域大槌);`leaseBot`/入列的 `withTimeout` 防呆保留當安全網。⑤`recordMatchResult` 加 `opts.silentDaily`:boot 補判(`reconcileAbandonedLocal`/`reconcileAbandonedMatch`)只記戰績、**不發每日獎/不跳 toast**(背景補判一場「關分頁的敗」不該算「完成一場對戰」領獎,更不該重開時莫名跳 toast)。
       - **驗證**:兩人分頁實測——舊碼 `ensureAccount` HUNG 12s+;get-first 後 RESOLVED 69ms~1.5s、重開分頁**顯示名保留**(測試名 RicoTest測試 未被清)、不再亂跳每日 toast、再快配正常進人機局。⚠️ **`ensureProfile` 兩顆雷都要避:不可 `applyLocally:false`、也不可無腦拿掉直接跑 transaction——用 get-first。**
    7. **⚠️ `.info/connected` 的 `onValue` 會「同步」觸發**:`waitForConnected` 的 finish() 不可在 unsub 指派前引用它(TDZ ReferenceError → 永不 resolve → 掛死)。用 `let unsub`+`if(unsub)` 守 + onValue 後 `if(done&&unsub)unsub()` 清理。
    8. **openMatch 只在 `status==='playing'` 才記**:特殊房「挑特殊牌(擲硬幣前)」時 host 會先同步初始 view,guest 的 `applyGuestView` 會提早記 openMatch → 賽前關分頁誤判敗。`applyEngine`/`applyGuestView` 呼叫 `trackOpenMatch` 前都 gate `status==='playing'`。「已發牌」的精確定義:`finishCoinTossOnline`(硬幣 onDone、決定先攻、開始發牌那刻)寫 `status='playing'`;硬幣還在晃=`coinToss`(不判)。

---

## 4. 觀戰

### 4.1 全開視角序列化（`serializeForSpectator`）
- 在 `src/net/sync.ts` 新增：
  ```ts
  export interface SpecView {
    phase, turn, postPicker, winner, winReason, firstPicker,
    deckCount: number,
    p1Hand: Card[],          // 全開（真人 host / 本機玩家）
    p2Hand: Card[],          // 全開（對手，真人 or 人機）
    slots: { owner, p1: Card[], p2: Card[] }[],   // 兩邊暗牌都翻正
    pending: { by, count } | null,
    lastShowdown: Showdown | null,
    specialUsed: Record<PlayerId, boolean>,
    // 名字/頭像放 liveIndex，不重複塞這裡
  }
  export function serializeForSpectator(engine: GameState): SpecView { /* 全部給真值，牌堆只給 count */ }
  export function deserializeForSpectator(v: SpecView): GameState { /* 還原成可被 GameBoard 渲染的 state */ }
  ```
- 清理 `undefined`（RTDB 拒收）：比照現有 `cleanCards` / `cleanShowdown`。

### 4.2 廣播端寫 spec 的時機（**只有觀眾在席才寫**）
- 廣播端訂閱 `spectate/{code}/watch`，得 `watcherCount = snap.size`。
- `watcherCount > 0` 時：每次引擎變動就 `set(spectate/{code}/spec, serializeForSpectator(engine))`。
- `watcherCount === 0` 時：不寫 spec（省流量）。
- **冷啟動**：`watcherCount` 由 0→1 的當下，廣播端**立即補寫一張當前快照**（否則第一個觀眾在廣播端下次動作前會看到空白）。
- 廣播端也負責把 `watcherCount` 寫回 `liveIndex/{code}/spectators`。
- **真人局**：在 `netgame.ts` 的 `_attachHost` 內，除了現有 `writeGame`（給 guest），另加 spec 廣播（訂 watch、條件寫 spec）。
- **人機局**：新增一個「本機廣播器」模組（例如 `src/net/broadcast.ts`），在 `startCasualBotMatch` 開始時：建立 `liveIndex/{code}`（status:'live'）、訂 `spectate/{code}/watch`、引擎變動時條件寫 spec；結束時翻 `status:'ended'` + `winner`。arm `onDisconnect` 清 `liveIndex/{code}` 與 `spectate/{code}`。

### 4.3 觀戰畫面（唯讀、全開牌桌）
- **複用現有 GameBoard**，加一個 `viewMode: 'player' | 'spectator'`（或獨立輕量 wrapper `SpectatorGame`），差異：
  - 兩邊手牌**全部翻正**、七欄對決區暗牌**兩邊都翻正**。
  - **拿掉所有操作**：排序（`SortButtons`）、送出、暫停、特殊牌（`SpecialControls`）、發牌。
  - **保留放大鏡**：直接沿用 `MagnifierModal`（`src/ui/components/game/MagnifierModal.tsx`）——它讀 `engine.slots[slot][side]` 顯示該疊牌 + 牌型；觀眾點任一疊即可放大。**唯一要改**：`MagnifierModal.tsx:19` 的 `你的牌／對手的牌` 文案，觀戰時改成雙方顯示名。
  - **版面固定**：上＝玩家1（p1）＋名字，下＝玩家2（p2）＋名字。沒有「我」的概念。名字用顯示名（p2 若人機用 persona 名）。
  - **狀態列**：改旁觀口吻，如「玩家1 思考中…」「對決中…」。
- **「加入觀戰」是 persistence 動作 → 先 `ensureAccount()`**（lazy 生 uid，與「開始遊戲」同級）：純看（讀 `spec`）因公開可讀不需要 uid，但「寫 watch / 發彈幕 / 被算觀戰數」需 auth。所以點「加入觀戰」時先 `ensureAccount`，訪客即在此刻拿到 uid（符合 lazy 設計：觀戰是動作、非純逛）。
- 觀眾進場：`set(spectate/{code}/watch/{watcherId}, true)` + `onDisconnect().remove()`；並 `push(spectate/{code}/notice, {kind:'join', name, at})`。
- 觀眾離場：`remove(watch/{watcherId})` + `push(notice, {kind:'leave', name, at})`。
- 訂閱 `spectate/{code}/spec` → `deserializeForSpectator` → 渲染。
- **對局結束**：觀眾看到唯讀結算（沿用 `EndModal` 之類，唯讀）→ 退回主畫面。此時 `liveIndex` 已翻 ended，該局進 `replays`（見 §6）。

### 4.4 觀眾數
- 廣播端訂 `spectate/{code}/watch` → `.size` 寫進 `liveIndex/{code}/spectators`（Live 卡直接讀 liveIndex，不用每張卡再各訂一個節點）。
- 關分頁自動扣（onDisconnect）；切背景不扣（可接受）；主動離場扣 + 發 leave 提示。

### 4.5 進/出場提示 —— ⚠️ 最終定案見 §11.C（進出提示已**併入彈幕區同一個顯示層**，非另開左上）
- 觀眾進/出 → `spectate/{code}/notice` push 一筆（`{kind:'join'|'leave', name, at}`）。
- 定案：進出提示**與彈幕同一區顯示**（右側中間、system 灰字），非原本規劃的「左上另一通道」。只收「訂閱後」新增的（`subscribeNew` + `startAfter`，見 §11.C）。

### 4.6 彈幕（罐頭訊息）—— ⚠️ 最終定案(位置/行數/秒數/開關)見 §11.C
- **觀眾端**：貼圖按鈕改造成「訊息鈕」（icon＋「訊息」），一顆鈕 → tray 文字下拉（pool §9，14 則）→ 點即 `push(spectate/{code}/danmaku, {text, by:myName, at})`。
- **顯示（定案：右側中間、最多 6 行、每行 6 秒、往上推堆疊）**：新的從最下面進、最舊在最上；滿 6 排隊，最上面 6 秒到消失、其餘上推、排隊的補進來（6 秒從補進來起算）；framer `AnimatePresence`+`layout`。
- **玩家端開關**：`showSpectatorDanmaku`（**定案改預設開**），被觀戰時 TopBar 選單多一列「觀眾彈幕 開/關」；host＋guest 都有（見 §11.C/D）。
- **不記錄 / 不補播**：彈幕不落地，隨房清；用 `subscribeNew`（`startAfter` 只收訂閱後新增的）→ 中途進場、關開開關都不補播舊訊息。

### 4.7 訪客名字
- 登入者：用自己的顯示名。
- 訪客：進**某一場**時，從名字 pool（使用者提供 10 個，見 §9）**隨機挑一個**，先跟該場現有觀眾（讀 watch 對應的名字）比對，撞到就換或補數字（「名稱＋數字」）。名字**只在該場有效**，離場即釋放；進下一場**重新挑**。
- 因為不同場觀眾看不到彼此，名字只需「同場不撞」，pool 10 個綽綽有餘。
- 該場內把挑到的名字存 `sessionStorage`（key 帶 code），避免同場重整又換名。

### 4.8 驗收
- A 玩家與真人/人機對戰 → B、C 開遊戲主畫面看到 Live 卡 → 點進去看到**全開牌桌**、能放大鏡、能發罐頭訊息。
- 彈幕：右側中間、最多 6 行、6 秒、上推、排隊正確（定案 §11.C）。
- 玩家端「觀眾彈幕」開時看得到觀眾彈幕＋進出提示（同一區）。
- 沒有觀眾時，廣播端不寫 spec（用 network 面板確認）。

---

## 5. Live 版（主畫面）—— ⚠️ 最終定案(露 1/池 8、自動輪播、視覺、桌機放大)見 §11.B

### 5.1 位置與外觀
- 主畫面**右側**常駐一塊「即時戰況 / 戰情中心」；**沒有任何 live/ended 場次時整塊不顯示**（要有 live 感）。
- **定案：一次露 1 張**（池 8），`< >` 跑馬燈＋下方圓點；**每 10 秒自動輪播**（有 live 只輪 live、新 live 跳回第 1 頁、手動翻頁重數 10 秒；見 §11.B）。
- **必須用本專案設計語言**（見 §7）：木質/羊皮卡面（`--wood-*` / `--parch-*`）、金色點綴（`--gold-*`）、`--font-display`；圓角 `--r-md`；陰影 `--shadow-1/2`。**不照抄任何外部截圖**。
- 卡片標頭「**LIVE**」字樣 + 紅點（`--lose`）**CSS 脈動閃爍**。
- 計數器：**只留「目前幾局在 Live（進行中）」**一個數字。不做「在線棋手」「即時觀戰」那兩個。

### 5.2 卡片內容
- 誰 vs 誰（雙方顯示名；p2 若人機用 persona 名，UI 不露破綻）。
- 名字底下一行：**真人勝場**（一定有）；位置塞得下再加**真人勝率**（0 場顯示 `—`）。
- 觀戰數（讀 `liveIndex.spectators`）。
- 狀態：`live` → 「加入觀戰」按鈕（點入 §4.3）；`ended` → 顯示「對戰結束・{勝方} 獲勝」，**不可點入觀戰**（但可去賽事精華看回放）。

### 5.3 資料來源與排序（**顯示邏輯，非資料庫淘汰**）
- 訂閱 `liveIndex` 整包（每筆 ~80 bytes，很輕）。
- **顯示排序規則**（前端算，已與使用者驗證過範例）：
  1. **live 群排在 ended 群前面**。
  2. 各群內**越新越前**（live 依 `startedAt` desc；ended 依 `endedAt` desc）。
  3. 全部**只顯示前 8**（`sortLiveEntries(entries, 8)`；跑馬燈一次露 1，見 §11.B）。
- **不需要在「滿了」時真的刪任何一筆**——超出前 8 的（例如較早結束的 ended）只是**沒被畫出來**，資料還在。
- **清潔工（唯一的實體刪除）**：懶人 sweep（比照 `sweepStaleRooms`）刪掉 `status==='ended'` 且 `endedAt` 超過 **24 小時**的 `liveIndex/{code}`（連同 `spectate/{code}` 一起清）。這也解決「都沒新場次、舊 ended 卡在上面」的情況。

### 5.4 生命週期
- 對局開始（真人局：guest 加入、status→playing；人機局：`startCasualBotMatch`）→ 廣播端寫 `liveIndex/{code}`（status:'live'）。
- 對局自然結束 → 廣播端把該筆翻 `status:'ended'` + `winner` + `endedAt`。
- 廣播端 arm `onDisconnect`：真人 host 當機 → 清該筆（避免殭屍 live）。**注意**：正常結束要保留成 ended 掛 24 小時，只有「當機/未正常結束」才由 onDisconnect 直接清除。實作上：結束流程主動寫 ended；onDisconnect 設為「remove」只作為當機兜底（當機時該局本來也沒有有效結果）。

### 5.5 驗收
- 開 1 場 → Live 卡出現、LIVE 紅點閃、可觀戰。
- 開多場 → 跑馬燈 `< >` 可切＋每 10 秒自動輪播、排序符合「live 優先＋越新越前＋切 8」（見 §11.B）。
- 一場結束 → 卡變 ended、不可點入、顯示勝方；24 小時後被清。
- 全部結束且無新場 → 24 小時後整塊消失。

---

## 6. 賽事精華（回放）

### 6.1 資料：全站近十場 move-log
```
replays/{pushId}: {
  v: 1,
  seed: number,
  firstPicker: 'p1' | 'p2',
  special: boolean,
  p1: { name, avatar, uid|null },
  p2: { name, avatar, uid|null, isBot },
  players: [uid1, uid2OrBotId],     // forward-compat：未來做「個人賽事精華」用這欄過濾
  winner: 'p1' | 'p2',
  endedAt: <serverTimestamp>,
  moves: Move[]                     // 見 §6.2
}
```
- **顯示**：`limitToLast(10)`（依 push key 時序）。
- **清潔工**：sweep 只留最新 ~15 筆（多留幾筆當緩衝），其餘刪除。每筆 2~5KB，全站極輕。
- **只收「完整正常結束」的局**（自然分出勝負才 push）：中離/秒退/斷線判敗**不進**（棋譜品質）。
- **只收真人局 + 人機局**（都算真人），不收主線關卡。
- **入口 UI**：主畫面一顆 **「賽事精華」** button（要 icon），放在**每日任務下面**（`DailyTasks` 之下）。用設計語言（§7）。

### 6.2 Move 格式（capture 點）
```ts
type Move =
  | { t: 'pick';  by: PlayerId; ids: string[] }
  | { t: 'place'; by: PlayerId; slot: number }
  | { t: 'special'; by: PlayerId; card: SpecialCardId; targetId?: string }
```
- **firstPicker / 擲硬幣結果**存在 header（不進 moves）。
- **抽牌不必記**：`drawFor` 從 seed 洗好的牌堆依序取，決定性（見 §6.3 例外）。
- **capture 位置**：在 gameStore 套用每個動作的地方，加一個「錄影 hook」，當「本局要錄」（online host 角色，或 `casualFoe` 人機局）時，把該動作 append 到記憶體中的 `moveLog`。
  - 真人局：host 端錄。host 自己的動作 & 收到 guest intent 後呼叫的 `submitPick/placeAt/special` 都經過 gameStore → 同一個 choke point 都錄得到。guest 端**不錄**（host 負責 push）。
  - 人機局：本機玩家 & 人機的動作都經 gameStore → 都錄得到。
- **push 時機**：對局自然結束那刻，一次 `push(replays, {...header, moves})`（單筆 ~3KB）。

### 6.3 決定性與那顆 Math.random
- 回放 = `createGame(seed, firstPicker)` 後，依序套用 `moves`，用 `state.ts` 的純函式：`applyPick` / `applyPlace` / `resolveShowdown` / `applyDraw` / `applySwap` / `applySuit` / `applyClubs` / `checkWin`。
- **唯一非決定性**：`applySwap`（`state.ts:334`）/`applyClubs`（`state.ts:383`）預設 `rng=Math.random`（把牌塞回牌堆隨機位置）。
- **解法（首選，最乾淨）**：讓**實際對局**與**回放**都對這兩個特殊效果用**同一條由 seed 決定的 rng 流**——
  - 建立 per-match「特殊效果 rng」：`const fxRng = mulberry32(seed ^ 0x9e3779b9)`（`src/game/rng.ts` 已有 `mulberry32`）。
  - 實際對局呼叫 `applySwap/applyClubs` 時**傳入這條 fxRng**（而非用預設 Math.random）。
  - 回放時用**相同 seed** 建同一條 fxRng，依相同順序消耗 → 完全重現。
  - ⚠️ 前提：這兩個特殊效果的 rng 消耗順序，實際對局與回放必須一致（因為 moves 順序一致，故一致）。
- **備援（若嫌改動對局引擎有風險）**：capture 時把該效果的具體結果（移除 index / 插入 index，或直接記結果牌序）寫進該 Move，回放時注入。二選一即可，首選前者。

### 6.4 回放播放器（`ReplayViewer`）
- **畫面**：複用 §4.3 的「全開唯讀牌桌」（回放也全開，方便研究心機），底部把彈幕列換成 **transport bar**。
- **Frame（一步）模型 — 最細**：
  - 由 `moves` 模擬產生一串 **frames**，每個 frame = 一個 `GameState` 快照 + 一句 caption。
  - 產生規則：每套用一個 move（pick / place / special）就 snapshot 一個 frame；若某 place 觸發 showdown（`resolveShowdown` 有結果）就**額外**snapshot 一個 frame（caption 如「第4格開牌：同花 · 玩家1勝」），讓新手能停在開牌研究；抽牌（`applyDraw`）同理可各自成 frame。
  - 全部 frames 數 `N` 開場即知 → 進度條 `0..N-1`。
  - **caption 範例**：「玩家1 出 3 張」「玩家2 放第 4 格」「玩家1 使用特殊牌：讓我看看」「第 4 格開牌：同花 · 玩家1 勝」。
- **transport bar 控制**（手機版＝牌桌下方一條）：
  | 控制 | 手機呈現 | 行為 |
  |---|---|---|
  | 播放/暫停 | 一顆按鈕 | `setInterval`，每 tick `step++` 到 N 停 |
  | 上一步 / 下一步 | 兩顆箭頭 | `step ± 1` → 重算渲染 |
  | 倍速 0.5 / 1 / 2 / 4× | 一顆循環切換的小晶片 | 改 interval：`baseDwell / speed`（baseDwell 建議 1200ms） |
  | 進度拖拉 | 原生 `<input type=range min=0 max=N-1>` | 拖到第 k 幀 → `stateAtFrame(k)` 重算 |
- **stateAtFrame(k)**：純函式，從 `createGame` 重跑到第 k 幀。因為一場 < 100 步、純計算是瞬間的，**拖拉會很順**（不需要真的等秒數）。可加簡單 memo（快取上一次 k → state）避免每幀從 0 重算。
- **實作位置**：新增 `src/game/replay.ts`（`buildFrames(replay): Frame[]`、`stateAtFrame`）；新增 `src/ui/screens/ReplayViewer.tsx`（讀 `replays/{id}` → buildFrames → 播放器 + 全開牌桌）；賽事精華清單畫面（列 10 場，點一場進 ReplayViewer）。

### 6.5 驗收
- 打完一場真人/人機局 → 賽事精華清單多一筆，雙方名字/頭像/勝負正確。
- 進回放：能播放/暫停/上一步/下一步/切倍速/拖進度；拖到任一點畫面正確、順暢。
- 有用到會塞牌回牌堆的特殊卡的那局，回放結果與當時一致（決定性驗證）。
- 中離/秒退的局**不出現**在清單。

---

## 6.6 賽事回放 — 實作定案（2026-09-09 as-built，**取代 §6.1~6.5 中與此不符處**）

> 已上線實作的權威版；改別的遊戲可照搬。名稱定案為「**賽事回放**」（原賽事精華）。

**A. 資料 / 錄製（`net/replays.ts`、`game/replay.ts`、`gameStore`、`broadcast.ts`、`netgame.ts`）**
- 修正原 §0/§6.3 兩處錯：`applyClubs` 其實是**決定性**（`applySuit` 無 rng）；引擎唯一非決定性只有 **`applySwap`**（塞牌回牌堆）。且**沒有單一 choke point**：online **guest 的特殊牌在 `netgame.ts` 內直接 apply**，不經 gameStore。
- **move-log**：`gameStore.moveLog:Move[]`（`{t:'pick'|'place'|'special', by, ...}`；swap 記 `rng`）+ `recordMove()`（守門：只有廣播端 me='p1' 且 casual/online-host 才錄）。錄製點：submitPick、placeAt、chooseSpecial(peek/spy)、activateSpecialTarget、aiMaybeSpecial、**+ netgame guest-special**。swap 用 **`recordingRng`（包 Math.random 記兩個輸出）**→ 回放 `replayRng` 重放,**live 玩法完全不變、零引擎改動、重整免疫**。
- **持久化**：moveLog 進 LocalSnapshot/HostSnapshot（sessionStorage）→ 重整續玩保留、打完才有完整棋譜。
- **決定性引擎**：`buildFrames(input)` = `createGame(seed,firstPicker)` 依序套 moves，**place 後自動補「開牌→翻幣→補牌」幀**（棋譜不記、可推），swap 用 `replayRng`。每幀 `{state, caption, actor, action, sound?, drawN?}`。`stateAtFrame(frames,k)=frames[k].state`（拖拉 O(1)）。**測試：5 種子整場錄→回放最後一幀 `toEqual` 真實結束 state（含 swap）**。
- **push**（自然結束由 `broadcast.end()` gate `lastEngine.phase==='ended'`）：`pushHighlight`（全站 `replays/{id}`，精華賽事）+ `pushUserReplay` 幫 p1.uid、p2.uid(非 bot)各一份（`userReplays/{uid}/{id}`，專屬賽事）。**中離**（`broadcast.abandon`，casual forfeitLocal 呼叫，只進 userReplays、`abandoned:true`）。各 cap **8、後蓋前**。`matchType:'casual'|'match'|'friend'`（房間加 `origin` 旗標；casual='casual'）。⚠️ **規則要 `replays`+`userReplays` 節點（已發布）**。

**B. 清單彈窗（`ui/screens/HighlightList.tsx`）— 骨架完全對齊排行榜**
- `.pz-screen(+.rp-overlay z:1000 因是疊在主畫面) + .panel panel--wide panel--rp + .pz__topbar(返回+`.pz__tabs`) + .panel__scroll(隱藏滾軸)`。兩頁籤 **精華賽事 / 專屬賽事** 在返回鍵右邊、無標題。
- 每列 **`.lb-row` 木紋 plank(固定高)+ 編號 `1. 2. 3.`**；內容:`[頭像44][名字7.5em] …spacer… [勝/敗] VS [勝/敗] …spacer… [名字][頭像]`（勝綠#1f9d4d/敗紅#d63a2e、比名字大粗 skew、貼近 VS；名字深木色置左/右；VS 木金）+ 右側 `配對方式-房型 / yyyy/mm/dd hh:mm:ss(結束時間)` + 圈狀黑三角播放鈕（點整列即播）。入口:AccountButton 每日任務鈕下「賽事回放」(IconFilm)。

**C. 回放播放器 — Reels 風（`ui/components/game/ReplayControls.tsx`,複用觀戰 GameBoard）**
- playback state 在 gameStore（`replayFrames/replayStep/replayPlaying/replaySpeed` + `startReplay/replaySeek/replayStepBy/replayToggle/replaySetSpeed/replayAdvance`）。`ReplayViewer` 只 buildFrames→startReplay + 計時器（**1x=1.7s、2x=1s/步**）。appStore `replayData:ReplayEntry`（清單帶 record,不再 fetch）。
- **兩層架構**：①**舞台層 `.rp-tap`**（點畫面切換播放/暫停）：`--playing z:48`(到處點=暫停)、`--paused **z:-1**`(**沉到牌堆/頭像 z≥0 下**→暫停時點放大鏡/頭像各做各的不解暫停,只空白 felt 點到=繼續)。②**body 傳送門 `.rp-ui`(z:1100,比 Modal scrim 1000 高)**放 離開/流程字幕/倍速/(暫停時)中央 ⏮▶⏭+進度軸 → 開牌彈窗也點得到。
- **⚠️ 傳送門定位貼齊 `.game` 舞台的 getBoundingClientRect（ResizeObserver+補量），子元素用舞台百分比**（不能用 viewport,否則電腦版舞台置中留白時控制飛到視窗邊）。
- 中央 ⏮▶⏭ **很透(rgba .14)、無外框、統一同色 #ffe9b0、壓在下方牌上**；離開沿用 `.spec-leave` 同位置(右下);倍速常駐右側對手張數下(**點了不暫停/不叫出進度軸**、選中壓下感);進度軸黃半透明底部避開離開鈕。**流程字幕(右側,全圓體 Huninn)**:`第 N 步：`(6em 置中黑)/ 名字(6em 置左)/ 動作(7em 置左金換行)。**showdown 對決彈窗 `scrimThrough`**(spec 已有)→ 邊緣控制點得穿透。
- **結束不彈框**(看字幕即可)。冪等:`startCasualBotMatch`/`finishCoinToss(Online)` guard(對局中忽略重開,防配對 race/onDone 重觸發重發牌+殘留假 live)。

**D. 音效（§10,回放+觀戰、以下方 p1 角度、只前進響）**
- 回放:每幀 `sound`(deal/place/showdown-win|lose→showdown+coin(400ms)/draw(drawN,只p1補牌)/special/win|lose;選牌&對手補牌靜音)。gameStore `playFrameSound` 只在 startReplay(第0幀deal)/replayAdvance/replayStepBy(+1) → **拖曳/上一步/跳轉靜音**。
- 觀戰:`SpectatorGame.spectateSound(prev,next)` 比前後 spec 快照(winner→win/lose、新showdown→showdown+coin、p1手牌增→draw、slot牌增→place)+ 新 fx→special;**進場首張不比對**(不補播)。

**E. 相關基建修（同批）**
- **liveIndex 洪水**:訪客(無 firebase auth)寫 liveIndex/spectate 被拒→RTDB 佇列狂重送洪水→所有寫入 gate `currentUser()`(不影響觀戰:進場前都 ensureAccount)。掃殘缺 zombie + 假 live(`startedAt>1h`)。
- **LiveBoard 已結束卡右上結束時間**(絕對定位不撐卡,13px)。

**F. 待辦 / 下一步**
- **回放分享連結**(尚未做):分享鈕→`?replay=<id>` deep link,別人過訪客關直接看。⚠️ 精華/專屬 cap8 會被蓋→需另存永久節點 `sharedReplays/{id}`(+規則+boot 讀 deep link,fetchReplay 讀該節點)。房號分享(`?room=`)已存在。
- 真機微調:第X步黑字紅底可讀性、控制/字幕位置手感;觀戰音效需雙人真測。

---

## 7. UI/UX 設計規範（務必遵守）

- **一律用 `src/ui/theme/tokens.css` 的變數**，禁止寫死顏色/字型/圓角。常用：
  - 卡面/木質：`--wood-1/2/3`、`--wood-edge`、`--wood-text`、`--wood-tex`；羊皮：`--parch-1/2`、`--parch-edge`、`--parch-text`、`--parch-muted`。
  - 金色點綴/高亮：`--gold-1..4`、`--text-gold-gradient`、`--border-gold-gradient`、`--shadow-gold`。
  - 桌面紅氈：`--felt-deep/base/mid/glow`。
  - 勝/負：`--win`（#4bd07a）/`--lose`（#ff6b6b，LIVE 紅點用它）。
  - 字型：`--font-display`（標題/卡標）、`--font-body`（內文）、`--font-comic`（Bangers，僅特殊強調）。
  - 圓角：`--r-sm/md/lg`；間距 `--space`；陰影 `--shadow-1/2`。
- **Live 卡**：木質/羊皮卡面 + 金框，LIVE 紅點脈動，跑馬燈 `< >` 用金色描邊小圓鈕。整體要跟現有 Modal/面板一致（參考 `Menu.css`、`Panel.css`、`DailyTasks.css` 的既有樣式語彙）。
- **賽事精華 button**：與每日任務按鈕同一視覺家族（放其下方），要 icon（可仿 `src/ui/components/Button.tsx` 既有 icon 風格新增一個「膠捲/播放」icon）。
- **觀戰牌桌**：沿用 GameBoard 的既有牌面樣式（`Game.css`），只是全開 + 無操作列 + 底部彈幕/transport。
- **彈幕**：右上、卡片式小條、半透明深色底 + 淺字，圓角 `--r-sm`；上推動畫用 framer-motion `layout`。
- **手機優先**：所有新 UI 必須在手機直式可用（transport bar、跑馬燈、彈幕都要在窄螢幕不破版）。參考現有 RWD 作法（`--stage-h`、clamp() 等）。
- **音效**：沿用 `src/audio/sfx.ts`——按鈕 `sfx.click()`、送彈幕可用 `sfx.success()`（比照貼圖）。

---

## 8. 檔案地圖（新增 / 修改）

**新增：**
- `src/game/bots.ts` — 15 隻 persona 定義 + `BOTS_ONLINE`。
- `src/net/broadcast.ts` — 人機局的本機廣播器（liveIndex + spectate/spec + watch 計數 + 生命週期）。
- `src/game/replay.ts` — `buildFrames` / `stateAtFrame`。
- `src/net/spectate.ts` — 觀眾端（watch 進出、訂 spec、danmaku、notice、訪客名字）。
- `src/net/liveIndex.ts` — 訂閱 + 排序（live 優先/越新越前/切 5）+ 清潔工。
- `src/net/replays.ts` — push / 訂閱 limitToLast(10) / 清潔工。
- `src/ui/components/LiveBoard.tsx`（+ `.css`）— 主畫面右側 Live 版（跑馬燈卡）。
- `src/ui/screens/SpectatorGame.tsx` — 觀戰牌桌（或 GameBoard 加 `viewMode`）。
- `src/ui/components/game/DanmakuBar.tsx` + `DanmakuLayer.tsx` — 彈幕輸入列 + 右上顯示層。
- `src/ui/screens/HighlightList.tsx` + `src/ui/screens/ReplayViewer.tsx`（+ css）— 賽事精華清單 + 回放播放器。

**修改：**
- `src/net/presence.ts` — 心跳制（§2）。
- `src/ui/components/OnlineCount.tsx` — 週期重算 + `+15`。
- `src/platform/cards.ts` — `fetchIsOnline` 改用 lastActive 窗口。
- `src/net/sync.ts` — `serializeForSpectator` / `deserializeForSpectator`（§4.1）。
- `src/net/netgame.ts` — `_attachHost` 加 spec 廣播 + watch 計數；host 端錄 move-log + 結束 push replay + 翻 liveIndex。
- `src/net/matchmaking.ts` — 配對時序（§3.4）。
- `src/ui/screens/Matchmaking.tsx` — 15/16–23 秒、`startBotWithPersona`（租借 persona）。
- `src/game/casualBots.ts` — 改為吃固定 persona（身分固定、大腦隨機）。
- `src/state/gameStore.ts` — `startCasualBotMatch` 掛廣播器 + 錄 move-log + 人機出手節奏（1–4s/長考）+ 結束 push replay & 更新 `bots/{botId}` & 釋放 lease。
- `src/game/state.ts` — `applySwap`/`applyClubs` 呼叫端改傳 per-match fxRng（§6.3）。
- `src/ui/components/game/MagnifierModal.tsx` — 觀戰時名字文案。
- `src/ui/screens/Menu.tsx` — 掛 LiveBoard（右側）+ 賽事精華 button（每日任務下）。
- `database.rules.json` — 新增 liveIndex/spectate/bots/botLease/replays 規則（§1.3）。
- 首次啟動 seed `bots/{botId}`（放 app 啟動流程，冪等）。

---

## 9. 使用者要提供的資料（可後補，先用 placeholder 開發）

| # | 項目 | 數量 | 現況 |
|---|---|---|---|
| 1 | **人機名字** | 15 個 | ✅ 已提供（見 §3.1） |
| 2 | **人機頭像 / 預設牌組 / 展示成就** | 由開發者自配 | 開發者用既有 avatar/特殊卡/成就 id 隨意配 |
| 3 | **罐頭訊息文字 pool** | 14 則 | ✅ 已提供（2026-09-07 定案版，見下）。實作在 `src/net/spectatePools.ts` `DANMAKU_POOL` |
| 4 | **訪客名字 pool** | 10 個 | ✅ 已提供（見下；超過 10 個同場觀眾自動「名稱＋數字」）。`src/net/spectatePools.ts` `GUEST_NAMES` |

**罐頭訊息 pool（依序，2026-09-07 定案，共 14 則）：**
`安安` / `881~` / `GG` / `???` / `!!` / `QQ` / `太嫩了` / `科科` / `太神啦` / `加油` / `666666` / `可以回家惹` / `天都黑了` / `這牌叫我阿嬤來玩都會贏`

**訪客名字 pool（依序，10 個）：**
`百香綠女孩` / `布丁狗` / `奇美博物館` / `全糖珍奶` / `苗栗小五郎` / `高雄發大財` / `不是喔不是這樣喔` / `財去人安樂` / `台股五萬點` / `瓜哥送幸福`

---

## 10. 開發順序建議
1. §2 在線人數心跳（地基，獨立可測）。
2. §3 人機系統（persona/租借/時序/節奏）——先讓「快速配對＝固定身分人機、有戰績」跑起來。
3. §4 觀戰序列化 + 廣播（真人局先通，再接人機局廣播）+ 觀戰畫面 + 彈幕。
4. §5 Live 版主畫面。
5. §6 賽事精華（move-log 錄製 → replay.ts → ReplayViewer）。

> 每一塊都有 §x.x 驗收條件，逐塊驗過再往下。UI 一律套 §7 設計 token。

---

## 11. 觀戰 · Live 版 · 彈幕 — 實作定案（2026-09-07 完整版；**取代 §4.3 / §4.5 / §4.6 / §5 中與此不符處**）

> 這一節是「觀戰整套」的權威定案，逐項可照做／可搬去別的遊戲。分四塊：A 觀戰畫面、B Live 版跑馬燈、C 彈幕(訊息)/進出提示、D 廣播協定與資料。

### 11.A 觀戰畫面 ＝ 直接複用遊玩的 `GameBoard`（不另寫版面，避免跑版）
- **狀態**：`gameStore` 加 `spectate: SpectateInfo|null`（雙方 `{name, avatarId, uid}`；uid＝真人 uid 或人機 botId）＋ `spectateLive: SpecExtras|null`（推牌/排序/特殊牌通知/暫停/貼圖）＋ `spectateMyName`（本觀眾名）＋ `spectateWatchers`（觀戰人數）＋ `spectateDanmaku`（收到的彈幕串，裁 40）＋ `spectateSend`（送彈幕器）。`applySpectate(engine, info, live?)` 灌串流：**me='p1' → 版面 下=p1(廣播端/host)、上=p2(對手)**；`exitSpectate` 全清。`useSeats` 遇 spectate 直接回雙方身分。
- **`Game.tsx` export `GameBoard`**，內部 `const spec = g.spectate` 當 gate：AI／timer 不跑；`!spec &&` 拿掉操作鈕（TopBar 選單／特殊牌／貼圖→改「訊息」鈕／暫停／問號／排序鈕／送出）；`SlotView revealAll`；狀態列 `spectatorStatusText`（旁觀口吻）；EndModal 觀戰不渲染。
- **牌桌內觀戰 UI 全用 stage 相對定位（取代既有按鈕位置 → 各平台一致）**：
  - 左上「●LIVE ／ 👁 觀戰數」＝ `.spec-hud`，疊在 `.topbar__menu`（選單鈕）位置。
  - 右下「離開觀戰」＝ `.spec-leave`，疊在 `.game__action`（送出鈕）位置、木紋 `Button size=md`（padding 12×18）。
  - 左欄：`觀戰者：`＋名字（`.spec-watcher`，疊在原「特殊牌」鈕位置、白色左靠）；「訊息」鈕（`DanmakuBar`，用 `game__emote-trigger` 疊在原「貼圖」鈕位置、icon＋「訊息」、tray `z-index:340` 高於對手推出的牌不被擋）。
  - `ShowdownModal` 加 `scrimThrough`（觀戰對決彈窗遮罩 `pointer-events:none` → 面板外的離開鈕仍可點，免 portal）。
- **推牌（即時）**：`SpecView` 帶 `p1Sel`(廣播端已選牌 id)、`p1Sort`(排序)、`pendCards`(已選未放的真牌)。GameBoard 觀戰把 picker「已選未放」的牌**插回其手牌 lift**（下方 p1 用其排序、上方 p2 固定 `rank/asc`）＋ 雙方喊「N 張」對話框（下方 `.spec-bubble` 對齊頭像方框左上角，放進 `me-avatar` 的 `.avatar-wrap`）。**限制**：對手(p2)的即時「選牌中」預覽未同步（casual 是 bot 瞬 submit；online guest 排序廣播端不知）——只在 place 階段用 pendCards 還原。
- **特殊牌 / 暫停 / 貼圖**同步：`SpecView` 帶 `fx{by,card,n}`（觀戰跳 toast「X 使用了「卡名」」）、`paused`（觀戰顯「暫停中」）、`emote{by,id,n}`（`SpecEmoteLayer` 依 by 從對應頭像飄）。⚠️ `fx` 與 `emote` **都在進場第一張 spec 只記 n、不觸發**（是進場前發生的，會被持續廣播在 lastExtras；用 `fxPrimed`/`primed` 旗標）→ 觀戰者中途重進不會被補播舊特殊牌通知/舊貼圖。
- **點頭像開玩家資訊卡**：觀戰時雙方頭像都可點 → `PlayerInfoCard`（uid=真人 uid／人機 botId）。
- **`ShowdownModal` 觀戰版**：`names` 顯雙方名、隱藏「繼續」、open 由 `engine.phase==='showdown'` 驅動、標題省「・對決」（名字長）、**名字欄固定寬 116px**(`modal__panel--showdown-spec`，≈8 中文字＋ellipsis) → 兩排牌起始 x 對齊。`MagnifierModal` 也帶 `names`。
- **`deserializeForSpectator` 必補滿 7 格**（空 slot 會被 RTDB 丟掉 → 只畫左邊幾格）。
- **`SpectatorGame.tsx`**：`joinSpectate → applySpectate`；讀取中(有離開鈕)；**觀戰者踢出**＝自然結束(liveIndex flip ended → 顯勝方) 或 廣播端中離收攤(liveIndex 被 remove、`onLive` null，用 `everHadLive` 判 `gone`) → 結算面板 portal 到 body(z:1050)導回主畫面。casual 中離改 `_bcast.end('p2')`(顯人機勝而非直接收攤)。`App` 觀戰時隱藏 OnlineCount。

### 11.B Live 版跑馬燈（`LiveBoard.tsx`／`.css`）
- **單卡跑馬燈**：訂 `liveIndex` → `sortLiveEntries`(live 群優先/群內越新越前)取前 **8**、一次露 1（`center`）；`< >` 箭頭＋下方圓點。
- **自動輪播規則**（`LiveBoard.tsx`）：每 **10 秒**往右一頁；**有 live 時只輪 live 群**（排序已把 live 推最前，`range = liveCount>0 ? liveCount : total`）；偵測到**新 live**（live code 集合出現新的）→ 直接跳回第 1 頁 + 重數；全結束 → 輪全部；**手動翻頁**循環全部場次（`(c±1+total)%total`）＋ 重數 10 秒。
- **視覺**：木質/羊皮卡＋金框；標題「即時戰況」前**白色**脈動點＋「X 場進行中」；卡內 `●LIVE`＋脈動點＋`👁 觀戰數`（放大）；頂部中央金色**編號**(在框內、與 LIVE/👁 同列)；雙方頭像 58＋名字(全顯示不截斷)＋`勝場 N（勝率%）`(置中、勝率同色)；`加入觀戰`/`對戰結束・X 獲勝`/`你的對戰進行中`(自己那場不給觀戰鈕)；黑色大 chevron 箭頭(底緣≈頭像下緣、離邊 6px)；圓點放大。**卡固定高**(head/foot 定高)→ live/ended 切換不跳。
- **右邊界對齊**（所有模式）：`right` 與在線人數/右上按鈕同 = base `max(10px,env-right)`、桌機(`min-width:1024`)`clamp(24px,4vw,80px)`。
- **電腦版整塊放大 20%**：`@media(min-width:1024)` `transform:scale(1.2); transform-origin:top right`(右邊界不變、不超出)＋ `top:140`。手機/窄螢幕不放大。沒任何場次整塊不顯示。

### 11.C 彈幕(訊息) / 進出提示（`DanmakuLayer`／`DanmakuBar`／`BroadcasterDanmaku`／`net/spectate.ts`）
- **送**：觀戰者點「訊息」鈕 → 罐頭文字下拉(§9 pool 14 則)→ 點即 `push(spectate/{code}/danmaku, {text, by, at})`。訪客名字＝§9 pool 挑不撞(存 sessionStorage)、登入用顯示名；名字寫進 `spectate/{code}/watch/{id}`(廣播端數 `.size`)＋進/出場 `push` `spectate/{code}/notice`。
- **顯示**（`DanmakuLayer`，觀戰＋玩家端共用）：**右側中間**、`z-index:300`「永遠最上」但 `pointer-events:none`(可穿透點按鈕)；**最多 6 行、每行 6 秒**(出現起算)、滿 6 排隊、framer `layout` 上推；**進出提示併入同區**(system 灰字)。
- **玩家端(廣播端)看觀眾彈幕**：`gameStore.showSpectatorDanmaku`(**預設開**)；被觀戰時(`broadcastCode` 有值──casual=`_bcast.code`、online host＝netgame startLive 設、**online guest＝`_attachGuest` 也設房號**)TopBar 選單多一列「觀眾彈幕 開/關」；`BroadcasterDanmaku` 開時 `watchDanmaku(code)`(只讀 danmaku+notice) → 同一個 `DanmakuLayer` 顯示。**⚠️ 關掉時 `setFeed([])`**(不清的話再開會把舊 feed 全補播)。
- **不落地/不補播**：danmaku/notice 用 `subscribeNew`(先讀最後一個 key，再 `startAfter` 只收「訂閱後」新增的) → 中途進場/關開不會補播舊訊息(彈幕本就不長存，隨房清)。

### 11.D 廣播協定（`sync.ts`／`broadcast.ts`／`gameStore`／`netgame`）
- **`SpecView`/`SpecExtras`**：engine 全開值 ＋ 附加 `p1Sel`/`p1Sort`/`pendCards`/`fx`/`paused`/`emote`。`serializeForSpectator(engine, extras?)` 只塞有值的(RTDB 拒 undefined、丟空陣列)。
- **廣播端 = p1**(casual 本機玩家 / online host)：`specExtrasOf(state)` 從 `selected`/`sortMode`/`sortDir`/`specFx`/`online`/`onlinePause`/`localPause`/`specEmote` 組。`broadcast.ts` `onEngine`/`onExtras` 各 merge `lastEngine`＋`lastExtras`，**有觀眾(`watchers>0`)才寫 spec**(省流量)＋ `onWatchers` 回呼觀戰人數。
- **casual**：`pushCasualExtras()`(`_bcast.onExtras`)在 toggleCard/排序/confirmPick/特殊牌/暫停(`localPause`)/貼圖(`broadcastMyEmote`)時呼。**⚠️特殊牌三處**原用 `set({engine})` 沒經 `applyEngine` → 補 `_bcast.onEngine`＋specFx。**online host**：netgame `subscribe` 監 `engine/selected/sort/specFx/onlinePause/specEmote` 變 → `bc.onExtras`；guest 特殊牌 intent 補 `specFx{by:'p2'}`。
- **暫停**移出 GameBoard 本地 state → `gameStore.localPause`(`toggleLocalPause`/`setLocalPause`)才廣播得出去。**貼圖** StickerProto 改呼 `broadcastMyEmote`(記 specEmote + online 送對手 + push)。
- **被觀戰提醒(防作弊)**：玩家(非觀戰)牌桌選單鈕右邊小 `👁 N`(`.game__watch-indicator`，條件 `watchers>0`)。host 由 `onWatchers`、casual 同、**guest 由 `_attachGuest` 訂 `liveIndex/{code}/spectators`** → 雙人對戰兩邊都看得到。

### 11.E 已知取捨 / 待辦
- 對手(p2)即時「選牌中」預覽未同步(只 place 階段用 pendCards 還原)。
- 「觀戰讀取中」＝玩的分頁背景太久(已確認，不修)。
- 下一步 ＝ §6 賽事精華(回放)。
