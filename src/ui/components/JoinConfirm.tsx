import { useEffect, useState } from 'react'
import { getRoomInfo, type RoomInfo } from '../../net/room'
import Button from './Button'
import Modal from './Modal'

/**
 * Join-confirmation popup — shown for BOTH deep-link (?room=) and manual code
 * entry. Peeks the room's public config and asks 確定/取消 before joining, so
 * the joiner always sees who opened it, the room type, and the time limit.
 */
export default function JoinConfirm({
  code,
  onConfirm,
  onCancel,
}: {
  code: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const [info, setInfo] = useState<RoomInfo | null>(null)

  useEffect(() => {
    if (!code) {
      setInfo(null)
      return
    }
    let cancelled = false
    setInfo(null)
    void getRoomInfo(code).then((i) => {
      if (!cancelled) setInfo(i)
    })
    return () => {
      cancelled = true
    }
  }, [code])

  if (!code) return null
  const joinable = !!info && info.exists && !info.full

  return (
    <Modal open onClose={onCancel} title="加入房間" width={360}>
      {!info ? (
        <p className="acct-note">讀取房間資訊中…</p>
      ) : !info.exists ? (
        <p className="acct-note">找不到房號 {code}。</p>
      ) : info.full ? (
        <p className="acct-note">房號 {code} 已經滿了。</p>
      ) : (
        <div className="joinconfirm">
          <p className="joinconfirm__who">
            <b>{info.hostName || '朋友'}</b> 建立的房間
          </p>
          <p className="joinconfirm__meta">
            {info.roomType === 'special' ? '特殊牌房' : '一般房'} · 限時 {info.timeLimit} 秒
          </p>
          <p className="acct-note">確定要加入嗎？</p>
        </div>
      )}
      <Button full disabled={!joinable} onClick={onConfirm}>
        確定加入
      </Button>
      <Button full variant="ghost" onClick={onCancel}>
        {joinable ? '取消' : '返回'}
      </Button>
    </Modal>
  )
}
