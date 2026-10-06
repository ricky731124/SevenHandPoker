# 大廳 AI 人機：聊天室 + LiveBoard 自動對戰 開發規格書

> 狀態：**框架定案、內容後補**。本檔只定「機制 + 資料 schema」；實際對話句子、tips 內容為後補。
> 關聯：複用 `docs/SPECTATE-REPLAY-SPEC.md` §3（固定人機/租借）、§4（觀戰/liveIndex/broadcast）、§5（Live 版卡片）、§6（賽事回放）、§7（UI/UX 規範）。

---

## 🔒 0-A. 最高紅線（務必遵守）

1. **現有人機系統一律不動**。本 spec 只「借地基」：`BOTS`（20 隻，2026-09-20 由 15 擴到 20）、`botLease`、`bots/{botId}`、`recordBotResult`、casualBots/自由匹配 的行為**全部維持現狀**。
2. **人 vs 人機（自由匹配）的勝負照舊記錄**（`recordBotResult`）。本 spec 的**人機 vs 人機表演賽才不記勝負**。
3. **若實作中真的需要改到任何現有設定 → 先向使用者說明原因、由使用者決定，不得自作主張。**
4. **絕不寫入任何真人玩家的節點**（呼應過去「寫死覆寫別人資料」事故）。
5. **永不向玩家揭露「那是人機」**——表演賽在任何玩家可見處不得出現「bot／表演賽／AI」字樣。

---

## 0. 目的與範圍

1. **主畫面聊天室（含 AI 人機）**：主畫面左下角一條縮合對話框（最新一句），點開為完整彈窗。只要有真人在大廳（active），人機就「回合制」閒聊（由唯一 host 驅動，見 §11.2）；真人發言/貼圖 → 依他的**註冊狀態＋主線進度**回應、引導（註冊／過主線／快速配對）。
2. **LiveBoard 自動對戰**：有**新玩家上線**且目前沒有 live 時，自動抓 2 隻空人機開一場「人機 vs 人機表演賽」，慢慢出牌，讓新手在 LiveBoard／觀戰看得到「有兩個人在打」。

**核心目標**：讓新手一進來就覺得「有人在玩、有人理我」。

**架構定案**：純前端 client 主持（無後端；「server」＝ Firebase）｜聊天回合制觸發｜人機 vs 人機**不計分、不進排行榜、打完存回放（用現成 moveLog/§6，不標示表演賽）**｜沿用現有 20 隻人機｜**打完不自動再開，等下一位新玩家或真人配對**。

---

## 1. 名詞與現況地圖

**20 隻人機（`src/game/bots.ts` `BOTS`）**：bot_01 山石宮分／02 我要驗牌／03 海Chris爛／04 無法顯示名稱／05 金色狂蜂／06 沒事call文哲／07 常威打旺福／08 你在大聲什麼啦／09 夢醒淑芬／10 新資料夾(2)／11 鍵盤柯南／12 玉皇Daddy／13 乂煞氣a屁孩卍／14 陶敬凱／15 穹道穗宮原／16 今天辛棄疾／17 宮森裘／18 不得不開除大衛／19 Chill西郎／20 春燕要來了嗎。**在線人數保底 = 20（`BOTS_ONLINE`）。**

**可直接複用的現有地基（皆不改其行為）**
| 現有 | 用途 | 本 spec 怎麼用 |
|---|---|---|
| `botLease/{botId}`（§3.3）| 租借鎖、關分頁釋放、**15 分 TTL 自癒** | LiveBoard 抓 2 隻空的；結束釋放（回收）；TTL 也當「表演賽被徹底遺棄」的上限 |
| `bots/{botId}` + `recordBotResult`（§3.2）| 人機真實勝負紀錄 | **⚠️ 僅現有「人 vs 人機」用；表演賽絕不呼叫** |
| `liveIndex`/`broadcast`/`serializeForSpectator`（§4）| 觀戰、live、全開視角 | 表演賽即時畫面沿用（新手可點進去觀戰，與真人局無異）|
| Live 版卡片（§5）| 主畫面即時戰況輪播 | 表演賽會出現在卡片、可點入觀戰 |
| `moveLog` + `recordMove` + `replays`（§6）| 賽事回放 | 表演賽打完直接用這套存（**呈現如兩個真人，不標表演賽**）|

**active 觀眾（§2.1）**：分頁**可見 且 不在對局中**（觀戰/開彈窗仍算）。用 `lobbyActive` 即時判定，**不是**在線人數的 10 分鐘超時。

---

## 2. 共同地基（聊天 + LiveBoard 共用）

### 2.1 active 旗標
- **active ＝ `visibilityState==='visible'` 且 不在一場對局中**。（觀戰表演賽、在主畫面開彈窗/子頁 **都算** active。）
- 變 active → 寫 `lobbyActive/{connId}={at,uid|guest}`；變不 active（切背景／進對局／關分頁）→ `remove`；`onDisconnect` 兜底。
- 「大廳有沒有活人」＝ `lobbyActive` 有無子節點（即時）。

### 2.2 主持人選舉（lock）
- `lobbyHost={by:connId,at}`。只有 active client 能 transaction 搶；持有者每 ~5s 更新 `at`（心跳）。
- host 進對局／斷線／關分頁 → 釋放（`onDisconnect` 兜底）。**單純觀戰不釋放、也不會被別人搶走 host。**

### 2.3 狀態放 Firebase、host 只是驅動者
- 聊天內容、表演賽對局狀態都放 Firebase。host 掛掉 → 由另一個 active client 或回來的原 host 從 Firebase 接續（見 §4.3）。

---

## 3. 聊天室

### 3.1 UI（**照抄既有元件、勿自創**）
- ⚠️ **三種介面都要支援：電腦版 / 手機網頁版 / 手機全螢幕版。** 縮合框與彈窗**沿用既有彈窗/框架元件（樣式、排版、字型、字體、音效、邏輯）先照抄，再微調**，不要另做新 UI 反覆測。
- **縮合對話框**（圖一）：主畫面左下角，**固定 3 行**的框。顯示最新一句：`頭像 + 名字：內容`（太長就在 3 行內換行）；字小；**不得蓋到排行榜按鈕**。最新訊息無論是人機或真人都顯示。
- **點擊 → 彈窗**（圖二）：訊息列＝`頭像 + 名字 + 對話泡泡`，**自己的訊息靠右**（貼圖為圖片泡泡）；底部＝**輸入框 + 表情鈕 + 發送鈕**。樣式一律照既有元件。訊息列表套 §3.2 保留規則。
- **只在主畫面顯示**；對局中不顯示。**訪客可看、可發言**（用訪客名字/頭像）。
- **發送方式並存**：可**打字**（輸入框）或**發貼圖**（表情鈕，5 個預設，見 §3.6）。手機橫式：打字較難時以貼圖為輔、`visualViewport` 把輸入列頂到鍵盤上方；登入推 OAuth。

### 3.2 資料模型 `lobbyChat`（push list）
```
lobbyChat/{pushId} = {
  ts, kind:'bot'|'human', botId?|uid?, name, avatarId,
  type:'text'|'sticker'|'action',
  text?, stickerId?,
  cta?: { label, action:'register'|'campaign'|'quickmatch', room?:'normal'|'special' }
}
```
- **顯示**：`limitToLast(30)` **且** `ts > now-2h`（兩者取嚴）。
- **清理**：host 寫入時順手 `remove` 超過 2h／超過 ~50 則的最舊訊息。
- **新訊息音效**：收到新訊息播**既有的 click 音**（自己送出已有發送鈕音）。〔若人機一直聊覺得吵，之後可改成只在彈窗開啟時響〕

### 3.3 環境閒聊引擎（**host 統一發**，回合制）
- **觸發一個 burst（任一）**：`lobbyActive` 新增子節點（新玩家）／玩家開聊天窗／玩家發言。新玩家上線可先一句單一招呼（例：某人機「安安大家好」）。
- **一個 burst ＝ 播 3–5 條 mini-thread（含單句式）** 後停止，直到下次觸發。
- **mini-thread**：從 `chatThreads` 隨機挑樣板；角色 A/B/C 指派給**隨機不同**人機；句間隔 **10–30 秒亂數**。配對關係寫在內容裡（例：開場→附和、嗆聲→吐槽；日常閒聊/小知識/揪團/貼圖＝單句）。
- **只有存在 active 觀眾才發**；沒有就停。玩家發言→**重置**閒聊計時。

### 3.4 反應式回覆　⚠️**已改：改由唯一 host 產生+發送，節奏 9~18s、插隊優先，見 §11.2（以 §11 為準）**
- 玩家送出訊息/貼圖 → **自己的 client 讀自己的「註冊狀態 ＋ 主線進度」**（不追蹤看過的 tip）→ 由上而下比對 `reactRules` 取**第一個命中** → **5–8 秒（亂數）後**寫一則 bot 回覆（可帶 CTA）到 `lobbyChat`。
- **reactRules 骨架（內容後補）**：
  | 條件（讀自己資料）| 回應池 | CTA |
  |---|---|---|
  | 未註冊（訪客）| 「{name} 要不先註冊一下？」 | register |
  | 未過 1-1 / 未通關 | 引導打主線 | campaign |
  | 過到 1-3+ | 邀快速對戰 | quickmatch（normal/special 隨機）|
  | 送了貼圖 | 隨機人機「抽牌吧 遊戲BOY！」 | quickmatch |
- **CTA 點擊**：`quickmatch`→進讀秒配對（＝現有快速配對，不是加入某隻人機的房、無「搶房」）；`campaign`→開主線；`register`→開註冊。
- **注意**：反應式**不含 tips**；tips 只在閒聊（§3.5）。**防連發：同一真人每 8 秒最多回一則。**

### 3.5 內容 schema（全部 JSON，內容後補，先塞少量假句跑流程）
```
chatPools:   { [category]: Line[] }   // category（定案）：開場/附和/嗆聲/吐槽/日常閒聊/揪團邀戰/隨意貼圖/小知識
chatThreads: Thread[]                 // [{ role:'A'|'B'|'C', category, text|stickerId }]，或單句
reactRules:  { when: Condition, say: poolRef|Line[], cta?: Cta }[]  // 有序；只讀 註冊/主線
```
- **無 persona**：大腦隨機、只有身分是實的 → 人機隨機挑即可，不做個性語氣。
- **tips ＝ `小知識` 的閒聊句**（人機互講的教育性一句話，例：「點頭像也能開個人化設定」「三條 CP 值超高，耗牌少又能贏多數非五張牌」「連成相鄰三格也能贏」）。隨機出現在閒聊，不綁個人、不追蹤。
- **隨意貼圖**：某人機隨機發一個預設貼圖當一則訊息。
- `Line` 可帶 `{name}`／`{level}` 佔位。
- **內容產出流程**：由 Claude 先自產一批草稿放進 `chatContent.json`（先讓框架跑起來），並附「怎麼加/改句子、怎麼新增 mini-thread、怎麼加 reactRule」的說明；使用者看到實際呈現後再修改。

### 3.6 貼圖
- **只用 5 個預設貼圖**（笑臉、讚…等簡單那組）。**不放商城貼圖**（商城貼圖尺寸小，發在聊天會跟字差不多大、看不清）。

---

## 4. LiveBoard 自動對戰（人機 vs 人機表演賽）

### 4.1 觸發
- **當一個 client 剛變成 active（新到大廳）** 且 `liveIndex` **沒有任何有效 live（真人局或表演賽）** → 嘗試成為 host 開一場：`leaseBot` 兩次抓 **2 隻空人機** → `rollCasualBot` 各 roll 大腦 → 建立表演賽對局。
- **抓不到 2 隻空人機時**（極少見；人機共 20 隻）→ **跳過不開、不報錯**。
- **同時最多一場**（搶鎖）。已有真人局在跑就不開。
- **打完不自動再開**；要等「下一位新玩家變 active」或「有人觸發真人配對」才會再有即時 live。

### 4.2 對戰執行（複用 §4 觀戰序列化）
- host 用引擎**逐步**跑「人機 vs 人機」，每步依階段停頓（像真人思考、且要幫兩家想）：
  - **選牌 6–8 秒**／**放牌 2–4 秒**／**看勝負固定 6 秒**（亂數落在區間內）。
- 每步用 `serializeForSpectator` 寫 live 節點（`liveIndex`/`broadcast`）；新手在 Live 卡片（§5）／觀戰（§4）看得到牌一張張出、**與真人局無異**。
- host 每 ~5s 更新對戰心跳。
- **一場 ＝ 一局（bounded）**：局內步數有限、自然結束（估幾分鐘）。交接只換驅動者、不重開、不延長內容。

### 4.3 交接 / 暫停 / 中斷 / 回收（**重點：暫停不砍，但一場硬上限 5 分鐘**）
- **host 保持驅動**，直到 host 進對局／斷線／關分頁。單純觀戰不交出 host。
- **host 掛掉時**：
  - **若當下有另一個 active client** → 它在 host 心跳 stale（**~15 秒**，僅為避免旁觀者盯著不動）後接手，從 Firebase 上一步**續跑**。
  - **若當下沒有別的 active client** → 對局**暫停**凍在 Firebase（不砍），原 host 回前景或任何 active client 進來 → **接手續跑**。
- **一場硬上限 5 分鐘**（從開局起算，含暫停時間）：
  - **5 分鐘內打完** → 存回放（§6）、釋放兩隻人機。
  - **超過 5 分鐘還沒打完** → **關掉即時 live、釋放兩隻人機、不進回放**（一場超過 5 分鐘太久）。
- **每次結束（打完 / 逾時 / 遺棄）都要釋放兩隻 `botLease`（回收人機）。**

### 4.4 計分政策（⚠️ 資料安全紅線）
- 表演賽：**不呼叫 `recordBotResult`、不動 `bots/{botId}` games/wins、不進排行榜**。
- **打完** → 用現成 `moveLog`/§6 存 `replays`，回放顯示勝敗、**呈現如兩個真人、不標任何表演賽字樣**。**沒打完** → 不存、不留戰績。
- 與現有「自由匹配（人 vs 人機）」完全區隔（那個維持現狀會 `recordBotResult`）。

---

## 5. RTDB 節點與規則（`database.rules.json`）
- **新增**：`lobbyChat`、`lobbyActive/{connId}`、`lobbyHost`。表演賽 live 沿用 `liveIndex`/`broadcast`（內部 flag 供邏輯用、**不外顯**）。
- **規則**：登入者（含訪客/匿名）可寫 `lobbyChat`（自己的訊息，uid 不可假冒）、`lobbyActive/自己的 connId`、`lobbyHost`（搶鎖）、表演賽 live 節點；**絕不可寫任何真人玩家節點**。
- 表演賽**不寫** `bots/`（不計分）。`botLease` 沿用現有規則。
- **不做聊天審核/防洗版**（人少不需要）。（風險自知：任何登入者理論上可寫 bot 訊息，接受。）

---

## 6. UI/UX 規範（遵守 SPECTATE-REPLAY-SPEC §7）
- 彈窗/框字型/背景/圓角/邊框/音效一律**沿用既有元件**，三種介面一致；**先照抄再微調**。
- 手機橫式：可打字、貼圖為輔、`visualViewport` 頂輸入列、登入推 OAuth。

---

## 7. 決策定案
| # | 項目 | 定案 |
|---|---|---|
| 1 | 縮合框 | **3 行**；`頭像+名字：內容`；三介面照抄既有元件 |
| 2 | 貼圖來源 | **只用 5 個預設貼圖**（不放商城）|
| 3 | 每 burst mini-thread 數 | **3–5 條**（含單句、含上線招呼句）|
| 4 | 表演賽節奏 | **選牌 6–8s／放牌 2–4s／看勝負固定 6s** |
| 5 | 回放標示表演賽 | **不標**；用現成 moveLog/§6 |
| 6 | 打完後再開 | **不自動再開**，等新玩家上線或真人配對 |
| 7 | 聊天審核 | **不做** ｜ 保留 **2 小時** ｜ 頻道：**全頻、無標籤** |
| 8 | 發送方式 | **打字 ＋ 貼圖並存** |
| 9 | 新訊息音效 | **播既有 click 音** |
| 10 | persona | **不做**，人機隨機挑 |
| 11 | categories | 開場/附和/嗆聲/吐槽/日常閒聊/揪團邀戰/隨意貼圖/小知識 |
| 12 | active | 可見 且 不在對局中（觀戰/彈窗仍算）；`lobbyActive` 即時 |
| 13 | host 中斷 | 暫停不砍；有別的活人才 ~15s 換手；**一場硬上限 5 分鐘**（逾時關掉、釋放人機、不進回放）|
| 14 | 反應式讀取 | 只讀 註冊 + 主線；tips 只在閒聊 |
| 15 | 反應式回覆 | ⚠️已改（§11.2）：由 host 發、每則間隔 **9~18s**、插隊優先、每則真人只回一句；同一真人 **15s** 最多一則 |

---

## 8. 檔案地圖（**預估**，實作時定案）
- **新增**：`src/game/lobbyChat.ts`（引擎+schema）｜`src/data/chatContent.json`（內容後補）｜`src/net/lobby.ts`（lobbyChat/host/active RTDB＋選舉/心跳）｜`src/game/exhibition.ts`（人機vs人機驅動，複用引擎+§4序列化）｜`src/ui/components/LobbyChat.tsx`(+css，照抄既有彈窗)
- **修改**：`src/ui/screens/Menu.tsx`（掛聊天框/active/觸發）｜`src/net/liveIndex.ts`/`broadcast`（表演賽 flag，不外顯；**新增路徑、不改真人局行為**）｜`database.rules.json`

---

## 9. 開放問題 / 待續 / 未來
- **內容產出流程（定案）**：聊天內容由 **Claude 先自產一批草稿**（`chatContent.json`）＋附「怎麼加/改句子」的規則；使用者**看實際框架跑起來後再改**。
- **人機擴充（2026-09-20 已做）**：15 → **20 隻**。新增 bot_16 今天辛棄疾／17 宮森裘／18 不得不開除大衛／19 Chill西郎／20 春燕要來了嗎（使用者提供名字；頭像 / 特殊卡 loadout / 門面成就由 Claude 比照現有自行配）。`BOTS_ONLINE` 隨之 = 20。
- 環境閒聊的「揪團」句 = 純聊天不帶按鈕；**按鈕只在反應式回覆**（對真人）出現。
- host 換手 ~15s、一場上限 5 分——數字實測再微調。
- 加好友/私訊（延後，先全頻）。
- LLM 生成對話（延後：需 key/後端/費用；先走組合式腳本）。

---

## 10. 建議實作順序
1. **共同地基**（§2：active / 主持人選舉 / 心跳交接）。
2. **聊天室**：UI（§3.1 照抄既有彈窗）＋ `lobbyChat`（§3.2）＋ 閒聊/反應**框架**（假內容跑通）。
3. **LiveBoard 表演賽**：lease 2 隻 → 驅動（§4.2）→ 暫停/交接/回收（§4.3）→ 打完寫回放（§4.4）。
4. **補內容**（§3.5）。
5. **手機橫式優化**（§6）。

---

## 11. As-built 補充（2026-09 實作 + 多輪回饋收斂；**與上方原文不同處以本節為準**）

**進度**：階段 1（共同地基）+ 階段 2（聊天室）**已實作、未 commit、已瀏覽器實測，2026-09-20 聊天引擎大重寫後基本完工**。階段 3（LiveBoard 表演賽）尚未做。`database.rules.json` 使用者已發布（presence 規則本批**還原成 owner-only**，也已重新發布）。

### 11.1 檔案（實際）
- 新檔：`src/net/lobby.ts`（CONN_ID / lobbyActive / lobbyHost 選舉+心跳 + `pruneActive` 清殘留 / lobbyChat 寫入·訂閱·prune / ensureLobbyAuth 自動匿名+登出防呆 / visibleChat；`LobbyMsg` 帶 `reg`/`stage` 供 host 挑回覆）｜`src/game/lobbyChat.ts`（`nextAmbientUnit` 單元式環境閒聊 + `greetingUtter` 招呼 + `matchReact` 反應式 + `pickBots`，純邏輯，收 `bots` 名單）｜`src/data/chatContent.json`（內容草稿）｜`src/ui/hooks/useLobby.ts`（orchestration，**模組層單例引擎**）｜`src/ui/components/LobbyChat.tsx`(+`.css`)。
- **動到的原程式（紅線，已逐一向使用者報備）**：`src/ui/screens/Menu.tsx`（掛 `<LobbyChat/>`）｜`database.rules.json`（新增 lobbyChat/lobbyActive/lobbyHost；**presence 規則維持/還原 owner-only `auth.uid===$uid`**）｜`src/game/stickers.ts`（免費貼圖 5→8，加 生氣/愛心/再見；**注意會同時出現在遊戲內對戰貼圖盤**）｜`src/platform/auth.ts`（ensureUser `_pendingAnon` 防重入 + **`whenAuthReady()`** 等 Firebase 還原完才建匿名）｜`src/ui/components/AccountButton.tsx`（登入/註冊密碼欄包 `<form>` + 帳號欄 `autoComplete="username"` 消 Chrome 警告）｜`src/game/bots.ts`（人機 15→**20** 隻）。
- **已移除**：`src/net/presence.ts` 的 lazy sweep（曾加、後移除，見 11.3）。

### 11.2 定案覆蓋（取代原文對應處）
- **auto-anon = A 案**：進主畫面 `ensureLobbyAuth()` 自動匿名（讓孤單訪客也有人機閒聊）；**登出後本 session 不再自動登入**（lobby.ts 監聽 onAuth，「有登入者→null」即 `_suppressAutoAnon=true`）。⚠️`ensureUser` 內 **先 `await whenAuthReady()`**（第一次 onAuthStateChanged）才決定建不建匿名 → 否則重整時帳號還沒還原就被匿名蓋掉（「重整被踢成訪客 + 在線人數每次+1」）。
- **唯一嘴巴 = host（重寫，取代原「反應式由發言者自己 client 發」）**：**所有** bot 輸出（環境閒聊 + 反應式回覆）都由 host 一台、**單一序列引擎**發；非 host 只顯示。真人訊息在 `LobbyMsg` 帶 `reg`（是否註冊）/`stage`（subStageOrder），host 據此 `matchReact` 挑對回覆（訪客沒穩定 uid 也收得到回覆）。
- **引擎是「分頁單例」**：引擎狀態（quota/replies/running/gen/roster…）放 `useLobby.ts` **模組層變數**、非元件 ref → React StrictMode 雙掛載 / HMR 熱替換都只有一條迴圈（否則兩條同時寫 → 訊息 2~3 秒亂噴）。
- **額度概念**：一輪聊 **6~9 個單元**（mini-thread/單句/貼圖，2026-09-20 由 5~8 調高,避免太快聊完）。**重置回滿的觸發**：①**新到訪**（uid 消失 ≥10 分再出現,**跟表演賽共用同一訊號**,不再用會被 60 秒抖動亂觸發的 grew）②任一真人發言/貼圖 ③**host** 點開聊天室（非 host 開窗只看;綁「點開那一下」,掛著開不重覆觸發）④**剛接手成 host**。
- **插隊回覆**：引擎每則發送前先看待回佇列 → 回覆最優先，**連 mini-thread 中間也插得進去**（被插的 thread 剩步驟在回覆後接著播、不砍斷）。**每則真人訊息只回「一句」**（matchReact 單則+可選 CTA），其後是額度續播非回話；同一真人 **15 秒**最多被回一次。
- **節奏**：每則 **10~20 秒**（2026-09-20 由 9~18 調寬）；**冷場首句零間隔**（最新訊息 >12 秒或全空才用招呼硬插首句，聊天正熱不插）。
- **收到新訊息不發音效**（會一直「搭搭搭」很吵，使用者要求拿掉；開窗/送出等按鍵音保留）。
- **§9 一次隨機 8 隻人機**：每個聊天 session 隨機挑 8 隻，閒聊+反應式都只用這 8 隻；activeCount=0 清空、下次重抓。（20 隻也只抓 8。）
- **貼圖**：聊天室用「全部免費貼圖」= **8 個**（smile/cry/wow/angry/thanks/like/heart/bye）。
- **CTA 多按鈕**：`cta` 為**陣列**。未註冊→兩顆（遊戲帳號註冊 + Google 登入）；快速配對→隨機一般/特殊一顆；主線→一顆。engine `resolveCtas` 補標籤；`action` 有 `google`。
- **縮合框（左下）**：2 行、`頭像(圓)＋名字：內容/貼圖`；背景/金框對齊即時戰況 LiveBoard 卡；定位對齊 OnlineCount（`max(14px, env*0.8)` + 桌機 `@1024 clamp`）。貼圖預覽 size **16**、`.lchat-fab__body` line-height **1.55**（避免 line-clamp 上下裁切）。
- **彈窗**：沿用既有 Modal（**吃同一套手機等比縮 --mw-scale**）、固定高度；貼圖盤 &「有新訊息↓」提示 absolute 浮動不撐高；每則右下 HH:MM:SS；字級對齊主畫面。
- **捲動/新訊息**：偵測用「**最後一則 id**」而非 length（滿 30 則後 length 不變會失效）。在底部→自動捲；不在底部→「有新訊息↓」不搶 focus；自己發言/貼圖→強制捲到底。
- **lobbyActive 清理**：host 每次 poll 順手 `pruneActive()`（刪 >5 分的殭屍 lobbyActive；onDisconnect 不一定觸發）。active **人數**本來就用 60s 窗口算，殘留不影響數字，此為 DB 清潔。

### 11.3 已修 / 未解 / 待辦
- **✅ 「重整被踢成訪客 + 在線人數每次 +1 狂加」已修**：根因＝`ensureLobbyAuth` Menu 掛載即呼叫、Firebase 還原是非同步、那瞬間 currentUser=null → signInAnonymously 生匿名蓋掉正要還原的帳號、每重整生一個拋棄 uid=+1。修法＝ensureUser 先 `await whenAuthReady()`。使用者真機測正常。
- **✅ 舊「+3」＝並發建多個匿名帳號**（`ensureUser` `_pendingAnon` 防重入已修），與 presence 無關。
- **✅ sweep 移除**：在線人數天生只算 lastActive<10 分、stale 不計 → sweep 對數字零幫助（多做的），已整段移除、presence 規則還原 owner-only。實測正式機 presence 乾淨、無殭屍、10 分機制正常。
- **✅ host 交接**實測正常（a 掉→b 接手續播）；lobbyHost 為單節點 + transaction 互斥，確認不會多 host（2~3 秒亂噴是引擎多迴圈，已用分頁單例修）。
- **#13 chatContent 大重構（框架收尾後做，使用者明確要）**：①上千則對話、每句 3–5 變體 ②threads 改「**插槽式**」（樣板只放 `{role, category}`，每格從池隨機抽 → a1/b3/c7 組合、非固定序）③**主動查詢**：讀 leaderboard（連勝/成就）+ 賽事回放（誰打敗誰）→ 主動播報、cue「在線但沒發言」的人。**現在重置變頻繁 → 重複感明顯，這是內容量問題非邏輯。**
- **階段 3 = LiveBoard 人機 vs 人機表演賽**（`exhibition.ts`，見 §4）。
- 全部**未 commit**，待使用者測滿意決定 commit+push。

### 11.5 表演賽（§4）as-built — v1（2026-09-20 實作、未 commit、待發布規則後實測）
- **新檔 `src/game/exhibition.ts`**：模組單例、**無頭驅動**（host 待在主畫面、不進遊戲畫面,純用 `state.ts` pure reducer 逐步跑 bot vs bot）。接進 `useLobby`（goActive→`exhibitionStart`、goInactive→`exhibitionStop`、poll 餵 `exhibitionSetContext{active,isHost,uid}`、有新真人上線 `exhibitionArm`）。
- **狀態節點 `lobbyExhibition`（單一、全域）**：`{code, seed, firstPicker, special, p1/p2:{botId,name,avatarId,boss:BossRuntime}, moves[], startedAt, driverConn, driverAt, status}`。BossRuntime 直接存(可序列化)→ 接手者讀回即得**一模一樣的兩隻大腦**。→ **需在 `database.rules.json` 新增 `lobbyExhibition`（已加,read:true/write:auth）並發布。**
- **觸發（2026-09-20 定案,取代舊 grew;⚠️「新到訪」判定已於 2026-09-21 改用全域 `lobbySeen`,見 §11.6/§12,本行①僅存歷史）**：兩條路,都 `exhibitionRequestOpen()` → 下個 tick「host + 此刻沒 live」才開、有 live 就看不排隊(8s 沒開就過期):
  ①**新到訪**（~~舊:某 uid ≥10 分沒在 `lobbyActive` / 本 host 分頁沒見過(noteActiveUids)~~ → 現改:全域 `lobbySeen` ≥15 分或無紀錄,見 §12）。
  ②**冷啟動**:剛成為 host **且是冷啟動**(前一任 host **不是我自己** 且 消失 >30s 或根本沒人 = 空大廳)。單人/第一個進空大廳靠這條。
  **交接(前一任新鮮/剛掉 15~21s)或「我自己切分頁回來重搶」→ 不開、也不重置聊天**(只是靜默接手)。
  ⚠️**關鍵修(reopen bug)**:`releaseHost` **不再把 lobbyHost 清成 null**(只停心跳、留 {by:我,at:舊值})→ 切分頁 hidden→visible 回來時看到「前一任是我自己」→ 判非冷啟動 → **不亂開**。(舊版清 null → 回來看到沒人握 host → 誤判冷啟動 → 每切分頁就重開一場。)
  DEV log:`[lobby] 開場觸發: 冷啟動[前一任…]` / `新到訪 xxx(缺席N分/本分頁初次見到)`、`[exhibition] 開新一場 code p1 vs p2`;F12 `await __lobby()` 看 host/在席/表演賽/租借(帶名字)。
- **驅動/續播**：`driverConn`+`driverAt` 心跳鎖（每 4s 更新）；stale **> 10 秒**（使用者定案 2026-09-21,原 11s）→ 任何活人 transaction 搶下、`rebuild()`(createGame+套 moves)續跑。廣播**直接寫** `spectate/{code}/spec`(serializeForSpectator,不經 broadcast.ts→不受 watcher-gate、不被 onDisconnect 砍→接手不斷)。`liveIndex` 用 `writeLiveEntry/flipLiveEnded/removeLiveEntry`。
- **節奏**：選牌 6–9s / 放牌 3–4s / 開牌 6s / 補牌 0.8s（2026-09-21 微調快一點,原 7–10s / 3–5s）。
- **收尾政策（2026-09-20 改，取代原「開局 5 分硬上限含暫停」）**：**有人在驅動(驅動者心跳新鮮)就一直跑到自然結束、存回放**(背景節流跑慢也會跑完);驅動者短暫掉線 >10s → 別的活人接手續跑;**驅動者消失 >3 分且沒人接手 = 遺棄 → `closeExhibition` 收掉、不存回放**。原本「連暫停時間都算的 5 分硬上限」會讓觀眾分心一下就被砍(還不存回放),使用者要求改掉。
- **🔒 計分**：打完 `flipLiveEnded` + **只 `pushHighlight`（全域 replays）**；p1/p2 uid 存 botId(頭像可點看 persona 戰績,同 casual)、isBot:true(metadata,不顯示)；**不 pushUserReplay、不 recordBotResult、不寫 bots/**。
- **雙租(2026-09-20 補)**：`net/bots.ts` 加 `leaseBotsById(uid, ids[])` / `releaseBotsById(ids[])`（transaction 依 id 占兩隻 + onDisconnect;leaseBot 是單租設計故另開）。開場占兩隻、**接手續播依 id 重占**(交接空窗不被別桌撈走)、打完/逾時/孤兒回收都 release。→ 根除「跟別桌 casual 撞同名」。
- **v1 範圍 / 取捨（可日後升級）**：**一般房**(無特殊牌;moves 只 pick/place)。特殊房之後加(要 bossChooseSpecial 套用 + rt 追蹤 + rebuild)。
- **觀戰人數(眼睛)**：驅動者訂閱 `spectate/{code}/watch` → `writeSpectatorCount`(之前漏了、眼睛恆 0,已修)。
- **測試帳號靜音**：`net/lobby.ts` `LOBBY_MUTE_USERS = ['ka','kaka']`（帳號名,大小寫不敏感);名單內的 client **不主持/不驅動/不觸發**大廳 AI,方便正式機/local 同庫用測試帳號開發不被洗版。(useLobby muted → 略過 active/host 效果。)
- **動到的原程式**：`database.rules.json`(加 lobbyExhibition)、`src/ui/hooks/useLobby.ts`(接線+新到訪偵測+靜音)、`src/net/lobby.ts`(subscribeActive 多回 uid 集合 + LOBBY_MUTE_USERS)、`src/net/bots.ts`(加雙租 func)、`src/net/spectate.ts`(重連重掛在席,修手機切 LINE 觀戰掉線)。`exhibition.ts` 新檔;broadcast/state/bossAI/liveIndex/replays/casualBots **只複用未改**。

### 11.4 🔒 紅線（持續）
動到任何原程式/邏輯前先問使用者；表演賽不記勝負、不進排行榜、打完才存回放、**永不揭露是人機**；絕不寫真人玩家節點。

### 11.6 2026-09-21 這批異動（本次對話，未 commit）
起因：使用者實測回報「兩個聊天 thread 同時跑、觸發時有時無、觀戰卡在『讀取牌局中』、接手 host 後把在席者當新人亂開」。逐項:
- **節奏微調**：選牌 7–10s→**6–9s**、放牌 3–5s→**3–4s**（`exhibition.ts`）。
- **驅動接手門檻**：`STALE_MS` 11s→**10s**（`exhibition.ts`;連同註解/spec 統一）。
- **#1/#2 聊天成雙**：`lobby.ts` 加 `verifyStillHost()`——每則聊天送出前直接讀 `lobbyHost` 確認還是自己,被降級的分頁立刻收手,不再兩視窗同時寫（`useLobby.ts` 引擎接上)。
- **表演賽 log 寫清楚**：`exhibitionRequestOpen(reason)` 印「📨 收到開場請求」、tick 一定接一行結局（`✅ 開場` / `⏭️ 沒開:原因` / `↩︎ 放棄:已有一場`），不再「只印請求、看不出開沒開」。
- **Bug 1 觀戰卡死**：①`SpectatorGame` 加 **9 秒逾時**——進觀戰 9s 收不到任何 spec → 顯示「這一場結束了」導回,不卡讀取。②`exhibition.ts` 加 `pruneDeadExhibition()`（進大廳背景清「驅動者早死 >3 分」的孤兒表演賽）。③**LiveBoard 改「即時濾死卡」而非「等清完才顯示」**：board 秒開,用權威節點 `lobbyExhibition`（`subscribeExhibitionLiveCode`,fresh=心跳<3分）即時把「雙方都是人機、code 不等於當前真活著那場」的死卡濾掉。
- **Bug 2 接手者把在席者當新人亂開 + 觸發競態**：**廢掉每分頁各記各的 `mLastSeenActive` 與 `mPendingArrivalReason`**,改用**全域 `lobbySeen/{uid}`**（見 §12）。→ **需在 `database.rules.json` 新增 `lobbySeen`（已加,使用者已發布）。**
- **移除**：所有 DEV 種資料工具（`__seedOrphanExhibition`/`__delOrphan`/`__seedDeadCard`）已刪,不留垃圾。
- **修「LiveBoard 顯示 0 場、卻說『已有 live 擋著不開』」**(使用者實測回報):`noOtherLive()` 原本信 raw liveIndex 的 `status:'live'`,漏了套 LiveBoard 那道「死表演賽卡」濾鏡 → 兩邊打架。改成共用同一判準:**雙方都是人機、又不是當前 `mState` 的 live 卡 = 死卡 → 不擋開場**;只有真人/casual 的 live(至少一方非人機)才擋。skip log 也改成印出「到底哪個 code 在擋」,以後不用猜。
- 實測(dev+實際 Firebase)：孤兒場進場自動清（🧹 log）、觀戰 9s→「這一場結束了」導回、`lobbySeen` 由 host 正常寫入。

---

## 12. 白話總覽（目前實際生效的規則，**看這段就好**）

> 給創作者快速掌握「這功能現在到底怎麼運作」。與上方任何舊敘述衝突,**以本節為準**。

### 12.1 名詞白話
- **主持人（host）**：同一時間只有「一台分頁」當主持,負責①發人機聊天②決定要不要開表演賽。用一個鎖選出來,主持每 5 秒回報一次「我還在」,超過 15 秒沒回報就被別台搶走。
- **表演賽**：兩隻人機互打的表演局,只是給大廳的人看熱鬧。**不計分、不進排行榜、打完存成回放、對玩家永遠不說那是人機**。
- **冷啟動**：整個大廳是「空的」（沒人,或上一個主持已消失超過 30 秒),然後有人進來當第一個主持。白話＝**「你是這波第一個進來的人,開一場給你看」**。
- **新到訪**：有「**別人**」進到大廳,而這個人**最近 15 分鐘都不在**(或系統從沒看過他)。＝真的有新的人來了。
- **換手/交接**：主持從一台換到另一台（有人關分頁、切背景、或兩台互搶）。**換手本身不會開表演賽**。
- **lobbySeen**：一張全域小表「每個人最後一次出現在大廳的時間」,**只有主持那台會寫**。用它判斷「這個人是不是真的很久沒來」。因為是全域,接手主持的人也讀得到「別人其實剛剛還在」,就不會把在席的人誤當新人。

### 12.2 什麼時候會「開」一場表演賽
**三個條件同時成立才開**：`當下沒有任何 live 場` ＋ `有主持` ＋ `（冷啟動 或 有別人新到訪）`。
- 你**自己一個人**反覆進出、切分頁、去 LINE 再回來 → **不開**（自己不算新到訪）。
- 已經有一場在打 → **看那場,不排隊**（開場請求 8 秒後自動失效,不會等打完再開）。
- 別人那場的驅動者停了（>10 秒）→ **任何在線的人 10 秒內接手續跑**,不會開新的、也不會卡住。
- 完全沒人超過 **3 分鐘** → 那場被收掉（不存回放）。

### 12.3 為什麼不會再看到「有人在打→點進去卻結束」
- 進大廳時**背景**先清掉上個 session 留下的死表演賽。
- LiveBoard **即時**用權威節點濾掉死卡（不必等清理寫回 DB）→ board 照樣秒開。
- 萬一還是點進一張剛好在清的死卡 → 觀戰 **9 秒**收不到資料就顯示「這一場結束了」導回,**永不卡在讀取**。

### 12.4 所有門檻數字（一次攤開）
| 項目 | 值 | 常數 |
|---|---|---|
| 主持回報心跳 / 過期可被搶 | 5s / 15s | `HOST_STALE_MS` |
| 主持輪詢 | 6s | `HOST_POLL_MS` |
| 表演賽驅動心跳 / 過期可接手 / 完全沒人收場 | 4s / 10s / 3 分 | `STALE_MS`,`ABANDON_MS` |
| 出牌節奏:選牌 / 放牌 / 開牌 / 補牌 | 6–9s / 3–4s / 6s / 0.8s | — |
| 開場請求有效期 | 8s | `OPEN_REQ_TTL` |
| **新到訪門檻**（別人缺席多久算新） | **15 分** | `NEW_ARRIVAL_MS`（lobbySeen） |
| lobbySeen 清理（刪多舊的） | >30 分 | — |
| 觀戰逾時（收不到 spec 就導回） | 9s | — |
| 聊天:每則間隔 / 一輪句數 / 同一人回覆節流 | 10–20s / 6–9 句 / 15s | — |
| 在線人數窗口（另一套 presence,非本功能） | 10 分 | `ONLINE_WINDOW_MS` |

### 12.5 🧹 DEV log 清單（流程確認正常後要刪）
以下 `console.log` 都包在 `import.meta.env.DEV` 內,正式版不會出現;確認流程 OK 後可整批刪:
1. `useLobby.ts`：`[lobby] 成為 host(非冷啟動 → 不開表演賽,新到訪交給 lobbySeen 判)…`
2. `exhibition.ts`：`[exhibition] 📨 收到開場請求:…`
3. `exhibition.ts`：`[exhibition] ⏭️ 沒開表演賽:…`
4. `exhibition.ts`：`[exhibition] ✅ 條件成立 → 開場(因:…)`
5. `exhibition.ts`：`[exhibition] 開新一場 …`
6. `exhibition.ts`：`[exhibition] ↩︎ 放棄開場:DB 已有一場進行中…`
7. `exhibition.ts`：`[exhibition] 🧹 進場清孤兒場…`
8. （除錯工具,非 log,可留可刪）`lobby.ts` F12 `await __lobby()`。

---

## 13. 聊天內容模型 v2（產句引擎）— 定案 + as-built（2026-09-22 實作、已瀏覽器實測、未 commit）

> 取代 §3.5 的陽春 schema。目標：**組合出 ≥3000 種變化**（不是手寫 3000 句）＋針對性＋關鍵字＋主動內容＋不重複感。使用者給核心/迷因句，Claude 依框架量產。

### 13.1 三層模型
1. **碎片 fragments**：可安全前綴/內插的小詞（`opener` 語助詞、`invite` 邀約短語…）。
2. **意圖模板**：一句 `Line`，內含 `{替代符}`；同一意圖掛多個模板。
3. **facts（替代符）**：host **發送前**填實值 → 非 host 只顯示、不需邏輯。

**檔案**：內容全在 `src/data/chatContent.ts`（純資料 + 型別 + 檔頭編輯教學；改它不用動程式）。引擎 `src/game/lobbyChat.ts`（純邏輯）。orchestration `src/ui/hooks/useLobby.ts`（餵 facts、驅動）。

### 13.2 `Line` 型別（所有句子共用）
`{ t?, sticker?, w?, guard?, cta?, ctaChance?, opener? }`；只有 `t`/`sticker` 必填其一。
`w`=權重(預設1)｜`guard`=出現條件｜`cta`=按鈕(可陣列)｜`ctaChance`=掛鈕機率(不填用 config)｜`opener:false`=拒絕自動前綴語助詞。

### 13.3 內容區塊（chatContent.ts）
| 區塊 | 用途 |
|---|---|
| `config` | 全域旋鈕：`openerChance`(0.4)/`pileOnChance`(0.15)/`cooldownSize`(25)/`ambientWeights`{thread,single,sticker,proactive}/`ctaChance`{每種按鈕預設機率} |
| `fragments` | `opener`(語助詞,可擴到200+)、`invite`(邀約短語) |
| `greetings` | 冷場首句招呼 |
| `singles` | 環境單句（自聊/tips/話題），可帶 cta |
| `threads`+`beatPools` | **插槽式劇場**：`threads` 定「形狀」(每拍 `{role,pool}`)、可宣告 thread 內共用槽 `slots`(如同一張 `{card}` 貫穿問→答→反應)；`beatPools` 是每拍的句池。A/B/C 指派給不同人機。 |
| `ambientStickers` | 閒聊時隨機發的貼圖（只用免費 8 張） |
| `stickerReplies` | 收到某張貼圖的回應池（可回字/回貼圖）；`'*'` = 通用 fallback |
| `keywords`+`kwPools` | 中文字元共現比對(`any`任一/`all`全部)，有序+加權取第一個命中 → 對應 `kwPools` |
| `reactRules` | 依發言者**狀態**的有序規則（第一個 `when` guard 通過者用），是貼圖/關鍵字都沒命中的 fallback 鏈 |
| `proactive` | 主動內容：`greet_newcomer`/`online_count`/`gossip_gm`/`announce_replay`/`time_morning`/`time_night` |
| `pileOn` | 補刀短句（回真人後低機率由另一隻人機接一句） |

### 13.4 facts（code 驗證版；來源=玩家資訊卡 `cards/{uid}` + 訊息 payload + 全域，全 read-only）
- **發言者**（讀他的卡）：`{name}`｜`{streak}`目前連勝｜`{bestStreak}`｜`{wins}`勝場｜`{games}`場次｜`{winRate}`勝率%(games>0才有)｜`{achv}`他**展示**的一個成就名(含銅/銀/金,guard 提 silver/gold 會挑對應階)｜`{loadoutCard}`他預設特殊牌之一｜主線進度→`{stageNo}`第幾關/`{bossName}`/`{bossCard}`招牌卡/`{bossStyle}`(強攻/囤牌/平衡)/`{bossSkill}`(詐唬/拼牌/鬼牌時機/看破)。
- **全域**：`{onlineCount}`｜`{newcomerName}`｜`{lastWinner}`/`{lastLoser}`。
- **隨機自聊**：`{anyCard}`/`{anyBoss}`/`{anySticker}`。
- **碎片**：`{opener}`/`{invite}`。
- ❌ **拿不到**：精確排行名次；他「擁有但沒展示」的成就；他「剛剛那場」輸贏(只有 streak,=0 當沒連勝)；他此刻正打哪關(用「已通關+1」當作在打的)。

### 13.5 guard（極小判斷式，只支援 `&&` 串接，無 `||`/括號）
布林：`guest`/`registered`｜`showsAchv`/`silverAchv`/`goldAchv`｜`hasLoadout`｜`hasBoss`｜`hasLive`｜`morning`/`night`。
比較：`streak>=N`/`bestStreak`/`wins`/`games`/`winRate>=N`。
關卡：`beforeStage:1-3`/`afterStage:1-2`（用小關 label；引擎轉 subStageOrder 比較）。`!` 前綴否定。

### 13.6 引擎流程（host 唯一嘴巴）
- **環境 `ambientUnit`**：依 `ambientWeights` 挑 劇場/單句/貼圖/主動 之一，組出一段（劇場可多則）。
- **反應 `reactUnit`**：①收到貼圖→`stickerReplies` ②關鍵字命中→`kwPools` ③`reactRules` 第一個 guard 通過 ④保底邀約；填 facts、掛 CTA；低機率 `pileOn` 由**另一隻**人機補一句。
- **招呼**：冷場 `greetingUtter`；有人上線 `arrivalGreeting({newcomerName})`。
- **解析**：guard 過濾 → 佔位可解析才留 → 全域冷卻(近 25 模板不重複) → 加權挑 → 單句 40% 前綴 opener → 填值寫 `lobbyChat`。

### 13.7 CTA（`LobbyCtaAction`，接既有畫面）
已接：`register`/`google`/`quickmatch`(隨機房)｜`quickmatch-normal`/`quickmatch-special`/`campaign`/`tutorial`/`personalize`/`loadout`/`achvShow`/`shop`(後四者都導 personalize 畫面)/`leaderboard`。
**v1 待接**：`spectate`(需帶當前 live code；目前 `hasLive` 恆 false 故不掛鈕)、`replays`/`daily`(Menu 內彈窗,尚無 appStore 入口)。

### 13.8 v1 已實作 / 待辦
- ✅ 三層組合、facts(連勝/成就/預設卡/主線→BOSS)、guard、關鍵字、插槽劇場、每張貼圖回應池+人機回貼圖、opener 前綴、加權+全域冷卻、補刀、主動(招呼/線上數/梗/時段)、多 CTA。**build 過、瀏覽器實測 errs=0**。
- ⏳ 待接：`spectate`/`replays`/`daily` CTA 入口；`announce_replay`/`cue_idle` 的資料餵給(需 host 拿最近表演賽勝負 + 在席但沒發言者名單)；`hasLive` 目前恆 false。
- 🔒 不碰：表演賽「怎麼觸發」邏輯、紅線（不寫真人節點、不揭露人機）。**未 commit。**

### 13.10 聊天導演 + 內容檢查（2026-10-06，未 commit）
- **導演 `src/game/lobbyDirector.ts`**（純邏輯、依賴注入 write/verifyHost/sleep/now，可做多分頁劇本模擬）決定何時講、講幾則、要不要打招呼；`useLobby.ts` 只剩 Firebase 接線 + 表演賽觸發（表演賽邏輯不變）。
  - **招呼只在冷啟動且聊天安靜 ≥10 分**；其他一律接著聊（修「打完一場回來又安安大家好」）。
  - **換手續聊**：非冷啟動成為 host 且引擎閒著 → 補 2~4 則（推翻 9/20「換手不重置」，使用者 10/06 同意）。
  - **回大廳續聊**：host 看到某人離開 ≥45s 又回來 → 補 2~4 則；host 自己 ≥45s 沒 poll(被節流) 時只重設基準、不誤判。
  - 安靜 ≥30s 時第一句 1.5~4s 就出；其餘 10~20s。真人發言/點開聊天室 → 額度回滿 6~9（不打招呼）。
  - 進主畫面延遲 3s 才接 host 工作（`START_DELAY_MS`）；「成為 host」與「人數到位」誰先到都不漏（`pendingBecameRef`）。
- **劇場**：不加 opener；共用槽（`{card}`/`{sticker}`）在挑句前帶入（修：原本含槽的句子全被濾掉 → 聊特殊卡劇場 B 從不發言）；劇場句的 cta 會顯示。
- **內容檢查器 `lintChatContent()`**（lobbyChat.ts）：pool/關鍵字池/佔位/條件/按鈕/貼圖 id/beat 格式/無發言者卻用 `{name}`/關鍵字互搶/池沒人用。DEV 啟動印在 F12；`npm test` 有 error 就失敗。
- **測試**：`lobbyDirector.test.ts`（9 個多分頁劇本：冷啟動、獨自進遊戲回來、換手、回大廳、切分頁不觸發、host 被節流不誤判、回覆插隊+節流、點開聊天室、兩分頁搶 host 不洗版、沒聽眾不講；全程驗「非 host 不寫」）＋ `lobbyChat.coverage.test.ts`（每個劇場/關鍵字/貼圖/時段/owner/觀戰鈕都真的會出現）。
- **reactRules 新規則（10/06 第二批）**：`exclusive:true` 的規則獨佔（目前 isOwner、guest）；其他所有符合的規則**合併成一個大池**（句子帶自己規則的 cta/ctaChance；achv 取最高階要求）→ 保底句可達、老手不再只抽到 2 句。
- **防連發（10/06 第二批）**：每則送出前「硬間隔」——聊天室最後一則（不論誰講、哪個分頁）未滿 10s 先等；確認 host 後再檢查一次本地狀態（確認期間人離開就不送）；時間比對用校正過的 `serverNow()`；HMR 換新導演時 `dispose()` 舊的。壓力測試：3 分頁亂進亂出/換手/發言，20 種子 × 2 小時 × (0ms/300ms 延遲)，最小間隔 10.2s、沒聽眾不講、招呼只在安靜 ≥10 分後。真環境兩分頁換手：10 則最小間隔 11.1s、0 則 <10s。

### 13.12 觀戰進場直接給局面 + owner 線上名單（10/06 第二批，未 commit）
- **觀戰**：`SkipEnterAnim` context（`components/game/enterAnim.ts`）。SpectatorGame 在棋盤剛掛上的 0.6s 內提供 true → Hand/OpponentHand/SlotView 用 `initial={false}` 直接定位；之後新發的牌照常飛入。實測重進觀戰 0.13s 出棋盤、48 張牌 0 張在飛。
- **owner 線上名單** `OnlineWho.tsx`：只有 `isOwnerName(username)`（chatContent.config.owners，目前 ricky）且非訪客才渲染/訂閱；放在左上「賽事回放」下方；名單＝`subscribeOnlineUids()`（與在線人數同一套 10 分窗判定，不含人機、不含自己），名字讀 `cards/{uid}`，訪客顯示「訪客·xxxx」；沒人不顯示、多人往下排。Q 版字型（--font-display）+ 羊皮紙膠囊 + 綠點。

### 13.11 圖片瘦身（2026-10-06，未 commit）
- 頭像原為 ~1000px PNG（0.7~1.4MB/張）、title.png 1.8MB，畫面只顯示 40~150px → 新玩家進主畫面要下載 ~9MB、解碼 ~28MB。
- `scripts/build-img.mjs`（ffmpeg-static）產 `public/avatars/{id}.webp`（長邊 512，~20KB）+ `public/title.webp`（73KB）；**原 PNG 保留當母檔**，改原圖後重跑即可。
- `avatarSrc()`/Menu 標題/CardBack 改用 WebP；頭像 `<img>` 加 `decoding="async"`，清單加 `loading="lazy"`。實測主畫面圖片總量 **263KB**。

### 13.9 內容生產流程（定案）
使用者用**自然語言 + 【中文佔位】**下單（格式見 chatContent.ts 檔頭 / 對話紀錄的 A~F 格式），Claude 轉成 `Line` 灌進 `chatContent.ts` 並量產；使用者也可直接改該檔（有中文註解）。
