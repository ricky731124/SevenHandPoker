// Remove a green-screen background from character PNGs and despill edges.
// Usage: node scripts/dechroma.mjs cat.png bird.png
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'

const PUBLIC = path.resolve('public')
const BACKUP = path.join(PUBLIC, 'originals')
fs.mkdirSync(BACKUP, { recursive: true })

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('no files given')
  process.exit(1)
}

for (const name of files) {
  const src = path.join(PUBLIC, name)
  const buf = fs.readFileSync(src)
  // back up original once
  const bak = path.join(BACKUP, name)
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, buf)

  const png = PNG.sync.read(buf)
  const { data, width, height } = png
  let keyed = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    // green-screen test: green clearly dominant
    const greenish = g > 90 && g > r * 1.35 && g > b * 1.35
    if (greenish) {
      // Strong green → fully transparent. Partial green (edge) → soften alpha.
      const dom = g - Math.max(r, b)
      if (dom > 60) {
        data[i + 3] = 0
        keyed++
      } else {
        // edge pixel: reduce alpha proportionally and despill
        data[i + 3] = Math.max(0, Math.round(255 * (1 - dom / 60)))
        const cap = Math.round(Math.max(r, b) * 1.1)
        if (g > cap) data[i + 1] = cap
      }
    } else {
      // despill any lingering green rim on kept pixels
      const cap = Math.round(Math.max(r, b) * 1.2)
      if (g > cap && g - Math.max(r, b) > 25) data[i + 1] = cap
    }
  }
  const out = PNG.sync.write(png)
  fs.writeFileSync(src, out)
  console.log(`${name}: ${width}x${height}, keyed ${keyed} px transparent`)
}
