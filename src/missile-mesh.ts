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

function paletteFor(kind: MissileKind): typeof STRAIGHT_COLORS {
  if (kind === 'homing') return HOMING_COLORS
  if (kind === 'big') return BIG_COLORS
  return STRAIGHT_COLORS
}

export function createMissileMesh(options: MissileVisualOptions): THREE.Group {
  const palette = paletteFor(options.kind)
  const group = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: palette.body,
    roughness: 0.34,
    metalness: 0.18,
    emissive: 0x1a1005,
    emissiveIntensity: 0.06,
  })
  const noseMaterial = new THREE.MeshStandardMaterial({
    color: palette.nose,
    roughness: 0.32,
    metalness: 0.1,
    emissive: 0x4d0800,
    emissiveIntensity: 0.2,
  })
  const finMaterial = new THREE.MeshStandardMaterial({
    color: palette.fin,
    roughness: 0.36,
    metalness: 0.12,
  })
  const stripeMaterial = new THREE.MeshStandardMaterial({
    color: palette.stripe,
    roughness: 0.34,
    metalness: 0.08,
    emissive: 0x3a1400,
    emissiveIntensity: 0.14,
  })
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: palette.flame,
    transparent: true,
    opacity: 0.78,
  })
  const coreFlameMaterial = new THREE.MeshBasicMaterial({
    color: palette.core,
    transparent: true,
    opacity: 0.86,
  })
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: palette.trail,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  })

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.92, 24), bodyMaterial)
  body.rotation.x = Math.PI / 2
  body.castShadow = true
  group.add(body)

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 24), noseMaterial)
  nose.rotation.x = Math.PI / 2
  nose.position.z = 0.64
  nose.castShadow = true
  group.add(nose)

  for (const z of [-0.12, 0.2]) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.018, 10, 32), stripeMaterial)
    stripe.position.z = z
    stripe.castShadow = true
    group.add(stripe)
  }

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.14, 20), finMaterial)
  nozzle.rotation.x = Math.PI / 2
  nozzle.position.z = -0.52
  nozzle.castShadow = true
  group.add(nozzle)

  const finSpecs = [
    { position: [-0.18, 0, -0.38], rotation: [0, 0, 0], size: [0.07, 0.24, 0.24] },
    { position: [0.18, 0, -0.38], rotation: [0, 0, 0], size: [0.07, 0.24, 0.24] },
    { position: [0, -0.18, -0.38], rotation: [0, 0, Math.PI / 2], size: [0.07, 0.24, 0.24] },
    { position: [0, 0.18, -0.38], rotation: [0, 0, Math.PI / 2], size: [0.07, 0.24, 0.24] },
  ] as const
  for (const spec of finSpecs) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(...spec.size), finMaterial)
    const [positionX, positionY, positionZ] = spec.position
    const [rotationX, rotationY, rotationZ] = spec.rotation
    fin.position.set(positionX, positionY, positionZ)
    fin.rotation.set(rotationX, rotationY, rotationZ)
    fin.castShadow = true
    group.add(fin)
  }

  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.48, 18), flameMaterial)
  flame.rotation.x = -Math.PI / 2
  flame.position.z = -0.78
  flame.name = 'flame'
  group.add(flame)

  const coreFlame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.36, 14), coreFlameMaterial)
  coreFlame.rotation.x = -Math.PI / 2
  coreFlame.position.z = -0.72
  coreFlame.name = 'core-flame'
  group.add(coreFlame)

  const trail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.92, 18), trailMaterial)
  trail.rotation.x = -Math.PI / 2
  trail.position.z = -1.12
  trail.name = 'trail'
  group.add(trail)

  const baseScale = 1.12 + Math.random() * 0.16
  group.scale.setScalar(baseScale * options.sizeMultiplier)
  return group
}

export function orientObjectToVelocity(object: THREE.Object3D, velocity: THREE.Vector3): void {
  const direction = velocity.clone()
  direction.y = 0
  direction.normalize()
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
}
