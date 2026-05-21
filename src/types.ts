import type * as THREE from 'three'

import type { CharacterDefinition } from './assets'

export type GameState = 'ready' | 'playing' | 'gameover'
export type GameMode = 'solo' | 'versus' | 'online'
export type MapKey = 'normal' | 'extended'
export type ActionName = 'idle' | 'idle2' | 'walk' | 'run' | 'rolling' | 'surprise'
export type MobileCameraMode = 'arena' | 'chunsik'

export type MissileKind = 'straight' | 'volley' | 'homing' | 'big'

export type PlayerId = 1 | 2

export type PlayerBindings = {
  up: string[]
  down: string[]
  left: string[]
  right: string[]
  run: string[]
  ability: string[]
}

export type Missile = {
  group: THREE.Group
  velocity: THREE.Vector3
  warning: THREE.Mesh
  radius: number
  age: number
  armedAt: number
  spin: number
  playedSound: boolean
  rollClearedBy: Set<PlayerId>
  kind: MissileKind
  homingStrength: number
}

export type BurstParticle = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  age: number
  life: number
}

export type JoystickState = {
  active: boolean
  pointerId: number | null
  centerX: number
  centerY: number
  vector: THREE.Vector2
}

export type PlayerRuntime = {
  id: PlayerId
  bindings: PlayerBindings
  character: CharacterDefinition
  group?: THREE.Group
  mixer?: THREE.AnimationMixer
  actions: Map<ActionName, THREE.AnimationAction>
  currentAction?: THREE.AnimationAction
  texture?: THREE.Texture
  shadow?: THREE.Mesh
  input: THREE.Vector2
  rollLockedInput: THREE.Vector2
  lookTarget: THREE.Vector3
  targetQuaternion: THREE.Quaternion
  rollAnimationUntil: number
  rollCooldownUntil: number
  cloakActiveUntil: number
  idleTimer: number
  nextIdleVariant: number
  runHeld: boolean
  alive: boolean
  ashTimer: number | null
  ashMaterials: AshMaterialSnapshot[]
}

export type AshMaterialSnapshot = {
  material: THREE.MeshStandardMaterial
  originalColor: number
}
