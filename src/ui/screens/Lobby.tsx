import { useState, type ReactNode } from 'react'
import { useAppStore } from '../../state/appStore'
import { useNetStore } from '../../state/netStore'
import { roomLink } from '../../net/room'
import Button from '../components/Button'
import PlayerAvatar from '../components/PlayerAvatar'
import { sfx } from '../../audio/sfx'
import './Lobby.css'

/**
 * Online lobby (Phase 1) — purely presentational. The create/join side effects
 * are fired at the action site (Menu button / ?room= deep link in App) BEFORE
 * navigating here, so this component has no mount effect that StrictMode could
 * double-invoke or tear down. Leaving happens only on the explicit back button.
 * The synced game starts in Phase 2 — for now we confirm connectivity.
 */
export default function Lobby({ mode }: { mode: 'host' | 'guest'; roomId?: string }) {
  const go = useAppStore((s) => s.go)
  const { phase, code, error, leave, room } = useNetStore()
  const [copied, setCopied] = useState(false)

  const back = () => {
    leave()
    go('menu')
  }

  const copyLink = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(roomLink(code))
      setCopied(true)
      sfx.click()
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the code is shown anyway */
    }
  }

  if (phase === 'error') {
    return (
      <Card>
        <h1 className="lobby__title">連線問題</h1>
        <p className="lobby__msg">{error ?? '發生未知錯誤'}</p>
        <Button onClick={back}>返回主畫面</Button>
      </Card>
    )
  }

  const connected = phase === 'connected'

  return (
    <Card>
      <h1 className="lobby__title">{connected ? '對手已加入！' : mode === 'host' ? '建立對戰' : '加入對戰'}</h1>

      {room && (
        <p className="lobby__msg">
          {room.roomType === 'special' ? '特殊牌房' : '一般房'} · 限時 {room.timeLimit ?? 50} 秒
        </p>
      )}

      <div className="lobby__seats">
        <Seat player="p1" label={`房主${mode === 'host' ? '（你）' : ''}`} on />
        <div className="lobby__vs">VS</div>
        <Seat
          player="p2"
          label={connected ? `對手${mode === 'guest' ? '（你）' : ''}` : '等待中…'}
          on={connected}
        />
      </div>

      {mode === 'host' && code && (
        <div className="lobby__code-box">
          <div className="lobby__code-label">房號</div>
          <div className="lobby__code">{code}</div>
          <Button size="sm" variant="secondary" onClick={copyLink}>
            {copied ? '已複製！' : '複製邀請連結'}
          </Button>
        </div>
      )}

      {phase === 'connecting' && <p className="lobby__msg">連線中…</p>}
      {phase === 'waiting' && mode === 'host' && (
        <p className="lobby__msg">等待對手加入…把房號或連結傳給朋友。</p>
      )}
      {phase === 'waiting' && mode === 'guest' && (
        <p className="lobby__msg">已加入房號 {code}，等待房主…</p>
      )}
      {connected && <p className="lobby__msg lobby__msg--ok">連線成功！牌局同步將於階段 2 接上。</p>}

      <Button variant="secondary" onClick={back}>
        {connected ? '離開房間' : '取消'}
      </Button>
    </Card>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="lobby">{children}</div>
}

function Seat({ player, label, on }: { player: 'p1' | 'p2'; label: string; on: boolean }) {
  return (
    <div className={`lobby__seat${on ? '' : ' lobby__seat--off'}`}>
      <PlayerAvatar player={player} size={76} />
      <span className="lobby__seat-label">{label}</span>
    </div>
  )
}
