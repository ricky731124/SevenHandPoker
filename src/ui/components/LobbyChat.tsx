import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { avatarSrc } from './PlayerAvatar'
import PlayerInfoCard, { type CardFallback } from './PlayerInfoCard'
import { useLobby } from '../hooks/useLobby'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'
import { STICKERS, getSticker } from '../../game/stickers'
import { sfx } from '../../audio/sfx'
import type { LobbyMsg } from '../../net/lobby'
import './LobbyChat.css'

/**
 * 大廳聊天室（見 docs/LOBBY-AI-SPEC.md §3）。左下角 2 行縮合框（頭像+名字：內容/貼圖）
 * → 點擊開 Modal 彈窗（沿用既有 Modal、固定高度、貼圖盤浮動不撐高）。
 */

// 聊天室貼圖 = 全部免費預設貼圖（emoji 那組，含新加的 生氣/愛心/再見）。
const DEFAULT_STICKERS = STICKERS.filter((s) => s.free)

function StickerGlyph({ id, size }: { id: string; size: number }) {
  const def = getSticker(id)
  if (def?.emoji) return <span style={{ fontSize: size, lineHeight: 1 }}>{def.emoji}</span>
  return <span style={{ fontSize: size * 0.6, lineHeight: 1 }}>🂠</span>
}

function hhmmss(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

type Cta = NonNullable<LobbyMsg['cta']>[number]
/** CTA 按鈕點擊 → 導去對應流程（§13）。多數接既有畫面；賽事回放/每日任務先當 no-op。 */
function runCta(c: Cta) {
  sfx.click()
  const app = useAppStore.getState()
  switch (c.action) {
    case 'register': app.requestRegister(); return
    case 'google': app.requestGoogle(); return
    case 'campaign': app.go('campaignStages'); return
    case 'tutorial': app.go('tutorial'); return
    case 'personalize': app.openPersonalize(); return       // 個人化(預設頁籤)
    case 'loadout': app.openPersonalize('cards'); return    // 直接落在「牌組/預設特殊牌」頁
    case 'achvShow': app.openPersonalize('achievements'); return // 直接落在「成就」頁
    case 'shop': app.openShop(); return                     // 商城彈窗
    case 'daily': app.openDaily(); return                   // 每日任務彈窗
    case 'replays': app.openReplays(); return               // 賽事回放彈窗
    case 'leaderboard': app.go('leaderboard'); return
    case 'spectate': if (c.code) app.openSpectate(c.code); return
    case 'quickmatch':
      void usePlatformStore.getState().ensureAccount()
      app.openMatchmaking(c.room ?? 'normal')
      return
  }
}

function MsgRow({ m, myUid, onOpenCard }: { m: LobbyMsg; myUid: string | null; onOpenCard: (m: LobbyMsg) => void }) {
  const mine = m.kind === 'human' && !!myUid && m.uid === myUid
  return (
    <div className={`lchat-row${mine ? ' lchat-row--me' : ''}`}>
      <img className="lchat-av" src={avatarSrc(m.avatarId)} alt="" decoding="async" loading="lazy" style={{ cursor: 'pointer' }} onClick={() => onOpenCard(m)} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      <div className="lchat-col">
        <span className="lchat-name">{m.name}</span>
        <div className="lchat-bubrow">
          {m.type === 'sticker' && m.stickerId ? (
            <div className="lchat-bubble lchat-bubble--sticker"><StickerGlyph id={m.stickerId} size={40} /></div>
          ) : (
            <div className="lchat-bubble">{m.text}</div>
          )}
          <span className="lchat-time">{hhmmss(m.ts)}</span>
        </div>
        {m.cta && m.cta.length > 0 && (
          <div className="lchat-ctarow">
            {m.cta.map((c, i) => (
              <button key={i} type="button" className="lchat-cta" onClick={() => runCta(c)}>{c.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function LobbyChat() {
  const { messages, latest, send, notifyOpened } = useLobby()
  const myUid = usePlatformStore((s) => s.uid)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [tray, setTray] = useState(false)
  const [hasNew, setHasNew] = useState(false)
  const [cardTarget, setCardTarget] = useState<{ uid: string | null; fallback: CardFallback } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const atBottomRef = useRef(true)
  const seenLastRef = useRef<string | null>(null)
  // 手機打字中（觸控裝置 + 輸入框有 focus = 鍵盤開著）→ 彈窗進「精簡模式」：藏標題列、訊息區縮到
  // 剛好塞進鍵盤上方的可見區 → 同時看得到鍵盤、輸入框(打了什麼字)和最新幾則訊息。
  const [typing, setTyping] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout>>() // 失焦晚 200ms 才退出精簡模式：手指點按鈕的瞬間版面不跳
  useEffect(() => () => clearTimeout(blurTimer.current), [])
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  const kb = typing && coarse

  // 精簡模式：訊息區高度 = 可見高度能塞的量（扣掉彈窗其餘部分）。鍵盤升降/可見區變動時重算，並捲到最新。
  useEffect(() => {
    const list = listRef.current
    if (!kb || !list) { if (list) list.style.height = ''; return }
    const vv = window.visualViewport
    const fit = () => {
      const panel = list.closest('.modal__panel') as HTMLElement | null
      if (!panel) return
      const mw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mw-scale')) || 1
      const visH = vv?.height ?? window.innerHeight
      const avail = (visH * 0.92) / mw                          // 彈窗最多可用的高度(未縮放前的 px)
      // 彈窗裡訊息區以外的部分(輸入列/內距/框線)。用 scrollHeight(內容全高)，offsetHeight 會被 max-height 夾住而算錯。
      const others = panel.scrollHeight - list.offsetHeight
      list.style.height = `${Math.max(40, Math.min(360, Math.floor(avail - others - 2)))}px`
      if (atBottomRef.current) list.scrollTop = list.scrollHeight
    }
    fit()
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    window.addEventListener('resize', fit)
    return () => {
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
      window.removeEventListener('resize', fit)
      list.style.height = ''
    }
  }, [kb])

  const scrollToBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setHasNew(false)
  }
  // 自己剛發言後的 3 秒「黏在最底」：手機上按發送 → 鍵盤收起 → 訊息區從精簡變回原尺寸、可見區連續變動，
  // 這段期間的捲動事件不可信(會把「在最底」誤判成否 → 自己的訊息進來時不捲)。手指一碰訊息區就取消黏底。
  const stickUntil = useRef(0)
  const touching = useRef(false)
  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (!near && !touching.current && Date.now() < stickUntil.current) { el.scrollTop = el.scrollHeight; return }
    atBottomRef.current = near
    if (near) setHasNew(false)
  }
  const stopSticking = () => { stickUntil.current = 0 }
  // 訊息區本身尺寸變了（鍵盤升降、精簡模式進出、轉向）→ 原本在最底的就維持在最底。
  useEffect(() => {
    const el = listRef.current
    if (!open || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (atBottomRef.current || Date.now() < stickUntil.current) el.scrollTop = el.scrollHeight })
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  // 新訊息偵測用「最後一則 id」而非 length（訊息滿 50 則後 length 不再變 → 舊寫法會失效）。
  const lastId = messages.length ? messages[messages.length - 1].id : null
  useEffect(() => {
    const first = seenLastRef.current === null
    const changed = lastId !== null && lastId !== seenLastRef.current
    seenLastRef.current = lastId
    if (!changed || first) return
    if (open) {
      // 收到新訊息不發音效(會一直「搭搭搭」很吵,使用者要求拿掉)。只處理捲動。
      const last = messages[messages.length - 1]
      const mine = last?.kind === 'human' && !!myUid && last.uid === myUid
      if (mine || atBottomRef.current || Date.now() < stickUntil.current) scrollToBottom() // 自己的訊息一律捲到看得到
      else setHasNew(true)
    }
  }, [lastId, open])

  // 開啟彈窗 → 直接捲到底
  useEffect(() => { if (open) requestAnimationFrame(scrollToBottom) }, [open])

  const openPopup = () => { sfx.click(); setOpen(true); notifyOpened() }
  const submitText = () => {
    const t = text.trim()
    if (!t) return
    send({ text: t.slice(0, 200) })
    setText('')
    stickUntil.current = Date.now() + 3000 // 自己發言 → 黏在最底 3 秒(鍵盤收起的版面變動期間也不會跑掉)
    scrollToBottom()
  }
  const sendSticker = (id: string) => { send({ stickerId: id }); setTray(false); stickUntil.current = Date.now() + 3000; scrollToBottom() }
  // 點頭像 → 開玩家資訊卡（人機用 botId，PlayerInfoCard 內建 fetchBotCard 顯示 persona 卡、不露餡）。
  const openCard = (m: LobbyMsg) => {
    sfx.click()
    const uid = m.kind === 'human' ? (m.uid ?? null) : (m.botId ?? null)
    setCardTarget({ uid, fallback: { name: m.name, avatarId: m.avatarId } })
  }

  return (
    <>
      {/* 左下角縮合框（2 行：頭像 + 名字：內容/貼圖） */}
      <button type="button" className="lchat-fab" onClick={openPopup} aria-label="聊天室">
        {latest ? (
          <>
            <img className="lchat-fab__av" src={avatarSrc(latest.avatarId)} alt="" decoding="async" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            <span className="lchat-fab__body">
              <b className="lchat-fab__name">{latest.name}：</b>
              {latest.type === 'sticker' && latest.stickerId
                ? <span className="lchat-fab__sticker"><StickerGlyph id={latest.stickerId} size={16} /></span>
                : latest.text}
            </span>
          </>
        ) : (
          <span className="lchat-fab__hint">💬 點我聊天</span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} onBack={() => setOpen(false)} title="聊天室" width={460} panelClass={`lchat-modal${kb ? ' lchat-modal--kb' : ''}`}>
        <div className="lchat-wrap">
          <div
            className="lchat-list"
            ref={listRef}
            onScroll={onScroll}
            onTouchStart={() => { touching.current = true; stopSticking() }}
            onTouchEnd={() => { touching.current = false }}
            onTouchCancel={() => { touching.current = false }}
            onWheel={stopSticking}
          >
            {messages.length === 0 ? (
              <p className="lchat-empty">還沒有人說話，來打聲招呼吧！</p>
            ) : (
              messages.map((m) => <MsgRow key={m.id} m={m} myUid={myUid} onOpenCard={openCard} />)
            )}
          </div>

          {/* 有新訊息但沒看到底 → 懸浮提示（不搶 focus，點了才捲到底） */}
          {hasNew && (
            <button type="button" className="lchat-newpill" onClick={scrollToBottom}>有新訊息 ↓</button>
          )}

          {/* 貼圖盤：懸浮在輸入列上方，不撐高彈窗 */}
          {tray && (
            <div className="lchat-tray">
              {DEFAULT_STICKERS.map((s) => (
                <button key={s.id} type="button" className="lchat-tray__btn" title={s.name} onClick={() => sendSticker(s.id)}>
                  <StickerGlyph id={s.id} size={24} />
                </button>
              ))}
            </div>
          )}

          <div className="lchat-input-row">
            {/* 按下時不搶 focus(mousedown preventDefault，手機也會發這個事件)：否則手指一碰，輸入框先失焦→彈窗變回原尺寸→按鈕位置跑掉、點不到。 */}
            <button type="button" className="lchat-emoji" onMouseDown={(e) => e.preventDefault()} onClick={() => { sfx.click(); inputRef.current?.blur(); setTray((v) => !v) }} aria-label="貼圖">😀</button>
            <input
              ref={inputRef}
              className="lchat-input"
              value={text}
              maxLength={200}
              placeholder="說點什麼…"
              onFocus={() => { setTray(false); clearTimeout(blurTimer.current); setTyping(true) }}
              onBlur={() => { blurTimer.current = setTimeout(() => setTyping(false), 200) }}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitText() } }}
            />
            {/* 發送也不搶 focus → 送完鍵盤留著、可以接著打下一句 */}
            <button type="button" className="lchat-send" onMouseDown={(e) => e.preventDefault()} onClick={submitText} disabled={!text.trim()}>發送</button>
          </div>
        </div>
      </Modal>

      {cardTarget && (
        <PlayerInfoCard uid={cardTarget.uid} fallback={cardTarget.fallback} onClose={() => setCardTarget(null)} />
      )}
    </>
  )
}
