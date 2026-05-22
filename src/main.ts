import './styles.css'

import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

import {
  ASSETS,
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  assetPath,
  findCharacter,
  pickRandomCharacter,
  type CharacterDefinition,
} from './assets'
import { AudioManager } from './audio'
import {
  type ArenaSpec,
  CLOAK,
  MAP_PRESETS,
  MOBILE_BREAKPOINT,
  MOBILE_TUNING,
  MOVEMENT,
  P1_BINDINGS,
  P2_BINDINGS,
  ROLL,
  SOLO_BINDINGS,
  STORAGE_KEYS,
  VERSUS,
  isMobileViewport,
} from './config'
import {
  PHASES,
  getPhaseIndex,
  getSpawnInterval,
  pickMissileKind,
} from './difficulty'
import { createMissileMesh, orientObjectToVelocity } from './missile-mesh'
import { gameRandom, gameRandomInt, gameRandomSpread, setRngSeed, clearRngSeed } from './rng'
import { OnlineNet, type OnlineRole, type OnlineNetEvents } from './net/online-net'
import { NEUTRAL_INPUT, type PlayerInput } from './net/input-packing'
import { SYNC_DIVISOR, BUFFER_LENGTH, MESSAGE_KIND, type MessageKind } from './net/input-queue'
import type {
  ActionName,
  BurstParticle,
  GameMode,
  GameState,
  JoystickState,
  MapKey,
  Missile,
  MissileKind,
  MobileCameraMode,
  PlayerBindings,
  PlayerId,
  PlayerRuntime,
} from './types'

function renderTemplate(target: HTMLElement, html: string): void {
  const fragment = document.createRange().createContextualFragment(html)
  target.replaceChildren(fragment)
}

class ChunsikDodgeGame {
  private readonly root: HTMLElement
  private readonly canvasHost: HTMLDivElement
  private readonly loading: HTMLDivElement
  private readonly loadingMeter: HTMLDivElement
  private readonly menu: HTMLDivElement
  private readonly menuTitle: HTMLElement
  private readonly menuText: HTMLElement
  private readonly resultPanel: HTMLDivElement
  private readonly finalTime: HTMLElement
  private readonly finalTimeLabel: HTMLElement
  private readonly startButton: HTMLButtonElement
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
  private readonly soundButton: HTMLButtonElement
  private readonly resetButton: HTMLButtonElement
  private readonly cameraToggle: HTMLDivElement
  private readonly rollButton: HTMLButtonElement
  private readonly rollButtonLabel: HTMLSpanElement
  private readonly runButton: HTMLButtonElement
  private readonly joystickBase: HTMLDivElement
  private readonly joystickStick: HTMLDivElement
  private readonly abilityTimer: HTMLDivElement
  private readonly abilityTimerLabel: HTMLSpanElement
  private readonly abilityTimerValue: HTMLSpanElement
  private readonly abilityTimerP2: HTMLDivElement
  private readonly abilityTimerP2Label: HTMLSpanElement
  private readonly abilityTimerP2Value: HTMLSpanElement
  private readonly modePicker: HTMLDivElement
  private readonly mapPicker: HTMLDivElement
  private readonly soloPicker: HTMLDivElement
  private readonly versusPicker: HTMLDivElement
  private readonly onlinePicker: HTMLDivElement
  private readonly onlineCreateBtn: HTMLButtonElement
  private readonly onlineJoinBtn: HTMLButtonElement
  private readonly onlineCopyBtn: HTMLButtonElement
  private readonly onlineRoomIdRow: HTMLDivElement
  private readonly onlineRoomIdLabel: HTMLElement
  private readonly onlineRoomIdInput: HTMLInputElement
  private readonly onlineStatus: HTMLParagraphElement
  private readonly keyboardHelpSolo: HTMLDivElement
  private readonly keyboardHelpVersus: HTMLDivElement
  private readonly keyboardHelpOnline: HTMLDivElement
  private readonly touchControls: HTMLDivElement

  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 120)
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true })
  private readonly loader = new GLTFLoader()
  private readonly textureLoader = new THREE.TextureLoader()
  private readonly clock = new THREE.Clock()
  private readonly audio = new AudioManager()
  private readonly keys = new Set<string>()
  private readonly cameraLookTarget = new THREE.Vector3(0, 0.25, -0.35)
  private readonly cameraLookCurrent = new THREE.Vector3(0, 0.25, -0.35)
  private readonly mobileChunsikCameraPan = new THREE.Vector2()
  private readonly mobileChunsikCameraPanTarget = new THREE.Vector2()
  private readonly missiles: Missile[] = []
  private readonly particles: BurstParticle[] = []
  private baseCharacterSkin?: HTMLImageElement
  private baseCharacterDetails?: HTMLImageElement
  private readonly joystick: JoystickState = {
    active: false,
    pointerId: null,
    centerX: 0,
    centerY: 0,
    vector: new THREE.Vector2(),
  }

  private state: GameState = 'ready'
  private mode: GameMode = (localStorage.getItem(STORAGE_KEYS.mode) as GameMode) === 'versus' ? 'versus' : 'solo'
  private versusMap: MapKey = (localStorage.getItem(STORAGE_KEYS.versusMap) as MapKey) === 'extended' ? 'extended' : 'normal'
  private arena: ArenaSpec = MAP_PRESETS.normal
  private arenaMeshes: THREE.Object3D[] = []
  private paperTexture?: THREE.Texture
  private sunLight?: THREE.DirectionalLight
  private gameoverRevealTimer: number | null = null
  private soloCharacter: CharacterDefinition = findCharacter(
    localStorage.getItem(STORAGE_KEYS.character) ?? DEFAULT_CHARACTER_ID,
  )
  private versusP1Character: CharacterDefinition = findCharacter(
    localStorage.getItem(STORAGE_KEYS.character) ?? DEFAULT_CHARACTER_ID,
  )
  private versusP2Character: CharacterDefinition = this.pickInitialP2Character()
  private soloPickerRandom = false
  private players: PlayerRuntime[] = []
  private bestScore = Number(localStorage.getItem(STORAGE_KEYS.best) ?? 0)
  private elapsed = 0
  private spawnTimer = 0
  private pendingSpawns: { at: number; kind: MissileKind }[] = []
  private simAccumulator = 0
  private online: OnlineNet | null = null
  private syncCounter = 0
  private peerAbilityWasDown = false
  private localAbilityWasDown = false
  private abilityPressedPending = false
  private shakeAmount = 0
  private currentPhaseIndex = -1
  private phaseLabelClearAt = 0
  private mobileCameraMode: MobileCameraMode = this.readMobileCameraMode()
  private targetCameraFov = 48
  private ground?: THREE.Mesh

  constructor(root: HTMLElement) {
    this.root = root
    renderTemplate(this.root, this.renderShell())
    this.canvasHost = this.getElement('canvas-host')
    this.loading = this.getElement('loading')
    this.loadingMeter = this.getElement('loading-meter')
    this.menu = this.getElement('menu')
    this.menuTitle = this.getElement('menu-title')
    this.menuText = this.getElement('menu-text')
    this.resultPanel = this.getElement('result-panel')
    this.finalTime = this.getElement('final-time')
    this.finalTimeLabel = this.getElement('final-time-label')
    this.startButton = this.getElement('start-button')
    this.timeValue = this.getElement('time-value')
    this.bestPanel = this.getElement('best-panel')
    this.bestValue = this.getElement('best-value')
    this.waveValue = this.getElement('wave-value')
    this.p1Panel = this.getElement('p1-panel')
    this.p2Panel = this.getElement('p2-panel')
    this.p1Name = this.getElement('p1-name')
    this.p2Name = this.getElement('p2-name')
    this.statusValue = this.getElement('status-value')
    this.statusValueP2 = this.getElement('status-value-p2')
    this.soundButton = this.getElement('sound-button')
    this.resetButton = this.getElement('reset-button')
    this.cameraToggle = this.getElement('camera-toggle')
    this.rollButton = this.getElement('roll-button')
    this.rollButtonLabel = this.getElement('roll-button-label')
    this.runButton = this.getElement('run-button')
    this.joystickBase = this.getElement('joystick-base')
    this.joystickStick = this.getElement('joystick-stick')
    this.abilityTimer = this.getElement('ability-timer')
    this.abilityTimerLabel = this.getElement('ability-timer-label')
    this.abilityTimerValue = this.getElement('ability-timer-value')
    this.abilityTimerP2 = this.getElement('ability-timer-p2')
    this.abilityTimerP2Label = this.getElement('ability-timer-p2-label')
    this.abilityTimerP2Value = this.getElement('ability-timer-p2-value')
    this.modePicker = this.getElement('mode-picker')
    this.mapPicker = this.getElement('map-picker')
    this.soloPicker = this.getElement('character-picker')
    this.versusPicker = this.getElement('versus-picker')
    this.onlinePicker = this.getElement('online-picker')
    this.onlineCreateBtn = this.getElement('online-create-btn')
    this.onlineJoinBtn = this.getElement('online-join-btn')
    this.onlineCopyBtn = this.getElement('online-copy-btn')
    this.onlineRoomIdRow = this.getElement('online-room-id-row')
    this.onlineRoomIdLabel = this.getElement('online-room-id')
    this.onlineRoomIdInput = this.getElement('online-room-id-input')
    this.onlineStatus = this.getElement('online-status')
    this.keyboardHelpSolo = this.getElement('keyboard-help-solo')
    this.keyboardHelpVersus = this.getElement('keyboard-help-versus')
    this.keyboardHelpOnline = this.getElement('keyboard-help-online')
    this.touchControls = this.getElement('touch-controls')
  }

  private pickInitialP2Character(): CharacterDefinition {
    const stored = localStorage.getItem(STORAGE_KEYS.characterP2)
    if (stored) {
      const candidate = findCharacter(stored)
      if (candidate.id !== this.versusP1Character.id) return candidate
    }
    const fallback = CHARACTERS.find(
      (character) => character.pickerVisible && character.id !== this.versusP1Character.id,
    )
    return fallback ?? CHARACTERS[0]!
  }

  async start(): Promise<void> {
    this.setupRenderer()
    this.setupScene()
    this.setupUi()
    this.setupOnlineUi()
    this.updateHud()
    this.updateSoundButton()
    await this.loadWorld()
    this.loading.classList.add('is-hidden')
    this.animate()
  }

  private renderShell(): string {
    return `
      <div class="game-shell">
        <div id="canvas-host" class="canvas-host"></div>
        <div id="ability-timer" class="ability-timer ability-timer--p1" aria-hidden="true">
          <span id="ability-timer-label" class="ability-timer-label">구르기</span>
          <span id="ability-timer-value" class="ability-timer-value">0.0</span>
        </div>
        <div id="ability-timer-p2" class="ability-timer ability-timer--p2" aria-hidden="true">
          <span id="ability-timer-p2-label" class="ability-timer-label">구르기</span>
          <span id="ability-timer-p2-value" class="ability-timer-value">0.0</span>
        </div>
        <div class="hud hud-top">
          <section class="score-panel" aria-label="점수">
            <div id="p1-panel" class="score-panel-cell score-panel-cell--p1" hidden>
              <span>1P</span>
              <strong id="p1-name">춘식이</strong>
            </div>
            <div>
              <span>TIME</span>
              <strong id="time-value">0.00</strong>
            </div>
            <div id="best-panel">
              <span>BEST</span>
              <strong id="best-value">0.00</strong>
            </div>
            <div>
              <span>WAVE</span>
              <strong id="wave-value">1</strong>
            </div>
            <div id="p2-panel" class="score-panel-cell score-panel-cell--p2" hidden>
              <span>2P</span>
              <strong id="p2-name">깜식이</strong>
            </div>
          </section>
          <div class="hud-actions">
            <button id="sound-button" class="icon-button" type="button" aria-label="사운드"></button>
            <button id="reset-button" class="icon-button" type="button" aria-label="다시 시작">
              <img src="${assetPath(ASSETS.images.replay)}" alt="" />
            </button>
          </div>
        </div>
        <div class="status-pill status-pill--p1" id="status-value">대기 중</div>
        <div class="status-pill status-pill--p2" id="status-value-p2" hidden>대기 중</div>
        <div id="camera-toggle" class="camera-toggle" role="group" aria-label="모바일 카메라">
          <button class="camera-option" type="button" data-camera-mode="arena" aria-pressed="true">전체</button>
          <button class="camera-option" type="button" data-camera-mode="chunsik" aria-pressed="false">춘식</button>
        </div>
        <div id="loading" class="loading">
          <img src="${assetPath(ASSETS.images.menuChunsik)}" alt="" />
          <strong>춘식이 출격 준비</strong>
          <div class="loading-bar"><div id="loading-meter"></div></div>
        </div>
        <div id="menu" class="menu-overlay">
          <section class="menu-card" aria-label="게임 메뉴">
            <img class="menu-character" src="${assetPath(ASSETS.images.menuChunsik)}" alt="" />
            <h1 id="menu-title">춘식이 미사일 회피</h1>
            <p id="menu-text">날아오는 궤적 사이를 빠져나가 오래 버티세요.</p>
            <div id="result-panel" class="result-panel" hidden>
              <span id="final-time-label" class="result-label">기록</span>
              <strong id="final-time">0.00초</strong>
            </div>
            <div id="mode-picker" class="mode-picker" role="radiogroup" aria-label="게임 모드">
              <button class="mode-option" type="button" data-game-mode="solo" role="radio" aria-checked="true">개인전</button>
              <button class="mode-option" type="button" data-game-mode="versus" role="radio" aria-checked="false">대결전</button>
              <button class="mode-option" type="button" data-game-mode="online" role="radio" aria-checked="false">온라인</button>
            </div>
            <div id="map-picker" class="mode-picker map-picker" role="radiogroup" aria-label="맵 선택" hidden>
              <button class="mode-option" type="button" data-map-key="normal" role="radio" aria-checked="true">일반맵</button>
              <button class="mode-option" type="button" data-map-key="extended" role="radio" aria-checked="false">확장맵</button>
            </div>
            <div id="character-picker" class="character-picker" role="radiogroup" aria-label="캐릭터 선택">
              <span class="character-picker-title">캐릭터</span>
              <div class="character-picker-grid">
                ${CHARACTERS.filter((character) => character.pickerVisible).map(
                  (character) => `
                  <button
                    class="character-option"
                    type="button"
                    data-character-id="${character.id}"
                    role="radio"
                    aria-checked="false"
                    aria-label="${character.name} - ${character.description}"
                  >
                    <span class="character-swatch" style="background:${character.swatch};"></span>
                    <span class="character-name">${character.name}</span>
                  </button>
                `,
                ).join('')}
                <button
                  class="character-option character-option--random"
                  type="button"
                  data-character-random
                  role="radio"
                  aria-checked="false"
                  aria-label="랜덤 선택 - 1/5 확률로 북극곰이 나옵니다"
                >
                  <span class="character-swatch character-swatch--random">?</span>
                  <span class="character-name">랜덤</span>
                </button>
              </div>
              <p class="character-picker-hint">랜덤은 1/5 확률로 <strong>북극곰</strong>이 등장합니다</p>
            </div>
            <div id="versus-picker" class="character-picker versus-picker" hidden>
              <span class="character-picker-title">1P 캐릭터</span>
              <div class="character-picker-grid" data-player-slot="1">
                ${CHARACTERS.filter((character) => character.pickerVisible).map(
                  (character) => `
                  <button
                    class="character-option"
                    type="button"
                    data-versus-id="${character.id}"
                    data-player-slot="1"
                    role="radio"
                    aria-checked="false"
                    aria-label="1P ${character.name}"
                  >
                    <span class="character-swatch" style="background:${character.swatch};"></span>
                    <span class="character-name">${character.name}</span>
                  </button>
                `,
                ).join('')}
              </div>
              <span class="character-picker-title">2P 캐릭터</span>
              <div class="character-picker-grid" data-player-slot="2">
                ${CHARACTERS.filter((character) => character.pickerVisible).map(
                  (character) => `
                  <button
                    class="character-option"
                    type="button"
                    data-versus-id="${character.id}"
                    data-player-slot="2"
                    role="radio"
                    aria-checked="false"
                    aria-label="2P ${character.name}"
                  >
                    <span class="character-swatch" style="background:${character.swatch};"></span>
                    <span class="character-name">${character.name}</span>
                  </button>
                `,
                ).join('')}
              </div>
              <p class="character-picker-hint">같은 캐릭터는 동시에 고를 수 없어요</p>
            </div>
            <div id="online-picker" class="online-picker" hidden>
              <div class="online-section">
                <button id="online-create-btn" class="online-action" type="button">방 만들기</button>
                <div id="online-room-id-row" class="online-room-id-row" hidden>
                  <span class="online-room-id-label">방 ID</span>
                  <code id="online-room-id" class="online-room-id"></code>
                  <button id="online-copy-btn" class="online-mini-btn" type="button">복사</button>
                </div>
              </div>
              <div class="online-section">
                <label class="online-join-label" for="online-room-id-input">친구의 방 ID</label>
                <div class="online-join-row">
                  <input id="online-room-id-input" class="online-room-id-input" type="text" placeholder="예: 02d361" maxlength="32" autocomplete="off" spellcheck="false" />
                  <button id="online-join-btn" class="online-action" type="button">들어가기</button>
                </div>
              </div>
              <p id="online-status" class="online-status" role="status">방을 만들거나 친구의 방 ID를 입력하세요</p>
              <p class="character-picker-hint">테스트할 때는 두 탭을 동시에 보이게 띄워주세요 — 비활성 탭은 브라우저가 멈춰서 락스텝이 진행되지 않습니다.</p>
            </div>
            <div id="keyboard-help-solo" class="keyboard-help" aria-label="키보드 조작법">
              <span class="keyboard-help-title">키보드 조작</span>
              <div class="keyboard-help-grid">
                <span><kbd>WASD</kbd><kbd>방향키</kbd></span>
                <strong>이동</strong>
                <span><kbd>Shift</kbd><kbd>이동</kbd></span>
                <strong>달리기</strong>
                <span><kbd>Space</kbd></span>
                <strong>구르기</strong>
                <span><kbd>Enter</kbd></span>
                <strong>시작</strong>
              </div>
            </div>
            <div id="keyboard-help-versus" class="keyboard-help keyboard-help--versus" hidden>
              <span class="keyboard-help-title">대결전 키보드 조작</span>
              <div class="versus-keys">
                <div class="versus-keys-row">
                  <strong class="versus-keys-row-label">1P</strong>
                  <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>
                  <span><kbd>L Shift</kbd></span>
                  <span><kbd>Space</kbd></span>
                </div>
                <div class="versus-keys-row">
                  <strong class="versus-keys-row-label">2P</strong>
                  <span><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span>
                  <span><kbd>R Shift</kbd></span>
                  <span><kbd>Enter</kbd></span>
                </div>
                <div class="versus-keys-legend">
                  <span>이동 / 달리기 / 능력</span>
                </div>
              </div>
            </div>
            <div id="keyboard-help-online" class="keyboard-help" aria-label="온라인 키보드 조작" hidden>
              <span class="keyboard-help-title">온라인 키보드 조작</span>
              <div class="keyboard-help-grid">
                <span><kbd>WASD</kbd><kbd>방향키</kbd></span>
                <strong>내 캐릭터 이동</strong>
                <span><kbd>Shift</kbd></span>
                <strong>달리기</strong>
                <span><kbd>Space</kbd></span>
                <strong>구르기</strong>
                <span><kbd>1</kbd><kbd>2</kbd></span>
                <strong>시점 전환</strong>
              </div>
              <p class="character-picker-hint">두 컴퓨터 모두 같은 키로 자기 캐릭터를 조작합니다.</p>
            </div>
            <button id="start-button" class="primary-button" type="button">시작</button>
          </section>
        </div>
        <div id="touch-controls" class="touch-controls">
          <div id="joystick-base" class="joystick-base">
            <div id="joystick-stick" class="joystick-stick"></div>
          </div>
          <div class="action-buttons">
            <button id="roll-button" class="action-button roll-button" type="button" aria-label="구르기">
              <span class="action-cooldown-ring" aria-hidden="true"></span>
              <span id="roll-button-label" class="action-label">구르기</span>
            </button>
            <button id="run-button" class="action-button run-button" type="button" aria-label="달리기" aria-pressed="false">
              <span class="action-label">달리기</span>
            </button>
          </div>
        </div>
      </div>
    `
  }

  private getElement<T extends HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`)
    if (!element) {
      throw new Error(`Missing element #${id}`)
    }
    return element
  }

  private setupRenderer(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.04
    this.renderer.domElement.tabIndex = 0
    this.renderer.domElement.style.outline = 'none'
    this.canvasHost.appendChild(this.renderer.domElement)
    window.addEventListener('resize', () => this.resize())
    this.resize()
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(0xe9f2ee)
    this.scene.fog = new THREE.Fog(0xe9f2ee, 28, 60)

    this.camera.position.set(0, 9.5, 12.2)
    this.cameraLookCurrent.set(0, 0, 0)
    this.cameraLookTarget.set(0, 0, 0)
    this.camera.lookAt(this.cameraLookCurrent)

    const ambient = new THREE.AmbientLight(0xffffff, 0.72)
    this.scene.add(ambient)

    const sun = new THREE.DirectionalLight(0xfff0d0, 2.1)
    sun.position.set(5, 9, 6)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.normalBias = 0.035
    this.sunLight = sun
    this.applyShadowCameraToArena(sun)
    this.scene.add(sun)

    const rim = new THREE.DirectionalLight(0xc9f4ff, 0.82)
    rim.position.set(-7, 5, -8)
    this.scene.add(rim)
  }

  private setupUi(): void {
    document.addEventListener('visibilitychange', () => {
      if (!this.online) return
      if (document.hidden && this.state === 'playing') {
        console.warn('[net] this tab is hidden — Chrome throttles inactive tabs. Open both tabs side-by-side for lockstep to progress.')
      }
    })
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code)
      this.updateRunButtonState()
      if (event.code === 'Space') {
        event.preventDefault()
        if (!this.online) this.tryAbility(this.players[0])
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        if (this.state === 'playing' && this.mode === 'versus' && !this.online) {
          this.tryAbility(this.players[1])
        } else if (this.state !== 'playing') {
          this.requestStartGame()
        }
      }
      if (event.code === 'Digit1' || event.code === 'Numpad1') this.setMobileCameraMode('arena')
      if (event.code === 'Digit2' || event.code === 'Numpad2') this.setMobileCameraMode('chunsik')
    })
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code)
      this.updateRunButtonState()
    })

    this.startButton.addEventListener('click', () => this.requestStartGame())
    this.resetButton.addEventListener('click', () => this.resetToReady())
    this.soundButton.addEventListener('click', () => {
      this.audio.setEnabled(!this.audio.isEnabled())
      this.updateSoundButton()
      this.audio.playSfx(ASSETS.audio.uiClick, 0.35)
    })
    this.cameraToggle.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-camera-mode]')
      if (!button) return
      this.setMobileCameraMode(button.dataset.cameraMode === 'chunsik' ? 'chunsik' : 'arena')
      this.audio.playSfx(ASSETS.audio.uiClick, 0.28)
    })
    this.rollButton.addEventListener('click', () => {
      if (this.online) {
        this.abilityPressedPending = true
        return
      }
      this.tryAbility(this.players[0])
    })
    this.runButton.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      this.runButton.setPointerCapture(event.pointerId)
      this.setRunButtonHeld(true)
    })
    this.runButton.addEventListener('pointerup', (event) => {
      event.preventDefault()
      this.setRunButtonHeld(false)
    })
    this.runButton.addEventListener('pointercancel', () => this.setRunButtonHeld(false))
    this.runButton.addEventListener('lostpointercapture', () => this.setRunButtonHeld(false))

    this.joystickBase.addEventListener('pointerdown', (event) => this.startJoystick(event))
    window.addEventListener('pointermove', (event) => this.moveJoystick(event))
    window.addEventListener('pointerup', (event) => this.endJoystick(event))
    window.addEventListener('pointercancel', (event) => this.endJoystick(event))

    this.modePicker.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-game-mode]')
      if (!button) return
      const raw = button.dataset.gameMode
      const next: GameMode = raw === 'versus' ? 'versus' : raw === 'online' ? 'online' : 'solo'
      if (next === this.mode && !(next === 'online' && !this.online)) return
      this.audio.playSfx(ASSETS.audio.uiClick, 0.3)
      if (next === 'online') {
        this.exitOnlineMode()
        void this.setMode('online')
      } else {
        this.exitOnlineMode()
        void this.setMode(next)
      }
    })

    this.mapPicker.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-map-key]')
      if (!button) return
      if (this.state !== 'ready') return
      const next: MapKey = button.dataset.mapKey === 'extended' ? 'extended' : 'normal'
      if (next === this.versusMap) return
      this.audio.playSfx(ASSETS.audio.uiClick, 0.3)
      void this.setVersusMap(next)
    })

    this.soloPicker.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const randomBtn = target.closest<HTMLButtonElement>('[data-character-random]')
      if (randomBtn) {
        const next = pickRandomCharacter()
        this.audio.playSfx(ASSETS.audio.uiClick, 0.32)
        this.soloPickerRandom = true
        if (next.id !== this.soloCharacter.id) {
          this.soloCharacter = next
          localStorage.setItem(STORAGE_KEYS.character, next.id)
          void this.applySelectionToPlayers()
        }
        this.updateCharacterPicker()
        return
      }
      const button = target.closest<HTMLButtonElement>('[data-character-id]')
      const characterId = button?.dataset.characterId
      if (!characterId) return
      const next = findCharacter(characterId)
      const sameId = next.id === this.soloCharacter.id
      this.soloPickerRandom = false
      if (!sameId) {
        this.soloCharacter = next
        localStorage.setItem(STORAGE_KEYS.character, next.id)
        void this.applySelectionToPlayers()
      }
      this.updateCharacterPicker()
      this.audio.playSfx(ASSETS.audio.uiClick, 0.32)
    })

    this.versusPicker.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-versus-id]')
      if (!button) return
      if (this.online && this.online.role === 'guest') return
      const characterId = button.dataset.versusId
      const slot = button.dataset.playerSlot === '2' ? 2 : 1
      if (!characterId) return
      const next = findCharacter(characterId)
      if (slot === 1) {
        if (this.versusP1Character.id === next.id) return
        if (this.versusP2Character.id === next.id) {
          this.versusP2Character = this.versusP1Character
          localStorage.setItem(STORAGE_KEYS.characterP2, this.versusP2Character.id)
        }
        this.versusP1Character = next
        localStorage.setItem(STORAGE_KEYS.character, next.id)
      } else {
        if (this.versusP2Character.id === next.id) return
        if (this.versusP1Character.id === next.id) {
          this.versusP1Character = this.versusP2Character
          localStorage.setItem(STORAGE_KEYS.character, this.versusP1Character.id)
        }
        this.versusP2Character = next
        localStorage.setItem(STORAGE_KEYS.characterP2, next.id)
      }
      this.audio.playSfx(ASSETS.audio.uiClick, 0.32)
      this.updateCharacterPicker()
      void this.applySelectionToPlayers()
      if (this.online && this.online.role === 'host') {
        this.sendCharacterPickToPeer()
      }
    })

    this.updateCameraToggle()
    this.updateModePicker()
    this.updateMapPicker()
    this.updateCharacterPicker()
    this.updateModeChrome()
    this.updateRollButtonState()
    this.updateRunButtonState()
  }

  private async loadWorld(): Promise<void> {
    this.setLoading(12)
    this.arena = MAP_PRESETS[this.getActiveMapKey()]
    if (this.sunLight) {
      this.applyShadowCameraToArena(this.sunLight)
    }
    await this.createDecorations()
    await this.buildArenaMeshes()
    this.setLoading(38)
    await this.createPlayersForMode()
    this.setLoading(100)
  }

  private async createDecorations(): Promise<void> {
    const racingMapTexture = await this.loadTexture(ASSETS.images.racingMap)
    const racingMap = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 4),
      new THREE.MeshBasicMaterial({
        map: racingMapTexture,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    )
    racingMap.rotation.x = -Math.PI / 2
    racingMap.rotation.z = -0.08
    racingMap.position.set(3.3, 0.03, -1.15)
    this.scene.add(racingMap)
  }

  private async rebuildArenaVisuals(): Promise<void> {
    this.disposeArenaMeshes()
    await this.buildArenaMeshes()
  }

  private disposeArenaMeshes(): void {
    for (const mesh of this.arenaMeshes) {
      this.scene.remove(mesh)
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          const material = child.material
          if (Array.isArray(material)) {
            material.forEach((m) => m.dispose())
          } else {
            material?.dispose()
          }
        } else if (child instanceof THREE.GridHelper) {
          child.geometry.dispose()
          const material = child.material
          if (Array.isArray(material)) {
            material.forEach((m) => m.dispose())
          } else {
            material.dispose()
          }
        }
      })
    }
    this.arenaMeshes = []
    this.ground = undefined
  }

  private async buildArenaMeshes(): Promise<void> {
    await this.buildGroundAndGrid()
    this.buildArenaRails()
  }

  private setLoading(percent: number): void {
    this.loadingMeter.style.width = `${percent}%`
  }

  private async loadTexture(path: string): Promise<THREE.Texture> {
    const texture = await this.textureLoader.loadAsync(assetPath(path))
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private async loadImage(path: string): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.crossOrigin = 'anonymous'
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error(`Failed to load image: ${path}`))
      element.src = assetPath(path)
    })
  }

  private async loadCharacterBaseLayers(): Promise<{ skin: HTMLImageElement; details: HTMLImageElement }> {
    if (!this.baseCharacterSkin || !this.baseCharacterDetails) {
      const [skin, details] = await Promise.all([
        this.loadImage(ASSETS.images.chunsikUvSkin),
        this.loadImage(ASSETS.images.chunsikUvDetails),
      ])
      this.baseCharacterSkin = skin
      this.baseCharacterDetails = details
    }
    return { skin: this.baseCharacterSkin, details: this.baseCharacterDetails }
  }

  private async createCharacterTexture(character: CharacterDefinition): Promise<THREE.Texture | null> {
    if (character.appearance.type !== 'uvFilter') return null
    const { hue, saturation, brightness } = character.appearance
    const { skin, details } = await this.loadCharacterBaseLayers()
    const canvas = document.createElement('canvas')
    canvas.width = skin.naturalWidth
    canvas.height = skin.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    if (hue !== 0 || saturation !== 1 || brightness !== 1) {
      ctx.filter = `hue-rotate(${hue}deg) saturate(${saturation}) brightness(${brightness})`
    }
    ctx.drawImage(skin, 0, 0)
    ctx.filter = 'none'
    ctx.drawImage(details, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.flipY = false
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    texture.needsUpdate = true
    return texture
  }

  private async createPlayersForMode(): Promise<void> {
    this.disposeAllPlayers()
    if (this.mode === 'solo') {
      const player = this.createPlayerSlot(1, SOLO_BINDINGS, this.soloCharacter)
      this.players = [player]
      await this.loadCharacterForPlayer(player)
    } else {
      const p1 = this.createPlayerSlot(1, P1_BINDINGS, this.versusP1Character)
      const p2 = this.createPlayerSlot(2, P2_BINDINGS, this.versusP2Character)
      this.players = [p1, p2]
      await Promise.all([this.loadCharacterForPlayer(p1), this.loadCharacterForPlayer(p2)])
    }
    this.positionPlayersForStart()
  }

  private createPlayerSlot(id: PlayerId, bindings: PlayerBindings, character: CharacterDefinition): PlayerRuntime {
    return {
      id,
      bindings,
      character,
      actions: new Map(),
      input: new THREE.Vector2(),
      rollLockedInput: new THREE.Vector2(),
      lookTarget: new THREE.Vector3(),
      targetQuaternion: new THREE.Quaternion(),
      rollAnimationUntil: 0,
      rollCooldownUntil: 0,
      cloakActiveUntil: 0,
      idleTimer: 0,
      nextIdleVariant: 6,
      runHeld: false,
      alive: true,
      ashTimer: null,
      ashMaterials: [],
    }
  }

  private positionPlayersForStart(): void {
    if (this.players.length === 1) {
      const player = this.players[0]
      player.group?.position.set(0, 0, 0)
      player.group?.quaternion.identity()
    } else if (this.players.length === 2) {
      const offsetX = VERSUS.spawnOffsetX
      this.players[0].group?.position.set(-offsetX, 0, 0)
      this.players[0].group?.quaternion.identity()
      this.players[1].group?.position.set(offsetX, 0, 0)
      this.players[1].group?.quaternion.identity()
      this.players[0].group?.rotateY(Math.PI / 2)
      this.players[1].group?.rotateY(-Math.PI / 2)
    }
    for (const player of this.players) {
      if (player.group && player.shadow) {
        player.shadow.position.x = player.group.position.x
        player.shadow.position.z = player.group.position.z
      }
    }
  }

  private async setMode(mode: GameMode): Promise<void> {
    if (this.mode === mode) return
    this.mode = mode
    localStorage.setItem(STORAGE_KEYS.mode, mode)
    if (mode === 'versus' && this.versusP1Character.id === this.versusP2Character.id) {
      this.versusP2Character = this.pickInitialP2Character()
      localStorage.setItem(STORAGE_KEYS.characterP2, this.versusP2Character.id)
    }
    this.setMobileCameraMode(mode === 'solo' ? 'chunsik' : 'arena')
    this.updateModePicker()
    this.updateMapPicker()
    this.updateModeChrome()
    this.updateCharacterPicker()
    await this.applyActiveArena()
    await this.createPlayersForMode()
    this.resetToReady()
  }

  private async applySelectionToPlayers(): Promise<void> {
    if (this.state === 'playing') {
      return
    }
    if (this.mode === 'solo') {
      const player = this.players[0]
      if (!player) return
      if (player.character.id !== this.soloCharacter.id) {
        await this.swapCharacterForPlayer(player, this.soloCharacter)
      }
    } else {
      const [p1, p2] = this.players
      if (!p1 || !p2) return
      if (p1.character.id !== this.versusP1Character.id) {
        await this.swapCharacterForPlayer(p1, this.versusP1Character)
      }
      if (p2.character.id !== this.versusP2Character.id) {
        await this.swapCharacterForPlayer(p2, this.versusP2Character)
      }
    }
    this.positionPlayersForStart()
    this.updateModeChrome()
  }

  private async swapCharacterForPlayer(player: PlayerRuntime, next: CharacterDefinition): Promise<void> {
    const previousModelPath = player.character.modelPath
    const previousPosition = player.group?.position.clone()
    const previousQuaternion = player.group?.quaternion.clone()
    player.character = next
    if (previousModelPath === next.modelPath && player.group) {
      const texture = await this.createCharacterTexture(next)
      if (texture) {
        const previousTexture = player.texture
        player.texture = texture
        player.group.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            child.material.map = texture
            child.material.needsUpdate = true
          }
        })
        previousTexture?.dispose()
      }
      return
    }
    this.disposeCharacterMeshForPlayer(player)
    await this.loadCharacterForPlayer(player)
    if (player.group && previousPosition && previousQuaternion) {
      player.group.position.copy(previousPosition)
      player.group.quaternion.copy(previousQuaternion)
    }
  }

  private disposeAllPlayers(): void {
    for (const player of this.players) {
      this.disposeCharacterMeshForPlayer(player)
    }
    this.players = []
  }

  private disposeCharacterMeshForPlayer(player: PlayerRuntime): void {
    if (player.cloakActiveUntil > 0) {
      player.cloakActiveUntil = 0
      this.setCloakActive(player, false)
    }
    player.ashMaterials = []
    player.ashTimer = null
    if (player.group) {
      this.scene.remove(player.group)
      player.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          const material = child.material
          if (Array.isArray(material)) {
            material.forEach((m) => m.dispose())
          } else {
            material?.dispose()
          }
        }
      })
    }
    player.mixer?.stopAllAction()
    player.actions.clear()
    player.currentAction = undefined
    player.group = undefined
    player.mixer = undefined
    player.texture?.dispose()
    player.texture = undefined
    if (player.shadow) {
      this.scene.remove(player.shadow)
      player.shadow.geometry.dispose()
      ;(player.shadow.material as THREE.Material).dispose()
      player.shadow = undefined
    }
  }

  private updateCharacterPicker(): void {
    const randomActive = this.soloPickerRandom || !this.soloCharacter.pickerVisible
    for (const button of this.soloPicker.querySelectorAll<HTMLButtonElement>('[data-character-id]')) {
      const active = !randomActive && button.dataset.characterId === this.soloCharacter.id
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
    const randomBtn = this.soloPicker.querySelector<HTMLButtonElement>('[data-character-random]')
    if (randomBtn) {
      randomBtn.classList.toggle('is-active', randomActive)
      randomBtn.setAttribute('aria-checked', String(randomActive))
    }
    for (const button of this.versusPicker.querySelectorAll<HTMLButtonElement>('[data-versus-id]')) {
      const slot = button.dataset.playerSlot === '2' ? 2 : 1
      const selectedId = slot === 1 ? this.versusP1Character.id : this.versusP2Character.id
      const otherId = slot === 1 ? this.versusP2Character.id : this.versusP1Character.id
      const active = button.dataset.versusId === selectedId
      const takenByOther = button.dataset.versusId === otherId
      button.classList.toggle('is-active', active)
      button.classList.toggle('is-taken', takenByOther && !active)
      button.setAttribute('aria-checked', String(active))
    }
  }

  private updateModePicker(): void {
    for (const button of this.modePicker.querySelectorAll<HTMLButtonElement>('[data-game-mode]')) {
      const active = button.dataset.gameMode === this.mode
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
  }

  private updateMapPicker(): void {
    for (const button of this.mapPicker.querySelectorAll<HTMLButtonElement>('[data-map-key]')) {
      const active = button.dataset.mapKey === this.versusMap
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
  }

  private getActiveMapKey(): MapKey {
    return this.mode === 'versus' ? this.versusMap : 'normal'
  }

  private async setVersusMap(next: MapKey): Promise<void> {
    if (this.versusMap === next) return
    this.versusMap = next
    localStorage.setItem(STORAGE_KEYS.versusMap, next)
    this.updateMapPicker()
    if (this.mode === 'versus') {
      await this.applyActiveArena()
    }
  }

  private async applyActiveArena(): Promise<void> {
    const nextSpec = MAP_PRESETS[this.getActiveMapKey()]
    if (this.arena === nextSpec) return
    this.arena = nextSpec
    if (this.sunLight) {
      this.applyShadowCameraToArena(this.sunLight)
    }
    await this.rebuildArenaVisuals()
    this.positionPlayersForStart()
  }

  private applyShadowCameraToArena(sun: THREE.DirectionalLight): void {
    const margin = 4
    const halfX = this.arena.halfWidth + margin
    const halfZ = this.arena.halfDepth + margin
    sun.shadow.camera.left = -halfX
    sun.shadow.camera.right = halfX
    sun.shadow.camera.top = halfZ
    sun.shadow.camera.bottom = -halfZ
    sun.shadow.camera.updateProjectionMatrix()
  }

  private updateModeChrome(): void {
    const solo = this.mode === 'solo'
    const versus = this.mode === 'versus'
    const online = this.mode === 'online'
    const twoPlayer = versus || online
    this.soloPicker.hidden = !solo
    this.versusPicker.hidden = !versus && !online
    this.onlinePicker.hidden = !online
    this.mapPicker.hidden = !versus
    this.keyboardHelpSolo.hidden = !solo
    this.keyboardHelpVersus.hidden = !versus
    this.keyboardHelpOnline.hidden = !online
    this.bestPanel.hidden = !solo
    this.p1Panel.hidden = !twoPlayer
    this.p2Panel.hidden = !twoPlayer
    this.statusValueP2.hidden = !twoPlayer
    this.touchControls.classList.toggle('is-hidden', !solo)
    if (online) this.menuTitle.textContent = '온라인 대결전 출격 준비'
    else if (versus) this.menuTitle.textContent = '대결전 출격 준비'
    else this.menuTitle.textContent = '춘식이 미사일 회피'
    if (versus) {
      this.menuText.textContent = '두 플레이어가 한 아레나에서 끝까지 살아남으세요.'
      this.p1Name.textContent = this.versusP1Character.name
      this.p2Name.textContent = this.versusP2Character.name
    } else if (online) {
      this.menuText.textContent = '방을 만들거나 친구의 방 ID로 입장해 함께 회피하세요.'
      this.p1Name.textContent = (CHARACTERS[0]?.name ?? '1P')
      this.p2Name.textContent = (CHARACTERS[1]?.name ?? '2P')
    } else {
      this.menuText.textContent = '날아오는 궤적 사이를 빠져나가 오래 버티세요.'
    }
    document.body.classList.toggle('mode-versus', twoPlayer)
  }

  private async buildGroundAndGrid(): Promise<void> {
    if (!this.paperTexture) {
      this.paperTexture = await this.loadTexture(ASSETS.images.paper)
      this.paperTexture.wrapS = THREE.RepeatWrapping
      this.paperTexture.wrapT = THREE.RepeatWrapping
    }
    this.paperTexture.repeat.set((3 * this.arena.width) / 17, (2 * this.arena.depth) / 11)
    this.paperTexture.needsUpdate = true

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.arena.width, this.arena.depth),
      new THREE.MeshStandardMaterial({
        map: this.paperTexture,
        roughness: 0.86,
        metalness: 0,
      }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground)
    this.arenaMeshes.push(this.ground)

    const grid = new THREE.GridHelper(this.arena.width, this.arena.gridDivisions, 0x23666a, 0xb6cfc6)
    grid.position.y = 0.04
    this.scene.add(grid)
    this.arenaMeshes.push(grid)
  }

  private buildArenaRails(): void {
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x244f52,
      roughness: 0.48,
      metalness: 0.05,
    })
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0xe5903c,
      roughness: 0.5,
      metalness: 0.08,
      emissive: 0x331100,
      emissiveIntensity: 0.15,
    })
    const horizontal = new THREE.BoxGeometry(this.arena.width + 0.8, 0.22, 0.18)
    const vertical = new THREE.BoxGeometry(0.18, 0.22, this.arena.depth + 0.8)

    const rails = [
      new THREE.Mesh(horizontal, railMaterial),
      new THREE.Mesh(horizontal, railMaterial),
      new THREE.Mesh(vertical, railMaterial),
      new THREE.Mesh(vertical, railMaterial),
    ]
    rails[0].position.set(0, 0.11, -this.arena.halfDepth - 0.16)
    rails[1].position.set(0, 0.11, this.arena.halfDepth + 0.16)
    rails[2].position.set(-this.arena.halfWidth - 0.16, 0.11, 0)
    rails[3].position.set(this.arena.halfWidth + 0.16, 0.11, 0)
    for (const rail of rails) {
      rail.castShadow = true
      rail.receiveShadow = true
      this.scene.add(rail)
      this.arenaMeshes.push(rail)
    }

    const markerSpacing = this.arena.halfWidth * (5.2 / 8.5)
    for (const x of [-markerSpacing, 0, markerSpacing]) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.26, 0.28), accentMaterial)
      marker.position.set(x, 0.18, -this.arena.halfDepth - 0.16)
      marker.castShadow = true
      this.scene.add(marker)
      this.arenaMeshes.push(marker)
    }
  }

  private async loadCharacterForPlayer(player: PlayerRuntime): Promise<void> {
    const definition = player.character
    const gltf = await this.loader.loadAsync(assetPath(definition.modelPath))
    const character = gltf.scene
    this.normalizeObject(character, definition.desiredHeight)
    character.position.set(0, 0, 0)
    character.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = false
        if (!child.geometry.attributes.normal) {
          child.geometry.computeVertexNormals()
        }
      }
    })

    if (definition.appearance.type === 'uvFilter') {
      const texture = await this.createCharacterTexture(definition)
      player.texture = texture ?? undefined
      character.traverse((child) => {
        if (child instanceof THREE.Mesh && texture) {
          child.material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.72,
            metalness: 0,
            side: THREE.DoubleSide,
          })
        }
      })
    }

    player.group = character
    player.mixer = new THREE.AnimationMixer(character)
    this.scene.add(character)

    const anims = definition.animations
    const actionLoads: Promise<void>[] = [
      this.loadActionForPlayer(player, 'idle', anims.idle),
      this.loadActionForPlayer(player, 'walk', anims.walk),
      this.loadActionForPlayer(player, 'run', anims.run),
      this.loadActionForPlayer(player, 'surprise', anims.surprise, true),
    ]
    if (anims.rolling) {
      actionLoads.push(this.loadActionForPlayer(player, 'rolling', anims.rolling, true))
    }
    if (anims.idle2) {
      actionLoads.push(this.loadActionForPlayer(player, 'idle2', anims.idle2, true))
    }
    await Promise.all(actionLoads)

    player.mixer.addEventListener('finished', (event) => {
      if (event.action !== player.currentAction) return
      if (this.state === 'playing' && player.alive && player.input.lengthSq() > 0.05) {
        this.playAction(player, this.getMovementAction(player))
      } else {
        this.playAction(player, 'idle')
      }
    })
    this.playAction(player, 'idle')
    await this.createShadowForPlayer(player)
  }

  private async loadActionForPlayer(
    player: PlayerRuntime,
    name: ActionName,
    path: string,
    once = false,
  ): Promise<void> {
    if (!player.mixer) return
    const gltf = await this.loader.loadAsync(assetPath(path))
    const clip = this.prepareClip(gltf, player.character.bonePrefix)
    if (!clip) return
    const action = player.mixer.clipAction(clip)
    if (once) {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    if (name === 'walk') {
      action.timeScale = 0.82
    }
    player.actions.set(name, action)
  }

  private prepareClip(gltf: GLTF, bonePrefix: string): THREE.AnimationClip | null {
    const clip = gltf.animations[0]?.clone()
    if (!clip) return null
    clip.tracks = clip.tracks.filter((track) => {
      if (!track.name.startsWith(bonePrefix)) return false
      if (!track.name.endsWith('.position')) return true
      const values = track.values
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (let index = 0; index < values.length; index += 3) {
        minX = Math.min(minX, values[index] ?? 0)
        maxX = Math.max(maxX, values[index] ?? 0)
        minZ = Math.min(minZ, values[index + 2] ?? 0)
        maxZ = Math.max(maxZ, values[index + 2] ?? 0)
      }
      return maxX - minX < 5 && maxZ - minZ < 5
    })
    return clip
  }

  private normalizeObject(object: THREE.Object3D, desiredHeight: number): void {
    const box = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    box.getSize(size)
    if (size.y > 0) {
      object.scale.setScalar(desiredHeight / size.y)
    }
    const normalizedBox = new THREE.Box3().setFromObject(object)
    object.position.y -= normalizedBox.min.y
  }

  private async createShadowForPlayer(player: PlayerRuntime): Promise<void> {
    const texture = await this.loadTexture(ASSETS.images.shadow)
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.74),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.035
    if (player.group) {
      shadow.position.x = player.group.position.x
      shadow.position.z = player.group.position.z
    }
    this.scene.add(shadow)
    player.shadow = shadow
  }

  private startGame(): void {
    this.clearGameoverRevealTimer()
    this.clearMissiles()
    this.clearParticles()
    this.state = 'playing'
    this.elapsed = 0
    this.spawnTimer = 0
    this.pendingSpawns.length = 0
    this.currentPhaseIndex = -1
    this.phaseLabelClearAt = 0
    this.shakeAmount = 0

    for (const player of this.players) {
      player.rollAnimationUntil = 0
      player.rollCooldownUntil = 0
      if (player.cloakActiveUntil > 0) {
        player.cloakActiveUntil = 0
        this.setCloakActive(player, false)
      }
      this.clearAshEffect(player)
      player.alive = true
      player.input.set(0, 0)
      player.rollLockedInput.set(0, 0)
      this.playAction(player, 'idle')
    }
    this.positionPlayersForStart()

    this.setRunButtonHeld(false)
    this.updateRollButtonState()
    this.menu.classList.add('is-hidden')
    this.setStatus(1, '회피 중')
    if (this.mode === 'versus' || this.online) this.setStatus(2, '회피 중')

    this.audio.playBgm()
    this.updateHud()
  }

  private resetToReady(): void {
    this.clearGameoverRevealTimer()
    this.state = 'ready'
    this.clearMissiles()
    this.clearParticles()
    this.elapsed = 0
    this.spawnTimer = 0
    this.pendingSpawns.length = 0
    this.currentPhaseIndex = -1
    this.phaseLabelClearAt = 0

    for (const player of this.players) {
      player.rollAnimationUntil = 0
      player.rollCooldownUntil = 0
      if (player.cloakActiveUntil > 0) {
        player.cloakActiveUntil = 0
        this.setCloakActive(player, false)
      }
      this.clearAshEffect(player)
      player.alive = true
      this.playAction(player, 'idle')
    }
    this.positionPlayersForStart()
    this.setRunButtonHeld(false)
    this.updateRollButtonState()
    if (this.mode === 'online') {
      this.menuTitle.textContent = '온라인 대결전 출격 준비'
      this.menuText.textContent = '방을 만들거나 친구의 방 ID로 입장해 함께 회피하세요.'
    } else if (this.mode === 'versus') {
      this.menuTitle.textContent = '대결전 출격 준비'
      this.menuText.textContent = '두 플레이어가 한 아레나에서 끝까지 살아남으세요.'
    } else {
      this.menuTitle.textContent = '춘식이 미사일 회피'
      this.menuText.textContent = '날아오는 궤적 사이를 빠져나가 오래 버티세요.'
    }
    this.resultPanel.hidden = true
    this.startButton.textContent = '시작'
    this.menu.classList.remove('is-hidden')
    this.setStatus(1, '대기 중')
    this.setStatus(2, '대기 중')
    this.updateHud()
  }

  private endGameSolo(): void {
    if (this.state !== 'playing') return
    this.state = 'gameover'
    this.shakeAmount = 0.8
    const player = this.players[0]
    if (player) {
      player.rollAnimationUntil = 0
      player.rollCooldownUntil = 0
      if (player.cloakActiveUntil > 0) {
        player.cloakActiveUntil = 0
        this.setCloakActive(player, false)
      }
      player.alive = false
      this.spawnBurst(player.group?.position ?? new THREE.Vector3())
      this.playAction(player, 'surprise')
      this.startAshEffect(player)
    }
    this.setRunButtonHeld(false)
    this.updateRollButtonState()
    this.menuTitle.textContent = this.elapsed > this.bestScore ? '새 기록' : '충돌'
    this.menuText.textContent = '한 번 더 틈을 찾아보세요.'
    this.finalTimeLabel.textContent = '기록'
    this.finalTime.textContent = `${this.elapsed.toFixed(2)}초`
    this.startButton.textContent = '재도전'
    this.setStatus(1, '충돌')
    this.audio.playSfx(ASSETS.audio.hit, 0.58)
    this.scheduleGameoverReveal()

    if (this.elapsed > this.bestScore) {
      this.bestScore = this.elapsed
      localStorage.setItem(STORAGE_KEYS.best, String(this.bestScore))
    }
    this.updateHud()
  }

  private endGameVersus(): void {
    if (this.state !== 'playing') return
    this.state = 'gameover'
    this.shakeAmount = 0.6
    const [p1, p2] = this.players
    for (const player of this.players) {
      player.rollAnimationUntil = 0
      player.rollCooldownUntil = 0
      if (player.cloakActiveUntil > 0) {
        player.cloakActiveUntil = 0
        this.setCloakActive(player, false)
      }
      if (!player.alive) {
        this.spawnBurst(player.group?.position ?? new THREE.Vector3())
        this.playAction(player, 'surprise')
        this.startAshEffect(player)
      } else {
        this.playAction(player, 'idle')
      }
    }

    const p1Alive = !!p1?.alive
    const p2Alive = !!p2?.alive
    let title: string
    let label: string
    if (p1Alive && !p2Alive) {
      title = '1P 승리!'
      label = `${p1?.character.name ?? '1P'} 승`
      this.setStatus(1, '승리')
      this.setStatus(2, '패배')
    } else if (!p1Alive && p2Alive) {
      title = '2P 승리!'
      label = `${p2?.character.name ?? '2P'} 승`
      this.setStatus(1, '패배')
      this.setStatus(2, '승리')
    } else {
      title = '무승부'
      label = '동시 격추'
      this.setStatus(1, '무승부')
      this.setStatus(2, '무승부')
    }

    this.setRunButtonHeld(false)
    this.updateRollButtonState()
    this.menuTitle.textContent = title
    this.menuText.textContent = '한 판 더 어떠세요?'
    this.finalTimeLabel.textContent = label
    this.finalTime.textContent = `${this.elapsed.toFixed(2)}초 생존`
    this.startButton.textContent = '재대결'
    this.audio.playSfx(ASSETS.audio.hit, 0.58)
    this.scheduleGameoverReveal()
    this.updateHud()
  }

  private endGame(): void {
    if (this.mode === 'versus' || this.online) this.endGameVersus()
    else this.endGameSolo()
  }

  private scheduleGameoverReveal(): void {
    this.clearGameoverRevealTimer()
    const fallbackSec = 1.4
    let durationSec = fallbackSec
    for (const player of this.players) {
      if (player.alive) continue
      const action = player.actions.get('surprise')
      const clipDuration = action?.getClip().duration
      if (clipDuration && clipDuration > durationSec) durationSec = clipDuration
    }
    this.gameoverRevealTimer = window.setTimeout(() => {
      this.gameoverRevealTimer = null
      if (this.state !== 'gameover') return
      this.resultPanel.hidden = false
      this.menu.classList.remove('is-hidden')
    }, durationSec * 1000)
  }

  private clearGameoverRevealTimer(): void {
    if (this.gameoverRevealTimer !== null) {
      window.clearTimeout(this.gameoverRevealTimer)
      this.gameoverRevealTimer = null
    }
  }

  private isKeyDown(codes: string[]): boolean {
    for (const code of codes) {
      if (this.keys.has(code)) return true
    }
    return false
  }

  private updateInputForPlayer(player: PlayerRuntime): void {
    if (this.online) return
    let x = 0
    let y = 0
    if (this.isKeyDown(player.bindings.left)) x -= 1
    if (this.isKeyDown(player.bindings.right)) x += 1
    if (this.isKeyDown(player.bindings.up)) y -= 1
    if (this.isKeyDown(player.bindings.down)) y += 1

    if (this.mode === 'solo' && this.joystick.active) {
      x = this.joystick.vector.x
      y = this.joystick.vector.y
    }

    player.input.set(x, y)
    if (player.input.lengthSq() > 1) player.input.normalize()
  }

  private tryAbility(player: PlayerRuntime | undefined): void {
    if (!player) return
    if (this.state !== 'playing') return
    if (!player.alive) return
    if (this.elapsed < player.rollCooldownUntil) return
    if (player.character.ability === 'cloak') {
      player.cloakActiveUntil = this.elapsed + CLOAK.duration
      player.rollCooldownUntil = this.elapsed + CLOAK.cooldown
      this.setCloakActive(player, true)
      this.setStatus(player.id, '클로킹')
    } else {
      player.rollAnimationUntil = this.elapsed + ROLL.animationDuration
      player.rollCooldownUntil = this.elapsed + ROLL.cooldown
      player.rollLockedInput.copy(player.input)
      this.playAction(player, 'rolling')
      this.setStatus(player.id, '구르기')
    }
    this.updateRollButtonState()
  }

  private static readonly ASH_COLOR = new THREE.Color(0x4a4a4f)
  private static readonly ASH_DURATION_SEC = 0.45
  private static readonly SIMULATION_STEP = 1 / 60
  private static readonly MAX_SIM_STEPS_PER_FRAME = 8

  private startAshEffect(player: PlayerRuntime): void {
    if (!player.group || player.ashTimer !== null) return
    player.ashMaterials = []
    player.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          player.ashMaterials.push({ material: mat, originalColor: mat.color.getHex() })
        }
      }
    })
    player.ashTimer = 0
  }

  private updateAshEffects(delta: number): void {
    for (const player of this.players) {
      if (player.ashTimer === null || player.ashMaterials.length === 0) continue
      player.ashTimer = Math.min(ChunsikDodgeGame.ASH_DURATION_SEC, player.ashTimer + delta)
      const t = player.ashTimer / ChunsikDodgeGame.ASH_DURATION_SEC
      const progress = t * t * (3 - 2 * t)
      for (const snapshot of player.ashMaterials) {
        snapshot.material.color.setHex(snapshot.originalColor).lerp(ChunsikDodgeGame.ASH_COLOR, progress)
      }
    }
  }

  private clearAshEffect(player: PlayerRuntime): void {
    for (const snapshot of player.ashMaterials) {
      snapshot.material.color.setHex(snapshot.originalColor)
    }
    player.ashMaterials = []
    player.ashTimer = null
  }

  private setCloakActive(player: PlayerRuntime, active: boolean): void {
    if (!player.group) return
    player.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const apply = (m: THREE.Material) => {
        m.transparent = active
        ;(m as THREE.MeshStandardMaterial).opacity = active ? CLOAK.opacity : 1
        m.depthWrite = !active
        m.needsUpdate = true
      }
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach(apply)
      else if (mat) apply(mat)
    })
  }

  private updatePlayer(player: PlayerRuntime, delta: number): void {
    if (!player.group) return
    this.updateInputForPlayer(player)

    if (this.state !== 'playing' || !player.alive) {
      this.playIdleVariant(player, delta)
      return
    }

    const rollAnimating = this.elapsed < player.rollAnimationUntil
    if (!rollAnimating && player.currentAction === player.actions.get('rolling')) {
      this.playAction(player, player.input.lengthSq() > 0.05 ? this.getMovementAction(player) : 'idle')
    }
    if (player.cloakActiveUntil > 0 && this.elapsed >= player.cloakActiveUntil) {
      player.cloakActiveUntil = 0
      this.setCloakActive(player, false)
      this.updateRollButtonState()
      if (this.getStatusText(player.id) === '클로킹') this.setStatus(player.id, '회피 중')
    }
    const move = rollAnimating ? player.rollLockedInput : player.input
    const speed = this.getMovementSpeed(player)

    if (move.lengthSq() > 0.02) {
      player.group.position.x += move.x * speed * delta
      player.group.position.z += move.y * speed * delta
      const radius = this.getPlayerRadius()
      player.group.position.x = THREE.MathUtils.clamp(
        player.group.position.x,
        -this.arena.halfWidth + radius,
        this.arena.halfWidth - radius,
      )
      player.group.position.z = THREE.MathUtils.clamp(
        player.group.position.z,
        -this.arena.halfDepth + radius,
        this.arena.halfDepth - radius,
      )

      player.lookTarget.set(
        player.group.position.x - move.x,
        player.group.position.y,
        player.group.position.z - move.y,
      )
      const lookMatrix = new THREE.Matrix4().lookAt(
        player.group.position,
        player.lookTarget,
        new THREE.Vector3(0, 1, 0),
      )
      player.targetQuaternion.setFromRotationMatrix(lookMatrix)
      player.group.quaternion.slerp(player.targetQuaternion, 10 * delta)

      if (!rollAnimating) this.playAction(player, this.getMovementAction(player))
    } else if (!rollAnimating && !this.isOneShotPlaying(player)) {
      this.playIdleVariant(player, delta)
    }
  }

  private resolvePlayerCollisions(): void {
    if (this.players.length < 2) return
    const [p1, p2] = this.players
    if (!p1?.group || !p2?.group || !p1.alive || !p2.alive) return
    const minDist = this.getPlayerRadius() * 2
    const dx = p1.group.position.x - p2.group.position.x
    const dz = p1.group.position.z - p2.group.position.z
    const distSq = dx * dx + dz * dz
    if (distSq >= minDist * minDist) return
    const dist = Math.sqrt(distSq) || 0.0001
    const overlap = minDist - dist
    const nx = dx / dist
    const nz = dz / dist
    p1.group.position.x += nx * overlap * 0.5
    p1.group.position.z += nz * overlap * 0.5
    p2.group.position.x -= nx * overlap * 0.5
    p2.group.position.z -= nz * overlap * 0.5
    const radius = this.getPlayerRadius()
    for (const player of [p1, p2]) {
      player.group!.position.x = THREE.MathUtils.clamp(
        player.group!.position.x,
        -this.arena.halfWidth + radius,
        this.arena.halfWidth - radius,
      )
      player.group!.position.z = THREE.MathUtils.clamp(
        player.group!.position.z,
        -this.arena.halfDepth + radius,
        this.arena.halfDepth - radius,
      )
    }
  }

  private syncPlayerShadows(): void {
    for (const player of this.players) {
      if (player.group && player.shadow) {
        player.shadow.position.x = player.group.position.x
        player.shadow.position.z = player.group.position.z
      }
    }
  }

  private getMovementAction(player: PlayerRuntime): ActionName {
    return this.isRunHeld(player) && player.input.lengthSq() > 0.05 ? 'run' : 'walk'
  }

  private getMovementSpeed(player: PlayerRuntime): number {
    return this.isRunHeld(player) && player.input.lengthSq() > 0.05 ? MOVEMENT.runSpeed : MOVEMENT.walkSpeed
  }

  private isRunHeld(player: PlayerRuntime): boolean {
    const fromKeys = this.isKeyDown(player.bindings.run)
    const fromButton = this.mode === 'solo' && player.id === 1 ? player.runHeld : false
    return fromKeys || fromButton
  }

  private setRunButtonHeld(held: boolean): void {
    const player = this.players[0]
    if (player) player.runHeld = held
    this.updateRunButtonState()
  }

  private updateRunButtonState(): void {
    const player = this.players[0]
    const held = player ? this.isRunHeld(player) : false
    this.runButton.classList.toggle('is-active', held)
    this.runButton.setAttribute('aria-pressed', String(held))
  }

  private updateRollButtonState(): void {
    const player = this.players[0]
    if (!player) {
      this.rollButton.disabled = false
      return
    }
    const ability = player.character.ability
    const label = ability === 'cloak' ? '클로킹' : '구르기'
    const cooldownTotal = ability === 'cloak' ? CLOAK.cooldown : ROLL.cooldown
    const isPlaying = this.state === 'playing'
    const remaining = isPlaying ? Math.max(0, player.rollCooldownUntil - this.elapsed) : 0
    const cooling = remaining > 0
    const active = isPlaying && this.elapsed < (ability === 'cloak' ? player.cloakActiveUntil : player.rollAnimationUntil)
    const progress = cooling ? THREE.MathUtils.clamp(remaining / cooldownTotal, 0, 1) : 0

    this.rollButton.disabled = cooling
    this.rollButton.classList.toggle('is-cooling', cooling)
    this.rollButton.classList.toggle('is-rolling', active)
    this.rollButton.style.setProperty('--cooldown-progress', `${progress * 360}deg`)
    this.rollButtonLabel.textContent = label
    this.rollButton.setAttribute('aria-label', label)

    if (!active && (this.getStatusText(1) === '구르기' || this.getStatusText(1) === '클로킹')) {
      this.setStatus(1, '회피 중')
    }
  }

  private updateAbilityTimers(): void {
    for (const player of this.players) {
      const node = player.id === 1 ? this.abilityTimer : this.abilityTimerP2
      const labelNode = player.id === 1 ? this.abilityTimerLabel : this.abilityTimerP2Label
      const valueNode = player.id === 1 ? this.abilityTimerValue : this.abilityTimerP2Value
      if (this.state !== 'playing') {
        node.classList.remove('is-visible')
        continue
      }
      const ability = player.character.ability
      const until = ability === 'cloak' ? player.cloakActiveUntil : player.rollAnimationUntil
      const remaining = until - this.elapsed
      if (remaining <= 0) {
        node.classList.remove('is-visible')
        continue
      }
      labelNode.textContent = ability === 'cloak' ? '클로킹' : '구르기'
      valueNode.textContent = `${remaining.toFixed(1)}초`
      node.classList.add('is-visible')
    }
  }

  private playIdleVariant(player: PlayerRuntime, delta: number): void {
    if (!player.group) return
    if (player.currentAction !== player.actions.get('idle') && !this.isOneShotPlaying(player)) {
      this.playAction(player, 'idle')
    }
    player.idleTimer += delta
    if (player.idleTimer > player.nextIdleVariant && !this.isOneShotPlaying(player)) {
      player.idleTimer = 0
      player.nextIdleVariant = 5 + Math.random() * 5
      this.playAction(player, 'idle2')
    }
  }

  private isOneShotPlaying(player: PlayerRuntime): boolean {
    return ['idle2', 'rolling', 'surprise'].some((name) => {
      const action = player.actions.get(name as ActionName)
      return action?.isRunning() && action.getEffectiveWeight() > 0.2
    })
  }

  private updateGame(delta: number): void {
    if (this.state !== 'playing') return
    this.elapsed += delta
    this.spawnTimer += delta

    this.maybeAnnouncePhase()

    const wave = this.getWave()
    const mobile = this.isSimMobile()
    const interval = getSpawnInterval(this.elapsed, wave, mobile)
    if (this.spawnTimer >= interval) {
      this.spawnTimer = 0
      const kind = pickMissileKind(this.elapsed, gameRandom)
      this.spawnMissileOfKind(kind)
      const doubleChance = PHASES[getPhaseIndex(this.elapsed)].doubleSpawnChance
      if (doubleChance > 0 && gameRandom() < doubleChance) {
        this.pendingSpawns.push({ at: this.elapsed + 0.18, kind: 'straight' })
      }
    }

    while (this.pendingSpawns.length > 0 && this.pendingSpawns[0].at <= this.elapsed) {
      const next = this.pendingSpawns.shift()!
      this.spawnMissileOfKind(next.kind)
    }

    if (this.phaseLabelClearAt > 0 && this.elapsed >= this.phaseLabelClearAt) {
      this.phaseLabelClearAt = 0
      if (this.state === 'playing') {
        for (const id of [1, 2] as PlayerId[]) {
          if (this.getStatusText(id)?.startsWith('페이즈:')) this.setStatus(id, '회피 중')
        }
      }
    }

    this.updateHud()
  }

  private getWave(): number {
    return Math.floor(this.elapsed / 10) + 1
  }

  private maybeAnnouncePhase(): void {
    const index = getPhaseIndex(this.elapsed)
    if (index === this.currentPhaseIndex) return
    const isInitial = this.currentPhaseIndex === -1
    this.currentPhaseIndex = index
    if (isInitial) return
    const label = PHASES[index].label
    this.setStatus(1, `페이즈: ${label}`)
    if (this.mode === 'versus' || this.online) this.setStatus(2, `페이즈: ${label}`)
    this.phaseLabelClearAt = this.elapsed + 2.2
    this.shakeAmount = Math.max(this.shakeAmount, 0.45)
  }

  private spawnMissileOfKind(kind: MissileKind): void {
    if (this.players.length === 0) return
    if (kind === 'volley') {
      this.spawnVolley()
      return
    }
    this.spawnSingleMissile(kind)
  }

  private spawnVolley(): void {
    const side = gameRandomInt(4)
    const fanOffsets = [-0.5, 0, 0.5]
    for (const offset of fanOffsets) {
      this.spawnSingleMissile('straight', { fixedSide: side, lateralOffset: offset })
    }
  }

  private pickAimTarget(): THREE.Vector3 {
    const alive = this.players.filter((p) => p.alive && p.group)
    if (alive.length === 0) return new THREE.Vector3()
    const choice = alive[gameRandomInt(alive.length)]
    return choice.group!.position.clone()
  }

  private spawnSingleMissile(
    kind: MissileKind,
    opts: { fixedSide?: number; lateralOffset?: number } = {},
  ): void {
    if (this.players.length === 0) return
    const side = opts.fixedSide ?? gameRandomInt(4)
    const margin = 1.2
    const spawn = new THREE.Vector3()
    if (side === 0) {
      spawn.set(gameRandomSpread(this.arena.width), 0.58, -this.arena.halfDepth - margin)
    } else if (side === 1) {
      spawn.set(this.arena.halfWidth + margin, 0.58, gameRandomSpread(this.arena.depth))
    } else if (side === 2) {
      spawn.set(gameRandomSpread(this.arena.width), 0.58, this.arena.halfDepth + margin)
    } else {
      spawn.set(-this.arena.halfWidth - margin, 0.58, gameRandomSpread(this.arena.depth))
    }

    const target = this.pickAimTarget()
    const aimSpread = kind === 'homing' ? 0.4 : 1.2
    target.x += gameRandomSpread(aimSpread)
    target.z += gameRandomSpread(aimSpread)

    if (opts.lateralOffset !== undefined) {
      const perpendicular = side === 0 || side === 2
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 0, 1)
      target.addScaledVector(perpendicular, opts.lateralOffset * 3.2)
    }

    const direction = target.sub(spawn)
    direction.y = 0
    direction.normalize()

    const phaseBoost = PHASES[getPhaseIndex(this.elapsed)].missileSpeedBoost
    const speedMult = this.isSimMobile() ? MOBILE_TUNING.missileSpeedMult : 1
    const baseSpeed = 4.5 + Math.min(5.5, this.elapsed * 0.08) + gameRandom() * 0.8 + phaseBoost
    const kindSpeedMult = kind === 'big' ? 0.55 : kind === 'homing' ? 0.78 : 1
    const speed = baseSpeed * speedMult * kindSpeedMult
    const velocity = direction.multiplyScalar(speed)
    const sizeMultiplier = kind === 'big' ? 1.85 : 1
    const group = createMissileMesh({ kind, sizeMultiplier })
    group.position.copy(spawn)
    orientObjectToVelocity(group, velocity)
    group.visible = false
    this.scene.add(group)

    const warning = this.createWarning(spawn, velocity)
    this.scene.add(warning)

    const radius = kind === 'big' ? 0.52 : 0.3
    const homingStrength = kind === 'homing' ? 0.9 : 0

    this.missiles.push({
      group,
      velocity,
      warning,
      radius,
      age: 0,
      armedAt: 0.46,
      spin: gameRandom() > 0.5 ? 1 : -1,
      playedSound: false,
      rollClearedBy: new Set<PlayerId>(),
      kind,
      homingStrength,
    })
  }

  private createWarning(spawn: THREE.Vector3, velocity: THREE.Vector3): THREE.Mesh {
    const direction = velocity.clone().normalize()
    const entry = this.getArenaEntryPoint(spawn, direction)
    entry.addScaledVector(direction, 0.18)
    const maxInsideDistance = this.getDistanceToArenaExit(entry, direction)
    const length = THREE.MathUtils.clamp(maxInsideDistance * 0.9, 4.8, 11.5)
    const warning = new THREE.Mesh(
      new THREE.PlaneGeometry(length, 0.15),
      new THREE.MeshBasicMaterial({
        color: 0xd94636,
        transparent: true,
        opacity: 0.46,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    warning.rotation.x = -Math.PI / 2
    warning.rotation.z = -Math.atan2(direction.z, direction.x)
    warning.position.set(
      entry.x + direction.x * (length * 0.5),
      0.075,
      entry.z + direction.z * (length * 0.5),
    )
    return warning
  }

  private getArenaEntryPoint(spawn: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 {
    const candidates: THREE.Vector3[] = []

    if (direction.x !== 0) {
      for (const x of [-this.arena.halfWidth, this.arena.halfWidth]) {
        const t = (x - spawn.x) / direction.x
        const z = spawn.z + direction.z * t
        if (t >= 0 && z >= -this.arena.halfDepth && z <= this.arena.halfDepth) {
          candidates.push(new THREE.Vector3(x, 0.075, z))
        }
      }
    }

    if (direction.z !== 0) {
      for (const z of [-this.arena.halfDepth, this.arena.halfDepth]) {
        const t = (z - spawn.z) / direction.z
        const x = spawn.x + direction.x * t
        if (t >= 0 && x >= -this.arena.halfWidth && x <= this.arena.halfWidth) {
          candidates.push(new THREE.Vector3(x, 0.075, z))
        }
      }
    }

    if (candidates.length === 0) {
      return spawn.clone().addScaledVector(direction, 1.2)
    }

    candidates.sort((a, b) => a.distanceToSquared(spawn) - b.distanceToSquared(spawn))
    return candidates[0] ?? spawn.clone().addScaledVector(direction, 1.2)
  }

  private getDistanceToArenaExit(entry: THREE.Vector3, direction: THREE.Vector3): number {
    const distances: number[] = []
    if (direction.x > 0) distances.push((this.arena.halfWidth - entry.x) / direction.x)
    if (direction.x < 0) distances.push((-this.arena.halfWidth - entry.x) / direction.x)
    if (direction.z > 0) distances.push((this.arena.halfDepth - entry.z) / direction.z)
    if (direction.z < 0) distances.push((-this.arena.halfDepth - entry.z) / direction.z)
    return Math.max(4.8, Math.min(...distances.filter((distance) => distance > 0)))
  }

  private updateMissiles(delta: number): void {
    const hitPlayers = new Set<PlayerRuntime>()
    for (let index = this.missiles.length - 1; index >= 0; index -= 1) {
      const missile = this.missiles[index]
      if (!missile) continue
      missile.age += delta

      const warningMaterial = missile.warning.material
      if (warningMaterial instanceof THREE.MeshBasicMaterial) {
        warningMaterial.opacity = Math.max(0, 0.46 - missile.age * 0.72)
      }

      if (missile.age < missile.armedAt) continue
      if (!missile.group.visible) {
        missile.group.visible = true
      }
      if (!missile.playedSound) {
        this.audio.playSfx(Math.random() > 0.5 ? ASSETS.audio.attackA : ASSETS.audio.attackB, 0.22)
        missile.playedSound = true
      }

      if (missile.homingStrength > 0) {
        const aliveTargets = this.players.filter((p) => p.alive && p.group)
        if (aliveTargets.length > 0) {
          const closest = aliveTargets.reduce((acc, p) => {
            const d = p.group!.position.distanceToSquared(missile.group.position)
            return acc === null || d < acc.d ? { p, d } : acc
          }, null as null | { p: PlayerRuntime; d: number })
          if (closest) {
            const toTarget = new THREE.Vector3(
              closest.p.group!.position.x - missile.group.position.x,
              0,
              closest.p.group!.position.z - missile.group.position.z,
            )
            if (toTarget.lengthSq() > 0.0001) {
              toTarget.normalize()
              const currentSpeed = missile.velocity.length()
              const currentDirection = missile.velocity.clone().setY(0).normalize()
              const blend = 1 - Math.exp(-missile.homingStrength * delta)
              currentDirection.lerp(toTarget, blend).normalize()
              missile.velocity.set(
                currentDirection.x * currentSpeed,
                missile.velocity.y,
                currentDirection.z * currentSpeed,
              )
              orientObjectToVelocity(missile.group, missile.velocity)
            }
          }
        }
      }

      missile.group.position.addScaledVector(missile.velocity, delta)
      missile.group.rotateZ(missile.spin * delta * 7)
      const flame = missile.group.getObjectByName('flame')
      if (flame) {
        const pulse = 1 + Math.sin((this.elapsed + missile.age) * 28) * 0.16
        flame.scale.setScalar(pulse)
      }
      const coreFlame = missile.group.getObjectByName('core-flame')
      if (coreFlame) {
        const pulse = 1 + Math.cos((this.elapsed + missile.age) * 31) * 0.12
        coreFlame.scale.setScalar(pulse)
      }
      const trail = missile.group.getObjectByName('trail')
      if (trail) {
        const pulse = 1 + Math.sin((this.elapsed + missile.age) * 18) * 0.1
        trail.scale.set(1, pulse, pulse)
      }

      if (this.state === 'playing') {
        for (const player of this.players) {
          if (!player.alive || !player.group) continue
          const dx = player.group.position.x - missile.group.position.x
          const dz = player.group.position.z - missile.group.position.z
          const distance = Math.hypot(dx, dz)
          const hitDistance = this.getPlayerRadius() + missile.radius
          const rollActive = this.elapsed < player.rollAnimationUntil
          const cloakActive = this.elapsed < player.cloakActiveUntil
          if ((rollActive && distance < hitDistance + ROLL.passRadiusBonus) || cloakActive) {
            this.markMissileRollCleared(missile, player)
          } else if (!missile.rollClearedBy.has(player.id) && distance < hitDistance) {
            hitPlayers.add(player)
          }
        }
      }

      const outside =
        Math.abs(missile.group.position.x) > this.arena.halfWidth + 3.2 ||
        Math.abs(missile.group.position.z) > this.arena.halfDepth + 3.2
      if (outside) {
        this.disposeMissile(index)
      }
    }

    if (hitPlayers.size > 0 && this.state === 'playing') {
      for (const player of hitPlayers) {
        player.alive = false
      }
      this.endGame()
    }
  }

  private markMissileRollCleared(missile: Missile, player: PlayerRuntime): void {
    if (missile.rollClearedBy.has(player.id)) return
    missile.rollClearedBy.add(player.id)
    missile.group.scale.multiplyScalar(0.94)
    this.setStatus(player.id, '회피!')
    const target = player.id
    window.setTimeout(() => {
      if (this.state === 'playing' && this.getStatusText(target) === '회피!') {
        this.setStatus(target, '회피 중')
      }
    }, 420)
  }

  private spawnBurst(position: THREE.Vector3): void {
    for (let index = 0; index < 34; index += 1) {
      const geometry = new THREE.SphereGeometry(THREE.MathUtils.randFloat(0.04, 0.11), 8, 8)
      const material = new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? 0xffdd6e : index % 3 === 1 ? 0xe05a3b : 0x2e7b82,
        transparent: true,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.copy(position)
      mesh.position.y = 0.7
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          THREE.MathUtils.randFloatSpread(3.4),
          THREE.MathUtils.randFloat(0.8, 3.2),
          THREE.MathUtils.randFloatSpread(3.4),
        ),
        age: 0,
        life: THREE.MathUtils.randFloat(0.65, 1.2),
      })
    }
  }

  private updateParticles(delta: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]
      if (!particle) continue
      particle.age += delta
      particle.velocity.y -= 4.8 * delta
      particle.mesh.position.addScaledVector(particle.velocity, delta)
      const material = particle.mesh.material
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = Math.max(0, 1 - particle.age / particle.life)
      }
      if (particle.age >= particle.life) {
        this.scene.remove(particle.mesh)
        particle.mesh.geometry.dispose()
        if (particle.mesh.material instanceof THREE.Material) particle.mesh.material.dispose()
        this.particles.splice(index, 1)
      }
    }
  }

  private playAction(player: PlayerRuntime, name: ActionName): void {
    const nextAction = player.actions.get(name)
    if (!nextAction) return
    if (player.currentAction === nextAction) {
      if (!nextAction.isRunning() || nextAction.getEffectiveWeight() < 0.1) {
        nextAction.reset().fadeIn(0.08).play()
      }
      return
    }
    player.currentAction?.fadeOut(0.14)
    nextAction.reset().fadeIn(0.14).play()
    player.currentAction = nextAction
  }

  private updateHud(): void {
    this.timeValue.textContent = this.elapsed.toFixed(2)
    this.bestValue.textContent = this.bestScore.toFixed(2)
    this.waveValue.textContent = String(this.getWave())
    if (this.mode === 'versus') {
      this.p1Name.textContent = this.versusP1Character.name
      this.p2Name.textContent = this.versusP2Character.name
    }
  }

  private setStatus(id: PlayerId, text: string): void {
    if (id === 1) this.statusValue.textContent = text
    else this.statusValueP2.textContent = text
  }

  private getStatusText(id: PlayerId): string {
    return (id === 1 ? this.statusValue.textContent : this.statusValueP2.textContent) ?? ''
  }

  private updateSoundButton(): void {
    this.soundButton.replaceChildren()
    const img = document.createElement('img')
    img.src = assetPath(this.audio.isEnabled() ? ASSETS.images.soundOn : ASSETS.images.soundOff)
    img.alt = ''
    this.soundButton.appendChild(img)
    this.soundButton.classList.toggle('is-active', this.audio.isEnabled())
  }

  private readMobileCameraMode(): MobileCameraMode {
    return localStorage.getItem(STORAGE_KEYS.camera) === 'chunsik' ? 'chunsik' : 'arena'
  }

  private setMobileCameraMode(mode: MobileCameraMode): void {
    if (this.mobileCameraMode === mode) return
    this.mobileCameraMode = mode
    localStorage.setItem(STORAGE_KEYS.camera, mode)
    this.updateCameraToggle()
    this.updateCameraProjection(false)
  }

  private updateCameraToggle(): void {
    for (const button of this.cameraToggle.querySelectorAll<HTMLButtonElement>('[data-camera-mode]')) {
      const active = button.dataset.cameraMode === this.mobileCameraMode
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
    }
  }

  private startJoystick(event: PointerEvent): void {
    if (this.mode === 'versus') return
    this.joystick.active = true
    this.joystick.pointerId = event.pointerId
    const rect = this.joystickBase.getBoundingClientRect()
    this.joystick.centerX = rect.left + rect.width / 2
    this.joystick.centerY = rect.top + rect.height / 2
    this.joystickBase.setPointerCapture(event.pointerId)
    this.moveJoystick(event)
  }

  private moveJoystick(event: PointerEvent): void {
    if (!this.joystick.active || event.pointerId !== this.joystick.pointerId) return
    const dx = event.clientX - this.joystick.centerX
    const dy = event.clientY - this.joystick.centerY
    const max = 42
    const distance = Math.min(Math.hypot(dx, dy), max)
    const angle = Math.atan2(dy, dx)
    const x = Math.cos(angle) * distance
    const y = Math.sin(angle) * distance
    this.joystick.vector.set(x / max, y / max)
    this.joystickStick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
  }

  private endJoystick(event: PointerEvent): void {
    if (event.pointerId !== this.joystick.pointerId) return
    this.joystick.active = false
    this.joystick.pointerId = null
    this.joystick.vector.set(0, 0)
    this.joystickStick.style.transform = 'translate(-50%, -50%)'
  }

  private updateCamera(delta: number): void {
    const cameraTargetIndex = this.online?.role === 'guest' ? 1 : 0
    const player = this.players[cameraTargetIndex]?.group?.position ?? new THREE.Vector3()
    const mobileArenaView = window.innerWidth < 720
    const followingSelf = this.mode === 'solo' || !!this.online
    const mobileChunsikView = mobileArenaView && this.mobileCameraMode === 'chunsik' && followingSelf

    if (mobileChunsikView) {
      const input = this.players[cameraTargetIndex]?.input ?? new THREE.Vector2()
      this.mobileChunsikCameraPanTarget.set(
        THREE.MathUtils.clamp(player.x * 0.34 + input.x * 0.72, -3.4, 3.4),
        THREE.MathUtils.clamp(player.z * 0.1 + input.y * 0.28, -0.95, 0.95),
      )
      this.mobileChunsikCameraPan.lerp(this.mobileChunsikCameraPanTarget, 1 - Math.exp(-delta * 4.1))
    } else {
      this.mobileChunsikCameraPan.set(0, 0)
    }

    const desktopArenaView = !mobileArenaView && followingSelf && this.mobileCameraMode === 'arena'
    let base: THREE.Vector3
    if (this.mode === 'versus') {
      const versusScale = Math.max(this.arena.width / 17, this.arena.depth / 11)
      base = mobileArenaView
        ? new THREE.Vector3(0, 30 * versusScale, 7.6 * versusScale)
        : new THREE.Vector3(0, 14.2 * versusScale, 13.4 * versusScale)
    } else if (mobileArenaView) {
      base = mobileChunsikView
        ? new THREE.Vector3(this.mobileChunsikCameraPan.x, 15.6, 16.4 + this.mobileChunsikCameraPan.y)
        : new THREE.Vector3(0, 27.5, 6.6)
    } else if (desktopArenaView) {
      base = new THREE.Vector3(0, 14.2, 13.4)
    } else {
      base = new THREE.Vector3(player.x * 0.16, 9.5, 12.2 + player.z * 0.12)
    }
    if (this.shakeAmount > 0) {
      base.x += THREE.MathUtils.randFloatSpread(this.shakeAmount * 0.14)
      base.y += THREE.MathUtils.randFloatSpread(this.shakeAmount * 0.1)
      this.shakeAmount = Math.max(0, this.shakeAmount - delta * 1.8)
    }

    this.camera.position.lerp(base, 1 - Math.exp(-delta * (mobileChunsikView ? 3.2 : 4.2)))
    if (this.mode === 'versus' || desktopArenaView) {
      this.cameraLookTarget.set(0, 0.4, 0)
    } else {
      this.cameraLookTarget.set(
        mobileArenaView ? (mobileChunsikView ? this.mobileChunsikCameraPan.x * 0.88 : 0) : player.x * 0.12,
        mobileChunsikView ? 0.62 : 0.25,
        mobileArenaView ? (mobileChunsikView ? this.mobileChunsikCameraPan.y * 0.65 - 0.4 : -0.35) : player.z * 0.12,
      )
    }
    this.cameraLookCurrent.lerp(this.cameraLookTarget, 1 - Math.exp(-delta * (mobileChunsikView ? 4.8 : 6.4)))
    this.camera.lookAt(this.cameraLookCurrent)
    this.updateCameraFov(delta)
  }

  private clearMissiles(): void {
    for (let index = this.missiles.length - 1; index >= 0; index -= 1) {
      this.disposeMissile(index)
    }
  }

  private disposeMissile(index: number): void {
    const missile = this.missiles[index]
    if (!missile) return
    this.scene.remove(missile.group)
    this.scene.remove(missile.warning)
    missile.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        this.disposeMaterial(child.material)
      }
    })
    missile.warning.geometry.dispose()
    this.disposeMaterial(missile.warning.material)
    this.missiles.splice(index, 1)
  }

  private clearParticles(): void {
    for (const particle of this.particles) {
      this.scene.remove(particle.mesh)
      particle.mesh.geometry.dispose()
      this.disposeMaterial(particle.mesh.material)
    }
    this.particles.length = 0
  }

  private disposeMaterial(material: THREE.Material | THREE.Material[]): void {
    if (Array.isArray(material)) {
      for (const item of material) item.dispose()
    } else {
      material.dispose()
    }
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate())
    const realDelta = Math.min(this.clock.getDelta(), 0.25)
    this.simAccumulator += realDelta

    const step = ChunsikDodgeGame.SIMULATION_STEP
    let stepsRemaining = ChunsikDodgeGame.MAX_SIM_STEPS_PER_FRAME
    while (this.simAccumulator >= step && stepsRemaining > 0) {
      if (this.online) {
        if (!this.tryOnlineStep(step)) break
      } else {
        this.simulateStep(step)
      }
      this.simAccumulator -= step
      stepsRemaining--
    }
    if (this.simAccumulator >= step) {
      this.simAccumulator = 0
    }

    this.renderFrame(realDelta)
  }

  private simulateStep(dt: number): void {
    this.updateGame(dt)
    for (const player of this.players) {
      this.updatePlayer(player, dt)
    }
    this.resolvePlayerCollisions()
    this.updateMissiles(dt)
  }

  private renderFrame(realDelta: number): void {
    for (const player of this.players) {
      player.mixer?.update(realDelta)
    }
    this.syncPlayerShadows()
    this.updateParticles(realDelta)
    this.updateAshEffects(realDelta)
    this.updateCamera(realDelta)
    this.updateRollButtonState()
    this.updateAbilityTimers()
    this.updateDiagPanel()
    this.renderer.render(this.scene, this.camera)
  }

  private diagPanel: HTMLDivElement | null = null
  private updateDiagPanel(): void {
    if (!import.meta.env.DEV) return
    if (!this.online) {
      if (this.diagPanel) this.diagPanel.style.display = 'none'
      return
    }
    if (!this.diagPanel) {
      const el = document.createElement('div')
      el.id = 'diag-panel'
      el.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:9999;background:rgba(0,0,0,0.72);color:#9af;padding:6px 8px;border-radius:6px;font:11px ui-monospace,monospace;line-height:1.45;pointer-events:none;white-space:pre;max-width:280px'
      document.body.appendChild(el)
      this.diagPanel = el
    }
    this.diagPanel.style.display = 'block'
    const p0 = this.players[0]
    const p1 = this.players[1]
    const keysList = Array.from(this.keys).slice(0, 6).join(',') || '-'
    const active = document.activeElement
    const activeTag = active ? active.tagName + (active.id ? '#' + active.id : '') : '-'
    const peerItems = (this.online.peer as unknown as { items: Array<{ syncCounter: number }> }).items
    const peerRange = peerItems.length > 0 ? `${peerItems[0].syncCounter}..${peerItems[peerItems.length - 1].syncCounter}` : '-'
    const localNext = this.online.local.peekNextCounter()
    const lead = localNext - this.syncCounter
    const lines = [
      `state=${this.state} role=${this.online.role} ch=${this.online.isChannelOpen() ? 'open' : 'closed'} hidden=${document.hidden}`,
      `sync=${this.syncCounter} localNext=${localNext} lead=${lead}`,
      `peerQ.len=${peerItems.length} range=${peerRange}`,
      `keys=${keysList}`,
      `active=${activeTag}`,
      `p1.input=(${p0?.input.x.toFixed(2) ?? '-'},${p0?.input.y.toFixed(2) ?? '-'}) pos=(${p0?.group?.position.x.toFixed(2) ?? '-'},${p0?.group?.position.z.toFixed(2) ?? '-'})`,
      `p2.input=(${p1?.input.x.toFixed(2) ?? '-'},${p1?.input.y.toFixed(2) ?? '-'}) pos=(${p1?.group?.position.x.toFixed(2) ?? '-'},${p1?.group?.position.z.toFixed(2) ?? '-'})`,
    ]
    this.diagPanel.textContent = lines.join('\n')
  }

  private resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    this.camera.aspect = width / height
    this.updateCameraProjection(true)
    this.renderer.setSize(width, height)
  }

  private getTargetCameraFov(): number {
    if (this.mode === 'versus') {
      return window.innerWidth < MOBILE_BREAKPOINT ? 60 : 52
    }
    if (window.innerWidth >= MOBILE_BREAKPOINT) return 48
    return this.mobileCameraMode === 'chunsik' ? 56 : MOBILE_TUNING.arenaFov
  }

  private getPlayerRadius(): number {
    return this.isSimMobile() ? MOBILE_TUNING.playerRadius : this.arena.playerRadius
  }

  private updateCameraProjection(immediate: boolean): void {
    this.targetCameraFov = this.getTargetCameraFov()
    if (!immediate) return
    this.camera.fov = this.targetCameraFov
    this.camera.updateProjectionMatrix()
  }

  private updateCameraFov(delta: number): void {
    if (Math.abs(this.camera.fov - this.targetCameraFov) < 0.02) {
      if (this.camera.fov !== this.targetCameraFov) {
        this.camera.fov = this.targetCameraFov
        this.camera.updateProjectionMatrix()
      }
      return
    }
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetCameraFov, 1 - Math.exp(-delta * 3.8))
    this.camera.updateProjectionMatrix()
  }

  private setupOnlineUi(): void {
    this.onlineCreateBtn.addEventListener('click', () => {
      void this.startOnlineHost()
    })
    this.onlineJoinBtn.addEventListener('click', () => {
      const id = this.onlineRoomIdInput.value.trim().toLowerCase()
      if (!id) {
        this.setOnlineStatus('방 ID를 입력해주세요', 'error')
        return
      }
      void this.startOnlineGuest(id)
    })
    this.onlineRoomIdInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.onlineJoinBtn.click()
      }
    })
    this.onlineCopyBtn.addEventListener('click', () => {
      const roomId = this.onlineRoomIdLabel.textContent ?? ''
      if (!roomId) return
      void navigator.clipboard?.writeText(roomId).then(
        () => this.setOnlineStatus(`방 ID 복사됨: ${roomId}`, 'ok'),
        () => this.setOnlineStatus('복사 실패 — 직접 선택해 복사해주세요', 'error'),
      )
    })
  }

  private async startOnlineHost(): Promise<void> {
    this.setOnlineButtonsBusy(true)
    this.setOnlineStatus('시그널 서버에 접속 중…')
    this.onlineRoomIdRow.hidden = true
    this.onlineRoomIdLabel.textContent = ''
    const net = await this.enterOnlineMode('host', {
      onRoomCreated: (roomId) => {
        this.onlineRoomIdLabel.textContent = roomId
        this.onlineRoomIdRow.hidden = false
        this.setOnlineStatus('친구가 들어올 때까지 대기 중…')
      },
      onChannelOpen: () => {
        this.setOnlineStatus(`연결됨 — 친구 준비 대기 중…`, 'ok')
        this.sendCharacterPickToPeer()
      },
      onChannelClose: () => {
        this.setOnlineStatus('상대 연결이 끊어졌습니다', 'error')
        this.handleOnlineDisconnected()
      },
      onError: (reason, detail) => {
        this.setOnlineStatus(`오류: ${this.formatOnlineError(reason, detail)}`, 'error')
        this.handleOnlineDisconnected()
      },
      onControl: (kind, payload) => this.handleOnlineControl(kind, payload),
    })
    net.connectAsHost()
  }

  private async startOnlineGuest(roomId: string): Promise<void> {
    this.setOnlineButtonsBusy(true)
    this.setOnlineStatus(`방 ${roomId}에 입장 중…`)
    this.onlineRoomIdRow.hidden = true
    this.onlineRoomIdLabel.textContent = ''
    const net = await this.enterOnlineMode('guest', {
      onRoomJoined: () => {
        this.setOnlineStatus('연결 협상 중…')
      },
      onChannelOpen: () => {
        this.setOnlineStatus('연결됨 — 호스트의 캐릭터 정보 대기 중…', 'ok')
      },
      onChannelClose: () => {
        this.setOnlineStatus('상대 연결이 끊어졌습니다', 'error')
        this.handleOnlineDisconnected()
      },
      onError: (reason, detail) => {
        this.setOnlineStatus(`오류: ${this.formatOnlineError(reason, detail)}`, 'error')
        this.handleOnlineDisconnected()
      },
      onControl: (kind, payload) => this.handleOnlineControl(kind, payload),
    })
    net.connectAsGuest(roomId)
  }

  private setOnlineStatus(message: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    this.onlineStatus.textContent = message
    this.onlineStatus.classList.toggle('is-error', kind === 'error')
    this.onlineStatus.classList.toggle('is-ok', kind === 'ok')
  }

  private setOnlineButtonsBusy(busy: boolean): void {
    this.onlineCreateBtn.disabled = busy
    this.onlineJoinBtn.disabled = busy
    this.onlineRoomIdInput.disabled = busy
  }

  private handleOnlineDisconnected(): void {
    this.setOnlineButtonsBusy(false)
    this.onlineRoomIdRow.hidden = true
    this.onlineRoomIdLabel.textContent = ''
    if (this.state === 'playing') {
      this.resetToReady()
    }
  }

  private formatOnlineError(reason: string, detail?: unknown): string {
    switch (reason) {
      case 'no-room': return '존재하지 않는 방입니다'
      case 'room-full': return '이미 가득 찬 방입니다'
      case 'not-in-room': return '방 정보가 없습니다'
      case 'room-gone': return '방이 종료되었습니다'
      case 'ws-closed': return '시그널 서버 연결이 끊겼습니다'
      case 'ws-error': return '시그널 서버 접속 실패'
      case 'bad-json': return '잘못된 메시지'
      case 'channel-error': return `P2P 채널 오류 (${String(detail ?? '')})`
      default: return reason
    }
  }

  async enterOnlineMode(role: OnlineRole, events: OnlineNetEvents = {}): Promise<OnlineNet> {
    this.exitOnlineMode()
    if (role === 'guest') {
      const defP1 = CHARACTERS[0]
      const defP2 = CHARACTERS[1] ?? CHARACTERS[0]
      if (defP1) this.versusP1Character = defP1
      if (defP2) this.versusP2Character = defP2
    } else {
      if (this.versusP1Character.id === this.versusP2Character.id) {
        const alt = CHARACTERS.find((c) => c.pickerVisible && c.id !== this.versusP1Character.id)
        if (alt) this.versusP2Character = alt
      }
    }
    this.setMobileCameraMode('arena')
    await this.setMode('online')
    await this.createPlayersForMode()
    this.resetToReady()
    this.online = new OnlineNet(role, events)
    return this.online
  }

  exitOnlineMode(): void {
    if (!this.online) return
    this.online.close()
    this.online = null
    this.syncCounter = 0
    this.peerAbilityWasDown = false
    this.localAbilityWasDown = false
    clearRngSeed()
  }

  startOnlineGame(roomId: string): void {
    if (!this.online) return
    setRngSeed(roomId)
    this.syncCounter = 0
    this.peerAbilityWasDown = false
    this.localAbilityWasDown = false
    this.online.local.reset()
    this.online.peer.reset()
    this.startGame()
    this.focusGameSurface()
  }

  private focusGameSurface(): void {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) {
      try { active.blur() } catch {}
    }
    try { this.renderer.domElement.focus({ preventScroll: true }) } catch {}
  }

  private requestStartGame(): void {
    if (this.state === 'playing') return
    if (this.online && this.online.isChannelOpen()) {
      const roomId = this.online.getRoomId()
      if (!roomId) return
      if (this.online.role === 'host') this.sendCharacterPickToPeer()
      this.online.sendControl(MESSAGE_KIND.RESTART_ROUND)
      this.startOnlineGame(roomId)
      return
    }
    this.startGame()
  }

  private handleOnlineControl(kind: MessageKind, payload?: Uint8Array): void {
    if (kind === MESSAGE_KIND.RESTART_ROUND) {
      if (!this.online) return
      if (this.state === 'playing') return
      const roomId = this.online.getRoomId()
      if (!roomId) return
      this.startOnlineGame(roomId)
      return
    }
    if (kind === MESSAGE_KIND.CHARACTER_PICK) {
      void this.applyPeerCharacterPick(payload)
      return
    }
  }

  private sendCharacterPickToPeer(): void {
    if (!this.online) return
    if (this.online.role !== 'host') return
    const p1Idx = CHARACTERS.findIndex((c) => c.id === this.versusP1Character.id)
    const p2Idx = CHARACTERS.findIndex((c) => c.id === this.versusP2Character.id)
    const payload = new Uint8Array([Math.max(0, p1Idx), Math.max(0, p2Idx)])
    this.online.sendControl(MESSAGE_KIND.CHARACTER_PICK, payload)
  }

  private async applyPeerCharacterPick(payload?: Uint8Array): Promise<void> {
    if (!this.online || this.online.role !== 'guest') return
    if (!payload || payload.byteLength < 2) return
    const p1 = CHARACTERS[payload[0]] ?? CHARACTERS[0]
    const p2 = CHARACTERS[payload[1]] ?? CHARACTERS[1] ?? CHARACTERS[0]
    if (!p1 || !p2) return
    const changed = this.versusP1Character.id !== p1.id || this.versusP2Character.id !== p2.id
    this.versusP1Character = p1
    this.versusP2Character = p2
    if (changed) await this.createPlayersForMode()
    this.updateCharacterPicker()
    this.updateModeChrome()
    if (this.state !== 'playing') {
      const roomId = this.online.getRoomId()
      if (!roomId) return
      this.online.sendControl(MESSAGE_KIND.RESTART_ROUND)
      this.startOnlineGame(roomId)
    }
  }

  private isSimMobile(): boolean {
    if (this.online) return false
    return isMobileViewport()
  }

  private pollLocalInput(): PlayerInput {
    let x: -1 | 0 | 1 = 0
    let y: -1 | 0 | 1 = 0
    if (this.isKeyDown(SOLO_BINDINGS.left)) x = -1
    else if (this.isKeyDown(SOLO_BINDINGS.right)) x = 1
    if (this.isKeyDown(SOLO_BINDINGS.up)) y = -1
    else if (this.isKeyDown(SOLO_BINDINGS.down)) y = 1
    if (this.joystick.active) {
      if (Math.abs(this.joystick.vector.x) > 0.3) x = this.joystick.vector.x > 0 ? 1 : -1
      if (Math.abs(this.joystick.vector.y) > 0.3) y = this.joystick.vector.y > 0 ? 1 : -1
    }
    const player = this.players[0]
    const runFromButton = !!player && player.runHeld
    const run = this.isKeyDown(SOLO_BINDINGS.run) || runFromButton
    const ability = this.isKeyDown(SOLO_BINDINGS.ability) || this.abilityPressedPending
    this.abilityPressedPending = false
    return { x, y, run, ability }
  }

  private tryOnlineStep(dt: number): boolean {
    if (!this.online) return false
    if (this.state !== 'playing') return true
    if (!this.online.isChannelOpen()) return false
    if (this.players.length < 2) return false

    const lead = this.online.local.peekNextCounter() - this.syncCounter
    if (lead < BUFFER_LENGTH) {
      this.online.enqueueLocal(this.pollLocalInput())
    }
    this.online.resendLocal()

    if (!this.online.peer.hasNext(this.syncCounter)) return false
    const localInput = this.online.local.getAt(this.syncCounter)
    if (!localInput) return false
    const peerInput = this.online.peer.consume(this.syncCounter)

    const hostPlayer = this.players[0]
    const guestPlayer = this.players[1]
    const localPlayer = this.online.role === 'host' ? hostPlayer : guestPlayer
    const remotePlayer = this.online.role === 'host' ? guestPlayer : hostPlayer
    this.applyOnlineInputToPlayer(localPlayer, localInput, true)
    this.applyOnlineInputToPlayer(remotePlayer, peerInput, false)

    this.simulateStep(dt)
    this.syncCounter = (this.syncCounter + 1) % SYNC_DIVISOR
    return true
  }

  private applyOnlineInputToPlayer(player: PlayerRuntime, input: PlayerInput, isLocal: boolean): void {
    player.input.set(input.x, input.y)
    if (player.input.lengthSq() > 1) player.input.normalize()
    player.runHeld = input.run
    const wasDown = isLocal ? this.localAbilityWasDown : this.peerAbilityWasDown
    if (input.ability && !wasDown) {
      this.tryAbility(player)
    }
    if (isLocal) this.localAbilityWasDown = input.ability
    else this.peerAbilityWasDown = input.ability
  }
}

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('Missing #app root')
}

const game = new ChunsikDodgeGame(root)
if (import.meta.env.DEV) {
  ;(window as unknown as { __game: ChunsikDodgeGame }).__game = game
  ;(window as unknown as { __diag: () => unknown }).__diag = () => {
    const g = game as unknown as {
      mode: string
      state: string
      keys: Set<string>
      players: Array<{
        id: number
        input: { x: number; y: number }
        runHeld: boolean
        alive: boolean
        group?: { position: { x: number; z: number } }
      }>
      online: {
        role: string
        isChannelOpen: () => boolean
        local: { peekNextCounter: () => number }
        peer: { items: unknown[] }
      } | null
      syncCounter: number
    }
    const fmt = (n: number) => Number(n.toFixed(2))
    return {
      mode: g.mode,
      state: g.state,
      keys: Array.from(g.keys),
      activeElement: document.activeElement?.tagName + (document.activeElement?.id ? '#' + document.activeElement.id : ''),
      hidden: document.hidden,
      players: g.players.map((p) => ({
        id: p.id,
        alive: p.alive,
        input: { x: fmt(p.input.x), y: fmt(p.input.y) },
        runHeld: p.runHeld,
        pos: p.group ? { x: fmt(p.group.position.x), z: fmt(p.group.position.z) } : null,
      })),
      online: g.online
        ? {
            role: g.online.role,
            channelOpen: g.online.isChannelOpen(),
            syncCounter: g.syncCounter,
            localNext: g.online.local.peekNextCounter(),
            peerQueueLen: g.online.peer.items.length,
          }
        : null,
    }
  }
  console.log('%c[diag] __diag() 콘솔에서 호출하면 키/상태/위치/큐 한번에 확인', 'color: #2e7b82')
  void import('./net/dev-helpers').then(({ netHost, netJoin, netClose, netTest, bindGameAdapter }) => {
    bindGameAdapter(() => ({
      enterOnlineMode: (role, events) => game.enterOnlineMode(role, events),
      exitOnlineMode: () => game.exitOnlineMode(),
      startOnlineGame: (roomId) => game.startOnlineGame(roomId),
    }))
    ;(window as unknown as {
      __net: { host: () => void; join: (id: string) => void; close: () => void; test: () => void }
    }).__net = {
      host: netHost,
      join: netJoin,
      close: netClose,
      test: netTest,
    }
    console.log('%c[net] helpers ready — __net.host() / __net.join(id) / __net.close() / __net.test()', 'color: #2e7b82')
  })
  void import('./rng').then(({ setRngSeed, gameRandom, clearRngSeed }) => {
    ;(window as unknown as { __detCheck: () => void }).__detCheck = () => {
      const sample = (seed: string, n: number) => {
        setRngSeed(seed)
        return Array.from({ length: n }, () => gameRandom())
      }
      const a = sample('chunsik-test', 200)
      const b = sample('chunsik-test', 200)
      const c = sample('different-seed', 200)
      clearRngSeed()
      const sameSeedMatch = a.every((v, i) => v === b[i])
      const diffSeedDiffers = a.some((v, i) => v !== c[i])
      console.log('[det-check] same seed → same sequence?', sameSeedMatch)
      console.log('[det-check] different seed → different sequence?', diffSeedDiffers)
      console.log('[det-check] first 3 of seed "chunsik-test":', a.slice(0, 3))
      console.log('[det-check] first 3 of seed "different-seed":', c.slice(0, 3))
      if (sameSeedMatch && diffSeedDiffers) {
        console.log('%c[det-check] PASS ✓', 'color: #2e7b82; font-weight: bold')
      } else {
        console.error('[det-check] FAIL ✗')
      }
    }
  })
}
void game.start()
