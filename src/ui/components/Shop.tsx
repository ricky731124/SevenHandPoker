import { useState } from 'react'
import { motion } from 'framer-motion'
import Modal from './Modal'
import Button from './Button'
import Diamond from './game/Diamond'
import useMobileWebScale from '../hooks/useMobileWebScale'
import { usePlatformStore } from '../../state/platformStore'
import { STICKERS, stickerPrice, stickerSrc, type StickerDef } from '../../game/stickers'
import { sfx } from '../../audio/sfx'
import '../screens/Panel.css'
import '../screens/Personalize.css'

/**
 * 商城 (shop) — a tabbed panel like 個人化設置 (fixed size, opened from the top-right,
 * left of 設定). v1 sells only stickers, so a single 貼圖 tab (future: 主畫面 etc).
 * The 鑽石 balance reads the live profile → stays in sync with the main screen;
 * buying deducts from both. Tap a sticker → a confirm popup 「付 90 鑽解鎖」.
 */
const PAID = STICKERS.filter((s) => !s.free)

type BuyResult = { ok: boolean; name: string; id: string; error?: string }

export default function Shop({ open, onClose }: { open: boolean; onClose: () => void }) {
  const diamonds = usePlatformStore((s) => s.profile?.diamonds) ?? 0
  const owned = usePlatformStore((s) => s.profile?.unlocked.emojis) ?? {}
  const buySticker = usePlatformStore((s) => s.buySticker)
  const [tab, setTab] = useState<'sticker' | 'home'>('sticker')
  const [info, setInfo] = useState(false)
  const [confirm, setConfirm] = useState<StickerDef | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BuyResult | null>(null)
  const mw = useMobileWebScale()

  if (!open) return null

  const buy = async (def: StickerDef) => {
    if (busy) return
    setBusy(true)
    const res = await buySticker(def.id)
    setBusy(false)
    setConfirm(null)
    if (res.ok) sfx.success() // 購買成功
    else sfx.error() // e.g. 鑽石不足 — the easiest way to hear the error cue
    setResult({ ok: res.ok, name: def.name, id: def.id, error: res.error })
  }

  return (
    <>
      <div className="pz-screen" style={{ zIndex: 300 }} onClick={onClose}>
      <motion.div className="panel panel--wide" initial={{ opacity: 0, y: 16, scale: mw }} animate={{ opacity: 1, y: 0, scale: mw }} onClick={(e) => e.stopPropagation()}>
        <div className="pz__topbar">
          <button className="pz-back" onClick={() => { sfx.click(); onClose() }} aria-label="返回" title="返回">
            <svg viewBox="0 0 24 24" width="26" height="26">
              <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="pz__tabs">
            <button className={`pz__tab${tab === 'sticker' ? ' pz__tab--on' : ''}`} onClick={() => { sfx.click(); setTab('sticker') }}>貼圖</button>
            <button className={`pz__tab${tab === 'home' ? ' pz__tab--on' : ''}`} onClick={() => { sfx.click(); setTab('home') }}>主畫面</button>
          </div>
          <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--wood-text)', fontSize: 24 }}>
            <Diamond size={28} />
            {diamonds}
            <button type="button" onClick={() => { sfx.click(); setInfo(true) }} aria-label="鑽石取得方式" title="鑽石取得方式" className="shop-qbtn">
              ?
            </button>
          </span>
        </div>

        <div className="panel__scroll">
          {tab === 'sticker' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              {PAID.map((s) => {
                const have = !!owned[s.id]
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { if (!have) { sfx.click(); setConfirm(s) } }}
                    disabled={have}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, border: '2px solid var(--wood-600,#8a6a3e)', background: 'var(--parch-100,#fbf1d9)', cursor: have ? 'default' : 'pointer', opacity: have ? 0.7 : 1 }}
                  >
                    <img src={stickerSrc(s.id)} alt={s.name} style={{ width: 118, height: 118, objectFit: 'contain' }} />
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--wood-800,#4a3418)' }}>{s.name}</span>
                    {have ? (
                      <span style={{ fontSize: 12, color: 'var(--wood-600,#8a6a3e)' }}>已擁有</span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 14, fontWeight: 700, color: 'var(--wood-800,#4a3418)' }}>
                        <Diamond size={15} /> {stickerPrice(s)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220, color: 'var(--parch-text)', opacity: 0.55, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18 }}>
              敬請期待
            </div>
          )}
        </div>
      </motion.div>
      </div>

      {/* 鑽石取得方式 — popup */}
      <Modal open={info} onClose={() => setInfo(false)} title="鑽石取得方式" width={360}>
        <div style={{ fontSize: 14, lineHeight: 1.9, color: 'var(--parch-text)' }}>
          ・通關主線關卡(每關首次過關 +10 鑽)
          <br />・完成每日任務可獲得鑽石:每日簽到、完成一場對戰、真人對戰獲勝(上限 2 場),各 +5 鑽,每日最多 +20 鑽。
        </div>
      </Modal>

      {/* 購買確認 — popup */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? `解鎖「${confirm.name}」` : ''} width={340}>
        {confirm && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <img src={stickerSrc(confirm.id)} alt={confirm.name} style={{ width: 180, height: 180, objectFit: 'contain' }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 16, fontFamily: 'var(--font-display)', color: 'var(--parch-text)' }}>
              付 <Diamond size={17} /> {stickerPrice(confirm)} 解鎖?
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Button variant="secondary" onClick={() => setConfirm(null)}>取消</Button>
              <Button disabled={busy} onClick={() => void buy(confirm)}>{busy ? '請稍候…' : '確定'}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 購買結果 — 跳中間、放大、明顯 */}
      <Modal open={!!result} onClose={() => setResult(null)} title={result?.ok ? '購買成功' : '無法購買'} width={360}>
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '4px 0 6px' }}>
            {result.ok ? (
              <>
                <img src={stickerSrc(result.id)} alt={result.name} style={{ width: 150, height: 150, objectFit: 'contain' }} />
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 26, color: 'var(--parch-text)', textAlign: 'center' }}>
                  購買成功！
                </div>
                <div style={{ fontSize: 17, color: 'var(--parch-text)', textAlign: 'center' }}>
                  已解鎖貼圖「{result.name}」
                </div>
              </>
            ) : (
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, color: '#c0392b', textAlign: 'center', padding: '18px 0' }}>
                {result.error ?? '購買失敗'}
              </div>
            )}
            <Button onClick={() => setResult(null)}>{result.ok ? '太好了' : '知道了'}</Button>
          </div>
        )}
      </Modal>
    </>
  )
}
