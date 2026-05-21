export type SignalErrorReason =
  | 'bad-json'
  | 'no-room'
  | 'room-full'
  | 'not-in-room'
  | 'room-gone'
  | 'ws-closed'
  | 'ws-error'

export type SignalingEvents = {
  onOpen?: () => void
  onCreated?: (roomId: string) => void
  onJoined?: (roomId: string) => void
  onPeerJoined?: () => void
  onPeerLeft?: () => void
  onSignal?: (payload: unknown) => void
  onError?: (reason: SignalErrorReason) => void
  onClose?: () => void
}

type ServerMessage =
  | { type: 'created'; roomId: string }
  | { type: 'joined'; roomId: string }
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'signal'; payload: unknown }
  | { type: 'error'; reason: SignalErrorReason }

export class Signaling {
  private ws: WebSocket | null = null
  private readonly url: string
  private readonly events: SignalingEvents
  private opened = false

  constructor(url: string, events: SignalingEvents = {}) {
    this.url = url
    this.events = events
  }

  connect(): void {
    if (this.ws) return
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.addEventListener('open', () => {
      this.opened = true
      this.events.onOpen?.()
    })
    ws.addEventListener('message', (e) => this.handleMessage(e.data))
    ws.addEventListener('error', () => {
      this.events.onError?.('ws-error')
    })
    ws.addEventListener('close', () => {
      this.opened = false
      this.ws = null
      this.events.onClose?.()
    })
  }

  createRoom(): void {
    this.sendOrError({ type: 'create' })
  }

  joinRoom(roomId: string): void {
    this.sendOrError({ type: 'join', roomId })
  }

  sendSignal(payload: unknown): void {
    this.sendOrError({ type: 'signal', payload })
  }

  leave(): void {
    if (this.opened) {
      this.sendOrError({ type: 'leave' })
    }
  }

  close(): void {
    this.leave()
    this.ws?.close()
    this.ws = null
  }

  private sendOrError(msg: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.events.onError?.('ws-closed')
      return
    }
    this.ws.send(JSON.stringify(msg))
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return
    let msg: ServerMessage
    try {
      msg = JSON.parse(raw) as ServerMessage
    } catch {
      this.events.onError?.('bad-json')
      return
    }
    switch (msg.type) {
      case 'created':
        this.events.onCreated?.(msg.roomId)
        return
      case 'joined':
        this.events.onJoined?.(msg.roomId)
        return
      case 'peer-joined':
        this.events.onPeerJoined?.()
        return
      case 'peer-left':
        this.events.onPeerLeft?.()
        return
      case 'signal':
        this.events.onSignal?.(msg.payload)
        return
      case 'error':
        this.events.onError?.(msg.reason)
        return
    }
  }
}
