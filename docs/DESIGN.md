# Seven Hand Poker — 設計文件 (DESIGN)

> UI/UX 與版面架構的權威記錄。邏輯規則見 [SPEC.md](SPEC.md)。
> 目前**手機橫向 (以 iPhone 12 Pro 844×390 為基準) 已調校完成**;
> **電腦版採「上限流動 + 置中」策略**(見 §4),與手機共用同一套版面,手機端輸出完全不變。
> **連線對戰(建房/加房、牌局同步、情報戰、對決雙方確認、再玩一場、斷線重連)已完成**(見 §7);**下一步:GitHub Pages 部署(階段 4)**。

---

## 1. 美術方向
- 風格:**Q 版 + MSN 紅絲絨致敬**。主角 **貓 = host = p1**、配角 **鳥 = guest = p2**(固定,不再隨機)。
- 主選單:`public/title.png` 英雄圖鋪滿整個畫面,按鈕疊在上面。
- 遊戲桌面:紅絲絨(`TableBackground.tsx`,SVG 漸層 + 織紋 + 暗角 + 桌緣)。

### 可覆蓋的美術資產 (都放 `public/`)
| 檔案 | 用途 | 備註 |
|---|---|---|
| `title.png` | 主選單英雄圖(含標題) | 橫幅,`object-fit: cover` |
| `cat.png` | p1 頭像 + 擲硬幣正面 + 藍/綠牌背上的貓 | 已去背(見下) |
| `bird.png` | p2 頭像 + 擲硬幣反面 | 已去背 |
| `wood.png` | 所有木紋按鈕的貼圖 | 由 `main.tsx` 設成 CSS 變數 `--wood-tex` |
- **去背工具**:`scripts/dechroma.mjs`(綠幕→透明 + 去溢色)。原圖備份在 `public/originals/`。若日後換綠幕圖,跑 `node scripts/dechroma.mjs cat.png bird.png`。
- **牌背**:藍 / 綠兩款(`CardBack.tsx`),把 `cat.png` 合成在上面;於設定切換。

---

## 2. 設計系統 (Design Tokens) — `src/ui/theme/tokens.css`
- **字型**:`Huninn`(粉圓,圓體可愛),透過 Google Fonts `<link>` 載入(`index.html`)。變數 `--font-display` / `--font-body`。
- **紅絲絨**:`--felt-*`(deep/base/mid/glow)。
- **金色**:`--gold-1..4`。
- **木紋(按鈕)**:`--wood-1..3`、`--wood-edge`、`--wood-text`、`--wood-tex`(貼圖,runtime 設定)。
- **羊皮紙(彈窗/面板)**:`--parch-1/2`、`--parch-edge`、`--parch-text`、`--parch-muted`。
- 一處改全站換膚。

### 元件慣例
- **木紋按鈕** `Button.tsx` / `.woodbtn`:貼圖 + 深棕描邊 + 輕立體底邊(厚度已壓半)。icon 用 `<span class="woodbtn__icon">` **絕對定位靠左**(全站對齊);全寬按鈕文字置中。圖示:`Paw / IconRobot / IconDice / IconKey / IconGlobe`。
- **圓形木紋鈕**(左上選單 `.topbar__menu`、排序鈕 `.sortbtn`):同貼圖、圓形。
- **彈窗** `Modal.tsx` / `.modal__*`:羊皮紙底、深棕字。標題 `.modal__title`(遊戲內比內文大);`largeTitle` 給主選單「開始遊戲」用(更大)。**只做進場動畫,關閉即卸載**(避免背景分頁 rAF 節流導致殘留遮罩)。
- **面板** `Panel.css`(如何遊玩 / 設定):同羊皮紙風。
- 是否雙按鈕(取消/確認、離開/再玩)間距統一 `.confirm__actions { gap: 26px }`。

---

## 3. 遊戲牌桌版面架構 (重要,電腦版要沿用)

### 3.1 尺寸來源:`src/ui/hooks/useBoardSizes.ts`
依視窗算出、並在 resize 時更新:
- **關鍵:所有「橫向」尺寸都用 `ew = min(vw, WCAP)` 算,不是原始 `vw`**(`WCAP = 1000`,高於任何手機橫向寬度)。手機 `vw ≤ WCAP` → `ew === vw` → 公式與過去逐位相同;桌面 `vw > WCAP` → 橫向凍結,7 格不再攤開(見 §4)。
- `card`:全桌統一撲克牌寬。**手機上限 54px、桌面上限 66px**(`cardCap` 只在超過 WCAP 時才升高,故手機不受影響);同時受高度 (`vh*0.15`)、`ew*0.078` 與「10 張手牌不重疊」限制。金框、發牌堆、對手蓋牌、對決區牌都用這個尺寸。
- `coin`、`avatar`(垂直方向,續用 `vh`)。
- `reserve`:**左右保留區等寬**(給頭像/發牌堆/控制),讓 7 格帶置中平衡。
- `rightReserve`:手牌用的右側保留(比 `reserve` 寬,避開右下送出鈕);手牌左右 padding 用 `reserve` / `rightReserve`,所以手牌略左移但仍與對手牌對齊。
- `handMax`:手牌可用寬度(用 `ew`)。
- `bandWidth`:7 格帶寬 = 中央區(用 `ew`)的 **85%**(略收窄)。
- `stageW`:牌桌方框寬 = `ew`。手機 = 視窗寬(滿版);桌面 = WCAP(置中,兩側露紅絲絨)。以 inline style 設在 `.game` 上。

### 3.2 固定格線(關鍵:防止抖動)
`.game__band` 用 `grid-template-columns: repeat(7, {card}px)`(**固定寬**)+ `justify-content: space-between`,寬度固定 = `bandWidth`。
**牌堆用堆疊呈現**(`Pile`,小偏移 + 數字徽章),footprint 固定 = 一張牌。
→ 放牌永遠不改變格子大小,**整個牌桌不會 reflow / 抖動**(已量測放牌前後金框/排序鈕位置完全一致)。
- 堆疊方向:目前**統一往下**(碰一點中央金幣可接受)。
- 金幣 `z-index:30`、`pointer-events:none`(**倒下時蓋在牌上**,且點到金幣會穿透去觸發放大鏡看牌)。

### 3.3 版面分區(手機橫向)
```
左上 ☰選單          對手頭像(右上) + 選牌時「N 張」對話框
        對手手牌(蓋牌,鏡像:選牌往下推)
發牌堆   [ 7 格帶:上=對手 / 金幣 / 下=我方 ]   排序鈕(右,圓形圖示)
        系統提示膠囊(置中金幣列,黑透白字)
你的頭像(左下)   你的手牌            送出鈕(右下)
```
- **手牌 / 對手牌**:同尺寸同間距;≤10 張不重疊(`cardW+6`),更多才依 `handMax` 壓縮重疊。**無 hover**;選取用內外兩層 motion(外=發牌進場、內=上推),互不干擾。
- **我方放到桌上的牌**:未對決前**蓋牌**,放大鏡可看;對手的牌對決翻開才可看。
- **對手選牌**:依它**真實手牌位置**推出(鏡像往下)、頭像下顯示「N 張」。
- **排序鈕**:兩顆圓形純圖示(上=方向 ▲▼ / 下=依據 點數/花色),右上/左下錯開。
- **狀態提示**:黑透膠囊,置中金幣列,`z-index` 低於牌。
- **對決彈窗**:標題「第 X 格・對決!」;獲勝那列靠右「獲得 🪙(金幣圖)」。

### 3.4 動畫節奏(順序化,不可同時)
放置 → (若對決) 先看金幣傾倒 → 0.55s 後彈對決窗 → 關閉 → 0.48s 後補牌(離散步驟,發牌動畫才一致)。引擎以 `phase: pick/place/showdown/draw` 串接(見 SPEC 3.x)。

---

## 4. 響應式策略 — 上限流動 (bounded fluid)
- **全 App 橫向**;直向顯示「請橫置」。
- 牌桌用 `useBoardSizes` **公式化**跟著視窗算(不寫死特定手機);不同手機自動適配。
- **一套版面同時吃手機與電腦**,不寫兩套。做法:
  1. 橫向尺寸一律用 `ew = min(vw, WCAP)`(`WCAP=1000`)。手機在 WCAP 以下 → 與過去逐位相同;**手機端不受任何影響**。
  2. 桌面:牌桌方框**寬 `stageW=min(vw,1000)`、高 `stageH=min(vh,580)`**,由 `.stage`(flex `justify-content:center` + `align-items:center`)**水平+垂直雙置中**,四周露紅絲絨。7 格因此不再「像大海一樣」攤開,雙方手牌也不再離中央格太遠。
  3. 桌面卡片上限升到 66px,讓置中的桌面不會顯得太小。
- **寫死 px 不是問題**:配合 `ew` 上限,固定 px 就是「設計單位」,置中框負責其餘;這是遊戲類版面用固定 px 的正解。
- `.game`:`position:relative`,寬高以 inline 設為 `stageW/stageH`,放在 `.stage` 裡雙置中。手機時 `stageW=vw、stageH=vh` → 滿版,置中無作用 → 與舊 `position:absolute; inset:0` 視覺相同。`.topbar__menu` 由 `fixed` 改 `absolute`,桌面時跟頭像一樣貼在**牌桌**角落(手機因牌桌=視窗,位置不變)。
- **垂直間距用方框高**:`.game` 上設 CSS 變數 `--stage-w/--stage-h`(= stageW/stageH);`.sortbtns`、`.sortbtn`、`.foe-bubble` 等原本吃 `vh` 的間距改成 `calc(N% * var(--stage-h))`,讓桌面尊重收緊後的方框高。**手機因 `--stage-h==vh`,值完全不變。**
- **驗證(量測)**:手機 844×390 = 牌桌滿版、card 54、band 561、格距 31、sort 高 106/上距 78/鈕 48 —— **與改動前逐位相同**;桌面 1280×800 = 牌桌 **1000×580 雙置中**、四周 felt(左右 140、上下 110)、card 66、格距 27、手牌↔中央格距離 **35~36px**(原 145px)、sort 不溢出、無捲動。

### 4.1 對決彈窗 (ShowdownModal)
- 兩列各可放 5 張牌,獲勝列右側多一個「獲得 🪙」徽章。**桌面 520px 寬時獲勝列會超出 2px → 第 5 張換行**(輸的那列沒徽章故不換行);修法:`Modal` 加 `panelClass` prop,對決窗帶 `.modal__panel--showdown`,`@media(min-width:1024px)` 把它加寬到 **600px**(`!important` 蓋 inline `max-width`,只影響這個窗)。手機(`max-height:480` 縮到 34px 牌)本就不換行,不受影響。
- **金幣外觀**:對決窗的 `CoinIcon` 要**與桌面內的 `Coin` 同一套環**(外圈亮金漸層 `sc-ring` → 內圈深金 `#b9810f` → 面)。之前把深金畫在最外圈,在綠底上看起來像**紅圈**;桌面牌桌的金幣沒有,故對齊為亮金外圈。

---

## 5. 音效 (`src/audio/sfx.ts`,WebAudio 合成)
`click / hover(僅桌面) / select / deal / coin / showdown / win / lose`。背景音樂待使用者提供檔案。

---

## 6. 連線防作弊(v1 接受的限制)
無伺服器 → 建房方 (host) 客戶端必然握有整副牌,技術上可偷看。給朋友玩可接受(見 SPEC 6.3)。

---

## 7. 連線對戰 UI / 架構(階段 2/3)
> 邏輯、資料流、隱藏資訊策略見 [SPEC.md](SPEC.md) §6、§14;此處記 UI 與檔案分工。

### 7.1 檔案分工
| 檔案 | 職責 |
|---|---|
| `net/firebase.ts` | 延遲初始化 RTDB(單機/選單不碰 Firebase);設定來自 `.env` 的 `VITE_FB_*` |
| `net/room.ts` | 房間生命週期(建房用 transaction 搶 3 碼房號、加房、`subscribeRoom`、`onDisconnect`+`maintainPresence` 在線狀態、`markAbandoned`)、**重連指標/房主快照(sessionStorage)** |
| `net/sync.ts` | guest-view 序列化/還原(佔位牌隱藏 host 手牌/牌堆/未對決蓋牌)、`Intent` 型別 |
| `net/netgame.ts` | host↔guest 橋接(host 寫 guest-view + 消化 intent;guest 讀 view + 送 intent)、情報戰 live 節流、rematch、`tryReconnect` |
| `state/netStore.ts` | 大廳連線狀態(`window.__net`) |
| `state/gameStore.ts` | 依 `online.role` 分流動作;`applyGuestView`/`restoreOnlineHost`/`leaveOnline` |

### 7.2 UI 元件與呈現
- **大廳 `Lobby.tsx`**:**純呈現**(建/加房副作用在 Menu 按鈕 / App `?room=` 深連結觸發,避開 StrictMode 雙呼叫)。房主顯示 3 碼房號 + 複製邀請連結;雙方頭像(貓/鳥)+ 連線狀態;短螢幕(`max-height:480`)有精簡版避免裁切。
- **情報戰即時**:對手選牌/排序即時同步,用 `OpponentHand` 既有**彈簧動畫「滑動」**呈現(非瞬移);節流 ~0.7s;選 0 張 = 清除(RTDB 不存空陣列,讀端一律 `?? []`)。
- **對決雙方確認**:各自按「繼續」;先按者關窗看牌 + 顯示「等待對手確認…」中央膠囊;兩邊都按才前進。
- **再玩一場**:雙方同意才開新局;結束窗顯示「對手想再玩一場!」/「等待對手同意…」。
- **擲硬幣**:雙方各自播同一結果動畫;**重連時跳過**。
- **斷線/離開 overlay(`Game.tsx`)**:對手**主動離開**→「對手已離開遊戲」(不倒數,只有返回鈕);對手**掉線**→「等待重連 1:30」倒數 + **「離開遊戲」按鈕(可主動脫身、不用罰站)**。

### 7.3 狀態儲存(重連)
- **重連指標** `shp.session={code,role}` 與**房主完整引擎快照** `shp.host.{code}` 存 **`sessionStorage`**(每分頁獨立、重整保留、關分頁清除;與 clientId 一致)。
  - ⚠️ **不可用 localStorage**:它跨分頁共享,guest 加入會覆蓋 host 的指標,導致房主重連失敗(踩過)。
- 牌局狀態:**host** 在記憶體 + sessionStorage 快照;**guest** 不存牌局,只讀 RTDB guest-view。
- 指標存在 = 意外斷線 → 接回;按「離開遊戲」會清指標 + 寫 `abandoned` → 不接回。
