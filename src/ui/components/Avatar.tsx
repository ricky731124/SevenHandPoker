import { useMemo } from 'react'
import { hashSeed, mulberry32 } from '../../game/rng'

/**
 * Procedural cute animal avatar (cat / dog / chick / bird / snake),
 * fully derived from a seed string so it's stable per player per game.
 * Can be replaced by a user PNG later by swapping this component.
 */

const ANIMALS = ['cat', 'dog', 'chick', 'bird', 'snake'] as const
type Animal = (typeof ANIMALS)[number]

const PALETTES: Record<Animal, string[]> = {
  cat: ['#f6a94b', '#b0b7c3', '#e7e2d8', '#6d5b4b'],
  dog: ['#c79355', '#8a5a2b', '#e8cfa8', '#4a3524'],
  chick: ['#ffd54a', '#ffca28', '#fff0a8'],
  bird: ['#4fb0e8', '#57c785', '#f06f9b', '#8a7de0'],
  snake: ['#7dc86a', '#5aa84f', '#a7e08a'],
}

function pick<T>(arr: readonly T[], r: number): T {
  return arr[Math.floor(r * arr.length) % arr.length]
}

export default function Avatar({ seed, size = 56 }: { seed: string; size?: number }) {
  const { animal, fur, belly, bg } = useMemo(() => {
    const rng = mulberry32(hashSeed(seed))
    const animal = pick(ANIMALS, rng()) as Animal
    const pal = PALETTES[animal]
    const fur = pick(pal, rng())
    const belly = '#fff6e6'
    const bgHues = ['#7a1420', '#123a86', '#2e6f4e', '#5a3a86', '#8a5a1a']
    const bg = pick(bgHues, rng())
    return { animal, fur, belly, bg }
  }, [seed])

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`avatar-${animal}`}>
      <defs>
        <radialGradient id={`ab-${seed}`} cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
          <stop offset="100%" stopColor={bg} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#ab-${seed})`} stroke="var(--gold-3)" strokeWidth="3" />
      <g>{renderAnimal(animal, fur, belly)}</g>
    </svg>
  )
}

function eyes(cx1 = 40, cx2 = 60, cy = 50, r = 4) {
  return (
    <>
      <circle cx={cx1} cy={cy} r={r} fill="#20242b" />
      <circle cx={cx2} cy={cy} r={r} fill="#20242b" />
      <circle cx={cx1 - 1.2} cy={cy - 1.2} r={1.3} fill="#fff" />
      <circle cx={cx2 - 1.2} cy={cy - 1.2} r={1.3} fill="#fff" />
    </>
  )
}

function renderAnimal(animal: Animal, fur: string, belly: string) {
  switch (animal) {
    case 'cat':
      return (
        <>
          <path d="M28 34 L34 20 L44 32 Z" fill={fur} />
          <path d="M72 34 L66 20 L56 32 Z" fill={fur} />
          <circle cx="50" cy="52" r="26" fill={fur} />
          <ellipse cx="50" cy="60" rx="16" ry="12" fill={belly} opacity="0.55" />
          {eyes()}
          <path d="M50 58 l-4 4 M50 58 l4 4" stroke="#20242b" strokeWidth="2" strokeLinecap="round" />
          <path d="M46 55 h8" stroke="#e07a8a" strokeWidth="3" strokeLinecap="round" />
          <g stroke="#20242b" strokeWidth="1.2" strokeLinecap="round">
            <path d="M40 60 h-14 M40 63 h-13 M60 60 h14 M60 63 h13" />
          </g>
        </>
      )
    case 'dog':
      return (
        <>
          <ellipse cx="26" cy="46" rx="9" ry="16" fill={fur} />
          <ellipse cx="74" cy="46" rx="9" ry="16" fill={fur} />
          <circle cx="50" cy="52" r="26" fill={fur} />
          <ellipse cx="50" cy="62" rx="15" ry="11" fill={belly} opacity="0.6" />
          {eyes()}
          <ellipse cx="50" cy="62" rx="5" ry="4" fill="#20242b" />
          <path d="M50 66 q-6 6 -12 3 M50 66 q6 6 12 3" stroke="#20242b" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )
    case 'chick':
      return (
        <>
          <circle cx="50" cy="52" r="27" fill={fur} />
          <path d="M46 24 q4 -8 8 0 q-4 3 -8 0" fill="#e0532b" />
          {eyes(41, 59)}
          <path d="M44 60 l6 5 l6 -5 Z" fill="#f0902b" />
        </>
      )
    case 'bird':
      return (
        <>
          <circle cx="50" cy="52" r="26" fill={fur} />
          <ellipse cx="50" cy="60" rx="14" ry="11" fill={belly} opacity="0.5" />
          <path d="M32 30 q6 -10 12 -2" fill={fur} />
          {eyes()}
          <path d="M45 60 l5 4 l5 -4 l-5 -3 Z" fill="#f0a02b" />
        </>
      )
    case 'snake':
      return (
        <>
          <circle cx="50" cy="52" r="26" fill={fur} />
          <ellipse cx="50" cy="58" rx="15" ry="13" fill={belly} opacity="0.4" />
          {eyes(42, 58, 48, 4.5)}
          <path d="M50 60 v6 M50 66 l-4 3 M50 66 l4 3" stroke="#c0392b" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M38 40 q6 -4 0 -8 M62 40 q-6 -4 0 -8" stroke={fur} strokeWidth="3" fill="none" />
        </>
      )
  }
}
