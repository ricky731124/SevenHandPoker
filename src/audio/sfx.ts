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
  | 'coinFail' | 'showdown' | 'battle' | 'win' | 'lose' | 'special' | 'reward'
  | 'achievement' | 'countdown' | 'error' | 'success'

/** File basename (in public/sounds/) + a base volume to balance foley vs jingles.
 *  使用者回饋:整體太吵 → 這批音量普遍砍半;hover 再砍到 1/4;battle(riser)砍到 1/3。*/
const SFX: Record<Name, { file: string; vol: number }> = {
  // ---- foley ----
  click: { file: 'click', vol: 0.2 },
  hover: { file: 'hover', vol: 0.02 }, // 滑過每顆都響,但音量壓很低 (2026-08-22 .05→.01→.03→.02)
  select: { file: 'select', vol: 0.07 }, // 選牌 (2026-08-22 再下修 .15→.07)
  deal: { file: 'deal', vol: 0.25 }, // 開局發牌 (card fan, once)
  draw: { file: 'draw', vol: 0.22 }, // 每回合補牌 (card slide, staggered per card)
  place: { file: 'place', vol: 0.3 },
  error: { file: 'error', vol: 0.25 }, // 鑽石不足 / 非法操作
  success: { file: 'success', vol: 0.07 }, // 購買/改名/裝備/設定/貼圖/暫停 成功 (再下修 .15→.07)
  countdown: { file: 'countdown', vol: 0.16 }, // one tick per second (再 -20% .2→.16)
  // ---- jingles ----
  coin: { file: 'coin', vol: 0.3 }, // opening coin toss (throw + land in one file)
  coinWin: { file: 'coinwin', vol: 0.15 }, // 搶金幣成功(贏家) (再 -30% .21→.15)
  coinFail: { file: 'coinfail', vol: 0.18 }, // 搶金幣失敗(輸家) (再 -10% .24→.18)
  showdown: { file: 'showdown', vol: 0.18 }, // 格子裡牌對牌的對決(鋼琴) (再 -20% .24→.18)
  battle: { file: 'battle', vol: 0.05 }, // 進場「BATTLE」撞擊(riser-hit) (.07→.035→.06→.05)
  win: { file: 'win', vol: 0.3 }, // 最終勝利 (-20% .37→.3)
  lose: { file: 'lose', vol: 0.28 }, // 局末落敗 (-20% .35→.28)
  special: { file: 'special', vol: 0.3 }, // moment a special card is activated
  reward: { file: 'reward', vol: 0.21 }, // +💎 / 頭像 / 特殊牌 入帳 (-40% .35→.21)
  achievement: { file: 'achievement', vol: 0.32 }, // 解鎖成就 (-20% .4→.32)
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
  const fire = () => {
    const h = howlFor(name)
    h.volume(SFX[name].vol * sfxVolume)
    h.play()
  }
  // Mobile suspends the AudioContext between gestures; a sound fired from a timer
  // (mid-turn 放牌/補牌) then plays into a suspended context and is DROPPED. Resume
  // FIRST and only play once it's actually running (await, not fire-and-forget) —
  // otherwise the first play after a suspend goes silent.
  const ctx = Howler.ctx
  if (ctx && ctx.state !== 'running' && typeof ctx.resume === 'function') {
    ctx.resume().then(fire).catch(fire)
  } else {
    fire()
  }
}

/** 補牌:補幾張就放幾次 card-slide,間隔 0.15s(補3張≈0.9s、補2張≈0.75s)。 */
function playDraw(count = 1) {
  const n = Math.max(1, Math.min(count, 6))
  for (let i = 0; i < n; i++) setTimeout(() => play('draw'), i * 150)
}

export const sfx = {
  /** Call once from a user gesture to unlock audio on mobile (Howler also auto-unlocks).
   *  Also PRELOAD every sound now (during the gesture): mobile drops the first play
   *  of a not-yet-loaded sound when it's triggered outside a user gesture (e.g. the
   *  開局發牌/補牌/放牌 fire from timers/AI), so 手機版 would go silent for those. */
  unlock() {
    try {
      void Howler.ctx?.resume?.()
      ;(Object.keys(SFX) as Name[]).forEach((n) => howlFor(n))
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
  coinFail: () => play('coinFail'),
  showdown: () => play('showdown'),
  battle: () => play('battle'),
  win: () => play('win'),
  lose: () => play('lose'),
  special: () => play('special'),
  reward: () => play('reward'),
  achievement: () => play('achievement'),
  countdown: () => play('countdown'),
  error: () => play('error'),
  success: () => play('success'),
}

// DEV-only:直接從 console 試放任一音效,用來分辨「音檔本身能不能播」vs「遊戲內觸發點有沒有開」。
//   __sfx.place()            → 放牌音
//   __sfx.draw(2)            → 補 2 張的連續補牌音
//   __sfx.unlock()           → 先解鎖/預載(若手機第一次沒聲先跑這個)
//   __testSfx()              → 依序把每個音效各放一次(間隔 700ms),聽哪個是啞的
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as { __sfx: typeof sfx; __testSfx: () => void }
  w.__sfx = sfx
  w.__testSfx = () => {
    sfx.unlock()
    const names: Name[] = [
      'click', 'hover', 'select', 'deal', 'draw', 'place', 'coin', 'coinWin',
      'coinFail', 'showdown', 'battle', 'win', 'lose', 'special', 'reward',
      'achievement', 'countdown', 'error', 'success',
    ]
    names.forEach((n, i) => setTimeout(() => { console.log('sfx →', n); play(n) }, i * 700))
  }
}
