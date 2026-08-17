import type { PlayerId } from '../../game/state'
import { useGameStore } from '../../state/gameStore'
import { useNetStore } from '../../state/netStore'
import { usePlatformStore } from '../../state/platformStore'
import { useCampaignStore } from '../../state/campaignStore'
import { AVATARS } from '../components/PlayerAvatar'

/**
 * Resolve the display identity (name + avatar) of both seats. See
 * docs/PLATFORM-SPEC.md §4 and the in-game avatar rules:
 * - registered player → their username + equipped avatar
 * - guest → "guest" + role default (host=cat / guest=bird)
 * - AI opponent → 電腦 + bird
 * Opponent identity in online play comes from the synced room player metadata.
 */
export interface Seat {
  name: string
  avatarId: string
}

const roleDefaultAvatar = (pid: PlayerId) => (pid === 'p1' ? 'cat' : 'bird')

export default function useSeats(): { p1: Seat; p2: Seat } {
  const me = useGameStore((s) => s.me)
  const online = useGameStore((s) => s.online)
  const displayName = usePlatformStore((s) => s.displayName)
  const profile = usePlatformStore((s) => s.profile)
  const room = useNetStore((s) => s.room)
  const campStage = useCampaignStore((s) => s.stage)

  const foePid: PlayerId = me === 'p1' ? 'p2' : 'p1'

  const selfSeat: Seat = displayName
    ? { name: displayName, avatarId: profile?.equipped?.avatar || 'cat' }
    : { name: 'guest', avatarId: roleDefaultAvatar(me) }

  let foeSeat: Seat
  if (!online) {
    // campaign boss: the CHARACTER name (= avatar name, e.g. 鳥鳥 / 英國短毛貓 /
    // 北極熊), NOT the stage name (哪裡來的鎹鴉? …). Portrait = the stage's bossAvatar.
    if (campStage) {
      const av = AVATARS.find((a) => a.id === campStage.bossAvatar)
      foeSeat = { name: av?.name ?? campStage.name, avatarId: campStage.bossAvatar }
    } else {
      foeSeat = { name: '電腦', avatarId: 'bird' } // single-player AI
    }
  } else {
    const foeRole = online.role === 'host' ? 'guest' : 'host'
    const meta = room?.players?.[foeRole] as { name?: string; avatarId?: string } | undefined
    foeSeat = {
      name: meta?.name || 'guest',
      avatarId: meta?.avatarId || roleDefaultAvatar(foePid),
    }
  }

  return me === 'p1' ? { p1: selfSeat, p2: foeSeat } : { p1: foeSeat, p2: selfSeat }
}
