// Enlarge a transparent PNG's content in-place by a factor, keeping the canvas
// size (centre zoom + crop). Bilinear, alpha-preserving. The subject sits in the
// middle with transparent margin, so zooming makes it read bigger in the avatar
// frame. Usage: node scripts/upscale.mjs <in> <out> <factor>
import { PNG } from 'pngjs'
import fs from 'node:fs'

const [inp, outp, fs_] = process.argv.slice(2)
const factor = +fs_
const src = PNG.sync.read(fs.readFileSync(inp))
const { width: W, height: H } = src
const out = new PNG({ width: W, height: H })
const cx = (W - 1) / 2, cy = (H - 1) / 2

function sample(fx, fy, ch) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1)
  if (x0 < 0 || y0 < 0 || x0 > W - 1 || y0 > H - 1) return 0
  const dx = fx - x0, dy = fy - y0
  const p = (x, y) => src.data[(y * W + x) * 4 + ch]
  return (
    p(x0, y0) * (1 - dx) * (1 - dy) +
    p(x1, y0) * dx * (1 - dy) +
    p(x0, y1) * (1 - dx) * dy +
    p(x1, y1) * dx * dy
  )
}

for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    // output pixel maps back to a source point closer to centre (zoom in)
    const sx = cx + (x - cx) / factor
    const sy = cy + (y - cy) / factor
    const di = (y * W + x) * 4
    for (let ch = 0; ch < 4; ch++) out.data[di + ch] = Math.round(sample(sx, sy, ch))
  }
fs.writeFileSync(outp, PNG.sync.write(out))
console.log(`upscaled ${inp} x${factor} -> ${outp} (${W}x${H})`)
