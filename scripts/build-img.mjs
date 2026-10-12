// 產生網頁用的小圖（WebP）。原始 PNG 完全不動，只另外輸出：
//   public/avatars/{id}.webp  — 頭像，長邊縮到 512px（3 倍螢幕顯示 150px 也夠清楚）
//   public/maps/stage{N}.webp — 關卡地圖，保持原尺寸、只換格式壓縮（PNG ~2MB → ~150KB）
//   public/title.webp         — 主畫面標題，保持原尺寸、只換格式壓縮
// 用法：node scripts/build-img.mjs   （改了原圖 PNG 後重跑一次即可）
// 頭像清單直接讀 PlayerAvatar.tsx 的 AVATAR_IMG，新增頭像不用再改這裡。
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const avatarSrc = readFileSync(join(root, 'src/ui/components/PlayerAvatar.tsx'), 'utf8')
const AVATARS = [...avatarSrc.matchAll(/^\s*(\w+): 'avatars\/\1\.webp'/gm)].map((m) => m[1])
const MAPS = readdirSync(join(pub, 'maps')).filter((f) => /^stage\d+\.png$/.test(f))
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
for (const id of AVATARS) webp(join(pub, `${id}.png`), join(pub, 'avatars', `${id}.webp`), { maxSide: 512, quality: 82 })
for (const f of MAPS) webp(join(pub, 'maps', f), join(pub, 'maps', f.replace('.png', '.webp')), { quality: 80, alpha: false })
webp(join(pub, 'title.png'), join(pub, 'title.webp'), { quality: 85 })
