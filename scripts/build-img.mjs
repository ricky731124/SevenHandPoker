// 產生網頁用的小圖（WebP）。原始 PNG 完全不動，只另外輸出：
//   public/avatars/{id}.webp  — 頭像，長邊縮到 512px（3 倍螢幕顯示 150px 也夠清楚）
//   public/title.webp         — 主畫面標題，保持原尺寸、只換格式壓縮
// 用法：node scripts/build-img.mjs   （改了原圖 PNG 後重跑一次即可）
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from 'ffmpeg-static'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const AVATARS = ['cat', 'bird', 'cat2', 'bear', 'dog', 'cat3', 'bird2']
const kb = (f) => (statSync(f).size / 1024).toFixed(0).padStart(5) + ' KB'

function webp(src, dst, { maxSide, quality }) {
  const vf = maxSide
    ? `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease:flags=lanczos`
    : 'null'
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-vf', vf,
    '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', '-pix_fmt', 'yuva420p', dst])
  console.log(`${kb(src)} → ${kb(dst)}  ${dst.slice(pub.length + 1)}`)
}

mkdirSync(join(pub, 'avatars'), { recursive: true })
for (const id of AVATARS) webp(join(pub, `${id}.png`), join(pub, 'avatars', `${id}.webp`), { maxSide: 512, quality: 82 })
webp(join(pub, 'title.png'), join(pub, 'title.webp'), { quality: 85 })
