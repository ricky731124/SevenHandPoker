# 遊戲平台層 — 規格書 (PLATFORM-SPEC v0.1)

> **可攜平台層**的權威文件。這一層與「某一款遊戲的規則」無關,設計為可整包搬到下一款遊戲(例:七手撲克 → 撲克麻將)。
>
> 本作(Seven Hand Poker)的**遊戲核心規則**見 [SPEC.md](SPEC.md)。
>
> 文件驅動:實作以本文件為準;衝突先改文件再改碼。
>
> **進度**:★ = 本輪(Phase A)已定稿;☐ = 佔位,待對應 Phase 展開。

---

## 0. 目的與可攜原則 ★

### 0.1 為什麼有這一層
帳號、進房身分、關卡制、能力卡、商城/貨幣、貼圖、成就、排行榜這些是**養成/元遊戲系統**,跟撲克怎麼比牌無關。把它們獨立成可攜層,下一款遊戲能直接複用,不必重寫。

### 0.2 核心原則:結構(可攜) ↔ 內容(每款重寫) 分離
| 系統 | 可攜結構(搬去下款不動) | 每款遊戲的內容(重寫) |
|---|---|---|
| 帳號 / Profile | 匿名 Auth→升級、UID、schema、進房身分 | (幾乎全可攜) |
| 關卡制 | 大關/小關、BO 賽制、解鎖獎勵流、進度存檔 | boss 是誰、AI 邏輯、每關配置 |
| 能力卡系統 | loadout「選 N 用 1」、交集池、啟用時機、同步、可見度 | 具體有哪些卡、各卡效果 |
| 商城 / 貨幣 | 貨幣、每日上限、購買流程 | 賣什麼品項、價格 |
| 貼圖 / 成就 / 排行榜 | 觸發→解鎖→裝備引擎、榜單結構 | 成就清單、貼圖圖庫 |

### 0.3 程式落點(解耦)
- 平台層程式集中在 `src/platform/`,**不 import** `src/game/`(遊戲核心)。
- 兩層只透過 **§1 整合契約** 溝通(事件 + 唯讀查詢),不互相直接呼叫內部函式。
- 下一款遊戲:複製 `src/platform/` + `docs/PLATFORM-SPEC.md`,只重寫 `src/game/` 與 §0.2 右欄的內容表。

### 0.4 交付「快速複製」的兩階段
1. **現在**:寫成遊戲中立文件 + 程式解耦(達成 ~80% 可複製性)。
2. **驗證後**:待本作跑順,用真實程式碼包成 Claude Skill(在新 repo 依本文件搭平台層並照契約接上遊戲)。

---

## 1. 整合契約(平台 ↔ 遊戲) ★ 骨架

> 這是可攜性的關鍵:遊戲核心與平台層之間**唯一**的溝通面。介面穩定,兩邊就能各自替換。
> 型別為 TypeScript 草案,實作時再定稿於 `src/platform/contract.ts`。

### 1.1 遊戲核心 → 平台(事件上報)
遊戲在關鍵時點呼叫平台提供的 `emit`,平台據以更新進度/貨幣/成就/排行榜。

```ts
type PlatformEvent =
  | { type: 'matchEnded'; result: 'win' | 'lose' | 'draw'; mode: 'campaign' | 'pvp' | 'ai';
      stageId?: string; opponentId?: string; stats: MatchStats }
  | { type: 'seriesEnded'; stageId: string; won: boolean }      // BO 系列賽整體結束(關卡制用)
  | { type: 'stageCleared'; stageId: string }                    // 首次通關某小關
  | { type: 'achievementProgress'; key: string; delta?: number; absolute?: number }
  | { type: 'abilityUsed'; cardId: string }                      // 對局內用了能力卡(成就/統計用)

// MatchStats:遊戲自定義的一局統計(可攜層只存不解讀),例:
interface MatchStats { coins?: number; usedFlush?: number; streak?: number; [k: string]: unknown }
```

### 1.2 平台 → 遊戲(唯讀查詢 / 開局注入)
遊戲開局前向平台索取「這一局的配置」;對局中不再回頭改平台狀態(只靠 §1.1 上報)。

```ts
interface PlatformContextForMatch {
  me: { uid: string; username: string | null; isAnonymous: boolean; avatarId: string }
  // 能力卡:這一局可用的牌池(PvP=雙方交集;campaign=依關卡規則)與我帶入的 loadout
  ability: { poolCardIds: string[]; myLoadout: string[]; useLimitPerMatch: number }  // 選 N 用 1 → useLimitPerMatch=1
  // 關卡制:若為 campaign,附本關配置(boss/AI/BO 規則);遊戲自行解讀 config 內容
  stage?: { stageId: string; bestOf: number; winsNeeded: number; config: unknown }
}
```

### 1.3 契約守則
- 平台**不認識**牌、牌型、boss 這些遊戲名詞;它只認識 `stageId`、`cardId`、`stats` 這些**不透明字串/數值**。
- 遊戲**不直接讀寫** Firebase 的 `users/*`;一律經平台 API。
- 新遊戲若無某系統(如不要關卡制),就不觸發對應事件、不注入 `stage`,平台其餘功能照常運作(**可單點取用**)。

---

## 2. 帳號 & 認證 (Auth) ★

### 2.1 技術選型
- **Firebase Authentication**(與現有 RTDB 同專案,不引新服務、不用 OAuth)。
- 登入方式:**Email/Password**,但玩家只輸入「帳號 + 密碼」。

### 2.2 匿名打底 + 原地升級(核心流程)
1. **延遲(lazy)建立匿名 UID**:**不在每次載入就登入**;只在**第一次需要存檔的動作**才 `signInAnonymously`。純瀏覽(開主選單就離開)= 零足跡、不建 UID。觸發點例:開始第一場想被記錄的遊戲、(Phase C 之後)在「登入/訪客」選**訪客**、按「註冊/登入」。
2. 匿名玩家一樣立即可玩,進度自建立 UID 起就存。
3. 玩得上手後跳提示「註冊保存進度」(**正式觸發點:通過關卡 1-2**;Phase A 因 campaign 未做,先用「玩完 N 局」軟提示 + 主選單常駐入口)。
4. 註冊 = `linkWithCredential`:把「帳密憑證」掛到**同一個匿名 uid** 上 → **uid 不變、資料一格不動**,只是多了一種登入方式。
5. 已註冊者於他處登入 = 一般 `signInWithEmailAndPassword`。

### 2.2.1 匿名 UID 生命週期與清理
- **建立**:lazy(見上),盡量少生垃圾。
- **每次寫入更新 `users/{uid}/lastActive`**(server ts),供日後判定陳舊。
- **Auth 記錄清理**:啟用 Firebase 內建「匿名帳號自動清理」(閒置約 30 天自動刪)。
- **DB 孤兒節點**(`users/{uid}` 不隨 Auth 刪連動):自動排程需 Cloud Functions(付費 Blaze),**v1 不做**;訪客節點極小,量大時再跑一次性 admin script 依 `lastActive` 清理。已升級為註冊帳號者永久保留。

### 2.3 UID vs 帳號名
- **UID** = Firebase 產生的亂碼,**永久主鍵(PK)**,永不變;所有資料掛在 `users/{uid}`。
- **username** = 登入標籤 + 顯示名,**非 PK**。
- **合成信箱**:玩家輸入 `ricky` → 內部轉 `ricky@shp.local` 丟給 Firebase Auth。玩家全程只見帳號/密碼。
  - 代價:無真 email → **無法寄信重設密碼**,忘記密碼救不回(v1 接受;日後可加「安全提示問題」)。
- **帳號名唯一性**:另存對照表 `usernames/{normalizedName} = uid`,註冊(link)前先以 transaction 檢查未被佔用。normalizedName = 轉小寫。

### 2.4 帳號名 / 密碼規則(v1 預設,可改)
- 帳號名:3–16 字,`[A-Za-z0-9_]`,大小寫不敏感唯一。
- 密碼:≥ 6 字(Firebase 下限)。

### 2.5 登出 / 換帳號
- 登出後回到「匿名」狀態(重新 `signInAnonymously` 取得新的匿名 uid;**不繼承**前一帳號資料)。
- 提供「換帳號」= 登出當前 → 登入他帳號。

---

## 3. Profile 資料模型 ★

> Firebase RTDB。所有欄位可攜;內容(cardId/achievementKey/stageId 的具體值)由各遊戲定義。

```
users/{uid}:
  username: string | null            # 匿名時 null
  isAnonymous: bool
  createdAt: <server ts>
  lastActive: <server ts>            # 每次寫入更新,供匿名孤兒清理判定(見 §2.2.1)
  progress:
    maxStageCleared: string | null    # 例 "2-3"
    stageClearedAt: { [stageId]: <ts> }   # 每小關首次通關時間(排行榜用)
  diamonds: number                    # 硬通貨(可攜;命名可換)
  daily:
    date: "YYYY-MM-DD"                 # 以裝置本地日期判定(v1 接受,可被輕微操控)
    pvpDiamonds: number               # 當日 PvP 已獲鑽(上限見 §7)
  unlocked:
    specialCards: { [cardId]: true }
    avatars:      { [avatarId]: true }
    achievements: { [key]: <ts> }
    emojis:       { [emojiId]: true }
  equipped:
    avatar: avatarId
    achievements: [key, key, key]      # 裝 3 個
    specialCards: [cardId, cardId, cardId]  # 預設出戰組合(選 3),對局帶入
  stats: { [key]: number }             # 累計統計(勝場…),供成就/排行榜;平台只存不解讀

usernames/{normalizedName}: uid        # 帳號名唯一性對照表

leaderboard/                           # 反正規化,只放榜單要顯示欄位(見 §10)
  byStage/{uid}:        { username, maxStageCleared, reachedAt }
  byAchievements/{uid}: { username, count }
```

**寫入原則**:玩家只能寫自己的 `users/{uid}`;`leaderboard/*` 由玩家寫自己那筆、所有人可讀(權限見 §11)。

---

## 4. 進房身分流程 ★

> 沿用本作既有的 3 碼房號 + URL 邀請(見 [SPEC.md](SPEC.md) §6),在其上加「身分」層。**保留匿名快速玩**。

### 4.1 點連結 / 進房時的身分判定
| 狀況 | 行為 |
|---|---|
| A. 已是**註冊帳號**登入中 | 直接用本人身分進房;角落顯示「以 {username} 進入・換身分」小提示。 |
| B. 目前僅**匿名** / 未登入 | 跳彈窗 **[登入並加入] / [訪客加入]**。選登入 → 登入後以本人進;選訪客 → 用匿名身分進。 |
| C. 全新裝置第一次 | 同 B。 |

- 因 Firebase Auth 狀態**跨分頁共用**(非 per-tab),朋友傳的連結在新分頁點開會沿用「當前瀏覽器的登入身分」,解決舊 `clientId`(per-tab)造成「點連結變成別人」的問題。
- 訪客(匿名)一樣能完整遊玩;差別:登入者才綁 profile(頭像、PvP 鑽石獎勵、排行榜)。

### 4.2 房型
| 房型 | 說明 |
|---|---|
| 一般房 | 禁用能力卡;維持最短節奏(約 2 分鐘一局),**無戰前選牌步驟**。 |
| 能力卡房 | 啟用能力卡;進入前有戰前準備(選 loadout)。 |

### 4.3 能力卡房的公平機制(交集池)
- 能力卡依關卡進度**循序解鎖**(過第 N 關得第 N 張)→ 每人牌庫恆為「1..N」連續集。
- **本局牌池 = 兩人牌庫交集 = 過關數較低者的整個牌庫**。雙方都從此池選(見 §5「選 N 用 1」)。
- **基底 1 張**:過新手教學即全員(含訪客)預設解鎖 1 張 → 交集恆 ≥ 1(最慘雙方各帶 1 張)。
- **loadout 帶入**:戰前畫面自動帶入玩家預設出戰組合;在池內的直接生效,不在池內的**灰掉**,玩家補選;**臨時調整不改動已存的預設**。
- **續局**:回戰前選牌畫面;沒改直接確認即可,輸了想換再換。
- 戰前準備為雙方「準備完成」同步步驟(類似擲硬幣),兩邊 ready 才開局。

### 4.4 與 Auth 的關係
- 訪客(匿名 uid)也有 `unlocked.specialCards`(至少基底 1 張),故訪客能進能力卡房。
- 未走過教學/新帳號基底如何給,由 §5/§6 的教學與解鎖流程定義。

---

## 5. 能力卡系統(結構) ☐ Phase C

> 可攜的「主動技能」框架;具體卡片(換牌等)與效果屬遊戲內容,列於 [SPEC.md](SPEC.md)。

待展開重點(已於討論定案,先記):
- **選 N 用 1**:每場帶入 loadout(選 3),對局中最多用 1 張(`useLimitPerMatch`)。
- **啟用時機**:只在**自己的「選牌」階段、送出前**;一場一次。
- **對手可見度(一致規則,單機/連線相同)**:
  - 不影響對手的效果(換牌、改自己某張花色)→ 只顯示「對方似乎使用了特殊牌」,**不透露是哪張**。
  - 會影響對手的效果(偷看對手放置牌 / 偷看對手手牌 / 叫對手重抽)→ **必須告知內容**。
- **連線同步**:能力卡使用走 host 裁判 + intent 模式(對齊 SPEC §6 連線架構)。
- **UI(細節留 DESIGN.md)**:選 loadout 於戰前畫面;對局中一顆小按鈕,用完變灰。

---

## 6. 關卡 / 任務系統(結構) ☐ Phase E

> 可攜且**資料驅動**:關卡是一份設定資料,水管(進度/解鎖/結算)通用;boss/AI/配置屬遊戲內容。

待展開重點(已定案框架):
- 一個「大關」= 一個角色 + 三小關;命名 `x-y`。
- **x-1**:介紹新角色、AI 換一套選牌邏輯、禁能力卡、`3 戰 2 勝`。
- **x-2**:boss 只用自己專屬能力卡;玩家可用已解鎖(選 3 用 1);`3 戰 2 勝`;**勝 → 解鎖該能力卡**。
- **x-3**:`先贏 3 場 (BO5)`;boss 用自己 + 任意已解鎖(不受選 3 限、一場一張);**勝 → 解鎖 boss 頭像**。
- 每小關**首次**通過 → +10 鑽(主線一次性,見 §7)。
- 牽動內容:每 boss 一套 AI 策略參數(且會用能力卡)、每 boss 一張專屬能力卡 + 一張角色圖、BO 系列賽外殼、解鎖獎勵流。
- 戰役中玩家用 `equipped.avatar`,boss 用其角色圖。

---

## 7. 貨幣 / 商城 ☐ Phase(後段)

待展開重點(已定案數值):
- 每過一個小關 +10 鑽(主線一次性,同一關不重複給)。
- PvP 獲勝 +5 鑽;**同一天最多 3 勝可領(上限 15 鑽)**(與主線不衝突)。中離/斷線判給你的勝(需已開打)同樣計入。
- 商城:以鑽石購買(首個品項 = 貼圖表情)。

---

## 8. 成就系統 ☐ Phase(後段)

待展開重點:
- 引擎:對局事件(§1.1)→ 累計/判定 → 解鎖 `unlocked.achievements` → 可**裝備 3 個**於身上(進遊戲可見)。
- 例:3 連勝、同場 2 次同花順、同場 3 次葫蘆。清單屬遊戲內容。

---

## 9. 貼圖 (Emoji) ☐ Phase(後段)

待展開重點:
- 對局內傳送給對手(RTDB 即時通道)。
- 圖庫來自商城購買(鑽石)。

---

## 10. 排行榜 ☐ Phase(後段)

待展開重點:
- 主選單入口,頁籤切換:**最快/最高進度**(誰過最多關,同關比 `reachedAt`)、**最多成就解鎖數**。
- 資料:`leaderboard/byStage`、`leaderboard/byAchievements`(反正規化,見 §3)。

---

## 11. Firebase Security Rules ☐ Phase A 收尾補

待展開重點(取代現行 rooms 全開放):
- `users/{uid}`:僅 `auth.uid === uid` 可讀寫自己。
- `usernames/{name}`:已存在者不可覆寫(transaction 佔位),可讀(檢查唯一)。
- `leaderboard/*`:各人只能寫自己那筆、所有人可讀。
- `rooms/*`:維持對局同步所需的讀寫(對齊 SPEC §6.3 的 v1 取捨),但可加「限已認證」以擋亂寫。

---

## 12. 每款遊戲的「內容綁定」檢查表 ★

> 複製本平台層到新遊戲時,要填/換的東西一覽(左欄不動,只換右欄內容)。

- [ ] **能力卡清單**:定義 `cardId`、各卡效果、基底解鎖哪張、教學教哪張。
- [ ] **關卡配置**:每個 `x-y` 的 boss、AI 策略參數、BO 規則、解鎖獎勵。
- [ ] **角色/頭像資產**:每個 boss 一張角色圖 + 可解鎖頭像清單。
- [ ] **成就清單**:`achievementKey` 與判定條件(對應遊戲會發的 `stats`/事件)。
- [ ] **商城品項**:貼圖圖庫、價格、其他販售品。
- [ ] **統計欄位**:遊戲要上報哪些 `MatchStats`(供成就/排行榜)。
- [ ] **貨幣命名/數值**:是否沿用「鑽石」與 10/5/上限 50 的數值。
- [ ] **文案/主題**:合成信箱網域、遊戲名、按鈕文字。

---

## 13. 里程碑(平台層)
- **Phase A**(本輪定稿):§2 Auth、§3 Profile schema、§4 進房身分、§1 契約骨架、§11 rules 收尾。→ 可開工。
- **Phase C**:§5 能力卡系統。
- **Phase E**:§6 關卡制。
- **後段**:§7 商城貨幣、§8 成就、§9 貼圖、§10 排行榜。
