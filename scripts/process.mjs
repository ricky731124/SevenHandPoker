// Master image processing for the stage-5/6 art drop.
//   node scripts/process.mjs preview   -> writes results to SCRATCH for review
//   node scripts/process.mjs commit    -> backs up originals + writes final files
import { load, writePng } from './imglib.mjs'
import fs from 'node:fs'
import path from 'node:path'

const MODE = process.argv[2] || 'preview'
const SCRATCH = process.argv[3]
const PUBLIC = path.resolve('public')
const MAPS = path.join(PUBLIC, 'maps')
const STICKERS = path.join(PUBLIC, 'stickers')
const ORIG = path.join(PUBLIC, 'originals')
fs.mkdirSync(ORIG, { recursive: true })

const out = (name) => (MODE === 'commit' ? name : path.join(SCRATCH, path.basename(name)))
function backup(name) {
  const src = path.join(PUBLIC, name)
  const bak = path.join(ORIG, name)
  if (!fs.existsSync(bak) && fs.existsSync(src)) fs.copyFileSync(src, bak)
}

// ---- green-screen key + despill (same rule as dechroma.mjs) ----------------
function dechroma(img) {
  const { data } = img
  let keyed = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const greenish = g > 90 && g > r * 1.35 && g > b * 1.35
    if (greenish) {
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

// paint a solid pure-green rectangle (so watermarks on the green key out cleanly)
function fillGreen(img, x, y, w, h) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const p = ((y + j) * img.width + (x + i)) * 4
      img.data[p] = 0; img.data[p + 1] = 255; img.data[p + 2] = 0; img.data[p + 3] = 255
    }
}

// heal a rectangle by copying clean texture translated from below (grass is
// high-frequency noise, so a translated copy is seamless), feathered at edges.
function healFromBelow(img, x, y, w, h, dy) {
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
      // feather weight: 0 at the outer 6px ring, 1 in the interior
      const edge = Math.min(i, w - 1 - i, j, h - 1 - j)
      const wgt = Math.min(1, edge / feather)
      data[d] = Math.round(data[d] * (1 - wgt) + pr * wgt)
      data[d + 1] = Math.round(data[d + 1] * (1 - wgt) + pg * wgt)
      data[d + 2] = Math.round(data[d + 2] * (1 - wgt) + pb * wgt)
    }
}

// quick watermark scan: count bright low-saturation pixels in bottom-right
function scanWM(img) {
  const { data, width, height } = img
  const x0 = Math.floor(width * 0.7), y0 = Math.floor(height * 0.7)
  let best = { c: 0, x: 0, y: 0 }
  const white = []
  for (let y = y0; y < height; y++)
    for (let x = x0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const sat = mx === 0 ? 0 : (mx - mn) / mx
      const bright = (r + g + b) / 3
      if (bright > 150 && sat < 0.22 && !(g > r * 1.2 && g > b * 1.2)) white.push([x, y])
    }
  for (let y = y0; y < height - 50; y += 8)
    for (let x = x0; x < width - 50; x += 8) {
      let c = 0
      for (const [wx, wy] of white) if (wx >= x && wx < x + 50 && wy >= y && wy < y + 50) c++
      if (c > best.c) best = { c, x, y }
    }
  return best
}

// ---- stage4: JPEG background, inpaint the Gemini sparkle -> maps/stage4.png -
{
  const im = load(path.join(PUBLIC, 'stage4.png'))
  healFromBelow(im, 1193, 650, 44, 62, 70)
  if (MODE === 'commit') { backup('stage4.png'); writePng(path.join(MAPS, 'stage4.png'), im) }
  else writePng(path.join(SCRATCH, 'stage4_out.png'), im)
  console.log('stage4 healed', im.width + 'x' + im.height)
}

// ---- stage5 / stage6: JPEG backgrounds, verify clean -> maps/ --------------
for (const n of ['stage5', 'stage6']) {
  const im = load(path.join(PUBLIC, n + '.png'))
  console.log(n, im.width + 'x' + im.height, 'wm-scan densest:', scanWM(im))
  if (MODE === 'commit') { backup(n + '.png'); writePng(path.join(MAPS, n + '.png'), im) }
  else writePng(path.join(SCRATCH, n + '_out.png'), im)
}

// ---- cat3: fill 2 sparkles green, then key -> public/cat3.png --------------
{
  const im = load(path.join(PUBLIC, 'cat3.png'))
  fillGreen(im, 858, 852, im.width - 858, im.height - 852) // clean bottom-right corner
  const k = dechroma(im)
  if (MODE === 'commit') { backup('cat3.png'); writePng(path.join(PUBLIC, 'cat3.png'), im) }
  else writePng(path.join(SCRATCH, 'cat3_out.png'), im)
  console.log('cat3 keyed', k)
}

// ---- bird2: fill 1 sparkle green, then key -> public/bird2.png -------------
{
  const im = load(path.join(PUBLIC, 'bird2.png'))
  fillGreen(im, 955, 740, 195, 150)
  const k = dechroma(im)
  if (MODE === 'commit') { backup('bird2.png'); writePng(path.join(PUBLIC, 'bird2.png'), im) }
  else writePng(path.join(SCRATCH, 'bird2_out.png'), im)
  console.log('bird2 keyed', k)
}

// ---- 4.png sticker: JPEG green screen -> public/stickers/4.png -------------
{
  const im = load(path.join(PUBLIC, '4.png'))
  const k = dechroma(im)
  if (MODE === 'commit') {
    backup('4.png')
    fs.mkdirSync(STICKERS, { recursive: true })
    writePng(path.join(STICKERS, '4.png'), im)
  } else writePng(path.join(SCRATCH, 'sticker4_out.png'), im)
  console.log('4.png keyed', k)
}
