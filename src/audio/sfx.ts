import { Howl, Howler } from 'howler'
import { useAppStore } from '../state/appStore'

/**
 * SFX via Howler, playing real files from public/sounds/ (Kenney CC0 foley +
 * freesound.org CC0 jingles). All sources are normalised/trimmed offline by
 * scripts/build-sfx.mjs into a single .mp3 set (universal: desktop/Android/iOS).
 * Background music is separate (user supplies via Suno later).
 */

type Name =
  | 'click' | 'hover' | 'select' | 'deal' | 'draw' | 'place' | 'coin' | 'coinWin'
  | 'showdown' | 'win' | 'lose' | 'special' | 'reward' | 'achievement'
  | 'countdown' | 'error' | 'success'

/** File basename (in public/sounds/) + a base volume to balance foley vs jingles. */
const SFX: Record<Name, { file: string; vol: number }> = {
  // ---- foley ----
  click: { file: 'click', vol: 0.4 },
  hover: { file: 'hover', vol: 0.22 },
  select: { file: 'select', vol: 0.45 },
  deal: { file: 'deal', vol: 0.5 }, // 開局發牌 (card fan, once)
  draw: { file: 'draw', vol: 0.45 }, // 每回合補牌 (card slide, staggered per card)
  place: { file: 'place', vol: 0.6 },
  error: { file: 'error', vol: 0.5 }, // 鑽石不足 / 非法操作
  success: { file: 'success', vol: 0.5 }, // 購買/改名/裝備/設定 成功
  countdown: { file: 'countdown', vol: 0.4 }, // one tick per second in the final 15s
  // ---- jingles (loudnorm'd) ----
  coin: { file: 'coin', vol: 0.6 }, // opening coin toss (throw + land in one file)
  coinWin: { file: 'coinwin', vol: 0.7 }, // 搶金幣 — the winner rakes in the coin
  showdown: { file: 'showdown', vol: 0.6 }, // 對決 — plays for BOTH sides when a duel fires
  win: { file: 'win', vol: 0.75 },
  lose: { file: 'lose', vol: 0.7 },
  special: { file: 'special', vol: 0.6 }, // moment a special card is activated
  reward: { file: 'reward', vol: 0.7 }, // +💎 / 頭像 / 特殊牌 入帳
  achievement: { file: 'achievement', vol: 0.8 }, // 解鎖成就
}

const BASE = import.meta.env.BASE_URL
const howls: Partial<Record<Name, Howl>> = {}

function howlFor(name: Name): Howl {
  let h = howls[name]
  if (!h) {
    h = new Howl({ src: [`${BASE}sounds/${SFX[name].file}.mp3`], volume: SFX[name].vol })
    howls[name] = h
  }
  return h
}

function play(name: Name) {
  const { sfx: on, sfxVolume } = useAppStore.getState().settings
  if (!on) return
  const h = howlFor(name)
  h.volume(SFX[name].vol * sfxVolume)
  h.play()
}

/** 補牌:補幾張就放幾次 card-slide,間隔 0.15s(補3張≈0.9s、補2張≈0.75s)。 */
function playDraw(count = 1) {
  const n = Math.max(1, Math.min(count, 6))
  for (let i = 0; i < n; i++) setTimeout(() => play('draw'), i * 150)
}

export const sfx = {
  /** Call once from a user gesture to unlock audio on mobile (Howler also auto-unlocks). */
  unlock() {
    try {
      void Howler.ctx?.resume?.()
    } catch {
      /* ignore */
    }
  },
  click: () => play('click'),
  hover: () => play('hover'),
  select: () => play('select'),
  deal: () => play('deal'),
  draw: (count?: number) => playDraw(count),
  place: () => play('place'),
  coin: () => play('coin'),
  coinWin: () => play('coinWin'),
  showdown: () => play('showdown'),
  win: () => play('win'),
  lose: () => play('lose'),
  special: () => play('special'),
  reward: () => play('reward'),
  achievement: () => play('achievement'),
  countdown: () => play('countdown'),
  error: () => play('error'),
  success: () => play('success'),
}
