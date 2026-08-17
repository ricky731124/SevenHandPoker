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
