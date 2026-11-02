import { useEffect, useState } from 'react'
import { motion, useTime, useTransform, type MotionValue } from 'framer-motion'
import './MatchWaitScene.css'

/**
 * 快速配對等待中的小劇場(使用者 2026-11-02:取代轉圈圈,讓等待不無聊)。
 * 角色是使用者產的全身姿勢圖(public/wait/,scripts/wait-art.mjs 去背),換姿勢 = 換圖。
 * 同一個時鐘(useTime)推所有東西:位置、姿勢、特效不會跑掉不同步。
 * 目前一段:英短躡手躡腳去戳波斯 → 波斯炸毛哈氣 → 英短冒汗逃回去。之後有多段就在 SCENES 加。
 */

const LOOP_MS = 5200 // 一段一輪幾毫秒
const SWITCH_MS = LOOP_MS * 2 // 每段播兩輪就換下一段
const GROUND = 120 // 地面(腳底)離舞台上緣幾 px;上面留給對話泡泡
// 兩隻原圖同比例:英短框 943×744、波斯框 858×858(scripts/wait-art.mjs 印的),顯示時照比例縮
const PERSIAN_H = 96
const SHORT_H = Math.round((PERSIAN_H * 744) / 858)
const SHORT_W = Math.round((SHORT_H * 943) / 744)

const SCENES = [ShorthairPokesPersian]

/** scene:固定播哪一段(測試 / 調整用);不給 = 隨機開始、輪流播 */
export default function MatchWaitScene({ scene }: { scene?: number }) {
  const [idx, setIdx] = useState(() => scene ?? Math.floor(Math.random() * SCENES.length))
  useEffect(() => {
    if (scene !== undefined || SCENES.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % SCENES.length), SWITCH_MS)
    return () => clearInterval(t)
  }, [scene])
  const Scene = SCENES[idx]
  return (
    <div className="mws" aria-hidden="true">
      <Scene key={idx} />
    </div>
  )
}

const src = (name: string) => `${import.meta.env.BASE_URL}wait/${name}.webp`

/** 這一輪走到哪(0~1) */
function useLoop(): MotionValue<number> {
  const time = useTime()
  return useTransform(time, (t) => (t % LOOP_MS) / LOOP_MS)
}

/** 某段時間內顯示這張姿勢圖(瞬間切換) */
function Pose({ p, name, h, on, flip }: { p: MotionValue<number>; name: string; h: number; on: [number, number][]; flip?: boolean }) {
  const opacity = useTransform(p, (v) => (on.some(([a, b]) => v >= a && v < b) ? 1 : 0))
  return <motion.img className="mws__pose" src={src(name)} alt="" height={h} style={{ opacity, scaleX: flip ? -1 : 1 }} draggable={false} />
}

/** 在 [a, b) 之間顯示,進場彈一下 */
function Pop({ p, a, b, className, style, children }: { p: MotionValue<number>; a: number; b: number; className: string; style: object; children: React.ReactNode }) {
  const opacity = useTransform(p, (v) => (v >= a && v < b ? 1 : 0))
  const scale = useTransform(p, [a, a + 0.03, a + 0.06], [0.5, 1.2, 1])
  return (
    <motion.span className={className} style={{ ...style, opacity, scale }}>
      {children}
    </motion.span>
  )
}

/** 英短躡手躡腳走過去 → 舉手戳兩下 → 波斯炸毛哈氣 → 英短冒汗轉身逃回去 → 波斯消氣坐回去 */
function ShorthairPokesPersian() {
  const p = useLoop()
  const REACH = 86 // 英短走到哪:手剛好戳到波斯胸口(波斯的框被炸毛姿勢撐寬,坐姿左邊有空白)
  // 英短位置:走過去(0.08~0.34)、戳的時候往前頂兩下、逃回去(0.6~0.8)
  // 走過去 = 一路慢慢走 6 小步(使用者 11/02:走走停停不流暢,停頓拿掉)
  const WALK: [number, number][] = [[0.08, 0.34]]
  const walkAt = (v: number) => {
    for (let i = 0; i < WALK.length; i++) {
      const [a, b] = WALK[i]
      if (v < a) return { x: (i * REACH) / WALK.length, lean: 0 }
      if (v < b) {
        const t = (v - a) / (b - a)
        return { x: ((i + t * t * (3 - 2 * t)) * REACH) / WALK.length, lean: Math.sin(t * Math.PI * 6) }
      }
    }
    return { x: REACH, lean: 0 }
  }
  const sxRest = useTransform(p, [0.34, 0.42, 0.44, 0.46, 0.49, 0.51, 0.53, 0.6, 0.8, 1], [REACH, REACH, REACH + 5, REACH, REACH, REACH + 5, REACH, REACH, 0, 0])
  const sx = useTransform(() => (p.get() < 0.34 ? walkAt(p.get()).x : sxRest.get()))
  // 逃跑大步跳、嚇一跳;走過去不跳(腳不會動,一跳就像在蹦 — 使用者 11/02),改左右搖擺走
  const sy = useTransform(p, (v) => {
    if (v >= 0.57 && v < 0.6) return -8 * Math.sin(((v - 0.57) / 0.03) * Math.PI) // 嚇一跳
    if (v >= 0.6 && v < 0.8) return -Math.abs(Math.sin(((v - 0.6) / 0.2) * Math.PI * 4)) * 7
    return 0
  })
  // 走的時候身體輕輕左右傾 ±1.5°(以腳底為軸,腳不離地;不壓扁,臉才不會變形)
  const srot = useTransform(p, (v) => walkAt(v).lean * 1.5)
  // 波斯:被戳到縮一下;炸毛時膨起來抖
  const px = useTransform(p, [0, 0.44, 0.455, 0.47, 0.51, 0.525, 0.54, 0.56, 0.58, 0.6, 0.62, 0.64, 1], [0, 0, 3, 0, 0, 3, 0, 0, -3, 3, -3, 0, 0])
  const ps = useTransform(p, [0, 0.555, 0.58, 0.62, 0.86, 0.9, 1], [1, 1, 1.12, 1.06, 1.06, 1, 1])
  return (
    <>
      <div className="mws__shadow" style={{ left: 168, top: GROUND - 6, width: 100 }} />
      <motion.div className="mws__actor" style={{ left: 172, top: GROUND - PERSIAN_H, x: px, scale: ps, originY: 1 }}>
        <Pose p={p} name="persian_sit" h={PERSIAN_H} on={[[0, 0.56], [0.86, 1]]} />
        <Pose p={p} name="persian_angry" h={PERSIAN_H} on={[[0.56, 0.86]]} />
      </motion.div>
      <motion.div className="mws__shadow" style={{ left: 4, top: GROUND - 6, width: SHORT_W - 8, x: sx }} />
      <motion.div className="mws__actor" style={{ left: 0, top: GROUND - SHORT_H, x: sx, y: sy, rotate: srot, originX: 0.5, originY: 1 }}>
        <Pose p={p} name="shorthair_stand" h={SHORT_H} on={[[0, 0.4], [0.555, 0.58], [0.8, 1]]} />
        <Pose p={p} name="shorthair_poke" h={SHORT_H} on={[[0.4, 0.555]]} />
        <Pose p={p} name="shorthair_run" h={SHORT_H} on={[[0.58, 0.8]]} flip />
      </motion.div>
      {/* 💢 在頭頂右邊、尾巴左邊(炸毛姿勢尾巴豎在右邊) */}
      <Pop p={p} a={0.56} b={0.82} className="mws__item mws__mark" style={{ left: 214, top: GROUND - PERSIAN_H - 10 }}>
        💢
      </Pop>
      <Pop p={p} a={0.57} b={0.82} className="mws__bubble" style={{ left: 146, top: GROUND - PERSIAN_H - 20 }}>
        哈——！
      </Pop>
    </>
  )
}
