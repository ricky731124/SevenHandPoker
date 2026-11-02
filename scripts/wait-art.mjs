// 配對等待小劇場的角色姿勢圖(2026-11-02):去白背 → 裁成同一個框(對齊腳底)→ 縮小轉 webp。
// 原圖放 art/wait/{角色}_{姿勢}.png(白底,1024×1024),一次處理全部:
//   node scripts/wait-art.mjs            → 預覽,輸出到 _art_src/wait/_preview/(不進 git)
//   node scripts/wait-art.mjs commit     → 寫進 public/wait/{name}.webp
// 同一隻角色(檔名底線前相同)的幾張姿勢裁同一個框,切換姿勢時才不會跳位置。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ffmpeg from 'ffmpeg-static'
import { PNG } from 'pngjs'
import { load, writePng, bleed } from './imglib.mjs'

// 白底去背(這批專用,imglib 的 keyFlood 是綠幕取向:白色門檻寬、全圖白點都當起點 →
// 會吃掉波斯的淺色毛尖和眼睛反光)。這裡:
//  ① 只有「很白」且從四邊連過去的才算背景
//  ② 被圍住的白色口袋夠大(> 0.06% 畫面,例:舉起的手和頭中間)才挖掉,眼睛反光 / 牙齒留著
//  ③ 邊緣 2 圈把白色「反混色」掉(抗鋸齒的灰白邊變成半透明的深色),深綠桌面上才不會有白毛邊
const isBgWhite = (r, g, b) => Math.min(r, g, b) > 236 && Math.max(r, g, b) - Math.min(r, g, b) < 16
function keyWhite(img) {
  const { data, width, height } = img
  const N = width * height
  const white = new Uint8Array(N)
  for (let i = 0; i < N; i++) white[i] = isBgWhite(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) ? 1 : 0
  // 白色連通塊:碰到四邊或夠大 → 背景
  const bg = new Uint8Array(N)
  const seen = new Uint8Array(N)
  const minPocket = N * 0.0006 // 1024² ≈ 630 px:眼睛反光 / 牙齒 ≤ 200,英短舉手和頭中間那塊 1268
  for (let s = 0; s < N; s++) {
    if (!white[s] || seen[s]) continue
    const comp = [s]
    seen[s] = 1
    let edge = false
    for (let j = 0; j < comp.length; j++) {
      const p = comp[j]
      const x = p % width, y = (p - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true
      for (const q of [x + 1 < width ? p + 1 : -1, x > 0 ? p - 1 : -1, y + 1 < height ? p + width : -1, y > 0 ? p - width : -1])
        if (q >= 0 && white[q] && !seen[q]) { seen[q] = 1; comp.push(q) }
    }
    if (edge || comp.length > minPocket) for (const p of comp) bg[p] = 1
  }
  // 沒連到主體的小碎塊(雜點)也當背景
  const label = new Int32Array(N).fill(-1)
  const sizes = []
  for (let s = 0; s < N; s++) {
    if (bg[s] || label[s] >= 0) continue
    const id = sizes.length
    const st = [s]
    label[s] = id
    let n = 0
    while (st.length) {
      const p = st.pop()
      n++
      const x = p % width, y = (p - x) / width
      for (const q of [x + 1 < width ? p + 1 : -1, x > 0 ? p - 1 : -1, y + 1 < height ? p + width : -1, y > 0 ? p - width : -1])
        if (q >= 0 && !bg[q] && label[q] < 0) { label[q] = id; st.push(q) }
    }
    sizes.push(n)
  }
  for (let i = 0; i < N; i++) if (!bg[i] && sizes[label[i]] < N * 0.002) bg[i] = 1
  // 離背景幾圈(只算前 2 圈)
  const dist = new Uint8Array(N).fill(255)
  for (let i = 0; i < N; i++) if (bg[i]) dist[i] = 0
  for (let d = 1; d <= 2; d++)
    for (let i = 0; i < N; i++) {
      if (dist[i] !== 255) continue
      const x = i % width, y = (i - x) / width
      if ((x > 0 && dist[i - 1] === d - 1) || (x + 1 < width && dist[i + 1] === d - 1) || (y > 0 && dist[i - width] === d - 1) || (y + 1 < height && dist[i + width] === d - 1)) dist[i] = d
    }
  let removed = 0
  for (let i = 0; i < N; i++) {
    if (bg[i]) { data[i * 4 + 3] = 0; removed++; continue }
    if (dist[i] > 2) continue
    // 反混白:假設這格 = 深色描邊 × a + 白 × (1 - a),描邊最暗約 40
    const lo = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    const a = Math.min(1, Math.max(0, (255 - lo) / (255 - 40)))
    if (a >= 1) continue
    if (a < 0.04) { data[i * 4 + 3] = 0; removed++; continue }
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((data[i * 4 + c] - 255 * (1 - a)) / a)))
    data[i * 4 + 3] = Math.round(255 * a)
  }
  return +((removed / N) * 100).toFixed(1)
}

const commit = process.argv[2] === 'commit'
const SRC = path.resolve('art', 'wait')
const OUT = commit ? path.resolve('public', 'wait') : path.resolve('_art_src', 'wait', '_preview')
const TMP = path.resolve('_art_src', 'wait')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(TMP, { recursive: true })
const HEIGHT = 240 // 輸出高度(舞台上顯示約 80px,3 倍螢幕也夠)

const files = fs.readdirSync(SRC).filter((f) => /\.(png|jpe?g)$/i.test(f))
if (!files.length) {
  console.error(`art/wait/ 裡沒有圖`)
  process.exit(1)
}
const nameOf = (f) => path.basename(f).replace(/\.(png|jpe?g)$/i, '')
const whoOf = (f) => nameOf(f).split('_')[0]

// 1) 去白背,記下每張的不透明外框
const keyed = files.map((f) => {
  const im = load(path.join(SRC, f))
  const pct = keyWhite(im)
  bleed(im)
  let x0 = im.width, y0 = im.height, x1 = -1, y1 = -1
  for (let y = 0; y < im.height; y++)
    for (let x = 0; x < im.width; x++)
      if (im.data[(y * im.width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return { f, im, pct, box: { x0, y0, x1, y1 } }
})

// 2) 每隻角色的聯集外框(原圖同一個畫布大小 → 對齊腳底、左右位置一致)
const groups = new Map()
for (const k of keyed) {
  const b = groups.get(whoOf(k.f)) ?? { x0: Infinity, y0: Infinity, x1: -1, y1: -1 }
  groups.set(whoOf(k.f), { x0: Math.min(b.x0, k.box.x0), y0: Math.min(b.y0, k.box.y0), x1: Math.max(b.x1, k.box.x1), y1: Math.max(b.y1, k.box.y1) })
}

for (const k of keyed) {
  const u = groups.get(whoOf(k.f))
  const w = u.x1 - u.x0 + 1
  const h = u.y1 - u.y0 + 1
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = u.x0 + x
      const sy = u.y0 + y
      const di = (y * w + x) * 4
      if (sx >= k.im.width || sy >= k.im.height) continue
      const si = (sy * k.im.width + sx) * 4
      for (let c = 0; c < 4; c++) png.data[di + c] = k.im.data[si + c]
    }
  const name = nameOf(k.f)
  const tmp = path.join(TMP, `${name}.png`)
  writePng(tmp, { data: png.data, width: w, height: h })
  const out = path.join(OUT, `${name}.webp`)
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', tmp, '-vf', `scale=-2:${HEIGHT}:flags=lanczos`, '-c:v', 'libwebp', '-quality', '85', '-pix_fmt', 'yuva420p', out])
  console.log(`${name}: 去背 ${k.pct}%  ${w}×${h} → ${out}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
}
for (const [who, u] of groups) console.log(`${who} 共同外框 ${u.x1 - u.x0 + 1}×${u.y1 - u.y0 + 1}(原圖座標 ${u.x0},${u.y0})→ 高 ${HEIGHT}px`)
