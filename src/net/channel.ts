import type { Signaling } from './signaling'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
]

const DATA_CHANNEL_LABEL = 'chunsik_p2p'

type Role = 'host' | 'guest'

type SignalPayload =
  | { kind: 'sdp'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

export type ChannelEvents = {
  onOpen?: () => void
  onMessage?: (data: ArrayBuffer) => void
  onClose?: () => void
  onError?: (err: unknown) => void
}

export class PeerChannel {
  private readonly pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private readonly signaling: Signaling
  private readonly role: Role
  private readonly events: ChannelEvents
  private closed = false

  constructor(signaling: Signaling, role: Role, events: ChannelEvents = {}) {
    this.signaling = signaling
    this.role = role
    this.events = events
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    this.pc.addEventListener('icecandidate', (e) => {
      if (e.candidate) {
        this.signaling.sendSignal({ kind: 'ice', candidate: e.candidate.toJSON() } satisfies SignalPayload)
      }
    })

    this.pc.addEventListener('connectionstatechange', () => {
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this.handleClose()
      }
    })

    if (role === 'host') {
      const dc = this.pc.createDataChannel(DATA_CHANNEL_LABEL, {
        ordered: false,
        maxRetransmits: 0,
      })
      this.attachDataChannel(dc)
    } else {
      this.pc.addEventListener('datachannel', (e) => this.attachDataChannel(e.channel))
    }
  }

  async start(): Promise<void> {
    if (this.role !== 'host') return
    try {
      const offer = await this.pc.createOffer()
      await this.pc.setLocalDescription(offer)
      this.signaling.sendSignal({ kind: 'sdp', sdp: offer } satisfies SignalPayload)
    } catch (err) {
      this.events.onError?.(err)
    }
  }

  async handleSignal(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object') return
    const data = payload as SignalPayload
    try {
      if (data.kind === 'sdp') {
        await this.pc.setRemoteDescription(data.sdp)
        if (data.sdp.type === 'offer') {
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
          this.signaling.sendSignal({ kind: 'sdp', sdp: answer } satisfies SignalPayload)
        }
      } else if (data.kind === 'ice') {
        await this.pc.addIceCandidate(data.candidate)
      }
    } catch (err) {
      this.events.onError?.(err)
    }
  }

  send(data: ArrayBuffer | Uint8Array | string): void {
    const dc = this.dc
    if (!dc || dc.readyState !== 'open') return
    if (typeof data === 'string') dc.send(data)
    else if (data instanceof ArrayBuffer) dc.send(data)
    else dc.send(data)
  }

  close(): void {
    this.handleClose()
  }

  private attachDataChannel(dc: RTCDataChannel): void {
    this.dc = dc
    dc.binaryType = 'arraybuffer'
    dc.addEventListener('open', () => this.events.onOpen?.())
    dc.addEventListener('message', (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.events.onMessage?.(e.data)
      } else if (typeof e.data === 'string') {
        const enc = new TextEncoder().encode(e.data)
        this.events.onMessage?.(enc.buffer as ArrayBuffer)
      }
    })
    dc.addEventListener('close', () => this.handleClose())
    dc.addEventListener('error', (e) => this.events.onError?.(e))
  }

  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    try { this.dc?.close() } catch {}
    try { this.pc.close() } catch {}
    this.events.onClose?.()
  }
}
