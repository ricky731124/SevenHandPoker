import { create } from 'zustand'

export type Screen = 'menu' | 'howto' | 'settings' | 'personalize' | 'leaderboard' | 'game' | 'tutorial' | 'campaign' | 'campaignStages'
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
  /** Pending game launch config, consumed by Game screen. `special` = special-
   *  card room (loadout + pre-match pick + in-game activation). `timeLimit` =
   *  per-turn seconds (SPEC §15 / #9 create-match config). */
  pendingGame: { mode: GameMode; roomId?: string; special?: boolean; timeLimit?: number; campaignSubId?: string } | null
  /** A room code from a /?room= deep link, held until the identity gate resolves. */
  pendingRoom: string | null
  /** Room type of a deep-linked room (from ?type=), shown before joining. */
  pendingRoomType: 'normal' | 'special' | null
  /** Per-turn seconds of a deep-linked room (from ?time=). */
  pendingRoomTime: number | null
  /** Show the "register to keep your progress" prompt (set on a campaign clear
   *  while still anonymous; #9). */
  upgradePrompt: boolean
  /** AccountButton opens the register form when it sees this on the menu. */
  wantRegister: boolean
  /** AccountButton fires Google login when it sees this on the menu (from the
   *  upgrade prompt's 使用 Google 登入). */
  wantGoogle: boolean
  go: (screen: Screen) => void
  launchGame: (cfg: { mode: GameMode; roomId?: string; special?: boolean; timeLimit?: number; campaignSubId?: string }) => void
  setPendingRoom: (code: string | null, type?: 'normal' | 'special' | null, time?: number | null) => void
  updateSettings: (patch: Partial<Settings>) => void
  askUpgrade: () => void
  dismissUpgrade: () => void
  /** From the upgrade prompt's 遊戲帳號註冊: go to the menu and flag the register form. */
  requestRegister: () => void
  clearRegister: () => void
  /** From the upgrade prompt's 使用 Google 登入: go to the menu and flag Google login. */
  requestGoogle: () => void
  clearGoogle: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'menu',
  settings: loadSettings(),
  pendingGame: null,
  pendingRoom: null,
  pendingRoomType: null,
  pendingRoomTime: null,
  upgradePrompt: false,
  wantRegister: false,
  wantGoogle: false,
  go: (screen) => set({ screen }),
  launchGame: (cfg) => set({ pendingGame: cfg, screen: 'game' }),
  setPendingRoom: (code, type = null, time = null) =>
    set({ pendingRoom: code, pendingRoomType: type, pendingRoomTime: time }),
  askUpgrade: () => set({ upgradePrompt: true }),
  dismissUpgrade: () => set({ upgradePrompt: false }),
  requestRegister: () => set({ upgradePrompt: false, wantRegister: true, screen: 'menu' }),
  clearRegister: () => set({ wantRegister: false }),
  requestGoogle: () => set({ upgradePrompt: false, wantGoogle: true, screen: 'menu' }),
  clearGoogle: () => set({ wantGoogle: false }),
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
