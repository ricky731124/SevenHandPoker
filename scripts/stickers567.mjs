// Background-removal for the 5/6/7 stickers: green screen (#00FF00) + the white
// die-cut border that touches it. Flood-fills the "background" (green OR strong
// white) inward from the image borders, so only background-connected pixels are
// removed — interior whites in the artwork are preserved. Then despills green
// off the kept edge and feathers a 1px alpha ramp for a clean cut.
//   node scripts/stickers567.mjs preview <scratch>   -> writes *_out.png to scratch
//   node scripts/stickers567.mjs commit               -> backup src + write stickers/
import { load, writePng } from './imglib.mjs'
import fs from 'node:fs'
import path from 'node:path'

const MODE = process.argv[2] || 'preview'
const SCRATCH = process.argv[3]
const PUBLIC = path.resolve('public')
const STICKERS = path.join(PUBLIC, 'stickers')
const ORIG = path.join(PUBLIC, 'originals')
fs.mkdirSync(ORIG, { recursive: true })
if (MODE === 'commit') fs.mkdirSync(STICKERS, { recursive: true })

const isGreen = (r, g, b) => g > 90 && g > r * 1.3 && g > b * 1.3
const isWhite = (r, g, b) => Math.min(r, g, b) > 220 && Math.max(r, g, b) - Math.min(r, g, b) < 28

function processSticker(name) {
  const im = load(path.join(PUBLIC, name))
  const { data, width, height } = im
  const N = width * height
  const bg = new Uint8Array(N)
  const isBgPx = (idx) => {
    const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2]
    return isGreen(r, g, b) || isWhite(r, g, b)
  }
  // Flood-fill background inward from every border pixel.
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const idx = y * width + x
    if (bg[idx] || !isBgPx(idx)) return
    bg[idx] = 1
    stack.push(idx)
  }
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1) }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y) }
  while (stack.length) {
    const idx = stack.pop()
    const x = idx % width, y = (idx - x) / width
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }
  // Cut background; despill green off kept pixels.
  let removed = 0
  for (let i = 0; i < N; i++) {
    if (bg[i]) { data[i * 4 + 3] = 0; removed++; continue }
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    const cap = Math.round(Math.max(r, b) * 1.1)
    if (g > cap && g - Math.max(r, b) > 12) data[i * 4 + 1] = cap
  }
  // Feather: kept pixels touching a removed pixel get half alpha for a soft edge.
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 1 : bg[y * width + x])
  const soft = []
  for (let i = 0; i < N; i++) {
    if (bg[i]) continue
    const x = i % width, y = (i - x) / width
    if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) soft.push(i)
  }
  for (const i of soft) data[i * 4 + 3] = Math.min(data[i * 4 + 3], 170)

  const pct = ((removed / N) * 100).toFixed(1)
  if (MODE === 'commit') {
    if (!fs.existsSync(path.join(ORIG, name))) fs.copyFileSync(path.join(PUBLIC, name), path.join(ORIG, name))
    writePng(path.join(STICKERS, name), im)
  } else {
    writePng(path.join(SCRATCH, name.replace('.png', '_out.png')), im)
  }
  console.log(`${name}: removed ${pct}% (${im.width}x${im.height})`)
}

for (const n of ['5.png', '6.png', '7.png']) processSticker(n)
