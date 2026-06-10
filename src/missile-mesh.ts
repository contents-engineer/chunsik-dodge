import * as THREE from 'three'

import type { MissileKind } from './types'

type MissileVisualOptions = {
  kind: MissileKind
  sizeMultiplier: number
}

const STRAIGHT_COLORS = {
  body: 0xf7f1df,
  nose: 0xe94635,
  stripe: 0xe5903c,
  fin: 0x245c68,
  flame: 0xffa331,
  core: 0xffe07a,
  trail: 0xff7a2e,
}

const HOMING_COLORS = {
  body: 0xe5f6ff,
  nose: 0x4ab8ff,
  stripe: 0x8ce2ff,
  fin: 0x1f4a73,
  flame: 0x6ad8ff,
  core: 0xd6f4ff,
  trail: 0x4ab8ff,
}

const BIG_COLORS = {
  body: 0x2c2730,
  nose: 0xff5a3c,
  stripe: 0xff8847,
  fin: 0x453c4f,
  flame: 0xff7438,
  core: 0xffd479,
  trail: 0xff4a1f,
}

type MissilePalette = typeof STRAIGHT_COLORS

function paletteFor(kind: MissileKind): MissilePalette {
  if (kind === 'homing') return HOMING_COLORS
  if (kind === 'big') return BIG_COLORS
  return STRAIGHT_COLORS
}

// 미사일 외형은 kind별 3종뿐이라 geometry/material을 모듈 레벨에서 공유하고,
// 그룹은 풀에서 재사용한다. 여기서 만든 공유 리소스는 dispose하면 안 된다.
type SharedGeometries = {
  body: THREE.CylinderGeometry
  nose: THREE.ConeGeometry
  stripe: THREE.TorusGeometry
  nozzle: THREE.CylinderGeometry
  fin: THREE.BoxGeometry
  flame: THREE.ConeGeometry
  core: THREE.ConeGeometry
  trail: THREE.ConeGeometry
}

let sharedGeometries: SharedGeometries | null = null

function getGeometries(): SharedGeometries {
  if (!sharedGeometries) {
    sharedGeometries = {
      body: new THREE.CylinderGeometry(0.14, 0.14, 0.92, 24),
      nose: new THREE.ConeGeometry(0.16, 0.36, 24),
      stripe: new THREE.TorusGeometry(0.145, 0.018, 10, 32),
      nozzle: new THREE.CylinderGeometry(0.1, 0.13, 0.14, 20),
      fin: new THREE.BoxGeometry(0.07, 0.24, 0.24),
      flame: new THREE.ConeGeometry(0.18, 0.48, 18),
      core: new THREE.ConeGeometry(0.09, 0.36, 14),
      trail: new THREE.ConeGeometry(0.22, 0.92, 18),
    }
  }
  return sharedGeometries
}

type MissileMaterials = {
  body: THREE.MeshStandardMaterial
  nose: THREE.MeshStandardMaterial
  fin: THREE.MeshStandardMaterial
  stripe: THREE.MeshStandardMaterial
  flame: THREE.MeshBasicMaterial
  core: THREE.MeshBasicMaterial
  trail: THREE.MeshBasicMaterial
}

const materialCache = new Map<MissileKind, MissileMaterials>()

function getMaterials(kind: MissileKind): MissileMaterials {
  const cached = materialCache.get(kind)
  if (cached) return cached
  const palette = paletteFor(kind)
  const materials: MissileMaterials = {
    body: new THREE.MeshStandardMaterial({
      color: palette.body,
      roughness: 0.34,
      metalness: 0.18,
      emissive: 0x1a1005,
      emissiveIntensity: 0.06,
    }),
    nose: new THREE.MeshStandardMaterial({
      color: palette.nose,
      roughness: 0.32,
      metalness: 0.1,
      emissive: 0x4d0800,
      emissiveIntensity: 0.2,
    }),
    fin: new THREE.MeshStandardMaterial({
      color: palette.fin,
      roughness: 0.36,
      metalness: 0.12,
    }),
    stripe: new THREE.MeshStandardMaterial({
      color: palette.stripe,
      roughness: 0.34,
      metalness: 0.08,
      emissive: 0x3a1400,
      emissiveIntensity: 0.14,
    }),
    flame: new THREE.MeshBasicMaterial({
      color: palette.flame,
      transparent: true,
      opacity: 0.78,
    }),
    core: new THREE.MeshBasicMaterial({
      color: palette.core,
      transparent: true,
      opacity: 0.86,
    }),
    trail: new THREE.MeshBasicMaterial({
      color: palette.trail,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    }),
  }
  materialCache.set(kind, materials)
  return materials
}

function buildMissileMesh(kind: MissileKind): THREE.Group {
  const geometries = getGeometries()
  const materials = getMaterials(kind)
  const group = new THREE.Group()

  const body = new THREE.Mesh(geometries.body, materials.body)
  body.rotation.x = Math.PI / 2
  body.castShadow = true
  group.add(body)

  const nose = new THREE.Mesh(geometries.nose, materials.nose)
  nose.rotation.x = Math.PI / 2
  nose.position.z = 0.64
  nose.castShadow = true
  group.add(nose)

  for (const z of [-0.12, 0.2]) {
    const stripe = new THREE.Mesh(geometries.stripe, materials.stripe)
    stripe.position.z = z
    stripe.castShadow = true
    group.add(stripe)
  }

  const nozzle = new THREE.Mesh(geometries.nozzle, materials.fin)
  nozzle.rotation.x = Math.PI / 2
  nozzle.position.z = -0.52
  nozzle.castShadow = true
  group.add(nozzle)

  const finSpecs = [
    { position: [-0.18, 0, -0.38], rotation: [0, 0, 0] },
    { position: [0.18, 0, -0.38], rotation: [0, 0, 0] },
    { position: [0, -0.18, -0.38], rotation: [0, 0, Math.PI / 2] },
    { position: [0, 0.18, -0.38], rotation: [0, 0, Math.PI / 2] },
  ] as const
  for (const spec of finSpecs) {
    const fin = new THREE.Mesh(geometries.fin, materials.fin)
    const [positionX, positionY, positionZ] = spec.position
    const [rotationX, rotationY, rotationZ] = spec.rotation
    fin.position.set(positionX, positionY, positionZ)
    fin.rotation.set(rotationX, rotationY, rotationZ)
    fin.castShadow = true
    group.add(fin)
  }

  const flame = new THREE.Mesh(geometries.flame, materials.flame)
  flame.rotation.x = -Math.PI / 2
  flame.position.z = -0.78
  flame.name = 'flame'
  group.add(flame)

  const coreFlame = new THREE.Mesh(geometries.core, materials.core)
  coreFlame.rotation.x = -Math.PI / 2
  coreFlame.position.z = -0.72
  coreFlame.name = 'core-flame'
  group.add(coreFlame)

  const trail = new THREE.Mesh(geometries.trail, materials.trail)
  trail.rotation.x = -Math.PI / 2
  trail.position.z = -1.12
  trail.name = 'trail'
  group.add(trail)

  return group
}

const missilePools = new Map<MissileKind, THREE.Group[]>()

export function acquireMissileMesh(options: MissileVisualOptions): THREE.Group {
  const group = missilePools.get(options.kind)?.pop() ?? buildMissileMesh(options.kind)
  group.visible = true
  group.position.set(0, 0, 0)
  group.quaternion.identity()
  // 펄스 연출과 구르기 통과 축소가 남긴 스케일을 초기화한다
  for (const name of ['flame', 'core-flame', 'trail']) {
    group.getObjectByName(name)?.scale.setScalar(1)
  }
  const baseScale = 1.12 + Math.random() * 0.16
  group.scale.setScalar(baseScale * options.sizeMultiplier)
  return group
}

export function releaseMissileMesh(kind: MissileKind, group: THREE.Group): void {
  group.visible = false
  let pool = missilePools.get(kind)
  if (!pool) {
    pool = []
    missilePools.set(kind, pool)
  }
  pool.push(group)
}

const ORIENT_FORWARD = new THREE.Vector3(0, 0, 1)
const ORIENT_SCRATCH = new THREE.Vector3()

export function orientObjectToVelocity(object: THREE.Object3D, velocity: THREE.Vector3): void {
  const direction = ORIENT_SCRATCH.copy(velocity)
  direction.y = 0
  direction.normalize()
  object.quaternion.setFromUnitVectors(ORIENT_FORWARD, direction)
}
