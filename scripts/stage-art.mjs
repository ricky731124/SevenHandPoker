// 主線新關卡「三張圖」一次處理(去綠背 / 去浮水印 / 調尺寸 / 壓縮 / 轉 webp)。
// 使用者把原圖照名字丟進 _art_src/stage{N}/:boss.png、map.png、sticker.png(JPEG 偽裝 .png 也行)。
//
//   node scripts/stage-art.mjs <N> <avatarId> <stickerId>           → 預覽,輸出到 _art_src/stage{N}/_preview/
//   node scripts/stage-art.mjs <N> <avatarId> <stickerId> commit    → 寫進正式位置
//
// 產出(commit):
//   public/{avatarId}.png         boss 母檔,1150×912(跟其他 boss 同尺寸;網頁不直接載)
//   public/avatars/{avatarId}.webp 網頁用頭像 512px(build-img 同規格)
//   public/maps/stage{N}.png      地圖母檔 1328×800
//   public/maps/stage{N}.webp     網頁用地圖
//   public/stickers/{stickerId}.png 貼圖 512×512(顯示最大 168px,3 倍螢幕也夠)
// 原圖留在 _art_src/stage{N}/(不進 git)當備份,要重調就從那裡重跑。
//
// 選項:--heal-map x,y,w,h[,dy]  地圖若有浮水印,用下方紋理羽化補掉該矩形(dy 預設 = h+8)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ffmpeg from 'ffmpeg-static'
import { load, writePng, keyFlood, removeCornerMark, healFromBelow, scanWM, bleed } from './imglib.mjs'

const [N, AVATAR, STICKER, MODE = 'preview'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!N || !AVATAR || !STICKER) {
  console.error('用法: node scripts/stage-art.mjs <N> <avatarId> <stickerId> [commit]')
  process.exit(1)
}
const healArg = process.argv.find((a) => a.startsWith('--heal-map'))
const heal = healArg ? process.argv[process.argv.indexOf(healArg) + 1].split(',').map(Number) : null

const SRC = path.resolve('_art_src', `stage${N}`)
const PUB = path.resolve('public')
const commit = MODE === 'commit'
const OUT = commit ? null : path.join(SRC, '_preview')
if (OUT) fs.mkdirSync(OUT, { recursive: true })
const dst = (rel) => (commit ? path.join(PUB, rel) : path.join(OUT, rel.replace(/[\\/]/g, '_')))
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB'
const tmp = path.join(SRC, '_tmp.png')

/** ffmpeg 縮放:cover=填滿裁切(boss/地圖),fit=等比塞進方框(貼圖)。 */
function scaleTo(srcPng, out, w, h, how) {
  const vf =
    how === 'cover'
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', srcPng, '-vf', vf, '-pix_fmt', 'rgba', out])
}
function webp(srcPng, out, { maxSide, quality, alpha }) {
  const vf = maxSide
    ? `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease:flags=lanczos`
    : 'null'
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', srcPng, '-vf', vf, '-c:v', 'libwebp',
    '-quality', String(quality), '-compression_level', '6', '-pix_fmt', alpha ? 'yuva420p' : 'yuv420p', out])
}

// ---- boss:去浮水印 → 去綠背 → 1150×912 → avatars webp -----------------------
{
  const im = load(path.join(SRC, 'boss.png'))
  const marks = removeCornerMark(im)
  // 從四邊+同色口袋 flood 去背(會連外圈淡綠光暈一起去掉;全圖 dechroma 會留一圈淡綠,第 8 關踩過)
  const keyed = keyFlood(im) + '%'
  bleed(im) // 透明像素補上鄰近顏色,縮圖時邊緣才不會滲綠
  writePng(tmp, im)
  const master = dst(`${AVATAR}.png`)
  scaleTo(tmp, master, 1150, 912, 'cover')
  const av = dst(`avatars/${AVATAR}.webp`)
  webp(master, av, { maxSide: 512, quality: 82, alpha: true })
  console.log(`boss  ${im.width}x${im.height} 浮水印${marks.length}處 ${JSON.stringify(marks)} 去背${keyed} → ${kb(master)} / webp ${kb(av)}`)
}

// ---- map:檢查/補浮水印 → 1328×800 → webp ------------------------------------
{
  const im = load(path.join(SRC, 'map.png'))
  if (heal) healFromBelow(im, heal[0], heal[1], heal[2], heal[3], heal[4] ?? heal[3] + 8)
  writePng(tmp, im)
  const master = dst(`maps/stage${N}.png`)
  scaleTo(tmp, master, 1328, 800, 'cover')
  const w = dst(`maps/stage${N}.webp`)
  webp(master, w, { quality: 80 })
  console.log(`map   ${im.width}x${im.height} 浮水印掃描(最密白點) ${JSON.stringify(scanWM(im))}${heal ? ' 已補 ' + heal : ''} → ${kb(master)} / webp ${kb(w)}`)
}

// ---- sticker:去浮水印 → 去綠背+白邊 → 512×512 --------------------------------
{
  const im = load(path.join(SRC, 'sticker.png'))
  const marks = removeCornerMark(im)
  const pct = keyFlood(im, { white: true })
  bleed(im)
  writePng(tmp, im)
  const out = dst(`stickers/${STICKER}.png`)
  scaleTo(tmp, out, 512, 512, 'fit')
  console.log(`sticker ${im.width}x${im.height} 浮水印${marks.length}處 去背${pct}% → ${kb(out)}`)
}

fs.rmSync(tmp, { force: true })
console.log(commit ? '已寫入 public/' : `預覽在 ${OUT}`)
