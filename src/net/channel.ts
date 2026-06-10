import type { Signaling } from './signaling'

// TURN 설정은 빌드타임 env(VITE_TURN_*)로 주입한다 — .env.example 참고.
// P2P 특성상 클라이언트 노출은 불가피하지만, 소스 하드코딩 대신 env로 두면 교체가 쉽다.
// env 미설정 시 openrelay 공개 credential로 폴백하는데, 동작이 보장되지 않으며
// 트래픽 제한이 있으므로 운영 시 metered.ca 무료 계정 발급(월 50GB)을 권장.
const TURN_URLS = (
  import.meta.env.VITE_TURN_URLS ??
  'turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turn:openrelay.metered.ca:443?transport=tcp'
).split(',')
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME ?? 'openrelayproject'
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL ?? 'openrelayproject'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  {
    urls: TURN_URLS,
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
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
