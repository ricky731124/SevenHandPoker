/**
 * Sticker set (對戰貼圖) — GAME CONTENT. Sent between players by short code (id)
 * so the online payload stays tiny (使用者:貼圖傳代號). Two kinds:
 *   - free emoji stickers (everyone owns them → the 貼圖 button is never empty)
 *   - paid image stickers (public/stickers/{id}.png, green-screened + de-watermarked),
 *     unlocked by buying with 鑽石 (stored in profile.unlocked.emojis).
 * Order = the display/tray order (使用者定:笑臉→哭臉→驚訝→謝謝→讚→付費).
 */
export interface StickerDef {
  id: string
  name: string
  free: boolean
  /** emoji glyph → rendered as text; absent → image sticker at stickers/{id}.png */
  emoji?: string
  /** 售價(鑽石);未指定 → 用預設 STICKER_PRICE。免費貼圖忽略此欄。 */
  price?: number
}

export const STICKERS: StickerDef[] = [
  { id: 'smile', name: '笑臉', free: true, emoji: '😄' },
  { id: 'cry', name: '哭臉', free: true, emoji: '😢' },
  { id: 'wow', name: '驚訝', free: true, emoji: '😮' },
  { id: 'thanks', name: '謝謝', free: true, emoji: '🙏' },
  { id: 'like', name: '讚', free: true, emoji: '👍' },
  { id: '1', name: '呵呵', free: false },
  { id: '2', name: '!!', free: false },
  { id: '3', name: '計畫通', free: false, price: 80 },
  { id: '4', name: '...', free: false },
  { id: '5', name: '我是貴賓欸', free: false, price: 80 },
  { id: '6', name: '等到花兒都謝了', free: false, price: 80 },
  { id: '7', name: '你有證據嗎', free: false, price: 80 },
]

/** 付費貼圖的預設價格(鑽石);個別貼圖可用 StickerDef.price 覆寫。 */
export const STICKER_PRICE = 60

/** 一張貼圖的實際售價(鑽石)。 */
export function stickerPrice(s: StickerDef): number {
  return s.price ?? STICKER_PRICE
}

/** All purchasable sticker ids (for the test account's unlock-all). */
export const ALL_PAID_STICKER_IDS = STICKERS.filter((s) => !s.free).map((s) => s.id)

export function getSticker(id: string): StickerDef | undefined {
  return STICKERS.find((s) => s.id === id)
}

export function stickerSrc(id: string): string {
  return `${import.meta.env.BASE_URL}stickers/${id}.png`
}

/** Owned = free, or purchased (profile.unlocked.emojis). */
export function ownsSticker(def: StickerDef, unlockedEmojis: Record<string, true>): boolean {
  return def.free || !!unlockedEmojis[def.id]
}

export function ownedStickers(unlockedEmojis: Record<string, true>): StickerDef[] {
  return STICKERS.filter((s) => ownsSticker(s, unlockedEmojis))
}
