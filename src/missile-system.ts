import * as THREE from 'three'

import type { ArenaSpec } from './config'
import { MOBILE_TUNING, ROLL } from './config'
import { PHASES, getPhaseIndex } from './difficulty'
import { acquireMissileMesh, orientObjectToVelocity, releaseMissileMesh } from './missile-mesh'
import { gameRandom, gameRandomInt, gameRandomSpread } from './rng'
import type { Missile, MissileKind, PlayerId, PlayerRuntime } from './types'

// 시뮬 컨텍스트 — 미사일 시스템은 게임 본체 상태를 직접 들지 않고 매 호출에 필요한
// 값만 받는다. 락스텝 결정성에 영향을 주는 값(elapsed, players, mobile 등)이 포함되므로
// 온라인 모드에서는 양쪽 피어가 같은 값을 넘겨야 한다.
export type MissileSimContext = {
  arena: ArenaSpec
  players: PlayerRuntime[]
  elapsed: number
  mobile: boolean
  playerRadius: number
  playing: boolean
}

export type MissileSystemEvents = {
  onMissileArmed: () => void
  onRollCleared: (playerId: PlayerId) => void
}

const WARNING_GEOMETRY = new THREE.PlaneGeometry(1, 0.15)

export class MissileSystem {
  readonly missiles: Missile[] = []
  private readonly warningPool: THREE.Mesh[] = []
  private readonly scene: THREE.Scene
  private readonly events: MissileSystemEvents

  private static readonly SCRATCH_VEC_A = new THREE.Vector3()
  private static readonly SCRATCH_VEC_B = new THREE.Vector3()
  // 호밍 미사일 방향 블렌딩 계수. 시뮬 dt가 1/60 고정이라 1 - exp(-0.9/60)도 상수지만,
  // Math.exp는 JS 엔진별 정밀도가 달라 락스텝 결정성을 깨므로 미리 계산한 리터럴을 쓴다.
  private static readonly HOMING_BLEND = 0.014888060396937353

  constructor(scene: THREE.Scene, events: MissileSystemEvents) {
    this.scene = scene
    this.events = events
  }

  spawnOfKind(kind: MissileKind, ctx: MissileSimContext): void {
    if (ctx.players.length === 0) return
    if (kind === 'volley') {
      const side = gameRandomInt(4)
      for (const offset of [-0.5, 0, 0.5]) {
        this.spawnSingle('straight', ctx, { fixedSide: side, lateralOffset: offset })
      }
      return
    }
    this.spawnSingle(kind, ctx)
  }

  update(delta: number, ctx: MissileSimContext): Set<PlayerRuntime> {
    const hitPlayers = new Set<PlayerRuntime>()
    for (let index = this.missiles.length - 1; index >= 0; index -= 1) {
      const missile = this.missiles[index]
      if (!missile) continue
      missile.age += delta

      const warningMaterial = missile.warning.material
      if (warningMaterial instanceof THREE.MeshBasicMaterial) {
        warningMaterial.opacity = Math.max(0, 0.46 - missile.age * 0.72)
      }

      if (missile.age < missile.armedAt) continue
      if (!missile.group.visible) {
        missile.group.visible = true
      }
      if (!missile.playedSound) {
        this.events.onMissileArmed()
        missile.playedSound = true
      }

      if (missile.homingStrength > 0) {
        let closest: PlayerRuntime | null = null
        let closestDistSq = Infinity
        for (const p of ctx.players) {
          if (!p.alive || !p.group) continue
          const d = p.group.position.distanceToSquared(missile.group.position)
          if (d < closestDistSq) {
            closest = p
            closestDistSq = d
          }
        }
        if (closest?.group) {
          const toTarget = MissileSystem.SCRATCH_VEC_A.set(
            closest.group.position.x - missile.group.position.x,
            0,
            closest.group.position.z - missile.group.position.z,
          )
          if (toTarget.lengthSq() > 0.0001) {
            toTarget.normalize()
            const currentSpeed = missile.velocity.length()
            const currentDirection = MissileSystem.SCRATCH_VEC_B.copy(missile.velocity).setY(0).normalize()
            currentDirection.lerp(toTarget, MissileSystem.HOMING_BLEND).normalize()
            missile.velocity.set(
              currentDirection.x * currentSpeed,
              missile.velocity.y,
              currentDirection.z * currentSpeed,
            )
            orientObjectToVelocity(missile.group, missile.velocity)
          }
        }
      }

      missile.group.position.addScaledVector(missile.velocity, delta)
      missile.group.rotateZ(missile.spin * delta * 7)
      const flame = missile.group.getObjectByName('flame')
      if (flame) {
        const pulse = 1 + Math.sin((ctx.elapsed + missile.age) * 28) * 0.16
        flame.scale.setScalar(pulse)
      }
      const coreFlame = missile.group.getObjectByName('core-flame')
      if (coreFlame) {
        const pulse = 1 + Math.cos((ctx.elapsed + missile.age) * 31) * 0.12
        coreFlame.scale.setScalar(pulse)
      }
      const trail = missile.group.getObjectByName('trail')
      if (trail) {
        const pulse = 1 + Math.sin((ctx.elapsed + missile.age) * 18) * 0.1
        trail.scale.set(1, pulse, pulse)
      }

      if (ctx.playing) {
        for (const player of ctx.players) {
          if (!player.alive || !player.group) continue
          const dx = player.group.position.x - missile.group.position.x
          const dz = player.group.position.z - missile.group.position.z
          const distSq = dx * dx + dz * dz
          const hitDistance = ctx.playerRadius + missile.radius
          const rollPassDistance = hitDistance + ROLL.passRadiusBonus
          const rollActive = ctx.elapsed < player.rollAnimationUntil
          const cloakActive = ctx.elapsed < player.cloakActiveUntil
          if ((rollActive && distSq < rollPassDistance * rollPassDistance) || cloakActive) {
            this.markRollCleared(missile, player)
          } else if (!missile.rollClearedBy.has(player.id) && distSq < hitDistance * hitDistance) {
            hitPlayers.add(player)
          }
        }
      }

      const outside =
        Math.abs(missile.group.position.x) > ctx.arena.halfWidth + 3.2 ||
        Math.abs(missile.group.position.z) > ctx.arena.halfDepth + 3.2
      if (outside) {
        this.release(index)
      }
    }
    return hitPlayers
  }

  clear(): void {
    for (let index = this.missiles.length - 1; index >= 0; index -= 1) {
      this.release(index)
    }
  }

  private markRollCleared(missile: Missile, player: PlayerRuntime): void {
    if (missile.rollClearedBy.has(player.id)) return
    missile.rollClearedBy.add(player.id)
    missile.group.scale.multiplyScalar(0.94)
    this.events.onRollCleared(player.id)
  }

  // 미사일 그룹·경고선은 풀로 돌아간다. geometry/material은 공유 자원이라 dispose하지 않는다.
  private release(index: number): void {
    const missile = this.missiles[index]
    if (!missile) return
    this.scene.remove(missile.group)
    this.scene.remove(missile.warning)
    releaseMissileMesh(missile.kind, missile.group)
    this.warningPool.push(missile.warning)
    this.missiles.splice(index, 1)
  }

  private pickAimTarget(ctx: MissileSimContext): THREE.Vector3 {
    const alive = ctx.players.filter((p) => p.alive && p.group)
    if (alive.length === 0) return new THREE.Vector3()
    const choice = alive[gameRandomInt(alive.length)]
    return choice.group!.position.clone()
  }

  private spawnSingle(
    kind: MissileKind,
    ctx: MissileSimContext,
    opts: { fixedSide?: number; lateralOffset?: number } = {},
  ): void {
    const { arena } = ctx
    const side = opts.fixedSide ?? gameRandomInt(4)
    const margin = 1.2
    const spawn = new THREE.Vector3()
    if (side === 0) {
      spawn.set(gameRandomSpread(arena.width), 0.58, -arena.halfDepth - margin)
    } else if (side === 1) {
      spawn.set(arena.halfWidth + margin, 0.58, gameRandomSpread(arena.depth))
    } else if (side === 2) {
      spawn.set(gameRandomSpread(arena.width), 0.58, arena.halfDepth + margin)
    } else {
      spawn.set(-arena.halfWidth - margin, 0.58, gameRandomSpread(arena.depth))
    }

    const target = this.pickAimTarget(ctx)
    const aimSpread = kind === 'homing' ? 0.4 : 1.2
    target.x += gameRandomSpread(aimSpread)
    target.z += gameRandomSpread(aimSpread)

    if (opts.lateralOffset !== undefined) {
      const perpendicular = side === 0 || side === 2
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 0, 1)
      target.addScaledVector(perpendicular, opts.lateralOffset * 3.2)
    }

    const direction = target.sub(spawn)
    direction.y = 0
    direction.normalize()

    const phaseBoost = PHASES[getPhaseIndex(ctx.elapsed)].missileSpeedBoost
    const speedMult = ctx.mobile ? MOBILE_TUNING.missileSpeedMult : 1
    const baseSpeed = 4.5 + Math.min(5.5, ctx.elapsed * 0.08) + gameRandom() * 0.8 + phaseBoost
    const kindSpeedMult = kind === 'big' ? 0.55 : kind === 'homing' ? 0.78 : 1
    const speed = baseSpeed * speedMult * kindSpeedMult
    const velocity = direction.multiplyScalar(speed)
    const sizeMultiplier = kind === 'big' ? 1.85 : 1
    const group = acquireMissileMesh({ kind, sizeMultiplier })
    group.position.copy(spawn)
    orientObjectToVelocity(group, velocity)
    group.visible = false
    this.scene.add(group)

    const warning = this.createWarning(spawn, velocity, arena)
    this.scene.add(warning)

    const radius = kind === 'big' ? 0.52 : 0.3
    const homingStrength = kind === 'homing' ? 0.9 : 0

    this.missiles.push({
      group,
      velocity,
      warning,
      radius,
      age: 0,
      armedAt: 0.46,
      spin: gameRandom() > 0.5 ? 1 : -1,
      playedSound: false,
      rollClearedBy: new Set<PlayerId>(),
      kind,
      homingStrength,
    })
  }

  private createWarning(spawn: THREE.Vector3, velocity: THREE.Vector3, arena: ArenaSpec): THREE.Mesh {
    const direction = velocity.clone().normalize()
    const entry = this.getArenaEntryPoint(spawn, direction, arena)
    entry.addScaledVector(direction, 0.18)
    const maxInsideDistance = this.getDistanceToArenaExit(entry, direction, arena)
    const length = THREE.MathUtils.clamp(maxInsideDistance * 0.9, 4.8, 11.5)
    const warning = this.acquireWarning()
    const material = warning.material as THREE.MeshBasicMaterial
    material.opacity = 0.46
    warning.scale.set(length, 1, 1)
    warning.rotation.set(-Math.PI / 2, 0, -Math.atan2(direction.z, direction.x))
    warning.position.set(
      entry.x + direction.x * (length * 0.5),
      0.075,
      entry.z + direction.z * (length * 0.5),
    )
    return warning
  }

  // 경고선은 길이만 다르므로 단위 평면 geometry를 공유하고 scale.x로 길이를 표현한다.
  // material은 미사일별로 opacity가 페이드되므로 풀 인스턴스마다 갖는다.
  private acquireWarning(): THREE.Mesh {
    const pooled = this.warningPool.pop()
    if (pooled) return pooled
    return new THREE.Mesh(
      WARNING_GEOMETRY,
      new THREE.MeshBasicMaterial({
        color: 0xd94636,
        transparent: true,
        opacity: 0.46,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
  }

  private getArenaEntryPoint(spawn: THREE.Vector3, direction: THREE.Vector3, arena: ArenaSpec): THREE.Vector3 {
    const candidates: THREE.Vector3[] = []

    if (direction.x !== 0) {
      for (const x of [-arena.halfWidth, arena.halfWidth]) {
        const t = (x - spawn.x) / direction.x
        const z = spawn.z + direction.z * t
        if (t >= 0 && z >= -arena.halfDepth && z <= arena.halfDepth) {
          candidates.push(new THREE.Vector3(x, 0.075, z))
        }
      }
    }

    if (direction.z !== 0) {
      for (const z of [-arena.halfDepth, arena.halfDepth]) {
        const t = (z - spawn.z) / direction.z
        const x = spawn.x + direction.x * t
        if (t >= 0 && x >= -arena.halfWidth && x <= arena.halfWidth) {
          candidates.push(new THREE.Vector3(x, 0.075, z))
        }
      }
    }

    if (candidates.length === 0) {
      return spawn.clone().addScaledVector(direction, 1.2)
    }

    candidates.sort((a, b) => a.distanceToSquared(spawn) - b.distanceToSquared(spawn))
    return candidates[0] ?? spawn.clone().addScaledVector(direction, 1.2)
  }

  private getDistanceToArenaExit(entry: THREE.Vector3, direction: THREE.Vector3, arena: ArenaSpec): number {
    const distances: number[] = []
    if (direction.x > 0) distances.push((arena.halfWidth - entry.x) / direction.x)
    if (direction.x < 0) distances.push((-arena.halfWidth - entry.x) / direction.x)
    if (direction.z > 0) distances.push((arena.halfDepth - entry.z) / direction.z)
    if (direction.z < 0) distances.push((-arena.halfDepth - entry.z) / direction.z)
    return Math.max(4.8, Math.min(...distances.filter((distance) => distance > 0)))
  }
}
