// Shared image helpers: load JPEG-or-PNG (some AI exports are JPEG with a .png
// name) into a uniform {data:RGBA, width, height}, and write PNG.
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import fs from 'node:fs'

export function load(file) {
  const buf = fs.readFileSync(file)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
  if (isJpeg) {
    const { data, width, height } = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
    return { data, width, height, jpeg: true }
  }
  const png = PNG.sync.read(buf)
  return { data: png.data, width: png.width, height: png.height, jpeg: false }
}

export function writePng(file, img) {
  const png = new PNG({ width: img.width, height: img.height })
  png.data.set(img.data)
  fs.writeFileSync(file, PNG.sync.write(png))
}

export function cropPng(img, x, y, w, h, out) {
  const png = new PNG({ width: w, height: h })
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const si = ((y + j) * img.width + (x + i)) * 4
      const di = (j * w + i) * 4
      png.data[di] = img.data[si]
      png.data[di + 1] = img.data[si + 1]
      png.data[di + 2] = img.data[si + 2]
      png.data[di + 3] = img.data[si + 3]
    }
  fs.writeFileSync(out, PNG.sync.write(png))
}

// ---- 以下為主線關卡圖的共用處理(scripts/stage-art.mjs 用) -----------------------

const isGreenPx = (r, g, b) => g > 90 && g > r * 1.3 && g > b * 1.3
const isWhitePx = (r, g, b) => Math.min(r, g, b) > 220 && Math.max(r, g, b) - Math.min(r, g, b) < 28

/** 綠幕去背(全圖):明顯綠→全透明、邊緣半綠→半透明+去綠溢色。回傳全透明像素數。 */
export function dechroma(img) {
  const { data } = img
  let keyed = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (g > 90 && g > r * 1.35 && g > b * 1.35) {
      const dom = g - Math.max(r, b)
      if (dom > 60) {
        data[i + 3] = 0
        keyed++
      } else {
        data[i + 3] = Math.max(0, Math.round(255 * (1 - dom / 60)))
        const cap = Math.round(Math.max(r, b) * 1.1)
        if (g > cap) data[i + 1] = cap
      }
    } else {
      const cap = Math.round(Math.max(r, b) * 1.2)
      if (g > cap && g - Math.max(r, b) > 25) data[i + 1] = cap
    }
  }
  return keyed
}

/** 貼圖去背:從四邊往內 flood-fill「綠(+白色割線邊)」,只刪跟背景連通的,圖內白色保留。
 *  回傳刪除百分比。 */
export function keyFlood(img, { white = false } = {}) {
  const { data, width, height } = img
  const N = width * height
  const bg = new Uint8Array(N)
  const isBg = (idx) => {
    const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2]
    return isGreenPx(r, g, b) || (white && isWhitePx(r, g, b))
  }
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const idx = y * width + x
    if (bg[idx] || !isBg(idx)) return
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
  // 白邊和綠底交界那圈半綠半白的像素會被 flood 漏掉,留下一圈虛線 → 把沒連到主體的小碎塊也當背景刪掉
  const label = new Int32Array(N).fill(-1)
  const sizes = []
  for (let s = 0; s < N; s++) {
    if (bg[s] || label[s] >= 0) continue
    const id = sizes.length
    let n = 0
    const st = [s]
    label[s] = id
    while (st.length) {
      const p = st.pop()
      n++
      const x = p % width, y = (p - x) / width
      for (const q of [x + 1 < width ? p + 1 : -1, x > 0 ? p - 1 : -1, y + 1 < height ? p + width : -1, y > 0 ? p - width : -1]) {
        if (q >= 0 && !bg[q] && label[q] < 0) { label[q] = id; st.push(q) }
      }
    }
    sizes.push(n)
  }
  const minIsland = N * 0.002
  for (let i = 0; i < N; i++) if (!bg[i] && sizes[label[i]] < minIsland) bg[i] = 1
  let removed = 0
  for (let i = 0; i < N; i++) {
    if (bg[i]) { data[i * 4 + 3] = 0; removed++; continue }
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    const cap = Math.round(Math.max(r, b) * 1.1)
    if (g > cap && g - Math.max(r, b) > 12) data[i * 4 + 1] = cap
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 1 : bg[y * width + x])
  for (let i = 0; i < N; i++) {
    if (bg[i]) continue
    const x = i % width, y = (i - x) / width
    if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) data[i * 4 + 3] = Math.min(data[i * 4 + 3], 170)
  }
  return ((removed / N) * 100).toFixed(1)
}

/**
 * 綠底圖的 AI 浮水印(Gemini 右下星星):在右下 25% 區找「非綠」的小連通塊,
 * 且不碰到區域的上/左邊界(=不是主體延伸進來的)→ 塗回純綠,之後去背就會消失。
 * 回傳塗掉的方框清單 [x,y,w,h]。
 */
export function removeCornerMark(img) {
  const { data, width, height } = img
  const x0 = Math.floor(width * 0.75), y0 = Math.floor(height * 0.75)
  const W = width - x0, H = height - y0
  // 背景色 = 最右下角 12×12 的平均;跟它色差夠大的才算「有東西」(淡淡的半透明星星也抓得到)
  let br = 0, bgc = 0, bb = 0
  for (let y = height - 12; y < height; y++)
    for (let x = width - 12; x < width; x++) {
      const i = (y * width + x) * 4
      br += data[i]; bgc += data[i + 1]; bb += data[i + 2]
    }
  br /= 144; bgc /= 144; bb /= 144
  const fg = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = ((y0 + y) * width + (x0 + x)) * 4
      const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bgc) + Math.abs(data[i + 2] - bb)
      if (d > 45) fg[y * W + x] = 1
    }
  const seen = new Uint8Array(W * H)
  const out = []
  for (let s = 0; s < W * H; s++) {
    if (!fg[s] || seen[s]) continue
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0
    const st = [s]
    seen[s] = 1
    while (st.length) {
      const p = st.pop()
      const x = p % W, y = (p - x) / W
      n++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const q = ny * W + nx
          if (fg[q] && !seen[q]) { seen[q] = 1; st.push(q) }
        }
    }
    const touchesSubject = minX === 0 || minY === 0
    if (touchesSubject || n < 6 || maxX - minX > 140 || maxY - minY > 140) continue
    const pad = 8
    const bx = Math.max(0, x0 + minX - pad), by = Math.max(0, y0 + minY - pad)
    const bx2 = Math.min(width - 1, x0 + maxX + pad), by2 = Math.min(height - 1, y0 + maxY + pad)
    for (let y = by; y <= by2; y++)
      for (let x = bx; x <= bx2; x++) {
        const i = (y * width + x) * 4
        data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; data[i + 3] = 255
      }
    out.push([bx, by, bx2 - bx + 1, by2 - by + 1])
  }
  return out
}

/** 照片/插畫背景的浮水印:用下方 dy 處的紋理平移蓋掉矩形,外圈 6px 羽化。 */
export function healFromBelow(img, x, y, w, h, dy) {
  const { data, width } = img
  const feather = 6
  const patch = []
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const s = ((y + j + dy) * width + (x + i)) * 4
      patch.push([data[s], data[s + 1], data[s + 2]])
    }
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const d = ((y + j) * width + (x + i)) * 4
      const [pr, pg, pb] = patch[j * w + i]
      const wgt = Math.min(1, Math.min(i, w - 1 - i, j, h - 1 - j) / feather)
      data[d] = Math.round(data[d] * (1 - wgt) + pr * wgt)
      data[d + 1] = Math.round(data[d + 1] * (1 - wgt) + pg * wgt)
      data[d + 2] = Math.round(data[d + 2] * (1 - wgt) + pb * wgt)
    }
}

/** 右下 30% 區最密集的「亮、低彩度」50px 方塊 → 浮水印候選(人工看 c 值判斷)。 */
export function scanWM(img) {
  const { data, width, height } = img
  const x0 = Math.floor(width * 0.7), y0 = Math.floor(height * 0.7)
  const W = width - x0, H = height - y0
  const m = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = ((y0 + y) * width + (x0 + x)) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      if ((r + g + b) / 3 > 150 && (mx === 0 ? 0 : (mx - mn) / mx) < 0.22 && !isGreenPx(r, g, b)) m[y * W + x] = 1
    }
  let best = { c: 0, x: 0, y: 0 }
  for (let y = 0; y + 50 <= H; y += 8)
    for (let x = 0; x + 50 <= W; x += 8) {
      let c = 0
      for (let j = 0; j < 50; j++) for (let i = 0; i < 50; i++) c += m[(y + j) * W + x + i]
      if (c > best.c) best = { c, x: x0 + x, y: y0 + y }
    }
  return best
}

/** 透明像素的 RGB 補成鄰近不透明像素的顏色(多輪擴散),縮圖時邊緣才不會滲出綠色。 */
export function bleed(img, passes = 6) {
  const { data, width, height } = img
  let known = new Uint8Array(width * height)
  for (let i = 0; i < known.length; i++) known[i] = data[i * 4 + 3] > 0 ? 1 : 0
  for (let p = 0; p < passes; p++) {
    const next = known.slice()
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const k = y * width + x
        if (known[k]) continue
        let r = 0, g = 0, b = 0, n = 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const q = ny * width + nx
          if (!known[q]) continue
          r += data[q * 4]; g += data[q * 4 + 1]; b += data[q * 4 + 2]; n++
        }
        if (n) {
          data[k * 4] = Math.round(r / n); data[k * 4 + 1] = Math.round(g / n); data[k * 4 + 2] = Math.round(b / n)
          next[k] = 1
        }
      }
    known = next
  }
}
