export type Axis = -1 | 0 | 1

export type PlayerInput = {
  x: Axis
  y: Axis
  run: boolean
  ability: boolean
}

export const NEUTRAL_INPUT: PlayerInput = { x: 0, y: 0, run: false, ability: false }

function axisToBits(axis: Axis): number {
  if (axis === 1) return 0b01
  if (axis === -1) return 0b11
  return 0b00
}

function bitsToAxis(bits: number): Axis {
  if (bits === 0b01) return 1
  if (bits === 0b11) return -1
  return 0
}

export function packInput(input: PlayerInput): number {
  let n = 0
  n |= axisToBits(input.x) & 0b11
  n |= (axisToBits(input.y) & 0b11) << 2
  if (input.run) n |= 1 << 4
  if (input.ability) n |= 1 << 5
  return n & 0xff
}

export function unpackInput(byte: number): PlayerInput {
  return {
    x: bitsToAxis(byte & 0b11),
    y: bitsToAxis((byte >>> 2) & 0b11),
    run: ((byte >>> 4) & 0b1) === 1,
    ability: ((byte >>> 5) & 0b1) === 1,
  }
}
