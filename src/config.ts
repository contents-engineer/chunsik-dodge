import type { MapKey, PlayerBindings } from './types'

export type ArenaSpec = {
  width: number
  depth: number
  halfWidth: number
  halfDepth: number
  playerRadius: number
  gridDivisions: number
}

export const MAP_PRESETS: Record<MapKey, ArenaSpec> = {
  normal: {
    width: 17,
    depth: 11,
    halfWidth: 8.5,
    halfDepth: 5.5,
    playerRadius: 0.42,
    gridDivisions: 12,
  },
  extended: {
    width: 24,
    depth: 15.5,
    halfWidth: 12,
    halfDepth: 7.75,
    playerRadius: 0.42,
    gridDivisions: 17,
  },
}

export const ROLL = {
  animationDuration: 1.05,
  cooldown: 10,
  passRadiusBonus: 0.22,
}

export const CLOAK = {
  duration: 2.4,
  cooldown: 10,
  opacity: 0.3,
}

export const MOVEMENT = {
  walkSpeed: 3.35,
  runSpeed: 5.4,
}

export const MOBILE_BREAKPOINT = 720

export const MOBILE_TUNING = {
  playerRadius: 0.36,
  missileSpeedMult: 0.85,
  spawnIntervalBase: 1.2,
  spawnIntervalDelta: 0.07,
  arenaFov: 60,
}

export const DESKTOP_TUNING = {
  spawnIntervalBase: 1.05,
  spawnIntervalDelta: 0.075,
}

export const STORAGE_KEYS = {
  best: 'chunsik-dodge-3d-best',
  sound: 'chunsik-dodge-3d-sound',
  camera: 'chunsik-dodge-3d-mobile-camera',
  characterSolo: 'chunsik-dodge-3d-character-solo',
  characterVersusP1: 'chunsik-dodge-3d-character-versus-p1',
  characterVersusP2: 'chunsik-dodge-3d-character-versus-p2',
  characterOnline: 'chunsik-dodge-3d-character-online',
  mode: 'chunsik-dodge-3d-mode',
  versusMap: 'chunsik-dodge-3d-versus-map',
}

export const P1_BINDINGS: PlayerBindings = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  run: ['ShiftLeft'],
  ability: ['Space'],
}

export const P2_BINDINGS: PlayerBindings = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  run: ['ShiftRight'],
  ability: ['Enter', 'NumpadEnter'],
}

export const SOLO_BINDINGS: PlayerBindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  ability: ['Space'],
}

export const VERSUS = {
  spawnOffsetX: 4.5,
  drawWindow: 0.05,
}

export function isMobileViewport(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}
