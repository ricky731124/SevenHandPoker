import { createContext, useContext } from 'react'

/**
 * 「跳過進場動畫」：觀戰中途進場時，桌上已經有幾十張牌 —— 如果每張都播飛入動畫，
 * 進場那一刻會同時啟動 60~90 個 spring 動畫而卡頓。SpectatorGame 在剛掛上棋盤的
 * 短時間內提供 true → 牌元件用 initial={false} 直接出現在定位；之後新發的牌照常飛入。
 */
export const SkipEnterAnim = createContext(false)
export const useSkipEnterAnim = () => useContext(SkipEnterAnim)
