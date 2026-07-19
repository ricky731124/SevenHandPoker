import { create } from 'zustand'

export type Screen = 'menu' | 'howto' | 'settings' | 'game'
export type GameMode = 'ai' | 'host' | 'guest'

export interface Settings {
  music: boolean
  musicVolume: number
  sfx: boolean
  sfxVolume: number
  cardBack: string // theme key, e.g. 'blue'
  table: string // theme key, e.g. 'red-velvet'
}

const SETTINGS_KEY = 'shp.settings'

const defaultSettings: Settings = {
  music: false,
  musicVolume: 0.5,
  sfx: true,
  sfxVolume: 0.7,
  cardBack: 'blue',
  table: 'red-velvet',
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return defaultSettings
}

interface AppState {
  screen: Screen
  settings: Settings
  /** Pending game launch config, consumed by Game screen. */
  pendingGame: { mode: GameMode; roomId?: string } | null
  go: (screen: Screen) => void
  launchGame: (cfg: { mode: GameMode; roomId?: string }) => void
  updateSettings: (patch: Partial<Settings>) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'menu',
  settings: loadSettings(),
  pendingGame: null,
  go: (screen) => set({ screen }),
  launchGame: (cfg) => set({ pendingGame: cfg, screen: 'game' }),
  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    set({ settings: next })
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __app: typeof useAppStore }).__app = useAppStore
}
