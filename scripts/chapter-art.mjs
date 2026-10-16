// 主線章節大地圖：art/chapters/ch{N}.png(母檔,AI 產的原圖) → public/chapters/ch{N}.webp(網頁用)
// + 極小模糊預覽圖(base64 寫進 src/ui/screens/chapterThumbs.ts,切章當下先顯示,清楚的圖載完再淡入)。
//
//   node scripts/chapter-art.mjs          → 全部章節重產
//
// 網頁圖不放大、照母檔解析度輸出;品質從 80 往下試,壓到 MAX_KB 以下為止(切章不能讀太久)。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ffmpeg from 'ffmpeg-static'

const SRC = path.resolve('art', 'chapters')
const OUT = path.resolve('public', 'chapters')
const THUMBS = path.resolve('src', 'ui', 'screens', 'chapterThumbs.ts')
const MAX_KB = 250
const THUMB_W = 64

fs.mkdirSync(OUT, { recursive: true })
const kb = (f) => fs.statSync(f).size / 1024
const run = (args) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args])

const files = fs.readdirSync(SRC).filter((f) => /^ch\d+\.png$/.test(f)).sort()
const thumbs = {}
for (const f of files) {
  const n = Number(f.match(/\d+/)[0])
  const src = path.join(SRC, f)
  const out = path.join(OUT, `ch${n}.webp`)
  let q = 80
  for (;;) {
    run(['-i', src, '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', '-pix_fmt', 'yuv420p', out])
    if (kb(out) <= MAX_KB || q <= 40) break
    q -= 4
  }
  const tmp = path.join(OUT, `_thumb${n}.webp`)
  run(['-i', src, '-vf', `scale=${THUMB_W}:-2:flags=area`, '-c:v', 'libwebp', '-quality', '50', tmp])
  thumbs[n] = `data:image/webp;base64,${fs.readFileSync(tmp).toString('base64')}`
  fs.unlinkSync(tmp)
  console.log(`ch${n}: ${kb(src).toFixed(0)} KB png → webp q${q} ${kb(out).toFixed(0)} KB, thumb ${thumbs[n].length} B`)
}

const body = Object.entries(thumbs)
  .map(([n, uri]) => `  ${n}: '${uri}',`)
  .join('\n')
fs.writeFileSync(
  THUMBS,
  `// 由 scripts/chapter-art.mjs 產生,別手改。章節大地圖的極小預覽圖(${THUMB_W}px 寬),切章時先模糊顯示。\nexport const CHAPTER_THUMBS: Record<number, string> = {\n${body}\n}\n`,
)
console.log(`→ ${path.relative(process.cwd(), THUMBS)}`)
