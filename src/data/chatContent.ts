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
 *   {onlineCount} 線上人數 · {newcomerName} 剛上線的人 · {lastWinner}{lastLoser} 剛剛誰贏誰輸
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
}
export interface ThreadBeat { role: string; pool: string }
export interface ThreadShape { id?: string; slots?: Record<string, 'anyCard' | 'anyBoss' | 'anySticker'>; beats: ThreadBeat[] }
export interface KwRule { any?: string[]; all?: string[]; intent: string; w?: number }
export interface ReactRule { when?: string; say: Line[]; cta?: LobbyCtaSpec; ctaChance?: number }
export interface ChatConfig {
  openerChance?: number
  pileOnChance?: number
  cooldownSize?: number
  ambientWeights?: { thread?: number; single?: number; sticker?: number; proactive?: number }
  ctaChance?: Record<string, number>
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
    openerChance: 0.4, // 單句自動前綴語助詞的機率
    pileOnChance: 0.15, // 回真人後「第二隻人機補刀」的機率
    cooldownSize: 25, // 最近用過的 25 個模板先不重複
    ambientWeights: { thread: 5, single: 3, sticker: 1, proactive: 2 }, // 沒事閒聊時各類比重
    ctaChance: {
      // 每種按鈕「預設」掛出的機率（單句可用 ctaChance 覆寫）
      tutorial: 0.9, register: 0.85, spectate: 0.7, campaign: 0.6, loadout: 0.6,
      google: 0.5, personalize: 0.4, daily: 0.4, achvShow: 0.4,
      quickmatch: 0.4, leaderboard: 0.3, replays: 0.3, shop: 0.3,
    },
  },

  // ── 碎片：可安全前綴/內插的小詞（語氣中性）；opener 你可擴到 200+ ──────────
  fragments: {
    opener: ['欸', '哇', '靠', '話說', '來啦來啦', '誒誒', '哈', '唉唷', '嘖', '欸你們', '誒', '嘿', '咦', '喔喔'],
    invite: ['要不要來一場', '配一場吧', '開一桌啦', '手癢了嗎', '來對戰啦', '陪我打一場'],
  },

  // ── 冷場首句（招呼）──────────────────────────────────────────────────────
  greetings: [
    { t: '安安大家好～' },
    { t: '有人在嗎，來一場啊' },
    { t: '我來囉，今天誰要挑戰我' },
    { t: '剛上線，牌運如何啊各位' },
    { t: '嗨嗨，等等要不要開一桌' },
  ],

  // ── 環境單句（自己聊 / tips / 話題）；可帶佔位與 cta ────────────────────────
  singles: [
    { t: '摸魚中，順便等對手' },
    { t: '今天目標連勝五場（應該啦）' },
    { t: '排行榜我又掉下去了，得拼一下', cta: 'leaderboard' },
    { t: '點自己頭像也能開個人化設定喔', cta: 'personalize' },
    { t: '偷偷說：三條CP值超高，耗牌少又能贏多數非五張牌' },
    { t: '別只顧著搶四個金幣，連成相鄰三格也能贏喔' },
    { t: '新來的先照新手教學走一遍，超快上手', cta: 'tutorial' },
    { t: '「{anyCard}」到底神在哪，我一直都帶' }, // 用隨機特殊牌名自聊
    { t: '偷天換日唯一真愛，不解釋', opener: false }, // 迷因死句
    { t: '有人要來一場嗎，手癢了', cta: 'quickmatch' },
  ],

  // ── 多句劇場（形狀定死走向、每拍從 beatPools 隨機抽；A/B/C 指派給不同人機）──
  threads: [
    { id: 'complain_console_rally', beats: [{ role: 'A', pool: 'complain' }, { role: 'B', pool: 'console' }, { role: 'C', pool: 'rally' }] },
    { id: 'brag_snark_giveup', beats: [{ role: 'A', pool: 'brag' }, { role: 'B', pool: 'snark' }, { role: 'C', pool: 'giveup' }] },
    // 共用一張牌名的小劇場（問→答→反應都講同一張 {card}）
    { id: 'skit_specialcard', slots: { card: 'anyCard' }, beats: [{ role: 'A', pool: 'ask_card' }, { role: 'B', pool: 'answer_card' }, { role: 'C', pool: 'react_card' }] },
    // 聊商城貼圖（共用一個貼圖名 {sticker}）
    { id: 'skit_shop', slots: { sticker: 'anySticker' }, beats: [{ role: 'A', pool: 'shop_ask' }, { role: 'B', pool: 'shop_reco' }] },
  ],
  beatPools: {
    complain: [{ t: '差一張就連三格了，可惡' }, { t: '對手把特殊牌扣到最後才用，賊' }, { t: '剛跟人對撞同花順輸了…' }],
    console: [{ t: '七手撲克就是這樣，差一步差很多' }, { t: '運氣不如人啦' }, { t: '別想了，牌品見人品' }],
    rally: [{ t: '有賭未必輸，再來一場' }, { t: '該休息了啦你' }, { t: '沒關係，你實力本來就這樣（誤）' }],
    brag: [{ t: '我最近手氣有夠旺' }, { t: '又連勝啦，誰來擋一下' }],
    snark: [{ t: '講這麼大聲，等等別輸喔' }, { t: '嘴上連勝的通常…你懂的' }],
    giveup: [{ t: 'OKOK 我信你' }, { t: '好啦好啦大神' }],
    ask_card: [{ t: '你們打{anyBoss}都帶什麼特殊牌' }, { t: '哪張特殊牌最好用啊' }, { t: '「{card}」到底神在哪' }],
    answer_card: [{ t: '「{card}」唯一真神，解成就都靠它' }, { t: '我都帶「{card}」打爆BOSS' }],
    react_card: [{ t: 'OKOK 下次學起來' }, { t: '靠，我還沒「{card}」這張' }, { t: '「{card}」勝率超差吧我不信' }],
    shop_ask: [{ t: '你覺得「{sticker}」貼圖好用嗎' }, { t: '我最愛用「{sticker}」' }, { t: '「{sticker}」必買吧' }],
    shop_reco: [{ t: '我也超愛「{sticker}」' }, { t: '「{sticker}」洗一排超好笑' }],
  },

  // ── 環境閒聊時，人機隨機發的貼圖（只用免費 8 張，聊天看得清）─────────────────
  ambientStickers: ['smile', 'like', 'wow', 'heart'],

  // ── 收到某張貼圖 → 的回應池（可回字、也可回貼圖）。'*' = 沒對應時的通用池 ──────
  stickerReplies: {
    smile: [{ t: '{name}心情不錯喔，來一場？', cta: 'quickmatch' }, { sticker: 'smile' }, { t: '笑什麼笑，開打啦' }],
    cry: [{ t: '別哭啦，下一場運氣會來的' }, { sticker: 'heart' }, { t: '{name}拍拍，再來一場回本', cta: 'quickmatch' }],
    wow: [{ t: '嚇到了吧，這就是實力' }, { sticker: 'wow' }],
    angry: [{ t: '別氣別氣，牌品見人品' }, { sticker: 'smile' }],
    thanks: [{ t: '不客氣啦' }, { t: '小事，多交流呀' }],
    like: [{ sticker: 'like' }, { t: '有默契喔{name}' }],
    heart: [{ sticker: 'heart' }, { t: '愛你喔，來一場啦', cta: 'quickmatch' }],
    bye: [{ sticker: 'bye' }, { t: '掰啦，下次再電你' }],
    '*': [{ t: '收到貼圖，那來對戰吧', cta: 'quickmatch' }, { sticker: 'like' }],
  },

  // ── 關鍵字（中文字元共現：any=任一命中、all=全部要有；有序+加權取第一個）──────
  keywords: [
    { any: ['hi', 'hello', '哈囉', '你好', '安安', '嗨', 'yo'], intent: 'kw_greet', w: 5 },
    { all: ['玩'], any: ['怎', '如何', '不會', '教學', '規則'], intent: 'kw_howto', w: 6 },
    { any: ['謝', '感謝', 'thx', 'thanks', '3q'], intent: 'kw_thanks' },
    { any: ['好強', '厲害', '強', '猛', '佩服', 'gg'], intent: 'kw_praise' },
    { any: ['衰', '背', '運氣', '賽'], intent: 'kw_unlucky' },
    { any: ['哈哈', '笑死', 'xd', 'lol', 'www'], intent: 'kw_lol' },
  ],
  kwPools: {
    kw_greet: [{ t: 'hi～{name}' }, { t: '{name}你好呀，來玩嗎', cta: 'quickmatch', ctaChance: 0.3 }, { t: '安安，正缺對手' }],
    kw_howto: [{ t: '{name}先照新手教學走一遍最快，很好上手', cta: 'tutorial' }, { t: '規則不難，跟著教學打一場就懂了', cta: 'tutorial' }],
    kw_thanks: [{ t: '不客氣啦' }, { t: '小事，多交流呀' }, { t: '客氣什麼，{invite}' }],
    kw_praise: [{ t: '過獎過獎（其實我也覺得）' }, { t: '哪裡，運氣好而已啦' }, { t: '再來一場你就知道我多強', cta: 'quickmatch' }],
    kw_unlucky: [{ t: '牌背而已，下一場就翻身' }, { t: '運氣這種東西是會輪的啦' }],
    kw_lol: [{ t: '笑死，是不是' }, { sticker: 'smile' }, { t: '哈哈哈懂喔' }],
  },

  // ── 依「發言者狀態」的反應（有序，第一個 guard 通過者用；貼圖/關鍵字都沒命中才走這）──
  reactRules: [
    { when: 'guest', say: [{ t: '{name}要不要先註冊一下？進度才能保存喔' }, { t: '先註冊嘛，不然打的成績都白費啦' }, { t: '{name}註冊一下，還能上排行榜呢' }], cta: ['register', 'google'] },
    { when: 'beforeStage:1-3', say: [{ t: '{name}先去打幾關主線熟悉一下吧，很好玩的' }, { t: '新手先走主線，邊玩邊學最快' }], cta: ['campaign', 'tutorial'] },
    { when: 'streak>=2', say: [{ t: '{name}都連{streak}場了喔，讓我來終止你的連勝吧' }, { t: '連{streak}勝的狠角色，怕了怕了' }], cta: 'quickmatch' },
    { when: 'silverAchv', say: [{ t: '{name}居然有「{achv}」，可以喔' }, { t: '欸「{achv}」這成就好酷，{name}真的假的' }], cta: 'achvShow', ctaChance: 0.2 },
    { when: '!hasLoadout && afterStage:1-2', say: [{ t: '{name}都打到這了還沒設預設特殊牌？設一下省超多事' }, { t: '偷偷說{name}，去設個預設特殊牌，每場自動幫你帶' }], cta: 'loadout' },
    { when: '!showsAchv && afterStage:1-3', say: [{ t: '{name}名片上還沒掛成就喔，解幾個掛上去很帥的' }], cta: 'achvShow' },
    { when: 'afterStage:1-3', say: [{ t: '{name}老手了，來場特殊房刺激一下', cta: 'quickmatch-special' }, { t: '{name}窺牌很好用你知道吧，帶一張再來' }] },
    { say: [{ t: '{name}要不要來一場快速配對？' }, { t: '{name}手癢了嗎，{invite}' }, { t: '{invite}', w: 2 }], cta: 'quickmatch' },
  ],

  // ── 主動內容（host 事件/時機觸發）──────────────────────────────────────────
  proactive: {
    greet_newcomer: [{ t: '{opener}{newcomerName}來啦' }, { t: '歡迎{newcomerName}，缺人陪打嗎', cta: 'quickmatch' }, { t: '{newcomerName}安安，先照新手教學走喔', cta: 'tutorial', ctaChance: 0.5 }],
    online_count: [{ t: '現在線上{onlineCount}人，蠻熱鬧的嘛' }, { t: '{onlineCount}個人在線，不開一桌太浪費' }],
    gossip_gm: [{ t: '你們看過鼓山金城武的玩家資訊嗎，勝率九十幾趴超誇張，作弊484' }, { t: '昨天又被鼓山金城武打爆了' }, { t: '看到鼓山金城武上線我按配對手都會抖' }],
    announce_replay: [{ t: '剛剛{lastWinner}把{lastLoser}打爆了欸' }, { t: '{lastWinner}又贏了，狀態很好' }],
    time_morning: [{ t: '早安，開工先來一場暖身' }, { t: '早啊各位，今天手氣如何' }],
    time_night: [{ t: '還沒睡喔，手氣不錯就別停啊' }, { t: '深夜場才是真本事，來啊' }],
  },

  // ── 補刀短句（回真人後，低機率由另一隻人機接一句；不帶 CTA）───────────────────
  pileOn: [{ t: '+1' }, { t: '就是說' }, { t: '哈哈哈對啊' }, { t: '我也這樣覺得' }, { sticker: 'like' }, { t: '樓上說得對' }, { t: '真的假的' }],
}

export default CHAT
