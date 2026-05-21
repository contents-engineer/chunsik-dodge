import { NEUTRAL_INPUT, packInput, unpackInput, type PlayerInput } from './input-packing'

export const SYNC_DIVISOR = 1 << 16
export const BUFFER_LENGTH = 8
const RESEND_WINDOW = BUFFER_LENGTH * 2

export type InputWithSync = {
  syncCounter: number
  input: PlayerInput
}

function syncDiff(a: number, b: number): number {
  let d = a - b
  if (d > SYNC_DIVISOR / 2) d -= SYNC_DIVISOR
  else if (d < -SYNC_DIVISOR / 2) d += SYNC_DIVISOR
  return d
}

export class LocalInputQueue {
  private nextCounter = 0
  private readonly items: InputWithSync[] = []

  enqueue(input: PlayerInput): InputWithSync {
    const entry = { syncCounter: this.nextCounter, input }
    this.items.push(entry)
    this.nextCounter = (this.nextCounter + 1) % SYNC_DIVISOR
    while (this.items.length > RESEND_WINDOW) this.items.shift()
    return entry
  }

  peekNextCounter(): number {
    return this.nextCounter
  }

  getAt(syncCounter: number): PlayerInput | null {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].syncCounter === syncCounter) return this.items[i].input
    }
    return null
  }

  hasAny(): boolean {
    return this.items.length > 0
  }

  serialize(): ArrayBuffer {
    if (this.items.length === 0) {
      return new ArrayBuffer(0)
    }
    const buf = new ArrayBuffer(2 + this.items.length)
    const view = new DataView(buf)
    view.setUint16(0, this.items[0].syncCounter, true)
    for (let i = 0; i < this.items.length; i++) {
      view.setUint8(2 + i, packInput(this.items[i].input))
    }
    return buf
  }

  reset(): void {
    this.nextCounter = 0
    this.items.length = 0
  }
}

export class PeerInputQueue {
  private nextExpected = 0
  private readonly items: InputWithSync[] = []

  ingestSerialized(buf: ArrayBuffer): void {
    if (buf.byteLength < 3) return
    const view = new DataView(buf)
    const startCounter = view.getUint16(0, true)
    const count = buf.byteLength - 2
    for (let i = 0; i < count; i++) {
      const counter = (startCounter + i) % SYNC_DIVISOR
      this.acceptIfNew(counter, unpackInput(view.getUint8(2 + i)))
    }
  }

  private acceptIfNew(counter: number, input: PlayerInput): void {
    if (syncDiff(counter, this.nextExpected) < 0) return
    if (this.items.length > 0) {
      const last = this.items[this.items.length - 1].syncCounter
      if (syncDiff(counter, last) <= 0) return
    }
    this.items.push({ syncCounter: counter, input })
    while (this.items.length > RESEND_WINDOW * 2) this.items.shift()
  }

  hasNext(counter: number): boolean {
    if (this.items.length === 0) return false
    return this.items[0].syncCounter === counter
  }

  consume(counter: number): PlayerInput {
    if (this.items.length === 0 || this.items[0].syncCounter !== counter) {
      return NEUTRAL_INPUT
    }
    const entry = this.items.shift()!
    this.nextExpected = (counter + 1) % SYNC_DIVISOR
    return entry.input
  }

  reset(): void {
    this.nextExpected = 0
    this.items.length = 0
  }
}
