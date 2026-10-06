import { useState } from 'react'
import type { PlayerId } from '../../game/state'

/**
 * Character art. Avatars are addressed by id ('cat' | 'bird' | 'cat2' | …) so a
 * registered player can show their equipped avatar; falls back to the role
 * default (p1=cat / p2=bird) when only a PlayerId is given.
 */
// 網頁用 512px WebP（~20KB/張）。原圖 public/{id}.png(~1MB) 保留當母檔；改原圖後跑 `node scripts/build-img.mjs` 重產。
const AVATAR_IMG: Record<string, string> = {
  cat: 'avatars/cat.webp', // 橘貓 (default / host)
  bird: 'avatars/bird.webp', // 鳥鳥 (guest default / 哪裡來的鎹鴉? boss + 第1關獎勵)
  cat2: 'avatars/cat2.webp', // 英國短毛貓 (明天開始168 boss + 第2關獎勵)
  bear: 'avatars/bear.webp', // 北極熊 (第3關 boss + 獎勵)
  dog: 'avatars/dog.webp', // 紅貴賓 (第4關 boss + 獎勵)
  cat3: 'avatars/cat3.webp', // 波斯貓 (第5關 boss + 獎勵)
  bird2: 'avatars/bird2.webp', // 貓頭鷹 (第6關 boss + 獎勵)
}
const AVATAR_EMOJI: Record<string, string> = { cat: '🐱', bird: '🐦', cat2: '🐱', bear: '🐻', dog: '🐩', cat3: '😾', bird2: '🦉' }

/** Selectable avatars (game content). `free` = available to everyone. */
export const AVATARS: { id: string; name: string; free: boolean }[] = [
  { id: 'cat', name: '橘貓', free: true },
  { id: 'bird', name: '鳥鳥', free: false },
  { id: 'cat2', name: '英國短毛貓', free: false },
  { id: 'bear', name: '北極熊', free: false },
  { id: 'dog', name: '紅貴賓', free: false },
  { id: 'cat3', name: '波斯貓', free: false },
  { id: 'bird2', name: '貓頭鷹', free: false },
]
export const ALL_AVATAR_IDS = AVATARS.map((a) => a.id)

export function avatarSrc(id: string): string {
  return `${import.meta.env.BASE_URL}${AVATAR_IMG[id] ?? AVATAR_IMG.cat}`
}
/** Back-compat: role → image source. */
export function characterSrc(player: PlayerId): string {
  return avatarSrc(player === 'p2' ? 'bird' : 'cat')
}

export default function PlayerAvatar({
  player,
  avatarId,
  size = 54,
  bare = false,
}: {
  player?: PlayerId
  /** explicit avatar id; overrides the player→default mapping */
  avatarId?: string
  size?: number
  /** no gold ring / background — for use inside the coin faces */
  bare?: boolean
}) {
  const [ok, setOk] = useState(true)
  const id = avatarId ?? (player === 'p2' ? 'bird' : 'cat')
  return (
    <div className={`pavatar${bare ? ' pavatar--bare' : ''}`} style={{ width: size, height: size }}>
      {ok ? (
        <img
          src={avatarSrc(id)}
          alt=""
          width={size}
          height={size}
          decoding="async"
          onError={() => setOk(false)}
          style={{
            width: size,
            height: size,
            objectFit: 'contain',
            // The art has transparent padding; zoom a touch so the face fills the frame.
            transform: bare ? 'scale(1.05)' : 'scale(1.28)',
          }}
        />
      ) : (
        <div className="pavatar__fallback" style={{ fontSize: size * 0.52 }}>
          {AVATAR_EMOJI[id] ?? '🐱'}
        </div>
      )}
    </div>
  )
}
