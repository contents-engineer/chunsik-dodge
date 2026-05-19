import { DESKTOP_TUNING, MOBILE_TUNING } from './config'
import type { MissileKind } from './types'

export type Phase = {
  startAt: number
  label: string
  intervalFloor: number
  kindWeights: Record<MissileKind, number>
  doubleSpawnChance: number
  missileSpeedBoost: number
}

export const PHASES: Phase[] = [
  {
    startAt: 0,
    label: '워밍업',
    intervalFloor: 0.66,
    kindWeights: { straight: 1, volley: 0, homing: 0, big: 0 },
    doubleSpawnChance: 0,
    missileSpeedBoost: 0,
  },
  {
    startAt: 30,
    label: '가속',
    intervalFloor: 0.5,
    kindWeights: { straight: 1, volley: 0, homing: 0, big: 0 },
    doubleSpawnChance: 0.22,
    missileSpeedBoost: 0,
  },
  {
    startAt: 60,
    label: '집중포화',
    intervalFloor: 0.42,
    kindWeights: { straight: 0.74, volley: 0.2, homing: 0, big: 0.06 },
    doubleSpawnChance: 0.3,
    missileSpeedBoost: 0,
  },
  {
    startAt: 90,
    label: '추적자',
    intervalFloor: 0.36,
    kindWeights: { straight: 0.56, volley: 0.2, homing: 0.18, big: 0.06 },
    doubleSpawnChance: 0.34,
    missileSpeedBoost: 0.4,
  },
  {
    startAt: 120,
    label: '혼돈',
    intervalFloor: 0.28,
    kindWeights: { straight: 0.42, volley: 0.26, homing: 0.24, big: 0.08 },
    doubleSpawnChance: 0.44,
    missileSpeedBoost: 0.9,
  },
]

export function getPhaseIndex(elapsed: number): number {
  let index = 0
  for (let i = 0; i < PHASES.length; i += 1) {
    if (elapsed >= PHASES[i].startAt) index = i
  }
  return index
}

export function getPhase(elapsed: number): Phase {
  return PHASES[getPhaseIndex(elapsed)]
}

export function getSpawnInterval(elapsed: number, wave: number, mobile: boolean): number {
  const phase = getPhase(elapsed)
  const base = mobile ? MOBILE_TUNING.spawnIntervalBase : DESKTOP_TUNING.spawnIntervalBase
  const delta = mobile ? MOBILE_TUNING.spawnIntervalDelta : DESKTOP_TUNING.spawnIntervalDelta
  return Math.max(phase.intervalFloor, base - wave * delta)
}

export function pickMissileKind(elapsed: number, random: () => number = Math.random): MissileKind {
  const phase = getPhase(elapsed)
  const weights = phase.kindWeights
  const total =
    weights.straight + weights.volley + weights.homing + weights.big
  if (total <= 0) return 'straight'
  let roll = random() * total
  for (const kind of ['straight', 'volley', 'homing', 'big'] as MissileKind[]) {
    roll -= weights[kind]
    if (roll <= 0) return kind
  }
  return 'straight'
}
