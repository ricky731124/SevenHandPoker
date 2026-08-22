// One-shot SFX pipeline: back up the chosen source files, then convert them to a
// single format (.mp3) in public/sounds/ with per-sound trims + loudness passes.
// Uses the ffmpeg-static binary (dev dep) so nothing is installed system-wide.
// Re-runnable: outputs are overwritten; backups are only copied if missing.
import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import ffmpeg from 'ffmpeg-static'

const ROOT = process.cwd()
const SRC = join(ROOT, '_sfx_src')
const BACKUP = join(SRC, '_backup')
const OUT = join(ROOT, 'public', 'sounds')
mkdirSync(BACKUP, { recursive: true })
mkdirSync(OUT, { recursive: true })

const K_CASINO = 'kenney_casino-audio/Audio'
const K_UI = 'kenney_interface-sounds/Audio'

// name → { src, jingle?, trim? (secs), fade? [start,dur] }
const MAP = {
  // ---- foley (mono, 96k, no loudnorm; balanced by code vol) ----
  deal: { src: `${K_CASINO}/card-fan-2.ogg` },
  draw: { src: `${K_CASINO}/card-slide-6.ogg` },
  click: { src: `${K_UI}/click_003.ogg` },
  hover: { src: `${K_UI}/tick_004.ogg` },
  select: { src: `${K_UI}/drop_002.ogg` },
  place: { src: `${K_CASINO}/card-place-3.ogg` },
  error: { src: `${K_UI}/select_002.ogg` },
  success: { src: `${K_UI}/confirmation_001.ogg` },
  countdown: { src: `${K_UI}/glass_002.ogg` },
  // ---- jingles (stereo, 144k, loudnorm I=-16) ----
  coin: { src: '557115__firediesproductions__fdp-coin-flip-2.wav', jingle: true },
  coinwin: { src: '676401__cjspellsfish__score-1.mp3', jingle: true },
  coinfail: { src: '138490__justinvoke__powerdown-2.wav', jingle: true, trim: 1.6, fade: [1.4, 0.2] }, // 搶金幣失敗(輸家)
  // 格子裡「牌對牌」的對決 → 原本的鋼琴,裁到 2s
  showdown: { src: '352655__foolboymedia__piano-notification-5a.mp3', jingle: true, trim: 2.0, fade: [1.8, 0.2] },
  // 進場「BATTLE」撞擊 → riser-hit,不裁(保留原始長度,只在程式端調音量)
  battle: { src: '649826__audiopapkin__riser-hit-sfx-044.wav', jingle: true },
  win: { src: '521645__fupicat__winfantasia.wav', jingle: true, trim: 3.0, fade: [2.75, 0.25] },
  lose: { src: '362206__taranp__horn_fail_wahwah_1.wav', jingle: true, trim: 3.0, fade: [2.75, 0.25] },
  special: { src: '853303__tommasomotteran__magic-healing-spell-sfx-fantasy-rpg-restore-effect.wav', jingle: true },
  reward: { src: '619838__cogfirestudios__achievement-happy-beeps-jingle.wav', jingle: true, trim: 1.5, fade: [1.3, 0.2] }, // 配合 toast 1.5s
  achievement: { src: '810753__mokasza__level-up-01.mp3', jingle: true },
}

let total = 0
for (const [name, cfg] of Object.entries(MAP)) {
  const inPath = join(SRC, cfg.src)
  if (!existsSync(inPath)) {
    console.error(`MISSING SOURCE: ${cfg.src}`)
    process.exit(1)
  }
  // back up the original once (keep original filename)
  const bak = join(BACKUP, basename(cfg.src))
  if (!existsSync(bak)) copyFileSync(inPath, bak)

  const outPath = join(OUT, `${name}.mp3`)
  const args = ['-y', '-i', inPath]
  const filters = []
  if (cfg.jingle) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11')
  if (cfg.fade) filters.push(`afade=t=out:st=${cfg.fade[0]}:d=${cfg.fade[1]}`)
  if (filters.length) args.push('-af', filters.join(','))
  if (cfg.trim) args.push('-t', String(cfg.trim))
  if (cfg.jingle) args.push('-ac', '2', '-b:a', '144k')
  else args.push('-ac', '1', '-b:a', '96k')
  args.push('-ar', '44100', outPath)

  execFileSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const kb = statSync(outPath).size / 1024
  total += kb
  console.log(`${name.padEnd(12)} ${kb.toFixed(1).padStart(7)} KB  <- ${basename(cfg.src)}`)
}
console.log(`----\nTOTAL ${(total / 1024).toFixed(2)} MB across ${Object.keys(MAP).length} files`)
console.log(`backups in ${BACKUP}`)
