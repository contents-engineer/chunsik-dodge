import { ASSETS, assetPath } from './assets'
import { STORAGE_KEYS } from './config'

export class AudioManager {
  private enabled = localStorage.getItem(STORAGE_KEYS.sound) !== 'off'
  private bgm?: HTMLAudioElement

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

  playBgm(): void {
    if (!this.enabled) return
    if (!this.bgm) {
      this.bgm = new Audio(assetPath(ASSETS.audio.main))
      this.bgm.loop = true
      this.bgm.volume = 0.2
    }
    void this.bgm.play()
  }

  playSfx(path: string, volume = 0.45): void {
    if (!this.enabled) return
    const audio = new Audio(assetPath(path))
    audio.volume = volume
    void audio.play()
  }
}
