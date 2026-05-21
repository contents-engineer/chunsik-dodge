import { PeerChannel } from './channel'
import { Signaling, type SignalErrorReason } from './signaling'
import { LocalInputQueue, PeerInputQueue } from './input-queue'
import type { PlayerInput } from './input-packing'

export const SIGNAL_URL = 'wss://chunsik-dodge.fly.dev'

export type OnlineRole = 'host' | 'guest'

export type OnlineNetEvents = {
  onRoomCreated?: (roomId: string) => void
  onRoomJoined?: (roomId: string) => void
  onChannelOpen?: () => void
  onChannelClose?: () => void
  onError?: (reason: SignalErrorReason | 'channel-error', detail?: unknown) => void
}

export class OnlineNet {
  readonly role: OnlineRole
  readonly local = new LocalInputQueue()
  readonly peer = new PeerInputQueue()
  private signaling: Signaling | null = null
  private channel: PeerChannel | null = null
  private channelOpen = false
  private roomId: string | null = null
  private readonly events: OnlineNetEvents

  constructor(role: OnlineRole, events: OnlineNetEvents = {}) {
    this.role = role
    this.events = events
  }

  getRoomId(): string | null {
    return this.roomId
  }

  isChannelOpen(): boolean {
    return this.channelOpen
  }

  connectAsHost(): void {
    this.connect(null)
  }

  connectAsGuest(roomId: string): void {
    this.connect(roomId)
  }

  private connect(joinRoomId: string | null): void {
    this.teardown()
    const signaling = new Signaling(SIGNAL_URL, {
      onOpen: () => {
        if (this.role === 'host') signaling.createRoom()
        else if (joinRoomId) signaling.joinRoom(joinRoomId)
      },
      onCreated: (id) => {
        this.roomId = id
        this.events.onRoomCreated?.(id)
      },
      onJoined: (id) => {
        this.roomId = id
        this.events.onRoomJoined?.(id)
      },
      onPeerJoined: () => {
        void this.channel?.start()
      },
      onPeerLeft: () => {
        this.events.onChannelClose?.()
      },
      onSignal: (payload) => void this.channel?.handleSignal(payload),
      onError: (reason) => this.events.onError?.(reason),
      onClose: () => {},
    })
    this.signaling = signaling

    this.channel = new PeerChannel(signaling, this.role, {
      onOpen: () => {
        this.channelOpen = true
        this.events.onChannelOpen?.()
      },
      onMessage: (data) => this.peer.ingestSerialized(data),
      onClose: () => {
        this.channelOpen = false
        this.events.onChannelClose?.()
      },
      onError: (err) => this.events.onError?.('channel-error', err),
    })

    signaling.connect()
  }

  enqueueLocal(input: PlayerInput): void {
    this.local.enqueue(input)
  }

  resendLocal(): void {
    if (!this.channelOpen || !this.channel) return
    const buf = this.local.serialize()
    if (buf.byteLength > 0) this.channel.send(buf)
  }

  close(): void {
    this.teardown()
  }

  private teardown(): void {
    this.channel?.close()
    this.signaling?.close()
    this.channel = null
    this.signaling = null
    this.channelOpen = false
    this.roomId = null
    this.local.reset()
    this.peer.reset()
  }
}
