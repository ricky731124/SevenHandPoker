/**
 * 觀戰彈幕 / 訪客名字 pool(§9,使用者 2026-09-06 提供)。
 * 彈幕 = 觀眾點一下即送的罐頭文字;訪客名字 = 未登入觀眾進場隨機挑一個(同場不撞,
 * 撞到補數字)。名字只在該場有效,離場即釋放。
 */

export const DANMAKU_POOL: string[] = [
  '安安',
  '881~',
  'GG',
  '???',
  '!!',
  'QQ',
  '太嫩了',
  '科科',
  '太神啦',
  '加油',
  '666666',
  '可以回家惹',
  '天都黑了',
  '這牌叫我阿嬤來玩都會贏',
]

export const GUEST_NAMES: string[] = [
  '百香綠女孩',
  '布丁狗',
  '奇美博物館',
  '全糖珍奶',
  '苗栗小五郎',
  '高雄發大財',
  '不是喔不是這樣喔',
  '財去人安樂',
  '台股五萬點',
  '瓜哥送幸福',
]

/**
 * 從 pool 挑一個沒被同場觀眾用掉的名字;10 個都撞到就「名字＋數字」。
 * @param taken 目前在席觀眾的名字(讀 watch 節點的 value)
 */
export function pickGuestName(taken: Set<string>): string {
  const free = GUEST_NAMES.filter((n) => !taken.has(n))
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)]
  // 全撞到 → 隨機基底 + 遞增數字直到不撞(理論上很難發生,pool 10 個綽綽有餘)
  const base = GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]
  let i = 2
  while (taken.has(`${base}${i}`)) i++
  return `${base}${i}`
}
