import { CLOAK, ROLL } from '../config'
import type { GameState, PlayerId, PlayerRuntime } from '../types'
import { getElement } from './shell'

// HUD 표시 계층 — 점수판·상태 필·능력 타이머·구르기/달리기 버튼의 렌더링만 담당한다.
// 입력 이벤트 연결과 게임 상태 판정은 게임 본체(main.ts)에 있고, 매 프레임 호출되는
// 갱신 메서드는 마지막 적용값 캐시로 중복 DOM 쓰기를 막는다.
export class HudView {
  readonly rollButton: HTMLButtonElement
  readonly runButton: HTMLButtonElement
  private readonly rollButtonLabel: HTMLSpanElement
  private readonly timeValue: HTMLElement
  private readonly bestPanel: HTMLDivElement
  private readonly bestValue: HTMLElement
  private readonly waveValue: HTMLElement
  private readonly p1Panel: HTMLDivElement
  private readonly p2Panel: HTMLDivElement
  private readonly p1Name: HTMLElement
  private readonly p2Name: HTMLElement
  private readonly statusValue: HTMLElement
  private readonly statusValueP2: HTMLElement
  private readonly abilityTimer: HTMLDivElement
  private readonly abilityTimerLabel: HTMLSpanElement
  private readonly abilityTimerValue: HTMLSpanElement
  private readonly abilityTimerP2: HTMLDivElement
  private readonly abilityTimerP2Label: HTMLSpanElement
  private readonly abilityTimerP2Value: HTMLSpanElement

  private readonly rollButtonCache = { label: '', cooling: false, active: false, progressDeg: -1 }
  private readonly abilityTimerCache = [
    { visible: false, label: '', value: '' },
    { visible: false, label: '', value: '' },
  ]
  private readonly scoreCache = { time: '', best: '', wave: '', p1: '', p2: '' }

  constructor(root: HTMLElement) {
    this.rollButton = getElement(root, 'roll-button')
    this.rollButtonLabel = getElement(root, 'roll-button-label')
    this.runButton = getElement(root, 'run-button')
    this.timeValue = getElement(root, 'time-value')
    this.bestPanel = getElement(root, 'best-panel')
    this.bestValue = getElement(root, 'best-value')
    this.waveValue = getElement(root, 'wave-value')
    this.p1Panel = getElement(root, 'p1-panel')
    this.p2Panel = getElement(root, 'p2-panel')
    this.p1Name = getElement(root, 'p1-name')
    this.p2Name = getElement(root, 'p2-name')
    this.statusValue = getElement(root, 'status-value')
    this.statusValueP2 = getElement(root, 'status-value-p2')
    this.abilityTimer = getElement(root, 'ability-timer')
    this.abilityTimerLabel = getElement(root, 'ability-timer-label')
    this.abilityTimerValue = getElement(root, 'ability-timer-value')
    this.abilityTimerP2 = getElement(root, 'ability-timer-p2')
    this.abilityTimerP2Label = getElement(root, 'ability-timer-p2-label')
    this.abilityTimerP2Value = getElement(root, 'ability-timer-p2-value')
  }

  setStatus(id: PlayerId, text: string): void {
    if (id === 1) this.statusValue.textContent = text
    else this.statusValueP2.textContent = text
  }

  getStatusText(id: PlayerId): string {
    return (id === 1 ? this.statusValue.textContent : this.statusValueP2.textContent) ?? ''
  }

  setModeVisibility(solo: boolean, twoPlayer: boolean): void {
    this.bestPanel.hidden = !solo
    this.p1Panel.hidden = !twoPlayer
    this.p2Panel.hidden = !twoPlayer
    this.statusValueP2.hidden = !twoPlayer
  }

  setPlayerNames(p1: string, p2: string): void {
    if (this.scoreCache.p1 !== p1) {
      this.scoreCache.p1 = p1
      this.p1Name.textContent = p1
    }
    if (this.scoreCache.p2 !== p2) {
      this.scoreCache.p2 = p2
      this.p2Name.textContent = p2
    }
  }

  // 매 시뮬 스텝(60Hz) 호출되므로 표시 문자열이 바뀐 항목만 DOM에 쓴다.
  updateScore(elapsed: number, bestScore: number, wave: number): void {
    const cache = this.scoreCache
    const time = elapsed.toFixed(2)
    if (cache.time !== time) {
      cache.time = time
      this.timeValue.textContent = time
    }
    const best = bestScore.toFixed(2)
    if (cache.best !== best) {
      cache.best = best
      this.bestValue.textContent = best
    }
    const waveText = String(wave)
    if (cache.wave !== waveText) {
      cache.wave = waveText
      this.waveValue.textContent = waveText
    }
  }

  setRunActive(held: boolean): void {
    this.runButton.classList.toggle('is-active', held)
    this.runButton.setAttribute('aria-pressed', String(held))
  }

  // 매 프레임 호출되므로 마지막 적용값과 다를 때만 DOM에 쓴다.
  // 쿨다운 링은 정수 deg 단위로 양자화해 쓰기 빈도를 줄인다.
  updateRollButton(player: PlayerRuntime | undefined, state: GameState, elapsed: number): void {
    if (!player) {
      this.rollButton.disabled = false
      this.rollButtonCache.progressDeg = -1
      return
    }
    const ability = player.character.ability
    const label = ability === 'cloak' ? '클로킹' : '구르기'
    const cooldownTotal = ability === 'cloak' ? CLOAK.cooldown : ROLL.cooldown
    const isPlaying = state === 'playing'
    const remaining = isPlaying ? Math.max(0, player.rollCooldownUntil - elapsed) : 0
    const cooling = remaining > 0
    const active = isPlaying && elapsed < (ability === 'cloak' ? player.cloakActiveUntil : player.rollAnimationUntil)
    const progressDeg = cooling
      ? Math.round(Math.min(1, Math.max(0, remaining / cooldownTotal)) * 360)
      : 0

    const cache = this.rollButtonCache
    if (
      cache.label !== label ||
      cache.cooling !== cooling ||
      cache.active !== active ||
      cache.progressDeg !== progressDeg
    ) {
      cache.label = label
      cache.cooling = cooling
      cache.active = active
      cache.progressDeg = progressDeg
      this.rollButton.disabled = cooling
      this.rollButton.classList.toggle('is-cooling', cooling)
      this.rollButton.classList.toggle('is-rolling', active)
      this.rollButton.style.setProperty('--cooldown-progress', `${progressDeg}deg`)
      this.rollButtonLabel.textContent = label
      this.rollButton.setAttribute('aria-label', label)
    }

    if (!active && (this.getStatusText(1) === '구르기' || this.getStatusText(1) === '클로킹')) {
      this.setStatus(1, '회피 중')
    }
  }

  updateAbilityTimers(players: PlayerRuntime[], state: GameState, elapsed: number): void {
    for (const player of players) {
      const cache = this.abilityTimerCache[player.id - 1]!
      const node = player.id === 1 ? this.abilityTimer : this.abilityTimerP2
      const labelNode = player.id === 1 ? this.abilityTimerLabel : this.abilityTimerP2Label
      const valueNode = player.id === 1 ? this.abilityTimerValue : this.abilityTimerP2Value
      let visible = false
      let label = ''
      let value = ''
      if (state === 'playing') {
        const ability = player.character.ability
        const until = ability === 'cloak' ? player.cloakActiveUntil : player.rollAnimationUntil
        const remaining = until - elapsed
        if (remaining > 0) {
          visible = true
          label = ability === 'cloak' ? '클로킹' : '구르기'
          value = `${remaining.toFixed(1)}초`
        }
      }
      if (cache.visible !== visible) {
        cache.visible = visible
        node.classList.toggle('is-visible', visible)
      }
      if (!visible) continue
      if (cache.label !== label) {
        cache.label = label
        labelNode.textContent = label
      }
      if (cache.value !== value) {
        cache.value = value
        valueNode.textContent = value
      }
    }
  }
}
