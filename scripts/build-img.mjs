// 從頭像母檔重產網頁用的小圖（WebP）：
//   art/avatars/{id}.png  — 頭像高畫質母檔(去背整理好的,不部署、程式不引用,只是備份/重產用)
//   → public/avatars/{id}.webp — 長邊縮到 512px（3 倍螢幕顯示 150px 也夠清楚）
// 用法：node scripts/build-img.mjs   （改了母檔後重跑一次即可）
// 頭像清單直接讀 PlayerAvatar.tsx 的 AVATAR_IMG，新增頭像不用再改這裡。
// 地圖、貼圖、標題圖不留母檔(2026-10 使用者定案):新關卡的地圖/貼圖由 stage-art.mjs 直接產 webp。
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const art = join(root, 'art', 'avatars')
const avatarSrc = readFileSync(join(root, 'src/ui/components/PlayerAvatar.tsx'), 'utf8')
const AVATARS = [...avatarSrc.matchAll(/^\s*(\w+): 'avatars\/\1\.webp'/gm)].map((m) => m[1])
const kb = (f) => (statSync(f).size / 1024).toFixed(0).padStart(5) + ' KB'

function webp(src, dst, { maxSide, quality, alpha = true }) {
  const vf = maxSide
    ? `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease:flags=lanczos`
    : 'null'
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-vf', vf,
    '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', '-pix_fmt', alpha ? 'yuva420p' : 'yuv420p', dst])
  console.log(`${kb(src)} → ${kb(dst)}  ${dst.slice(pub.length + 1)}`)
}

mkdirSync(join(pub, 'avatars'), { recursive: true })
for (const id of AVATARS) webp(join(art, `${id}.png`), join(pub, 'avatars', `${id}.webp`), { maxSide: 512, quality: 82 })
