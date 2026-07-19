/**
 * Lightweight SFX via WebAudio — no asset files needed.
 * click / hover are single tones; showdown / win / lose are short blended cues.
 * Background music is handled separately (user supplies files) via Howler later.
 */
import { useAppStore } from '../state/appStore'

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; delay?: number; sweepTo?: number } = {},
) {
  const c = ac()
  if (!c) return
  const { sfx, sfxVolume } = useAppStore.getState().settings
  if (!sfx) return
  const t0 = c.currentTime + (opts.delay ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, t0)
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + dur)
  const peak = (opts.gain ?? 0.2) * sfxVolume
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export const sfx = {
  /** call once from a user gesture to unlock audio on mobile */
  unlock() {
    ac()
  },
  click() {
    tone(660, 0.06, { type: 'triangle', gain: 0.18 })
  },
  hover() {
    tone(1040, 0.04, { type: 'sine', gain: 0.08 })
  },
  select() {
    tone(880, 0.05, { type: 'sine', gain: 0.12 })
    tone(1180, 0.05, { type: 'sine', gain: 0.08, delay: 0.03 })
  },
  deal() {
    tone(320, 0.05, { type: 'triangle', gain: 0.12, sweepTo: 220 })
  },
  coin() {
    tone(1320, 0.09, { type: 'triangle', gain: 0.14, sweepTo: 1760 })
    tone(1760, 0.12, { type: 'sine', gain: 0.1, delay: 0.05 })
  },
  showdown() {
    tone(440, 0.14, { type: 'sawtooth', gain: 0.12 })
    tone(660, 0.16, { type: 'triangle', gain: 0.12, delay: 0.08 })
  },
  win() {
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.16, delay: i * 0.1 }))
  },
  lose() {
    ;[440, 349, 262].forEach((f, i) => tone(f, 0.28, { type: 'sine', gain: 0.16, delay: i * 0.12 }))
  },
}
