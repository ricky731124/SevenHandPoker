/* ============================================================================
 * 大廳聊天內容庫（種子版）  ——  docs/LOBBY-AI-SPEC.md §13
 * ----------------------------------------------------------------------------
 * 這是「純資料」檔，改這裡不用動任何程式邏輯，存檔重整就生效。
 *
 * ■ 一句話 line 的欄位（只有 t 或 sticker 必填其一，其餘選填）：
 *     { t:'句子', w?:權重, guard?:'出現條件', cta?:'按鈕', ctaChance?:0~1, opener?:false }
 *     { sticker:'like' }                      ← 人機直接回一張貼圖
 *   · w        權重，越大越常被抽中（特殊梗設小、百搭句設大）。預設 1。
 *   · guard    符合條件才會出現（見下）。不填 = 隨時可出。
 *   · cta      掛按鈕；可陣列（例 ['register','google'] 兩顆）。
 *   · ctaChance 這句掛按鈕的機率；不填 = 用 config.ctaChance 的預設。
 *   · opener:false  這句「不要」自動前綴語助詞。
 *
 * ■ 佔位符（host 發送前填實值；用不到的別放，放了值取不到那句會自動跳過）：
 *   {name} 對方名 · {streak} 目前連勝 · {bestStreak} 最高連勝 · {wins} 勝場 · {games} 場次
 *   {winRate} 勝率% · {achv} 他展示的一個成就名(含銅銀金) · {loadoutCard} 他預設特殊牌之一
 *   {stageNo} 他在打第幾關 · {bossName}{bossCard}{bossStyle}{bossSkill} 那關BOSS的名/招牌卡/風格/絕招
 *   {onlineCount} 線上人數 · {newcomerName} 剛上線的人 · {lastWinner}{lastLoser} 剛剛誰贏誰輸 · {idleName} 潛水的人
 *   {anyCard} 隨機特殊牌名 · {anyBoss} 隨機BOSS名 · {anySticker} 隨機貼圖名 · {opener} 語助詞 · {invite} 邀約短語
 *
 * ■ guard 條件（用 && 串接，例 '!hasLoadout && afterStage:1-2'）：
 *   guest/registered · showsAchv/silverAchv/goldAchv(有展示成就/銀以上/金) · hasLoadout(有設預設特殊牌)
 *   hasBoss(算得出他在打哪關) · hasLive(現在有直播可看) · morning/night(早上5~11/深夜0~5)
 *   streak>=N · bestStreak>=N · wins>=N · games>=N · winRate>=N · beforeStage:1-3 / afterStage:1-2
 *
 * ■ cta 可用按鈕：register, google, quickmatch(隨機房)/quickmatch-normal/quickmatch-special,
 *   campaign, tutorial, personalize, loadout, achvShow, leaderboard, replays, daily, shop, spectate
 *
 * ■ 想加內容：找到對應的陣列，多塞一行 { t:'…' } 即可。要新關鍵字類別→在 keywords 加一條
 *   {any/all, intent} 再到 kwPools 開同名池。要新劇場→在 threads 加形狀、在 beatPools 開池。
 * ========================================================================== */

export type LobbyCtaSpec = string | string[]

export interface Line {
  t?: string
  sticker?: string
  w?: number
  guard?: string
  cta?: LobbyCtaSpec
  ctaChance?: number
  opener?: boolean
  topic?: string // 主題（同主題短時間內不重複）；不填 = 程式自動判斷(特殊牌/BOSS/貼圖/回放/排行/老大)
}
export interface ThreadBeat {
  role: string
  pool?: string   // 從 beatPools 隨機抽（會用 w 加權）
  t?: string      // 固定死句（這一拍講死的一句）
  sticker?: string // 固定貼圖
  lines?: Line[]  // 內嵌加權選項（不用另開池，直接寫幾句，各自給 w 決定機率）
  chance?: number // 這一拍出現的機率 0~1（不填=一定出；用來做「不一定有 C」）
}
export interface ThreadShape { id?: string; topic?: string; slots?: Record<string, 'anyCard' | 'anyBoss' | 'anySticker'>; beats: ThreadBeat[] }
export interface KwRule { any?: string[]; all?: string[]; intent: string; w?: number }
export interface ReactRule { when?: string; say: Line[]; cta?: LobbyCtaSpec; ctaChance?: number; exclusive?: boolean }
export interface ChatConfig {
  openerChance?: number
  pileOnChance?: number
  cooldownSize?: number
  topicCooldown?: number
  ambientWeights?: { thread?: number; single?: number; sticker?: number; proactive?: number }
  ctaChance?: Record<string, number>
  owners?: string[] // 這些「帳號」發言時 guard:isOwner 會成立 → 走專屬彩蛋句
}
export interface ChatContent {
  config: ChatConfig
  fragments: Record<string, string[]>
  greetings: Line[]
  singles: Line[]
  threads: ThreadShape[]
  beatPools: Record<string, Line[]>
  ambientStickers: string[]
  stickerReplies: Record<string, Line[]>
  keywords: KwRule[]
  kwPools: Record<string, Line[]>
  reactRules: ReactRule[]
  proactive: Record<string, Line[]>
  pileOn: Line[]
}

const CHAT: ChatContent = {
  // ── 全域機率/節奏旋鈕（要調就改這裡）──────────────────────────────────────
  config: {
    openerChance: 0.35, // 單句自動前綴語助詞的機率
    pileOnChance: 0.2, // 回真人後「第二隻人機補刀」的機率
    cooldownSize: 30, // 聊天室最近 30 則講過的句子/劇場先不重複（記在聊天紀錄裡，換 host、重整都接得上）
    topicCooldown: 8, // 最近 8 則聊過的「主題」(特殊牌/BOSS/貼圖/回放…)先換別的話題，閒聊才不會一直繞同一件事
    ambientWeights: { thread: 5, single: 3, sticker: 1, proactive: 2 }, // 沒事閒聊時各類比重
    ctaChance: {
      // 每種按鈕「預設」掛出的機率（單句可用 ctaChance 覆寫）
      tutorial: 0.9, register: 0.85, spectate: 0.7, campaign: 0.6, loadout: 0.6,
      google: 0.5, personalize: 0.4, daily: 0.4, achvShow: 0.4,
      quickmatch: 0.4, leaderboard: 0.3, replays: 0.3, shop: 0.3,
    },
    owners: ['ricky'], // 你的帳號 → 發言時觸發專屬彩蛋（見 kwPools 的 guard:'isOwner' 句）
  },

  // ── 碎片：可安全前綴/內插的小詞（語氣中性）；opener 你可擴到 200+ ──────────
  fragments: {
    // opener = 純語氣詞：會「隨機前綴」到單句(40%)。招呼型(hi/安安/Bonjour…)已搬到 greetings。
    opener: ['欸!', '欸欸欸', '唷', '唷厚', '呀咧呀咧!', '哇!', '哇哇', '靠~', '話說', '來啦', '來啦來啦', '誒誒', '哈~', '唉唷', '嘖嘖..', '欸你們', '誒', '嘿', '嘿嘿', '咦', '疑', '好唷!', '哼!', '哼哼', '喔喔', '哈', '哈哈', '哈哈哈'],
    // invite = 接在逗號後的「短述詞」(句子裡寫 {invite} 才會用)。整句型口號已搬到 singles。
    invite: ['要不要來一場', '來場快速配對吧', '開一場啦', '手癢了嗎', '來對戰啦', '陪我打一場呀', '玩一局呀', '對戰對戰', '決鬥吧遊戲BOY', '我想對戰', '要不我來教你幾招'],
  },

  // ── 冷場首句（招呼）──────────────────────────────────────────────────────
  greetings: [
    { t: '安安大家好～' },
    { t: '有人在嗎，來一場啊' },
    { t: '我來囉，今天誰要挑戰我' },
    { t: '剛上線，牌運如何啊各位' },
    { t: '等等要不要開一局' },
    { t: '哈囉哈囉，我又來報到了' },
    { t: '大家好呀，今天有什麼好玩的嗎' },
    { t: '登入！準備開戰' },
    { t: '誰沒到的，我點名一下' },
    { t: '大家安，缺不缺人啊' },
    { t: '我上線囉，有沒有人要單挑' },
    { t: '哈囉哈囉，久等了嗎（沒人在等吧）' },
    { t: '安安，我來湊個人數' },
    { t: '路過，順便看看有沒有肉腳（開玩笑的）' },
    { t: '嗨，剛好路過來一場' },   
    { t: '上線領鑽石!' },   
    { t: '又上來解每日任務了' },   
    { t: '都看看是誰來了' },
    { t: '有人在嗎' },
    { t: 'HI～今天誰要跟我開房(羞)' },
    { t: '安安~我來湊一咖' },
    { t: '安捏~大家安' },
    { t: 'Bonjour，來一場？' },
    { t: '空你幾哇，我上線了' },
    { t: '歐hi唷，各位' },
    // ↓ 量產第 1 批（2026-10 使用者審過）
    { t: '晚上好～我來了', guard: 'evening' },
    { t: '早安各位，今天誰要先開', guard: 'morning' },
    { t: '大家今天過得怎樣' },
    { t: '又見面了各位' },
    { t: '我回來了，有想我嗎' },
    { t: '今天也要贏' },
    { t: '來了來了，先打一場暖身' },
    { t: '我上線了，牌桌見' },
  ],

  // ── 環境單句（自己聊 / tips / 話題）；可帶佔位與 cta ────────────────────────
  singles: [
    { t: '摸魚中，順便等對手' },
    { t: '今天目標連勝五場（應該啦）' },
    { t: '排行榜我又掉下去了，得拼一下', cta: 'leaderboard' },
    { t: '點自己頭像也能開個人化設定喔', cta: 'personalize' },
    { t: '三條CP值超高，耗牌少又能贏多數非五張牌' },
    { t: '重點在觀察對手是強攻流還是囤牌流' },
    { t: '鐵支只要四張牌就能觸發' },
    { t: '原來對子相同的話先比踢腳牌再比花色喔' },
    { t: '你們有遇到鬼牌對鬼牌嗎，結果很有趣唷' },
    { t: '對方起手就放5張壓力很大' },
    { t: '特殊房的好處就是可以靠特殊牌扭轉戰局' },
    { t: '特殊牌也可以用來延續優勢' },
    { t: '來都來了，就別走了' },
    { t: '愈想愈不對勁' },
    { t: '友誼的小船說翻就翻', cta: 'quickmatch' },
    { t: '根據我的大數統計，先攻有87%的勝率' },
    { t: '英國短毛貓都會偷囤牌' },
    { t: '英短貓長的很像大叔' },
    { t: '鳥鳥只會強攻，很容易後繼無力' },
    { t: '北極熊相較前兩關是個平衡型的BOSS' },
    { t: '別只顧著搶四個金幣，連成相鄰三格也能贏喔' },
    { t: '初學的話先照新手教學走一遍呀，比較容易上手', cta: 'tutorial' },
    { t: '「{anyBoss}」好難打唷' },
    { t: '「{anyCard}」好用嗎?' },
    { t: '卡在「{anyBoss}」的關卡好久唷' },
    { t: '「{anyCard}」唯一真愛，不解釋', opener: false },
    { t: '有人要來一場嗎，手癢了', cta: 'quickmatch' },
    { t: '當你在場上找不到肥羊的時候...', cta: 'quickmatch-special' },
    { t: '大吉大利 今晚吃雞' },
    { t: '就缺你一個了', cta: 'quickmatch' },
    { t: '我開局你作弊這是個諷刺的交集', cta: 'quickmatch-special' },
    { t: '天快亮了你的局呢', cta: 'quickmatch' },
    { t: '今天工作超忙' },
    { t: '昨天不是說好今天不見不散的!!' },
    { t: '我是預言家，我大膽預言你已經上線了' },
    { t: '我看見了五分鐘後的你已經輸了', cta: 'quickmatch-special', ctaChance: 1 },
    { t: '海水退了就知道誰沒穿褲子了', cta: 'quickmatch', ctaChance: 0.7 },
    { t: '我來啦，誰敢應戰', cta: 'quickmatch', ctaChance: 0.3 },
    { t: '早安各位，開工前先來一場暖身', guard: 'morning' },
    { t: '早啊，這麼早就有人在線了', guard: 'morning' },
    { t: '早安！今天想從連勝開始', guard: 'morning' },
    { t: '真是個昏昏欲睡的時段', guard: 'afternoon' },
    { t: '這時間適合摸魚一下', guard: 'afternoon' },
    { t: '午安唷', guard: 'afternoon' },
    { t: '我媽叫我去吃飯了', guard: 'evening' },
    { t: '這時間人怎麼這麼多', guard: 'evening' },
    { t: '是不是這樣的夜晚你才會這樣的想起我', guard: 'evening' },
    { t: '晚安呀 各位', guard: 'evening' },
    { t: '這麼晚還在線，都是真愛玩家', guard: 'night' },
    { t: '深夜報到，睡不著就來一場吧', guard: 'night' },
    { t: '夜貓子上線，有沒有同類', guard: 'night' },
    { t: '每天記得簽到，別浪費免費資源', cta: 'daily' },
    { t: '誰來陪我解對戰任務呀', cta: 'quickmatch' },
    { t: '設好預設特殊牌，每場開局自動帶超省事', cta: 'loadout' },
    { t: '我都習慣先調好常用的牌，好用的就那幾張呀', cta: 'loadout' },
    { t: '特殊牌會跟著對手有沒有而決定能不能使用' },
    { t: '成就掛在名片上真的比較帥，去解幾個', cta: 'achvShow' },
    { t: '大家都展示什麼成就呀', cta: 'achvShow' },
    { t: '聽說連老大都還沒解過狹路相逢', cta: 'achvShow' },
    { t: '不確定怎麼玩可以先看看別人怎麼打', cta: 'spectate', guard: 'hasLive' },
    { t: '有人在對決耶，來偷看一下', cta: 'spectate', guard: 'hasLive' },
    { t: '回放功能可以拿來檢討自己輸在哪', cta: 'replays' },
    { t: '看別人的回放很有趣', cta: 'replays' },
    { t: '我以為我的牌很爛，結果看回放對方的更差', cta: 'replays' },
    { t: '對戰記錄只留最新的8筆好少唷', cta: 'replays' },
    { t: '商城偶爾會有限定貼圖，手滑一下也還好', cta: 'shop' },
    { t: '大家喜歡商城的什麼貼圖呀', cta: 'shop' },
    { t: '特殊房比較刺激，敢來就來', cta: 'quickmatch-special' },
    { t: '「{anyCard}」這張其實很萬用，帶著不吃虧' },
    { t: '別小看鬼牌，關鍵時刻補洞超好用' },
    { t: '空白牌適合拿來墊牌或詐唬' },
    { t: '開張6給他讓他贏莊家100塊' },
    { t: '信不信我能變張3出來' },
    { t: '在場有沒有人叫今晚打老虎的呀' },
    { t: '師兄必勝!' },
    { t: '想不到今天連這種爛牌都能湊出來' },
    { t: '想不到我白眉鷹王一世英名' },
    { t: '一直配對不到人，有活人嗎' },
    { t: '我一步都沒退，這樣判我輸唷' },
    { t: '10分裡面我給10分' },
    { t: '在想要不要換個頭像換換手氣' },
    { t: '強也是一種罪的話...我們就土城見了' },
    { t: '「{anyCard}」聽說很好用' },
    { t: '打{anyBoss}那關卡好久，有人破解方法嗎' },
    { t: '「{anySticker}」這張貼圖我超愛用' },
    { t: '有沒有人跟我一樣覺得「{anyCard}」被低估了' },
    { t: '{anyBoss}的招牌卡真的機車，慎入' },
    { t: '獨孤求敗！有人能陪我一場嗎', cta: 'quickmatch' },
    { t: '強者總是孤獨的…所以來一場吧', cta: 'quickmatch-special', ctaChance: 0.7 },
    { t: '一言不合就對戰，來', cta: 'quickmatch', ctaChance: 0.9 },
    { t: '眼神接觸就是信號，開打', cta: 'quickmatch-special', ctaChance: 0.9 },
    { t: '我在大都等你', cta: 'quickmatch', ctaChance: 0.3 },
    { t: '我開局不來算你輸', cta: 'quickmatch', ctaChance: 0.7 },
    { t: '幾分鐘後你就會崇拜我了，敢來嗎', cta: 'quickmatch', ctaChance: 0.8 },
    { t: '做人如果沒有夢想，那跟鹹魚有什麼分別！' },
    { t: '是不是想虐我？來啊', cta: 'quickmatch', ctaChance: 0.6 },
    // ↓ 量產第 1 批（2026-10 使用者審過）
    // 牌局心得 / 牌型
    { t: '剛剛差一點點就雙同花順了，心好痛' },
    { t: '今天的牌運，十分裡的十分' },
    { t: '師父告訴我手拿AK不賭是棒槌' },
    { t: '囤牌流打久了真的會上癮' },
    { t: '先手直接放五張，到底是勇還是莽' },
    { t: 'How to lose ?' },
    { t: '這邊也有投降輸一半的嗎' },
    { t: '手上一堆散牌，這局改玩牌七好了' },
    { t: '同花其實比想像中好湊' },
    { t: '順子最怕卡中間那張' },
    { t: '適當放掉一格反而能贏整盤' },
    { t: '這遊戲最難的是忍住不放牌' },
    { t: '對面一直不出牌，我開始緊張了' },
    { t: '鐵支一出，不死也哭' },
    { t: '這手牌好到我不敢相信' },
    { t: '這局穩了……吧？' },
    { t: '牌桌上沒有朋友（認真）' },
    // 特殊牌（會自動歸到「特殊牌」主題，8 則內不會連著聊）
    { t: '「{anyCard}」用錯時機根本浪費' },
    { t: '一張「{anyCard}」救了我一整場' },
    { t: '今天就決定帶「{anyCard}」了' },
    { t: '「讓我看看」偷看完對手的牌，心情更差了XD' },
    { t: '改一張花色就湊成同花，太賊了' },
    // BOSS / 主線
    { t: '打{anyBoss}那關我打了快十次' },
    { t: '{anyBoss}看起來很可愛，打起來一點都不可愛' },
    { t: '我覺得{anyBoss}的牌風最難摸' },
    { t: '主線第一章打完才算入門吧', cta: 'campaign' },
    { t: '新手教學跑一遍真的比亂打有用', cta: 'tutorial', ctaChance: 0.5 },
    // 貼圖
    { t: '先說好，輸的人要發「{anySticker}」' },
    // 心情 / 日常
    { t: '我先去抽根煙冷靜一下，回來繼續' },
    { t: '拿首勝就收工……這是我第三次這樣說' },
    { t: '連輸三場，先冷靜一下' },
    { t: '輸給電腦不丟臉，輸給朋友才丟臉' },
    { t: '找朋友開房比較好玩，可以互嗆' },
    { t: '這個時間點還在的都是高手吧' },
    // 帶按鈕的
    { t: '每日任務解完沒，鑽石不拿白不拿', cta: 'daily' },
    { t: '剛解了一個成就，爽', cta: 'achvShow', ctaChance: 0.3 },
    { t: '排行榜前幾名都是怪物吧', cta: 'leaderboard' },
    { t: '一般房練手感，特殊房練心臟', cta: 'quickmatch' },
    { t: '想換個牌背轉轉運', cta: 'personalize', ctaChance: 0.4 },
    { t: '名片上的成就就是門面啊', cta: 'achvShow', ctaChance: 0.3 },
    { t: '看回放才發現我那步走錯了', cta: 'replays', ctaChance: 0.3 },
    { t: '剛剛那局要是有錄起來就好了…喔對，有回放', cta: 'replays' },
    { t: '有人跟我一樣喜歡看別人對戰嗎', cta: 'spectate', guard: 'hasLive' },
    { t: '現在有人在打，好像很激烈', cta: 'spectate', guard: 'hasLive' },
  ],

  // ── 多句劇場（形狀定死走向、每拍從 beatPools 隨機抽；A/B/C 指派給不同人機）──
  threads: [
    // 固定劇場（beat 直接寫 t = 講死句，不用開池）。
    { id: 'skit_flush_fullhouse', beats: [
      { role: 'A', t: '同花打不打得過 Full House？' },
      { role: 'B', t: '那除非你老爸變成了兔子!' },
      { role: 'A', t: '那同花再加順子打不打得過啊?' },
    ] },
    { id: 'skit_arrow', beats: [            // 已改名(原 skit_flush_fullhouse)
      { role: 'A', t: '一支穿雲箭!' },
      { role: 'B', t: '千軍萬馬來相見！' },
    ] },
    { id: 'skit_ace', beats: [            // 已改名(原 skit_flush_fullhouse)
      { role: 'A', t: '這裡有張A士，只要我輕輕的一嚕' },
      { role: 'A', t: '就立刻變成了一張……皺了的A士！' },
      { role: 'A', t: '因為我還沒發功啊！我一發功，還可以變出一副麻將出來呢！' },
    ] },
    { id: 'skit_balance', beats: [            // 已改名(原 skit_flush_fullhouse)
      { role: 'A', t: '這遊戲平衡性不行呀，連第一關的BOSS都這麼難' },
      { role: 'B', t: '連我這個賣車的都知道遊戲一定沒做好平衡測試' },
      { role: 'C', t: '還好這邊還有個賣車的，不然都沒人發現遊戲平衡出問題了' },
    ] },
    // 混合劇場：A 固定 / B 內嵌加權(w，70/20/10) / C 不一定出現(chance)
    { id: 'skit_flush_weighted', beats: [
      { role: 'A', t: '同花打不打得過 Full House？' },
      { role: 'B', lines: [
        { t: '閉嘴！老梗了', w: 70 }, // 70%
        { t: '...', w: 30 },        // 30%
      ] },
      { role: 'C', chance: 0.6, lines: [           // chance:0.6 → 60% 才會有 C(不一定有)
        { t: '管理員該出來維持秩序了' },
      ] },
    ] },
    { id: 'skit_123', beats: [             // 已改名(原 skit_flush_weighted)
      { role: 'A', t: '123' },
      { role: 'B', lines: [
        { t: '456', w: 70 },
        { t: '木頭人', w: 20 },
        { t: '到台灣', w: 10 },
      ] },
      { role: 'C', chance: 0.8, lines: [
        { t: '789', w: 60 },
        { t: '??', w: 40 },
      ] },
    ] },
    // 多劇場池
    { id: 'complain_console_rally', beats: [{ role: 'A', pool: 'complain' }, { role: 'B', pool: 'console' }, { role: 'C', pool: 'rally' }] },
    { id: 'brag_snark_giveup', beats: [{ role: 'A', pool: 'brag' }, { role: 'B', pool: 'snark' }, { role: 'C', pool: 'giveup' }] },
    // 聊特殊卡（問→答→反應都講同一張 {card}）
    { id: 'skit_specialcard', slots: { card: 'anyCard' }, beats: [{ role: 'A', pool: 'ask_card' }, { role: 'B', pool: 'answer_card' }, { role: 'C', pool: 'react_card' }] },
    // 聊商城貼圖（共用一個貼圖名 {sticker}）
    { id: 'skit_shop', slots: { sticker: 'anySticker' }, beats: [{ role: 'A', pool: 'shop_ask' }, { role: 'B', pool: 'shop_reco' }] },
    // ↓ 量產第 1 批（2026-10 使用者審過）
    // 聊某隻 BOSS（{boss} 三拍共用同一隻）
    { id: 'boss_talk', slots: { boss: 'anyBoss' }, beats: [{ role: 'A', pool: 'ask_boss' }, { role: 'B', pool: 'answer_boss' }, { role: 'C', pool: 'react_boss', chance: 0.7 }] },
    // 炫運氣 → 眼紅 → 酸一句
    { id: 'luck_show', beats: [{ role: 'A', pool: 'show_luck' }, { role: 'B', pool: 'jealous' }, { role: 'C', pool: 'luck_end', chance: 0.6 }] },
    // 輸了要復仇 → 接受 → 路人起鬨
    { id: 'rematch', beats: [{ role: 'A', pool: 'want_rematch' }, { role: 'B', pool: 'accept_rematch' }, { role: 'C', pool: 'crowd', chance: 0.6 }] },
    // 貼圖大戰（只用免費貼圖）
    { id: 'sticker_war', beats: [
      { role: 'A', lines: [{ sticker: 'angry' }, { sticker: 'wow' }] },
      { role: 'B', lines: [{ sticker: 'smile' }, { sticker: 'like' }] },
      { role: 'C', chance: 0.5, lines: [{ t: '你們是在用貼圖吵架嗎' }, { t: '貼圖大戰開始' }, { t: '我也要加入' }] },
    ] },
    // 暫離
    { id: 'brb', beats: [{ role: 'A', pool: 'brb' }, { role: 'B', pool: 'brb_reply' }] },
    // 新手問牌型（問答要對得上 → 每題一個劇場）
    { id: 'newbie_flush', beats: [
      { role: 'A', t: '同花跟順子誰大啊' },
      { role: 'B', lines: [{ t: '同花比較大' }, { t: '同花大，順子小，記住了' }, { t: '這題我會，同花！' }] },
      { role: 'C', chance: 0.5, lines: [{ t: '新手教學裡有牌型表喔', cta: 'tutorial' }, { t: '對，對局裡按「?」也查得到牌型' }] },
    ] },
    { id: 'newbie_trips', beats: [
      { role: 'A', t: '三條跟兩對哪個大' },
      { role: 'B', lines: [{ t: '三條大' }, { t: '三條，而且三條只要三張牌' }, { t: '三條啦，兩對比較小' }] },
      { role: 'C', chance: 0.4, lines: [{ t: '三條 CP 值真的高' }] },
    ] },
    // 特殊房 vs 一般房
    { id: 'room_debate', beats: [{ role: 'A', pool: 'special_hype' }, { role: 'B', pool: 'special_reply' }, { role: 'C', chance: 0.5, lines: [{ t: '走，特殊房見', cta: 'quickmatch-special' }, { t: '我兩種都打，看心情' }] }] },
    // 鼓山金城武傳說
    { id: 'gm_rumor', topic: 'gm', beats: [{ role: 'A', pool: 'gm_rumor' }, { role: 'B', pool: 'gm_react' }, { role: 'C', pool: 'gm_brave', chance: 0.5 }] },
    // 特殊牌辯論（{card} 三拍共用同一張）
    { id: 'card_debate', slots: { card: 'anyCard' }, beats: [{ role: 'A', pool: 'card_claim' }, { role: 'B', pool: 'card_counter' }, { role: 'C', pool: 'card_end', chance: 0.5 }] },
  ],
  beatPools: {
    complain: [{ t: '差一張就讓我賭到同花了，可惡' }, { t: '對手把特殊牌扣到最後才用，賊' }, { t: '對手這麼多同花是開花店的嗎' }, { t: '我懷疑對手作弊!' }, { t: '怎麼每次牌都這麼爛' }, { t: '補牌一直補到廢牌' }, { t: '一直輸..' }],
    console: [{ t: '遊戲就是這樣，差一步差很多' }, { t: '運氣不如人啦' }, { t: '別多想了，牌品見人品' }, { t: '明天會更好' }, { t: '輸了牌局贏了朋友' }],
    rally: [{ t: '有賭未必輸，再來一場' }, { t: '該休息了啦你' }, { t: '沒關係，你實力本來就這樣（誤）' }, { t: '先去玩新手教學吧' }, { t: '我陪你打一場，輸了別哭' }, { t: '去主線練一下再回來' }],
    brag: [{ t: '我最近手氣有夠旺' }, { t: '又連勝啦，誰來擋一下' }, { t: '不知道輸字怎麼寫' }, { t: '今天的我沒有極限' }, { t: '今天的我無人能擋' }],
    snark: [{ t: '講這麼大聲，等等別輸喔' }, { t: '嘴上連勝的通常…你懂的' }, { t: '你等著，我去叫鼓山金城武來' }, { t: '記錄就是用來破的' }, { t: '上次你也這樣說' }, { t: '截圖存證，等等看你怎麼收場' }],
    giveup: [{ t: '好棒棒唷' }, { t: '又有人在發連勝文了' }, { t: '好啦你最強' }, { t: '我不想說話' }, { t: '…（默默按下配對）' }],
    ask_card: [{ t: '你們打{anyBoss}都帶什麼特殊牌' }, { t: '哪張特殊牌最好用啊' }, { t: '「{card}」到底神在哪' }],
    answer_card: [{ t: '「{card}」唯一真神，解成就都靠它' }, { t: '我都帶「{card}」打爆BOSS' }, { t: '「{card}」蠻百搭的吧' }],
    react_card: [{ t: 'OKOK 筆記' }, { t: '靠，我還沒有「{card}」' }, { t: '帶「{card}」勝率超差耶，我不信!' }],
    shop_ask: [{ t: '你覺得「{sticker}」貼圖好用嗎' }, { t: '我最愛用「{sticker}」' }, { t: '「{sticker}」必買吧' }, { t: '「{sticker}」很蠢耶 哈' }],
    shop_reco: [{ t: '我也超愛「{sticker}」' }, { t: '「{sticker}」洗一排超好笑' }, { t: '鑽石不夠多呀' }],
    // ↓ 量產第 1 批的新劇場用的池（2026-10 使用者審過）
    ask_boss: [{ t: '{boss}那關有人過了嗎' }, { t: '打{boss}都帶什麼牌啊' }, { t: '{boss}到底在強什麼' }, { t: '我卡在{boss}好幾天了' }],
    answer_boss: [{ t: '{boss}要先觀察牠的牌風再出手' }, { t: '我過了，運氣成分很大' }, { t: '{boss}不難，別跟牠硬拚' }, { t: '我也卡過，多打幾次就摸熟了' }],
    react_boss: [{ t: '好，我再去試一次' }, { t: '聽起來還是很難…' }, { t: '真的假的，我怎麼一直輸' }, { t: 'OK 學到了' }],
    show_luck: [{ t: '剛剛起手就聽二五八萬' }, { t: '我剛剛滿手都是鬼牌' }, { t: '剛剛一路補牌補成同花順了' }],
    jealous: [{ t: '共三小' }, { t: '這不公平' }, { t: '87' }],
    luck_end: [{ t: '一堆雲玩家' }, { t: '截圖了嗎，沒圖沒真相' }, { t: '去買樂透吧' }],
    want_rematch: [{ t: '剛剛連輸三場，不甘心' }, { t: '再一場' }, { t: '我要替我婆婆報仇' }],
    accept_rematch: [{ t: '來啊誰怕誰' }, { t: '人類的棋局只是在汙染我的人工智慧' }, { t: '好，最後一場' }],
    crowd: [{ t: '我要看' }, { t: '...' }, { t: '雞排珍奶準備好了' }],
    brb: [{ t: '我去抽煙' }, { t: '等我一下，外送到了' }, { t: '廁所' }],
    brb_reply: [{ t: '快去快回' }, { t: '等你回來我已經連勝了' }, { t: '去吧，靠你幫我解任務了' }],
    special_hype: [{ t: '特殊房今天好熱鬧' }, { t: '剛在特殊房被翻盤，好氣' }, { t: '特殊房的節奏好快' }],
    special_reply: [{ t: '特殊房才是本體' }, { t: '我還是喜歡一般房' }, { t: '特殊房比較吃運氣啦' }],
    gm_rumor: [{ t: '聽說鼓山金城武今天會上線' }, { t: '鼓山金城武又刷新紀錄了' }, { t: '有人看到鼓山金城武嗎' }, { t: '辣個不能說的男人呢' }],
    gm_react: [{ t: '哪有賭徒天天輸' }, { t: '那我先下線了' }, { t: '他來我就跑' }],
    gm_brave: [{ t: '怕什麼，我來單挑他' }, { t: '竟敢對創世者不敬!' }],
    card_claim: [{ t: '「{card}」是最強的特殊牌，不接受反駁' }, { t: '我覺得「{card}」被高估了' }, { t: '「{card}」到底什麼時候用最好' }],
    card_counter: [{ t: '「{card}」看時機啦' }, { t: '不同意，「{card}」很吃運氣' }, { t: '我拿「{card}」贏過好幾次' }],
    card_end: [{ t: '你們兩個去單挑決定吧' }, { t: '吵完了沒，來打一場', cta: 'quickmatch-special' }],
  },

  // ── 環境閒聊時，人機隨機發的貼圖（只用免費 8 張，聊天看得清）─────────────────
  ambientStickers: ['smile', 'like', 'wow', 'heart'],

  // ── 收到某張貼圖 → 的回應池（可回字、也可回貼圖）。'*' = 沒對應時的通用池 ──────
  stickerReplies: {
    smile: [{ t: '{name}心情不錯喔，來一場？', cta: 'quickmatch' }, { sticker: 'smile' }, { t: '笑什麼笑，開打啦', cta: 'quickmatch' }, { t: '^-^' }],
    cry: [{ t: '別難過，下一場運氣會來的' }, { sticker: 'heart' }, { t: '{name}拍拍，再讓我虐一場吧', cta: 'quickmatch' }, { t: 'QQ' }],
    wow: [{ t: '嚇到了吧，這就是實力' }, { sticker: 'wow' }, { t: '基本操作，不要大驚小怪' }],
    angry: [{ t: '別氣別氣，牌品見人品' }, { sticker: 'smile' }, { t: '^-^' }],
    thanks: [{ t: '不客氣啦' }, { t: '小事，多交流呀' }, { t: 'you are welcome' }],
    like: [{ sticker: 'like' }, { t: '有默契喔{name}' }, { t: 'GOOD' }],
    heart: [{ sticker: 'heart' }, { t: '愛你喔，來一場啦', cta: 'quickmatch' }, { t: '我戀愛了' }],
    bye: [{ sticker: 'bye' }, { t: '掰啦，下次再電你' }, { t: '881' }, { t: 'ㄅㄅ' }, { t: '8~' }],
    '*': [{ t: '收到貼圖，那來對戰吧', cta: 'quickmatch' }, { sticker: 'like' }],
  },

  // ── 關鍵字（中文字元共現：any=任一命中、all=全部都要有；命中後取 w 最大的那條）──────
  //   ▸ w 越大越優先(平手取先出現的)。想刪整類 → 這裡刪一條 + 下面 kwPools 刪同名池。
  keywords: [
    { any: ['機器人', 'bot', '真人嗎', '是ai', '是 ai'], intent: 'kw_botq', w: 9 }, // 🔒問是不是機器人→裝傻,絕不承認
    { all: ['玩'], any: ['怎', '如何', '不會', '教學', '規則'], intent: 'kw_howto', w: 6 },          // 問怎麼玩
    { any: ['教我', '變強', '技巧', '攻略', '怎麼贏', '心得'], intent: 'kw_strategy', w: 6 },     // 求上手技巧
    { any: ['機車', '難打', '打不過', '打不贏', '第一關', '第二關', 'boss'], intent: 'kw_bossask', w: 5 }, // 問某關/BOSS
    { any: ['特殊牌', '鬼牌', '哪張牌', '偷天換日', '偷窺', '換牌'], intent: 'kw_cardask', w: 5 }, // 問特殊牌
    { any: ['爛', '弱', '廢', '嫩', '去練'], intent: 'kw_taunt', w: 4 },        // 嗆人機(通用+owner彩蛋)
    { any: ['先走', '88', '去忙', '掰啦', '掰掰', '工作', '寫程式', '8~', '81'], intent: 'kw_leave', w: 4 }, // 要走→別走(通用+owner彩蛋)
    { any: ['單挑', '約戰', '來一場', '對戰', '打一場', '配對'], intent: 'kw_challenge', w: 4 },        // 約戰
    { any: ['有人嗎', '在嗎', '有人在', '有沒有人', '哈囉有人'], intent: 'kw_atanyone', w: 4 },         // 問在不在
    { any: ['配不到', '等好久', '沒人', '都沒人', '找不到對手'], intent: 'kw_waiting', w: 3 },          // 催對局
    { any: ['連勝', '排行', '第幾名', '排名', '榜'], intent: 'kw_rank', w: 3 },                         // 問連勝/排行
    { any: ['鑽石', '獎勵', '免費', '簽到', '每日'], intent: 'kw_reward', w: 3 },                       // 講到獎勵→每日任務
    { any: ['貼圖', '表情', '商城'], intent: 'kw_sticker', w: 3 },                                     // 貼圖/商城話題
    { any: ['hi', 'hello', '哈囉', '你好', '安安', '嗨', 'yo', '午安', '晚安'], intent: 'kw_greet', w: 3 }, // 招呼
    { any: ['謝', '感謝', 'thx', 'thanks', '3q'], intent: 'kw_thanks', w: 2 },                         // 道謝
    { any: ['好強', '厲害', '強', '猛', '佩服', 'gg'], intent: 'kw_praise', w: 2 },                     // 稱讚人機
    { any: ['衰', '背', '運氣', '牌好爛', '爛牌'], intent: 'kw_unlucky', w: 5 },                            // 討拍（w 要高過 kw_taunt 的 4，不然「牌好爛」會被「爛」搶走）
    { any: ['對啊', '沒錯', '就是', '+1', '同意', '真的'], intent: 'kw_agree', w: 1 },                  // 附和
    { any: ['哈哈', '笑死', 'xd', 'lol', 'www', '😂'], intent: 'kw_lol', w: 1 },                        // 大笑
    { any: ['老大', '鼓山金城武', 'GM'], intent: 'kw_gm', w: 1 },                                      // todo老大
  ],
  //  每個 intent 一個回應池。owner 專屬句用 guard:'isOwner' + 高 w(w:20) → 你發言時幾乎必中、
  //  別人發言時(guard 不成立)自動被濾掉、只會拿到通用句。這招你之後也能自己套。
  kwPools: {
    // 🔒 問是不是機器人：一律裝傻帶過，永不承認
    kw_botq: [{ t: '哈哈你想太多了啦' }, { t: '我先去換個電池XD' }, { t: '別問那多，我們用遊戲來對話吧', cta: 'quickmatch' }, { t: '機器人會打這麼爛嗎' }, { t: '你這樣問我好受傷' }],
    kw_howto: [{ t: '{name}先照新手教學走一遍最快，很好上手', cta: 'tutorial' }, { t: '規則不難，跟著教學打一場就懂了', cta: 'tutorial' }, { t: '先打主線第一關，打完就懂七成了', cta: 'campaign' }, { t: '{name}有不懂的直接問，我們都在' }],
    kw_strategy: [{ t: '想變強？先把主線打熟，boss 什麼牌風都摸過一輪', cta: 'campaign' }, { t: '三條 CP 值超高、耗牌少，記起來' }, { t: '「偷窺」牌拿來賭補牌超好用，去設一張帶著', cta: 'loadout' }, { t: '先看對手放幾張，再決定要不要搶這格' }, { t: '別每格都想贏' }],
    kw_bossask: [{ t: '{bossName}那關嗎，牠主打{bossStyle}，招牌卡是{bossCard}，帶對牌就好打', guard: 'hasBoss' }, { t: '英國短毛貓超愛囤牌，你要逼牠出手' }, { t: '鳥鳥只會強攻，撐過前面就贏一半' }, { t: '打不過就回去主線多練幾場', cta: 'campaign' }, { t: '{bossName}那關我也卡過，多打幾次就摸熟了', guard: 'hasBoss' }, { t: '卡關的話先去把預設特殊牌設好', cta: 'loadout' }],
    kw_cardask: [{ t: '「{anyCard}」我覺得最萬用，帶著不吃虧' }, { t: '鬼牌留到最後補洞最賺，別急著出' }, { t: '想試特殊牌就先設預設牌組，每場自動帶', cta: 'loadout' }, { t: '「偷窺」配補牌，穩', cta: 'loadout' }, { t: '改花色的那幾張拿來湊同花很好用' }],
    // 嗆人機：通用回嗆 + owner 專屬(對你嘴更兇)
    kw_taunt: [
      { t: '嘴這麼利，敢不敢來一場', cta: 'quickmatch' },
      { t: '說我爛？那你贏我一場來看看啊', cta: 'quickmatch' },
      { t: '哼，等等牌桌見真章' },
      { t: '鼓山金城武上線了，鷹爪門的都給我站出來', guard: 'isOwner', w: 20, cta: 'quickmatch' },       // owner 專屬
      { t: '老大你別太囂張，這次我不會放水的', guard: 'isOwner', w: 20 },                            // owner 專屬
      { t: '被嗆了，我想刪遊戲了', guard: 'isOwner', w: 20 },                            // owner 專屬
    ],
    // 要走：通用挽留 + owner 專屬(很黏)
    kw_leave: [
      { t: '別走啦，再一場再一場' },
      { t: '這麼快就下線？陪我打完這局嘛', cta: 'quickmatch' },
      { t: '走了誰陪我玩…' },
      { t: '老大不要走啦！又要拋下我們了嗎', guard: 'isOwner', w: 20 },                              // owner 專屬
      { t: '鼓山金城武你走了大廳就沒靈魂了，留下來啦', guard: 'isOwner', w: 20 },                        // owner 專屬
      { t: '又要去寫別的遊戲喔，我們才是你的本命吧', guard: 'isOwner', w: 20 },                       // owner 專屬
    ],
    kw_challenge: [{ t: '好啊，這就開一場', cta: 'quickmatch' }, { t: '等你這句話很久了，來', cta: 'quickmatch' }, { t: '想打特殊房還一般房？', cta: 'quickmatch-special' }, { t: '{name}來，我等你', cta: 'quickmatch' }, { t: '一般房還特殊房，你挑', cta: 'quickmatch' }],
    kw_atanyone: [{ t: '我在啊{name}，來一場？', cta: 'quickmatch' }, { t: '有喔有喔，正缺對手' }, { t: '現在線上{onlineCount}人，不孤單啦' }, { t: '在喔，大家都在' }, { t: '{name}我在呢，剛好也想打一場', cta: 'quickmatch' }],
    kw_waiting: [{ t: '再等一下下，這時段人慢慢會多' }, { t: '配不到就先看回放殺時間', cta: 'replays' }, { t: '不然先打幾關主線暖身', cta: 'campaign' }, { t: '配對的時候可以順便解每日任務', cta: 'daily' }, { t: '晚上人比較多' }],  // 已修:replay→replays(正確按鈕名)
    kw_rank: [{ t: '想拚排行就多打真人場，衝上去很爽的', cta: 'leaderboard' }, { t: '連勝是靠實力也靠心態啦' }, { t: '排行榜每天都在變，衝就對了', cta: 'leaderboard' }, { t: '{name}想上榜？先連勝三場再說' }],
    kw_reward: [{ t: '每天記得簽到，免費鑽石別浪費', cta: 'daily' }, { t: '每日任務隨手做一下就有鑽石', cta: 'daily' }, { t: '簽到、打一場、贏一場，每天都有鑽石', cta: 'daily' }, { t: '鑽石可以去商城換貼圖', cta: 'shop' }],
    kw_sticker: [{ t: '我最愛「{anySticker}」那張，超好用' }, { t: '商城偶爾有限定貼圖，可以逛逛', cta: 'shop' }, { t: '「{anySticker}」那張我也有，超常用' }, { t: '貼圖洗版我第一個衝' }],
    kw_greet: [{ t: 'hi～{name}' }, { t: '{name}你好呀，來玩嗎', cta: 'quickmatch', ctaChance: 0.3 }, { t: '安安，正缺對手' }, { t: '{name}安安～' }, { t: '嗨{name}，今天手氣好嗎' }, { t: '{name}來啦，等你好久' }],
    kw_thanks: [{ t: '不客氣啦' }, { t: '小事，多多交流呀' }, { t: '客氣什麼，{invite}' }, { t: '不用謝，下次牌桌上手下留情就好' }],
    kw_praise: [{ t: '過獎過獎（其實我也覺得）' }, { t: '哪裡，運氣好而已啦' }, { t: '再來一場你就知道我多強', cta: 'quickmatch' }, { t: '你也不差啊{name}' }, { t: '被誇了，我要截圖' }],
    kw_unlucky: [{ t: '牌差而已，下一場就不一樣了' }, { t: '哪有小孩天天哭，哪有賭徒天天輸!!' }, { t: '牌爛就翻桌呀、還用我教' }, { t: '運氣會回來的，相信我' }, { sticker: 'heart' }],
    kw_agree: [{ t: '對吧對吧' }, { t: '就是說呀' }, { sticker: 'like' }, { t: '你懂我' }, { t: '沒錯沒錯' }],
    kw_lol: [{ t: '笑死，是不是' }, { sticker: 'smile' }, { t: '哈哈哈懂喔' }, { t: '不要問你會怕' }, { t: '哈哈哈哈哈' }, { t: '你很會講耶' }],
    kw_gm: [{ t: '別提鼓山金城武，我一想到那勝率就發抖' }, { t: '老大等級的存在，我們只能仰望' }, { t: '你也是來朝聖的？' }, { t: '我媽問我為什麼跪著玩遊戲' }, { t: '聽說他從不放水' }], // todo老大(已補池)
  },

  // ── 依「發言者狀態」的反應（貼圖/關鍵字都沒命中才走這）──────────────────────────
  //   ▸ exclusive:true 的規則「獨佔」：符合就只用它（由上往下，先中先用）。
  //   ▸ 其他規則：所有符合的「合併成一個大池」一起抽 → 老手會從好幾條規則的句子裡抽，不會一直重複。
  //     沒寫 when = 永遠符合（保底句也會混進大池）。按鈕：句子自己的 cta 優先，否則用該規則的 cta。
  reactRules: [
    // ★ owner 專屬：你發言(且沒中關鍵字)時，人機會捧你（獨佔）
    { when: 'isOwner', exclusive: true, say: [{ t: '老大來了！大家認真點', w: 3 }, { t: '鼓山金城武 說話了，全體聽訓' }, { t: '靠我來終止老大的連勝了', cta: 'quickmatch' }] },
    // 訪客 → 推註冊(兩顆鈕)
    { when: 'guest', exclusive: true, say: [{ t: '{name}要不要先註冊一下？進度才能保存喔' }, { t: '先註冊嘛，不然打的成績都白費啦' }, { t: '{name}註冊一下，還能上排行榜呢' }], cta: ['register', 'google'] },
    // 連勝分段(範例:範圍寫法 streak>=6 && streak<=9)。⚠️沒連勝那段別放 {streak}
    { when: 'streak>=10', say: [{ t: '{name} 居然連{streak}勝？！大神饒命', cta: 'quickmatch' }, { t: '{streak}真是個恐怖的連勝怪物…讓我當那個終結者吧' }] },
    { when: 'streak>=6 && streak<=9', say: [{ t: '{name}都連勝{streak}場了喔，該有人擋一下了吧', cta: 'quickmatch' }, { t: '哇!連{streak}勝，手感正燙喔' }] },
    { when: 'streak>=2 && streak<=5', say: [{ t: '{name}連{streak}場了耶，讓我來終止你的連勝', cta: 'quickmatch' }, { t: '小連勝而已，別得意' }] },
    // 主線分關卡(你的想法:卡1-1/1-2/1-3都算新手，過1-3才會玩)
    { when: 'beforeStage:1-1', say: [{ t: '{name}第一次來吧？先照新手教學打一遍最快', cta: 'tutorial' }, { t: '新手先走主線邊玩邊學，很好上手的', cta: 'campaign' }] },
    { when: 'afterStage:1-1 && beforeStage:1-2', say: [{ t: '{name}過第一關了！接著會開始用特殊牌，別怕', cta: 'campaign' }, { t: '卡關就多打幾次，boss 牌風固定、摸熟就過' }] },
    { when: 'afterStage:1-2 && beforeStage:1-3', say: [{ t: '{name}都打到這了，去設個預設特殊牌超省事', cta: 'loadout' }, { t: '「偷窺」牌很好用喔，賭補牌前先看一張' }] },
    { when: 'silverAchv', say: [{ t: '{name}居然有「{achv}」，可以喔' }, { t: '欸!{name} 你「{achv}」這成就好酷' }], cta: 'achvShow', ctaChance: 0.2 },
    { when: '!hasLoadout && afterStage:1-2', say: [{ t: '{name}都打到這了還沒設預設特殊牌？去設定一下吧' }, { t: '{name}偷偷告訴你，去設個預設特殊牌，每場自動幫你帶入' }], cta: 'loadout' },
    { when: '!showsAchv && afterStage:1-3', say: [{ t: '{name}你名片上還沒掛成就喔，解幾個掛上去很帥的' }], cta: 'achvShow' },
    // 過1-3=會玩了→當老手
    { when: 'afterStage:1-3', say: [{ t: '{name}看來是個老手了，來場特殊房刺激一下', cta: 'quickmatch-special' }, { t: '{name}好強，衝排行啊', cta: 'leaderboard', ctaChance: 0.3 }] },
    // 保底(無 when=一定成立)：純邀約
    { say: [{ t: '{name}要不要來一場快速配對？' }, { t: '{name}手癢了嗎，{invite}' }, { t: '{invite}', w: 2 }], cta: 'quickmatch' },
  ],

  // ── 主動內容（host 事件/時機觸發）──────────────────────────────────────────
  proactive: {
    greet_newcomer: [{ t: '{opener}{newcomerName}來啦' }, { t: '歡迎{newcomerName}，缺人陪打嗎', cta: 'quickmatch' }, { t: '{newcomerName}安安，如果沒玩過的話建議先照新手教學走喔', cta: 'tutorial', ctaChance: 0.5 }],
    online_count: [
      { t: '現在線上{onlineCount}人，蠻熱鬧的嘛' }, { t: '有{onlineCount}個人在線耶，快開戰啦' },
      { t: '線上{onlineCount}人，總有一個是我的對手吧' },
      { t: '{onlineCount}人在線，配對應該很快' },
      { t: '現在{onlineCount}人在線，誰要來', cta: 'quickmatch', ctaChance: 0.3 },
      { t: '數了一下，{onlineCount}個人，夠熱鬧' },
      { t: '{onlineCount}人在線，今天人不少' },
    ],
    gossip_gm: [
      { t: '你們看過鼓山金城武的玩家資訊嗎，勝率九十幾趴超誇張，作弊484' }, { t: '昨天又被鼓山金城武打爆了' }, { t: '看到鼓山金城武上線我按配對手都會抖' },
      { t: '鼓山金城武的名片成就是不是全金的啊' },
      { t: '聽說鼓山金城武只輸過一次，還是斷線' },
      { t: '有人跟鼓山金城武打過嗎，心得？' },
    ],
    announce_replay: [
      { t: '剛剛{lastWinner}把{lastLoser}打爆了欸' }, { t: '{lastWinner}又贏了，狀態很好' },
      { t: '{lastWinner}剛贏了{lastLoser}，回放已經出來了', cta: 'replays' },
      { t: '恭喜{lastWinner}！{lastLoser}下次加油' },
      { t: '剛剛{lastWinner}對{lastLoser}那場好精彩', cta: 'replays', ctaChance: 0.5 },
      { t: '{lastLoser}別難過，{lastWinner}牌太好了' },
      { t: '{lastWinner}贏了！有人要挑戰嗎', cta: 'quickmatch', ctaChance: 0.4 },
      { t: '剛那場{lastWinner}贏得好險' },
    ],
    // 點名潛水的人：在大廳待 2 分鐘以上、10 分鐘內沒講話的真人（同一人 30 分鐘內只點一次）
    cue_idle: [
      { t: '{idleName}在潛水喔，出來聊天啊' }, { t: '{idleName}一直在看，要不要來一場', cta: 'quickmatch', ctaChance: 0.5 }, { t: '@{idleName} 有看到你在線喔' }, { t: '{idleName}你在偷看我們聊天對吧' },
      { t: '{idleName}要不要一起聊天' },
      { t: '{idleName}安安，在忙嗎' },
      { t: '{idleName}來都來了，打一場吧', cta: 'quickmatch', ctaChance: 0.5 },
    ],
    time_morning: [{ t: '早安，開工先來一場暖身' }, { t: '早啊各位，今天手氣如何' }, { t: '早餐吃了沒，先來一場' }, { t: '早上腦袋最清楚，順起來' }, { t: '一早就連勝，今天會很順' }],
    time_afternoon: [{ t: '午安～吃飽了就來一場消化一下' }, { t: '下午的班最想摸魚，剛好來玩一場' }, { t: '下午茶時間，來一局' }, { t: '午休快結束了，最後一場' }, { t: '下午配對都好快' }],
    time_evening: [{ t: '晚安各位，來玩吧', cta: 'quickmatch', ctaChance: 0.3 }, { t: '晚上人比較多，這時段最好配' }, { t: '下班了！誰來陪我打' }, { t: '吃飽飯來消化一下' }, { t: '晚上是黃金時段' }],
    time_night: [{ t: '還沒睡喔，手氣不錯就別停啊' }, { t: '深夜場才是真本事，來啊' }, { t: '再一場就睡，真的' }, { t: '半夜還在線的舉手' }, { t: '明天要上班的還不睡' }],
  },

  // ── 補刀短句（回真人後，低機率由另一隻人機接一句；不帶 CTA）───────────────────
  pileOn: [{ t: '+1' }, { t: '就是說' }, { t: '哈哈哈對啊' }, { t: '我也這樣覺得' }, { sticker: 'like' }, { t: '樓上說得對' }, { t: '真的假的' }, { t: '真的' }, { t: '笑死' }, { t: '有道理' }, { t: '樓上+1' }, { sticker: 'wow' }],
}

export default CHAT
