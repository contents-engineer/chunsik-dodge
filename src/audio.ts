import { ASSETS, assetPath } from './assets'
import { STORAGE_KEYS } from './config'

// SFX는 Web Audio API(BufferSource → GainNode)로 재생한다.
// HTMLAudio는 재생마다 객체 생성·디코딩 비용이 들고 iOS Safari가 volume을 무시하기 때문.
// BGM은 스트리밍·루프가 필요한 단일 트랙이라 HTMLAudio를 유지하되,
// MediaElementSource로 컨텍스트에 연결해 볼륨만 GainNode로 적용한다.
export class AudioManager {
  private enabled = localStorage.getItem(STORAGE_KEYS.sound) !== 'off'
  private context: AudioContext | null = null
  private readonly sfxBuffers = new Map<string, Promise<AudioBuffer | null>>()
  private bgm: HTMLAudioElement | null = null
  private bgmSource: MediaElementAudioSourceNode | null = null

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    localStorage.setItem(STORAGE_KEYS.sound, enabled ? 'on' : 'off')
    if (enabled) {
      this.playBgm()
    } else {
      this.bgm?.pause()
    }
  }

  // 첫 사용자 제스처 이후 호출해 SFX를 미리 디코딩해둔다 (첫 재생 지연 방지).
  preload(): void {
    if (!this.getContext()) return
    for (const path of Object.values(ASSETS.audio)) {
      if (path === ASSETS.audio.main) continue
      void this.loadSfx(path)
    }
  }

  playBgm(): void {
    if (!this.enabled) return
    if (!this.bgm) {
      this.bgm = new Audio(assetPath(ASSETS.audio.main))
      this.bgm.loop = true
      const context = this.getContext()
      if (context) {
        const gain = context.createGain()
        gain.gain.value = 0.2
        this.bgmSource = context.createMediaElementSource(this.bgm)
        this.bgmSource.connect(gain).connect(context.destination)
      } else {
        this.bgm.volume = 0.2
      }
    } else {
      this.getContext()
    }
    void this.bgm.play()
  }

  playSfx(path: string, volume = 0.45): void {
    if (!this.enabled) return
    const context = this.getContext()
    if (!context) return
    void this.loadSfx(path).then((buffer) => {
      if (!buffer || !this.enabled) return
      const source = context.createBufferSource()
      source.buffer = buffer
      const gain = context.createGain()
      gain.gain.value = volume
      source.connect(gain).connect(context.destination)
      source.start()
    })
  }

  // AudioContext는 지연 생성하고, 모바일 자동재생 정책으로 suspended면 재생 직전 resume한다.
  private getContext(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext()
      } catch {
        return null
      }
    }
    if (this.context.state === 'suspended') {
      void this.context.resume()
    }
    return this.context
  }

  // 디코딩된 버퍼 캐시. 중복 fetch를 막기 위해 promise 자체를 저장한다.
  private loadSfx(path: string): Promise<AudioBuffer | null> {
    const cached = this.sfxBuffers.get(path)
    if (cached) return cached
    const context = this.getContext()
    if (!context) return Promise.resolve(null)
    const promise = fetch(assetPath(path))
      .then((response) => response.arrayBuffer())
      .then((data) => context.decodeAudioData(data))
      .catch(() => null)
    this.sfxBuffers.set(path, promise)
    return promise
  }
}
