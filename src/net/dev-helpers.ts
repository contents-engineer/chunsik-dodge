import { NEUTRAL_INPUT, packInput, unpackInput, type PlayerInput } from './input-packing'
import { LocalInputQueue, PeerInputQueue } from './input-queue'
import type { OnlineNet, OnlineNetEvents } from './online-net'

type GameAdapter = {
  enterOnlineMode: (role: 'host' | 'guest', events: OnlineNetEvents) => Promise<OnlineNet>
  exitOnlineMode: () => void
  startOnlineGame: (roomId: string) => void
}

let getGame: () => GameAdapter | null = () => null

export function bindGameAdapter(fn: () => GameAdapter | null): void {
  getGame = fn
}

function log(...args: unknown[]): void {
  console.log('%c[net]', 'color: #2e7b82; font-weight: bold', ...args)
}

export async function netHost(): Promise<void> {
  const game = getGame()
  if (!game) return log('game not ready')
  let roomId: string | null = null
  const online = await game.enterOnlineMode('host', {
    onRoomCreated: (id) => {
      roomId = id
      log('[host] roomId =', id, '— in second tab call __net.join("' + id + '")')
    },
    onChannelOpen: () => {
      log('[host] channel open, seed =', roomId)
      if (roomId) game.startOnlineGame(roomId)
    },
    onChannelClose: () => log('[host] channel closed'),
    onError: (reason, detail) => log('[host] error', reason, detail ?? ''),
  })
  online.connectAsHost()
}

export async function netJoin(roomId: string): Promise<void> {
  const game = getGame()
  if (!game) return log('game not ready')
  const online = await game.enterOnlineMode('guest', {
    onRoomJoined: (id) => log('[guest] joined', id),
    onChannelOpen: () => {
      log('[guest] channel open, seed =', roomId)
      game.startOnlineGame(roomId)
    },
    onChannelClose: () => log('[guest] channel closed'),
    onError: (reason, detail) => log('[guest] error', reason, detail ?? ''),
  })
  online.connectAsGuest(roomId)
}

export function netClose(): void {
  const game = getGame()
  game?.exitOnlineMode()
  log('closed')
}

function eqInput(a: PlayerInput, b: PlayerInput): boolean {
  return a.x === b.x && a.y === b.y && a.run === b.run && a.ability === b.ability
}

export function netTest(): void {
  console.group('[net] packing round-trip')
  const samples: PlayerInput[] = [
    NEUTRAL_INPUT,
    { x: 1, y: -1, run: true, ability: false },
    { x: -1, y: 1, run: false, ability: true },
    { x: 1, y: 1, run: true, ability: true },
    { x: -1, y: -1, run: false, ability: false },
  ]
  let pass = true
  for (const s of samples) {
    const byte = packInput(s)
    const back = unpackInput(byte)
    const ok = eqInput(s, back)
    if (!ok) pass = false
    console.log(JSON.stringify(s), '→ 0b' + byte.toString(2).padStart(8, '0'), '→', JSON.stringify(back), ok ? '✓' : '✗')
  }
  console.groupEnd()

  console.group('[net] queue serialize round-trip')
  const local = new LocalInputQueue()
  samples.forEach((s) => local.enqueue(s))
  const wire = local.serialize()
  console.log('wire bytes:', wire.byteLength, '(expected', 3 + samples.length, ')')
  const peer = new PeerInputQueue()
  peer.ingestSerialized(wire)
  for (let i = 0; i < samples.length; i++) {
    const has = peer.hasNext(i)
    const got = peer.consume(i)
    const ok = has && eqInput(samples[i], got)
    if (!ok) pass = false
    console.log(`syncCounter ${i}: has=${has}, got=${JSON.stringify(got)}`, ok ? '✓' : '✗')
  }
  console.groupEnd()

  console.group('[net] redundancy: duplicate ingest is no-op')
  const local2 = new LocalInputQueue()
  local2.enqueue({ x: 1, y: 0, run: false, ability: false })
  local2.enqueue({ x: 0, y: 1, run: false, ability: false })
  const peer2 = new PeerInputQueue()
  peer2.ingestSerialized(local2.serialize())
  peer2.ingestSerialized(local2.serialize())
  peer2.ingestSerialized(local2.serialize())
  const c0 = peer2.consume(0)
  const c1 = peer2.consume(1)
  const c2 = peer2.consume(2)
  const ok = c0.x === 1 && c1.y === 1 && eqInput(c2, NEUTRAL_INPUT)
  if (!ok) pass = false
  console.log('after 3x ingest: consume(0)=', c0, 'consume(1)=', c1, 'consume(2) returns neutral=', c2, ok ? '✓' : '✗')
  console.groupEnd()

  if (pass) console.log('%c[net] all checks PASS ✓', 'color: #2e7b82; font-weight: bold')
  else console.error('[net] some checks FAIL ✗')
}
