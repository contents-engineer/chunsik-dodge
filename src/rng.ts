import seedrandom from 'seedrandom'

let rng: () => number = Math.random
let currentSeed: string | null = null

export function setRngSeed(seed: string): void {
  currentSeed = seed
  rng = seedrandom(seed)
}

export function clearRngSeed(): void {
  currentSeed = null
  rng = Math.random
}

export function getCurrentSeed(): string | null {
  return currentSeed
}

export function gameRandom(): number {
  return rng()
}

export function gameRandomRange(min: number, max: number): number {
  return min + (max - min) * rng()
}

export function gameRandomSpread(range: number): number {
  return range * (rng() - 0.5)
}

export function gameRandomInt(maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive)
}
