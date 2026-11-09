import { create } from 'zustand'

/**
 * 「開啟自動旋轉」圖解要不要開、開哪一版(TypingRotateTip 負責畫)。
 *   - iOS / 安卓假橫向時點了要打字的框 → 提示列上按「怎麼開？」
 *   - 安卓按了「進入遊戲」卻還是直的(瀏覽器不讓鎖橫向)→ 進大廳後直接打開(Splash)
 */
export type RotateOs = 'ios' | 'android'

export const useRotateHelp = create<{ os: RotateOs | null }>(() => ({ os: null }))

export const openRotateHelp = (os: RotateOs): void => useRotateHelp.setState({ os })
export const closeRotateHelp = (): void => useRotateHelp.setState({ os: null })
