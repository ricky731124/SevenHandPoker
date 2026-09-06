/**
 * 固定人機（假人）設定。§3：15 隻 persona（固定 name/avatar/loadout/展示成就），
 * 身分固定、大腦每局隨機 roll（見 casualBots.ts）。戰績寫在 bots/{botId}（見
 * src/net/bots.ts）。見 docs/SPECTATE-REPLAY-SPEC.md §3。
 *
 * avatar/loadout/achievements 皆為「門面假資料」，沿用既有 id（頭像 7 種、特殊卡 7 種、
 * 成就族多種，tier 1=銅 2=銀）。頭像數少於人機數，故會重複使用——無妨（假玩家）。
 */

export interface BotPersona {
  /** 穩定 key，也是 bots/{botId} 的 id。 */
  id: string
  /** 顯示名（使用者提供）。 */
  name: string
  /** 固定頭像 id（沿用既有 avatar）。 */
  avatarId: string
  /** 預設牌組展示（≤3 張特殊卡 id，門面用）。 */
  loadout: string[]
  /** 展示成就（族 id + 階級 1=銅 2=銀，門面用）。 */
  achievements: { id: string; tier: number }[]
}

/** 15 隻固定人機（使用者定案的名字）。 */
export const BOTS: BotPersona[] = [
  { id: 'bot_01', name: '山石宮分',       avatarId: 'cat',   loadout: ['peek', 'swap'],            achievements: [{ id: 'wins', tier: 2 }, { id: 'games', tier: 2 }] },
  { id: 'bot_02', name: '我要驗牌',       avatarId: 'bird',  loadout: ['spy', 'peek', 'clubs'],    achievements: [{ id: 'streak', tier: 1 }] },
  { id: 'bot_03', name: '海Chris爛',      avatarId: 'cat2',  loadout: ['diamonds', 'hearts'],      achievements: [{ id: 'games', tier: 1 }, { id: 'flush', tier: 2 }] },
  { id: 'bot_04', name: '無法顯示名稱',   avatarId: 'bear',  loadout: ['swap', 'spades'],          achievements: [{ id: 'wins', tier: 1 }] },
  { id: 'bot_05', name: '金色狂蜂',       avatarId: 'dog',   loadout: ['peek', 'spy', 'swap'],     achievements: [{ id: 'streak', tier: 2 }, { id: 'wins', tier: 2 }] },
  { id: 'bot_06', name: '沒事call文哲',   avatarId: 'cat3',  loadout: ['clubs', 'diamonds'],       achievements: [{ id: 'games', tier: 2 }] },
  { id: 'bot_07', name: '常威打旺福',     avatarId: 'bird2', loadout: ['spades', 'swap', 'peek'],  achievements: [{ id: 'wins', tier: 1 }, { id: 'quads', tier: 1 }] },
  { id: 'bot_08', name: '你在大聲什麼啦', avatarId: 'cat',   loadout: ['hearts', 'spy'],           achievements: [{ id: 'games', tier: 1 }] },
  { id: 'bot_09', name: '夢醒淑芬',       avatarId: 'cat3',  loadout: ['peek'],                    achievements: [{ id: 'streak', tier: 1 }, { id: 'games', tier: 1 }] },
  { id: 'bot_10', name: '新資料夾(2)',    avatarId: 'bird',  loadout: ['swap', 'clubs', 'spades'], achievements: [{ id: 'wins', tier: 2 }] },
  { id: 'bot_11', name: '鍵盤柯南',       avatarId: 'bear',  loadout: ['spy', 'peek'],             achievements: [{ id: 'fullHouse', tier: 1 }, { id: 'games', tier: 2 }] },
  { id: 'bot_12', name: '玉皇Daddy',      avatarId: 'dog',   loadout: ['diamonds', 'hearts', 'swap'], achievements: [{ id: 'wins', tier: 2 }, { id: 'streak', tier: 2 }] },
  { id: 'bot_13', name: '乂煞氣a屁孩卍',  avatarId: 'cat2',  loadout: ['spades', 'peek'],          achievements: [{ id: 'games', tier: 1 }] },
  { id: 'bot_14', name: '陶敬凱',         avatarId: 'bird2', loadout: ['swap', 'spy', 'clubs'],    achievements: [{ id: 'wins', tier: 1 }, { id: 'flush', tier: 1 }] },
  { id: 'bot_15', name: '穹道穗宮原',     avatarId: 'cat',   loadout: ['peek', 'diamonds'],        achievements: [{ id: 'streak', tier: 1 }] },
]

/** botId → persona（配對時、名片顯示用）。 */
export const BOT_BY_ID: Record<string, BotPersona> = Object.fromEntries(BOTS.map((b) => [b.id, b]))

/**
 * 在線人數保底:永遠顯示這麼多隻人機在線（不佔真實 RTDB 連線）。= 固定 15 隻。
 */
export const BOTS_ONLINE = BOTS.length
