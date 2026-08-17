import type { AchTier } from '../../game/achievements'

/**
 * Achievement badge — a faceted octagonal "rank gem" recoloured by tier (銅/銀/金),
 * with a per-family emblem in the centre (使用者 2026-08-12): 連勝=3+/5+/10+、
 * 同花=花、葫蘆=房子(門+煙囪)、鐵支=鐵軌、同花順=大船入港、身經百戰=交叉雙劍、常勝軍=飄揚旗(勝)。
 * Outer frame + centre art both use the tier metal; `locked` greys an un-earned tier.
 */
const TIER: Record<AchTier, { face: string; rim: string; hi: string }> = {
  0: { face: '#8a8578', rim: '#5f5b51', hi: '#b7b1a2' },
  1: { face: '#c67b3e', rim: '#7d4a20', hi: '#f0b877' }, // 銅
  2: { face: '#c7cdd4', rim: '#828a93', hi: '#ffffff' }, // 銀
  3: { face: '#f0c33c', rim: '#a9800f', hi: '#fff0a8' }, // 金
}
const INNER = '#2f2110'
// flat-top octagon, r≈22 in a 48 box
const OCT = '44.3,32.4 32.4,44.3 15.6,44.3 3.7,32.4 3.7,15.6 15.6,3.7 32.4,3.7 44.3,15.6'
const OCT_IN = '40.6,30.4 30.4,40.6 17.6,40.6 7.4,30.4 7.4,17.6 17.6,7.4 30.4,7.4 40.6,17.6'
const STREAK = ['', '3+', '5+', '10+'] as const

/** Centre emblem for a family, drawn in colour `c` on the dark inner disc. */
function Emblem({ icon, tier, c }: { icon: string; tier: AchTier; c: string }) {
  const line = { stroke: c, strokeWidth: 2.1, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  switch (icon) {
    case 'flush': // 花:六瓣花
      return (
        <g fill={c}>
          {[0, 60, 120, 180, 240, 300].map((a) => {
            const r = (a * Math.PI) / 180
            return <circle key={a} cx={24 + 6.4 * Math.cos(r)} cy={24 + 6.4 * Math.sin(r)} r="3.1" />
          })}
          <circle cx="24" cy="24" r="3.2" fill={INNER} />
        </g>
      )
    case 'fullHouse': // 葫蘆=房子(只有門、屋頂右側一根煙囪,無窗)
      return (
        <g fill={c}>
          {/* 煙囪先畫,屋頂再蓋住其底部→與屋頂無縫相接;頂端不高過屋脊(y14) */}
          <rect x="27.6" y="15.4" width="2.8" height="8.3" rx="0.5" />
          <path d="M13.5 24.5 L24 14 L34.5 24.5 Z" />
          <rect x="17" y="24" width="14" height="9.5" rx="1" />
          {/* 只留門,挖空成內盤深色 */}
          <rect x="22.2" y="27.5" width="3.6" height="6" rx="0.4" fill={INNER} />
        </g>
      )
    case 'quads': // 鐵支=火車軌道
      return (
        <g {...line}>
          <line x1="19" y1="15" x2="19" y2="33" />
          <line x1="29" y1="15" x2="29" y2="33" />
          <line x1="16" y1="18.5" x2="32" y2="18.5" />
          <line x1="16" y1="24" x2="32" y2="24" />
          <line x1="16" y1="29.5" x2="32" y2="29.5" />
        </g>
      )
    case 'straightFlush': // 同花順=大船入港:郵輪(層疊甲板+煙囪+右揚船艏,兩排甲板窗+船身舷窗)
      return (
        <g fill={c} stroke="none">
          {/* 煙囪(偏船尾) */}
          <path d="M17.5 13.6 h3.1 l-0.4 4.2 h-2.3 z" />
          {/* 上層甲板 */}
          <rect x="15.3" y="17.6" width="13.4" height="3.6" rx="0.7" />
          {/* 主船樓 */}
          <rect x="13.2" y="20.9" width="18.8" height="4.6" rx="0.8" />
          {/* 船殼:右舷上揚成船艏 */}
          <path d="M12.3 25.5 H32.2 L36 27 L34.3 30.5 Q33.3 32.2 30.9 32.2 H15 Q12.9 32.2 12.3 30.6 Z" />
          {/* 甲板窗兩排 + 船身舷窗(挖空) */}
          <g fill={INNER}>
            <rect x="16" y="18.4" width="1.5" height="1.9" rx="0.3" />
            <rect x="18.2" y="18.4" width="1.5" height="1.9" rx="0.3" />
            <rect x="20.4" y="18.4" width="1.5" height="1.9" rx="0.3" />
            <rect x="22.6" y="18.4" width="1.5" height="1.9" rx="0.3" />
            <rect x="24.8" y="18.4" width="1.5" height="1.9" rx="0.3" />
            <rect x="27" y="18.4" width="1.5" height="1.9" rx="0.3" />
            <rect x="15" y="22" width="1.4" height="2" rx="0.3" />
            <rect x="17" y="22" width="1.4" height="2" rx="0.3" />
            <rect x="19" y="22" width="1.4" height="2" rx="0.3" />
            <rect x="21" y="22" width="1.4" height="2" rx="0.3" />
            <rect x="23" y="22" width="1.4" height="2" rx="0.3" />
            <rect x="25" y="22" width="1.4" height="2" rx="0.3" />
            <rect x="27" y="22" width="1.4" height="2" rx="0.3" />
            <rect x="29" y="22" width="1.4" height="2" rx="0.3" />
            <circle cx="15.5" cy="29" r="0.85" />
            <circle cx="19" cy="29" r="0.85" />
            <circle cx="22.5" cy="29" r="0.85" />
            <circle cx="26" cy="29" r="0.85" />
            <circle cx="29.5" cy="29" r="0.85" />
          </g>
        </g>
      )
    case 'soloGames': // 百戰不殆(打電腦):機器人頭
      return (
        <g fill={c} stroke={c} strokeWidth="1.4" strokeLinejoin="round">
          <line x1="24" y1="12" x2="24" y2="15.5" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="24" cy="11.5" r="1.6" stroke="none" />
          <rect x="15" y="16" width="18" height="15" rx="3" fill="none" strokeWidth="2" />
          <circle cx="20" cy="23" r="2.1" stroke="none" />
          <circle cx="28" cy="23" r="2.1" stroke="none" />
          <line x1="20.5" y1="27.5" x2="27.5" y2="27.5" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )
    case 'soloWins': // AI領主(打電腦獲勝):AI 字樣
      return (
        <text x="24" y="25" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-display)" fontWeight="900" fontSize="15" fill={c}>
          AI
        </text>
      )
    case 'sfDuel': // 狹路相逢:一座橋
      return (
        <g stroke={c} strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M14 20 Q24 30 34 20" />
          <line x1="14" y1="20" x2="14" y2="31" />
          <line x1="34" y1="20" x2="34" y2="31" />
          <line x1="14" y1="31" x2="34" y2="31" />
          <line x1="20" y1="26.6" x2="20" y2="31" strokeWidth="1.5" />
          <line x1="24" y1="28" x2="24" y2="31" strokeWidth="1.5" />
          <line x1="28" y1="26.6" x2="28" y2="31" strokeWidth="1.5" />
        </g>
      )
    case 'streak': {
      const t = STREAK[tier] || '3+'
      return (
        <text x="24" y="25" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-display)" fontWeight="900" fontSize={t.length >= 3 ? 12 : 15} fill={c}>
          {t}
        </text>
      )
    }
    case 'games': // 身經百戰:交叉雙劍(⚔)
      return (
        <g stroke={c} strokeLinecap="round" strokeLinejoin="round">
          {/* 兩把劍身交叉成 X,劍尖朝上、劍柄朝下 */}
          <line x1="15.5" y1="15" x2="30.5" y2="30" strokeWidth="2.4" />
          <line x1="32.5" y1="15" x2="17.5" y2="30" strokeWidth="2.4" />
          {/* 劍尖 */}
          <path d="M15.5 15 L19 15.4 L16.4 18 Z" fill={c} stroke="none" />
          <path d="M32.5 15 L29 15.4 L31.6 18 Z" fill={c} stroke="none" />
          {/* 護手(十字檔) */}
          <line x1="28.4" y1="32" x2="32.6" y2="27.8" strokeWidth="1.9" />
          <line x1="19.6" y1="32" x2="15.4" y2="27.8" strokeWidth="1.9" />
          {/* 握把 + 劍首 */}
          <line x1="30.5" y1="30" x2="33.1" y2="34" strokeWidth="2.2" />
          <line x1="17.5" y1="30" x2="14.9" y2="34" strokeWidth="2.2" />
          <circle cx="33.4" cy="34.6" r="1.4" fill={c} stroke="none" />
          <circle cx="14.6" cy="34.6" r="1.4" fill={c} stroke="none" />
        </g>
      )
    case 'wins': // 常勝軍=飄揚旗,旗面放大填滿內盤、裡面寫一個完整的「勝」;左側短旗桿
      return (
        <g>
          <line x1="14.6" y1="15" x2="14.6" y2="32" stroke={c} strokeWidth="2.3" strokeLinecap="round" />
          {/* 旗面(上下緣輕微波浪),放大、偏右置中 */}
          <path d="M15.1 15.5 Q20.4 14.6 25.4 15.5 Q30.4 16.4 34.4 15.5 L34.4 31 Q30.4 31.9 25.4 31 Q20.4 30.1 15.1 31 Z" fill={c} />
          {/* 完整的勝(放大置中) */}
          <text x="24.8" y="23.4" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-display)" fontWeight="900" fontSize="14.5" fill={INNER}>
            勝
          </text>
        </g>
      )
    default: {
      return (
        <text x="24" y="25" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-display)" fontWeight="900" fontSize="16" fill={c}>
          ★
        </text>
      )
    }
  }
}

export default function Badge({ icon, tier, size = 44, locked = false }: { icon: string; tier: AchTier; size?: number; locked?: boolean }) {
  const t = TIER[tier] ?? TIER[0]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ display: 'block', opacity: locked ? 0.4 : 1, filter: locked ? 'grayscale(0.75)' : 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' }}>
      {/* faceted octagon frame */}
      <polygon points={OCT} fill={t.rim} />
      <polygon points={OCT_IN} fill={t.face} />
      <polygon points={OCT_IN} fill="none" stroke={t.hi} strokeWidth="1.6" />
      {/* top-left bevel highlight for a metallic read */}
      <polygon points="17.6,7.4 30.4,7.4 24,13 " fill={t.hi} opacity="0.55" />
      {/* recessed inner disc + family emblem */}
      <circle cx="24" cy="24" r="13.5" fill={INNER} stroke={t.rim} strokeWidth="1.6" />
      <Emblem icon={icon} tier={tier} c={t.hi} />
    </svg>
  )
}
