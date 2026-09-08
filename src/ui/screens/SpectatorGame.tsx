import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../state/appStore'
import { useGameStore, type SpectateInfo } from '../../state/gameStore'
import { joinSpectate, type LiveMeta } from '../../net/spectate'
import type { SpecView } from '../../net/sync'
import type { GameState } from '../../game/state'
import { getSpecialCard } from '../../game/specialCards'
import { useToastStore } from '../../state/toastStore'
import { GameBoard } from './Game'
import Button from '../components/Button'
import { sfx } from '../../audio/sfx'
import './Game.css'
import './SpectatorGame.css'

/**
 * 觀戰畫面(§4.3):**直接複用遊玩的 GameBoard**(認得 gameStore.spectate 就切成全開唯讀、
 * 拿掉 8 個操作鈕),版面與遊玩 100% 一致、推牌等也自然跟著動。本元件只負責:①把 spec 串流
 * 灌進 gameStore(applySpectate)②疊上觀戰專屬浮動 UI(左上 LIVE+觀戰數、離開觀戰、結算)。
 */

/** §10 觀戰音效:比對前後兩張 spec 快照,以「下方 p1 角度」補回音效(發牌兩次的問題天然避開:
 *  觀戰只收廣播端的狀態、不會自己再發一次)。進場首張不比對(不補播舊聲)。 */
function spectateSound(prev: GameState, next: GameState): void {
  if (next.winner && !prev.winner) {
    next.winner === 'p1' ? sfx.win() : sfx.lose()
    return
  }
  const ns = next.lastShowdown
  const ps = prev.lastShowdown
  if (ns && (!ps || ps.slot !== ns.slot)) {
    sfx.showdown()
    const p1Won = ns.winner === 'p1' || ns.winner === 'both'
    setTimeout(() => (p1Won ? sfx.coinWin() : sfx.coinFail()), 400)
    return
  }
  const grew = next.hands.p1.length - prev.hands.p1.length
  if (grew > 0) {
    sfx.draw(grew) // 只有下方 p1 補牌才響(對手補牌 p1 手牌不變)
    return
  }
  const slotCards = (g: GameState) => g.slots.reduce((a, s) => a + s.p1.length + s.p2.length, 0)
  if (slotCards(next) > slotCards(prev)) sfx.place() // 放牌(無開牌)
}

function seatsFrom(m: LiveMeta | null): SpectateInfo {
  return {
    p1: { name: m?.p1?.name || '玩家1', avatarId: m?.p1?.avatar || 'cat', uid: m?.p1?.uid ?? null },
    p2: { name: m?.p2?.name || '玩家2', avatarId: m?.p2?.avatar || 'bird', uid: m?.p2?.uid ?? null },
  }
}

export default function SpectatorGame() {
  const code = useAppStore((s) => s.spectateCode)
  const closeSpectate = useAppStore((s) => s.closeSpectate)
  const applySpectate = useGameStore((s) => s.applySpectate)
  const exitSpectate = useGameStore((s) => s.exitSpectate)
  const feedDanmaku = useGameStore((s) => s.feedDanmaku)
  const setSpectateSend = useGameStore((s) => s.setSpectateSend)
  const setSpectateMyName = useGameStore((s) => s.setSpectateMyName)
  const setSpectateWatchers = useGameStore((s) => s.setSpectateWatchers)
  const engine = useGameStore((s) => s.engine)
  const spectate = useGameStore((s) => s.spectate)
  const [live, setLive] = useState<LiveMeta | null>(null)
  const liveRef = useRef<LiveMeta | null>(null)
  const [hasSpec, setHasSpec] = useState(false)
  // 廣播端「中離/離開」→ liveIndex 被 stop() 移除 → onLive 收到 null。若我們**曾經**收過
  // live 卡,現在變 null,代表這場已收攤(非自然結束、拿不到 winner)→ 也要把觀戰者導回主畫面,
  // 不能讓他卡在牌桌苦等(#5)。用 everHadLive 區分「一開始就沒有」與「打到一半收攤」。
  const everHadLive = useRef(false)
  const [gone, setGone] = useState(false)
  const lastFxN = useRef(0) // 特殊牌通知去重(同一則只 toast 一次)
  const fxPrimed = useRef(false) // 進場首張 spec 只記 fx.n、不 toast → 進場前用過的特殊牌不會被補播(#5)
  const prevEngRef = useRef<GameState | null>(null) // §10 音效:比對前後快照;首張不比對(不補播舊聲)

  useEffect(() => {
    if (!code) return
    setHasSpec(false)
    setGone(false)
    everHadLive.current = false
    lastFxN.current = 0
    fxPrimed.current = false
    prevEngRef.current = null
    // §特殊牌:誰用了哪張 → 跳 toast。⚠️ 進場「第一張」spec 帶的 fx 是**進場前**就用過的
    //   (我第 6 手才進來、對手第 4 手用的)→ 只記 n、不 toast;之後 n 有變(進場後新用的)才 toast(#5)。
    const toastFx = (view: SpecView | null) => {
      const fx = view?.fx
      if (!fxPrimed.current) {
        fxPrimed.current = true
        lastFxN.current = fx?.n ?? 0
        return
      }
      if (!fx || fx.n === lastFxN.current) return
      lastFxN.current = fx.n
      sfx.special() // §10:進場後新用的特殊牌 → 音效(下方角度即可)
      const m = liveRef.current
      const byName = fx.by === 'p1' ? m?.p1?.name || '玩家1' : m?.p2?.name || '玩家2'
      const cardName = getSpecialCard(fx.card)?.name ?? '特殊牌'
      useToastStore.getState().show(`${byName} 使用了「${cardName}」`)
    }
    const h = joinSpectate(code, {
      onSpec: (eng, view) => {
        toastFx(view)
        if (!eng) return
        // §10 音效:比對前後快照補回音效(下方 p1 角度);首張只記、不發聲(不補播進場前的)。
        if (prevEngRef.current) spectateSound(prevEngRef.current, eng)
        prevEngRef.current = eng
        // 帶上 spec 附加狀態:推牌選取/排序 + 暫停 + 貼圖 → GameBoard 下方手牌 lift/同排序、顯暫停中、
        // SpecEmoteLayer 飄貼圖(#4:之前只帶 p1Sel/p1Sort,漏了 paused/emote → 觀戰看不到暫停/貼圖)。
        applySpectate(
          eng,
          seatsFrom(liveRef.current),
          view ? { p1Sel: view.p1Sel, p1Sort: view.p1Sort, paused: view.paused, emote: view.emote } : null,
        )
        setHasSpec(true)
      },
      onLive: (m) => {
        if (m) everHadLive.current = true
        else if (everHadLive.current) setGone(true) // 曾有卡、現在沒了 = 廣播端收攤
        liveRef.current = m
        setLive(m)
        setSpectateWatchers(m?.spectators ?? 0) // 牌桌內左上 👁 顯示(#5)
        const cur = useGameStore.getState().engine
        if (cur && m) applySpectate(cur, seatsFrom(m), useGameStore.getState().spectateLive) // 名字/頭像更新 → 重套 seats(保留推牌狀態)
      },
      onDanmaku: (msg) => feedDanmaku(msg), // Phase C:收到彈幕 → 進 gameStore 供 DanmakuLayer 顯示
      onName: (name) => setSpectateMyName(name), // 觀戰者姓名(#3)
    })
    setSpectateSend((t) => h.sendDanmaku(t)) // 綁定送出器供 GameBoard 的彈幕鈕呼叫
    return () => {
      h.stop()
      exitSpectate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  if (!code) return null

  const ready = hasSpec && !!engine && !!spectate
  const ended = live?.status === 'ended' || engine?.phase === 'ended' || gone
  const winner = live?.winner ?? engine?.winner ?? null
  const winnerName = winner ? (winner === 'p1' ? live?.p1?.name || '玩家1' : live?.p2?.name || '玩家2') : ''

  const leave = () => {
    sfx.click()
    closeSpectate()
  }

  return (
    <div className="spectate">
      {ready ? (
        // 牌桌本體 = GameBoard(spec):LIVE/眼睛(左上取代選單鈕位置)、左欄(觀戰者姓名/彈幕/N張)、
        // 離開觀戰(右下取代送出鈕位置)、彈幕層 全都在 GameBoard 內、用 stage 相對定位(各平台一致,#5)。
        <GameBoard />
      ) : (
        <div className="spectate__loading">
          <div className="mm__spinner" aria-hidden="true" />
          <p>讀取牌局中…</p>
        </div>
      )}

      {/* 讀取中(GameBoard 還沒渲染)→ 也要有離開管道(#6)。就緒後由 GameBoard 內的離開鈕接手。 */}
      {!ready &&
        createPortal(
          <div className="spectate__leave-wrap">
            <Button size="md" onClick={leave}>離開觀戰</Button>
          </div>,
          document.body,
        )}

      {/* 對局結束(自然分勝負 / 廣播端中離收攤)→ 唯讀結算 → 引導回主畫面。
          portal 到 <body> 並蓋過 Modal(對決彈窗可能還開著)→ 觀戰者一定看得到、不會卡等(#5)。 */}
      {ended &&
        createPortal(
          <div className="spectate__end">
            <div className="spectate__end-panel">
              <div className="spectate__end-title">對戰已結束</div>
              {winnerName ? (
                <div className="spectate__end-winner">{winnerName} 獲勝</div>
              ) : (
                <div className="spectate__end-winner">這一場結束了</div>
              )}
              <Button onClick={leave}>返回主畫面</Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
