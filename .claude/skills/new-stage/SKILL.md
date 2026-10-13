---
name: new-stage
description: 主線戰役加一個新關卡(新 boss + 關卡地圖 + 商城貼圖 + 招牌特殊卡)的固定流程。使用者說「要做主線新關卡 / 加第 N 關 / 新 boss」時使用:先給表單與前面 boss 參數表讓使用者填,收到圖和表後照固定步驟做完並自測。
---

# 新增主線關卡

第 7 關(柴柴/強迫更新,commit `884831e`)就是照這份做的,不確定時去看那個 commit 的 diff。

一大關 = 一隻 boss = 三小關(`subStages()` 自動產):x-1 一般房 BO3、x-2 boss 只用招牌卡 BO3(過關解鎖招牌卡)、x-3 boss 用卡池 BO5(過關解鎖 boss 頭像),每小關首次過 +10 鑽。獎勵、卡池、解鎖都是自動推導,不用手寫。

## 1. 給使用者表單

先讀 `src/game/campaign.ts` 的 `CAMPAIGN`,**現抓**前面所有 boss 做參數表(不要用記憶裡的舊數字),連同表單一起給使用者:

| 關 | 角色 | 招牌卡 | 強攻/囤牌/平衡 | 詐唬/拼牌/鬼牌時機/看破 | 執行力 x-1/2/3 |
|---|---|---|---|---|---|

參數意思一併附上(一行一個):主風格每局抽一次(強攻=有好牌就送、囤牌=前期墊小牌後期反擊、平衡=有怪物牌才攻);詐唬=用張數裝大、拼牌=留牌等同花/順/葫蘆、鬼牌時機=關鍵時才用鬼牌、看破=從張數推理對手(不作弊);執行力=實際難度。

```
關卡名(地圖標題):
角色名(對局顯示):
主風格 強攻/囤牌/平衡(加總100):  /  /
技能 詐唬/拼牌/鬼牌時機/看破(各0~100):  /  /  /
執行力 x-1/x-2/x-3(預設 .6/.75/.9):
招牌卡:用現有的(寫卡名)或 新卡(另外口語描述)
貼圖名稱:
貼圖價格(預設60,近期80):
新卡的卡圖想法(可空,我自己畫):
```

並請使用者把 3 張圖照檔名丟進 `_art_src/stage{N}/`(已 gitignore):`boss.png`、`map.png`、`sticker.png`。綠底、浮水印、尺寸都不用先處理。

**不要問**:頭像 emoji(自己挑)、角色個性、地圖節點位置(共用 `NODE_POS`)、獎勵(邏輯固定)、公告(使用者自己補)、大廳聊天內容(新 boss 不加聊天梗)。

## 2. 收到後先回報疑點,再動手

- 表單有缺/矛盾、加總不是 100 → 問。
- **新特殊卡一定先討論規則**,每張卡機制都不一樣,不要硬套。至少問清楚:
  - 空白牌/鬼牌(玩家專屬、不在牌堆)算不算在效果裡
  - 被花色卡改過的牌怎麼處理(建議恢復原花色;id 還是原牌,保留會讓牌堆出現重複牌)
  - 什麼情況不能用(沒目標、牌堆空…)→ 擋下並 toast,不消耗卡
  - 影不影響對手(`affectsFoe`)、對手看到什麼提示、要不要動畫
  - boss 什麼時候用:x-2 本尊、x-3 本尊、其他 boss/快配人機各自的時機與機率;x-2 要不要強制用(讓玩家一定看得到)
  - 人機門面牌組(`bots.ts`)要不要帶
  - 先自己推演一下遊戲流程,有「不可能發生」的情況就直接告訴使用者不用做(例:偷窺看的補牌在自己回合就抽掉了,所以「對手重洗後偷窺失效」不會發生)

## 3. 圖

```bash
node scripts/stage-art.mjs <N> <avatarId> <stickerId>          # 預覽 → _art_src/stage{N}/_preview/
node scripts/stage-art.mjs <N> <avatarId> <stickerId> commit   # 寫進 public/
node scripts/build-img.mjs                                       # 註冊頭像後重產 webp(頭像清單讀 PlayerAvatar)
```

- avatarId 用英文小寫(如 `shiba`);stickerId = `stickers.ts` 最後一張 +1。
- 會自動:去綠背(從四邊+跟背景同色的口袋 flood,含外圈淡綠光暈)、偵測右下浮水印塗回綠再去背、貼圖連白色割線邊一起去並清碎點、透明邊補色防縮圖滲綠、boss 1150×912、地圖 1328×800 + webp、貼圖 512×512。
- **一定要目視檢查**:把預覽疊到紫底再看(檢視器會把透明區顯示成綠色,看不出去背成果):
  `ffmpeg -f lavfi -i color=c=0x6a2c8c:s=1150x1024 -i <png> -filter_complex "[0][1]overlay=0:0:shortest=1" -frames:v 1 out.png`(ffmpeg 用 `node -e "console.log(require('ffmpeg-static'))"` 拿路徑)。
- 地圖的浮水印不在綠底上,看輸出的 `浮水印掃描` 和右下角裁圖判斷;有的話加 `--heal-map x,y,w,h`。
- 尺寸、比例跟前面關卡不一樣就以現有圖為準調,使用者不滿意再微調。

## 4. 資料

- `src/game/campaign.ts`:`CAMPAIGN` 加一筆(`id/index/name/bossAvatar/bossName/signatureCard/profile/subStages('sN', N, card, avatar[, 執行力三段])/nodePositions: NODE_POS`)。
- `src/ui/components/PlayerAvatar.tsx`:`AVATAR_IMG`、`AVATAR_EMOJI`、`AVATARS`(name = 角色名)。
- `src/game/stickers.ts`:加貼圖 `{ id, name, free: false, price }`。
- 大廳 boss 名單、build-img 頭像清單、x-3 卡池、獎勵都自動,不用改。

## 5. 新特殊卡(用現有卡就跳過)

依機制分三類,工作量由少到多:

| 類 | 例 | 要改 |
|---|---|---|
| A 改花色 | 踏雪尋梅… | `specialCards.ts` 加 `suit` 即可,其他全自動 |
| B 看資訊 | 偷窺、讓我看看 | 定義 + 資訊彈窗 + boss 怎麼利用資訊 |
| C 改牌面/有隨機/打對手 | 偷天換日、強迫更新 | 下面整串 |

C 類清單(照強迫更新的做法):
1. `specialCards.ts`:`SpecialCardId` 加 id + 定義(name/short/desc/affectsFoe/needsTarget/accent)。
2. `state.ts`:純函式 `applyXxx(state, player, rng)` + `canXxx`;**隨機只呼叫 rng 一次當洗牌種子**,回放才只記一個數。
3. `replay.ts`:`buildFrames` 加分支(`replayRng(m.rng)`)+ 字幕;要動畫就設 `refreshTarget` 之類的欄位。
4. `gameStore.ts`:`chooseSpecial`(玩家用;guest 送 intent)、`aiMaybeSpecial`(AI 用)、`recordMove` 帶 `rng: rec.out`、boss 的 `spyHand/peekDraw` 快取若會失效要清。
5. `netgame.ts`:guest intent 分支(host 判定、不能用就回 fx 告知);host 打 guest 用 `sendFx(msg, card)` 讓 guest 播動畫。
6. `SpectatorGame.tsx`:觀戰收到 fx 也播動畫。
7. `bossAI.ts`:`bossChooseSpecial` 的時機規則(`opts.signature` 分辨本尊);只讀公開資訊+自己手牌。
8. `SpecialCard.tsx`:畫卡圖(SVG,0..100×118 畫布)。
9. 動畫元件掛在 `Game.tsx` 的 `.game` 裡(參考 `RefreshFx.tsx`)。
10. `bots.ts`:挑幾隻人機門面牌組加這張(快配人機實際用卡 = 玩家已解鎖池隨機 3 張,自動)。
11. `difficulty.sim.test.ts` 的 `bossSpecial` 加這張卡的套用分支(不然模擬裡 boss 用了也沒效果)。

C 類的經驗(第 8 關爆破):
- 「打對手、對方看得到結果」的卡:guest 看不到對手手牌 → guest 只送 intent,由 host 判定+算結果,再用 `sendFx(msg, { card, target, victim })` 回報;guest 的 fx 處理依 `target` 決定動畫播在哪一方。
- 被拿掉/換掉的牌用 `removedCard(before, after)` 比對出來(提示文字用 `cardFaceText`);觀戰端用前後兩個快照比對。
- 「預設型」空白/鬼牌用 `isStarterSpecial`(看 id),不要用 `isSpecial`(看 kind)——未來模式會有非預設的鬼牌/空白。
- boss 時機若是「本尊前幾手只等這張」,這段判斷要放在 `bossChooseSpecial` 其他卡判斷**之前**,而且一定要有時間上限(到第幾手就回到一般選卡),否則條件一直不成立 boss 就永遠不用卡。
- framer-motion 的 keyframes:每個屬性的陣列長度要和 `times` 一樣,`times` 最後一個要是 1。

## 6. 自測(交付前自己做足,不要叫使用者測)

- `npx tsc -b`、`npx vitest run` 全綠。新卡寫單元測試:效果、不能用的情況、回放重現、boss 時機每條規則、**幾百場 boss 對 boss 的牌守恆壓力測**(52 張普通牌不重不漏、專屬牌不進牌堆、每場打得完)。參考 `src/game/refresh.test.ts`。
- 瀏覽器(`preview_start shp-dev`,DEV 有 `window.__campaign/__game/__app/__net/__platform`):
  - 關卡列表、地圖(webp 載入、節點位置)。
  - `__campaign.getState().startSeries('sN-2', { reset: true })` → `confirmLoadout` → `finishCoinToss` → 把 engine 的 turn 設成 boss、造出觸發條件 → 看 boss 出卡、提示、牌面。
  - 線上兩個方向:host 分頁 `__net.getState().create('special', 99)` + `__app.getState().launchGame({ mode: 'host', special: true, timeLimit: 99 })`;第二個分頁開 `http://[::1]:5183`,`join(code)` + `launchGame({ mode: 'guest', ... })`。guest 出牌要用 `selected` + `confirmPick()`,不是 `submitPick`。
  - 用 host 的 `moveLog` 跑 `buildFrames`,最後一幀的雙方手牌、牌堆要跟實際一致。
  - 瀏覽器 pane 隱藏時 rAF 不跑(動畫不動、截圖常逾時):import `/node_modules/.vite/deps/framer-motion.js` 拿 `frameData/frameSteps`,用 setInterval 手動 process 各 step 來量動畫軌跡。
- 報告時誠實寫出沒能親眼確認的部分(例如動畫實際觀感)。

## 7. 收尾

- **push 前一定跑 `npx tsc -b --force` + `npm run build`**:平常的 `tsc -b` 走增量快取,可能漏檢查新檔(第 7 關就因測試檔用了 `Array.prototype.at` 讓 CI build 失敗、部署沒上)。程式裡也別用 `.at()`(專案 lib 不含)。
- 照 commit 規矩:使用者說 commit 才 commit;push 若遇到認證失敗(這個 shell 不能跳登入視窗),請使用者自己在終端機跑 `git push origin main`。
- 使用者要調難度時再跑模擬(很花時間,不要每次都跑):
  `SIM=1 SIM_N=300 npx vitest run src/game/difficulty.sim.test.ts`(PowerShell:`$env:SIM='1'; npx vitest run src/game/difficulty.sim.test.ts`),會印出全部關卡三小關的單局勝率、玩家過關率、boss 用卡率。太難就調該關 `subStages(...)` 的執行力三段。

## 坑

- PowerShell 雙引號字串裡的反引號是跳脫字元(`` `r `` 會變成換行),改程式碼用 Edit 工具,不要用 PowerShell 字串取代含反引號的內容。
- Bash 工具在中文多的指令偶爾會直接失敗,改用 PowerShell 或 Read/Grep 工具。
- 改既有的音效、圖片資產前先問使用者;新增衍生檔(webp)不算。
- 本機開發版和正式站共用同一個 Firebase:在本機用新卡打的場次會出現在正式站回放列表,還沒部署(或手機快取舊版)時舊程式看不懂。`buildFrames` 已會停在最後一個正確步驟並提示「請更新」,不用另外處理;但要記得**做完盡快 push 部署**。
