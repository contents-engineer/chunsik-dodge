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
import { MissileSystem, type MissileSimContext } from './missile-system'
import { gameRandom, setRngSeed, clearRngSeed } from './rng'
import { OnlineNet, SIGNAL_URL, type OnlineRole, type OnlineNetEvents } from './net/online-net'
import { Signaling, type RoomSummary, type RoomVisibility } from './net/signaling'
import type { PlayerInput } from './net/input-packing'
import { SYNC_DIVISOR, BUFFER_LENGTH, MESSAGE_KIND, syncDiff, type MessageKind } from './net/input-queue'
import type {
  ActionName,
  BurstParticle,
  GameMode,
  GameState,
  JoystickState,
  MapKey,
  MissileKind,
  MobileCameraMode,
  PlayerBindings,
  PlayerId,
  PlayerRuntime,
} from './types'
import { HudView } from './ui/hud'
import { getElement, renderShellHtml, renderTemplate } from './ui/shell'

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
  private readonly soundButton: HTMLButtonElement
  private readonly resetButton: HTMLButtonElement
  private readonly cameraToggle: HTMLDivElement
  private readonly joystickBase: HTMLDivElement
  private readonly joystickStick: HTMLDivElement
  private readonly hud: HudView
  private readonly modePicker: HTMLDivElement
  private readonly mapPicker: HTMLDivElement
  private readonly soloPicker: HTMLDivElement
  private readonly versusPicker: HTMLDivElement
  private readonly onlinePicker: HTMLDivElement
  private readonly onlineVisibilityGroup: HTMLDivElement
  private readonly onlineVisibilityHint: HTMLParagraphElement
  private readonly onlineRoomList: HTMLDivElement
  private readonly onlineCreateBtn: HTMLButtonElement
  private readonly onlineJoinBtn: HTMLButtonElement
  private readonly onlineCopyBtn: HTMLButtonElement
  private readonly onlineRoomIdRow: HTMLDivElement
  private readonly onlineRoomIdLabel: HTMLElement
  private readonly onlineRoomIdInput: HTMLInputElement
  private readonly onlineStatus: HTMLParagraphElement
  private readonly onlineLobby: HTMLDivElement
  private readonly onlineLobbyRoomId: HTMLElement
  private readonly onlineLobbyCopyBtn: HTMLButtonElement
  private readonly onlineLobbySelfGrid: HTMLDivElement
  private readonly onlineLobbyPeerSwatch: HTMLElement
  private readonly onlineLobbyPeerName: HTMLElement
  private readonly onlineLobbyPeerStatus: HTMLElement
  private readonly onlineLobbyLeaveBtn: HTMLButtonElement
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
  private readonly missileSystem = new MissileSystem(this.scene, {
    onMissileArmed: () =>
      this.audio.playSfx(Math.random() > 0.5 ? ASSETS.audio.attackA : ASSETS.audio.attackB, 0.22),
    onRollCleared: (playerId) => this.handleRollCleared(playerId),
  })
  // MissileSystem에 매 호출 전달하는 컨텍스트 — 핫패스라 객체를 재사용한다
  private readonly missileCtx: MissileSimContext = {
    arena: MAP_PRESETS.normal,
    players: [],
    elapsed: 0,
    mobile: false,
    playerRadius: 0,
    playing: false,
  }
  private readonly particles: BurstParticle[] = []
  private readonly particlePool: THREE.Mesh[] = []
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
    localStorage.getItem(STORAGE_KEYS.characterSolo) ?? DEFAULT_CHARACTER_ID,
  )
  private versusP1Character: CharacterDefinition = findCharacter(
    localStorage.getItem(STORAGE_KEYS.characterVersusP1) ?? DEFAULT_CHARACTER_ID,
  )
  private versusP2Character: CharacterDefinition = this.pickInitialP2Character()
  // 랜덤 선택 상태. 켜져 있으면 매 판 시작 시 캐릭터를 새로 뽑는다.
  private soloPickerRandom = localStorage.getItem(STORAGE_KEYS.characterSoloRandom) === 'on'
  private soloStartPending = false
  private players: PlayerRuntime[] = []
  private bestScore = Number(localStorage.getItem(STORAGE_KEYS.best) ?? 0)
  private elapsed = 0
  private spawnTimer = 0
  private pendingSpawns: { at: number; kind: MissileKind }[] = []
  private simAccumulator = 0
  private online: OnlineNet | null = null
  private onlinePhase: 'menu' | 'lobby' = 'menu'
  private roomVisibility: RoomVisibility =
    (localStorage.getItem(STORAGE_KEYS.roomVisibility) as RoomVisibility) === 'private' ? 'private' : 'public'
  // 온라인 메뉴에서 공개 대기실 목록만 받아오는 가벼운 시그널 연결.
  // 방을 만들거나 들어가면 닫고, 메뉴로 돌아오면 다시 연다 (syncLobbyBrowser).
  private lobbyBrowser: Signaling | null = null
  private suppressLobbyBrowser = false
  private localReady = false
  private peerReady = false
  private syncCounter = 0
  private peerAbilityWasDown = false
  private localAbilityWasDown = false
  private readonly localChecksums = new Map<number, number>()
  private readonly peerChecksums = new Map<number, number>()
  private abilityPressedPending = false
  private shakeAmount = 0
  private currentPhaseIndex = -1
  private phaseLabelClearAt = 0
  private mobileCameraMode: MobileCameraMode = this.readMobileCameraMode()
  private targetCameraFov = 48
  private ground?: THREE.Mesh

  constructor(root: HTMLElement) {
    this.root = root
    renderTemplate(this.root, renderShellHtml())
    this.hud = new HudView(root)
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
    this.soundButton = this.getElement('sound-button')
    this.resetButton = this.getElement('reset-button')
    this.cameraToggle = this.getElement('camera-toggle')
    this.joystickBase = this.getElement('joystick-base')
    this.joystickStick = this.getElement('joystick-stick')
    this.modePicker = this.getElement('mode-picker')
    this.mapPicker = this.getElement('map-picker')
    this.soloPicker = this.getElement('character-picker')
    this.versusPicker = this.getElement('versus-picker')
    this.onlinePicker = this.getElement('online-picker')
    this.onlineVisibilityGroup = this.getElement('online-visibility')
    this.onlineVisibilityHint = this.getElement('online-visibility-hint')
    this.onlineRoomList = this.getElement('online-room-list')
    this.onlineCreateBtn = this.getElement('online-create-btn')
    this.onlineJoinBtn = this.getElement('online-join-btn')
    this.onlineCopyBtn = this.getElement('online-copy-btn')
    this.onlineRoomIdRow = this.getElement('online-room-id-row')
    this.onlineRoomIdLabel = this.getElement('online-room-id')
    this.onlineRoomIdInput = this.getElement('online-room-id-input')
    this.onlineStatus = this.getElement('online-status')
    this.onlineLobby = this.getElement('online-lobby')
    this.onlineLobbyRoomId = this.getElement('online-lobby-room-id')
    this.onlineLobbyCopyBtn = this.getElement('online-lobby-copy')
    this.onlineLobbySelfGrid = this.getElement('online-lobby-self-grid')
    this.onlineLobbyPeerSwatch = this.getElement('online-lobby-peer-swatch')
    this.onlineLobbyPeerName = this.getElement('online-lobby-peer-name')
    this.onlineLobbyPeerStatus = this.getElement('online-lobby-peer-status')
    this.onlineLobbyLeaveBtn = this.getElement('online-lobby-leave')
    this.keyboardHelpSolo = this.getElement('keyboard-help-solo')
    this.keyboardHelpVersus = this.getElement('keyboard-help-versus')
    this.keyboardHelpOnline = this.getElement('keyboard-help-online')
    this.touchControls = this.getElement('touch-controls')
  }

  private pickInitialP2Character(): CharacterDefinition {
    const raw = localStorage.getItem(STORAGE_KEYS.characterVersusP2)
    if (raw) {
      const candidate = findCharacter(raw)
      if (candidate.pickerVisible && candidate.id !== this.versusP1Character.id) return candidate
    }
    return this.firstPickableOtherThan(this.versusP1Character)
  }

  private firstPickableOtherThan(other: CharacterDefinition): CharacterDefinition {
    return CHARACTERS.find((c) => c.pickerVisible && c.id !== other.id) ?? CHARACTERS[0]!
  }

  private storedPickable(key: string, fallback: CharacterDefinition): CharacterDefinition {
    const c = findCharacter(localStorage.getItem(key))
    return c.pickerVisible ? c : fallback
  }

  private loadVersusCharacters(): void {
    this.versusP1Character = this.storedPickable(STORAGE_KEYS.characterVersusP1, CHARACTERS[0]!)
    const p2 = this.storedPickable(STORAGE_KEYS.characterVersusP2, CHARACTERS[1] ?? CHARACTERS[0]!)
    this.versusP2Character = p2.id === this.versusP1Character.id
      ? this.firstPickableOtherThan(this.versusP1Character)
      : p2
  }

  async start(): Promise<void> {
    this.setupRenderer()
    this.setupScene()
    this.setupUi()
    this.setupOnlineUi()
    this.updateHud()
    this.updateSoundButton()
    // 첫 제스처에서 AudioContext 생성 + SFX 사전 디코딩 (preload는 멱등)
    window.addEventListener('pointerdown', () => this.audio.preload(), { once: true })
    window.addEventListener('keydown', () => this.audio.preload(), { once: true })
    await this.loadWorld()
    this.loading.classList.add('is-hidden')
    this.animate()
  }


  private getElement<T extends HTMLElement>(id: string): T {
    return getElement<T>(this.root, id)
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
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code)
      this.updateRunButtonState()
      if (event.code === 'Space') {
        event.preventDefault()
        if (!this.online && this.mode !== 'versus') this.tryAbility(this.players[0])
      }
      if (event.code === 'ControlLeft') {
        if (this.mode === 'versus' && !this.online && this.state === 'playing') {
          event.preventDefault()
          this.tryAbility(this.players[0])
        }
      }
      if (event.code === 'ControlRight') {
        if (this.mode === 'versus' && !this.online && this.state === 'playing') {
          event.preventDefault()
          this.tryAbility(this.players[1])
        }
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        if (this.state !== 'playing') {
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
    this.hud.rollButton.addEventListener('pointerdown', (event) => {
      if (this.hud.rollButton.disabled) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      event.preventDefault()
      if (this.online) {
        this.abilityPressedPending = true
        return
      }
      this.tryAbility(this.players[0])
    })
    this.hud.runButton.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      this.hud.runButton.setPointerCapture(event.pointerId)
      this.setRunButtonHeld(true)
    })
    this.hud.runButton.addEventListener('pointerup', (event) => {
      event.preventDefault()
      this.setRunButtonHeld(false)
    })
    this.hud.runButton.addEventListener('pointercancel', () => this.setRunButtonHeld(false))
    this.hud.runButton.addEventListener('lostpointercapture', () => this.setRunButtonHeld(false))

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
        localStorage.setItem(STORAGE_KEYS.characterSoloRandom, 'on')
        if (next.id !== this.soloCharacter.id) {
          this.soloCharacter = next
          localStorage.setItem(STORAGE_KEYS.characterSolo, next.id)
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
      localStorage.setItem(STORAGE_KEYS.characterSoloRandom, 'off')
      if (!sameId) {
        this.soloCharacter = next
        localStorage.setItem(STORAGE_KEYS.characterSolo, next.id)
        void this.applySelectionToPlayers()
      }
      this.updateCharacterPicker()
      this.audio.playSfx(ASSETS.audio.uiClick, 0.32)
    })

    this.versusPicker.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-versus-id]')
      if (!button) return
      const characterId = button.dataset.versusId
      const slot = button.dataset.playerSlot === '2' ? 2 : 1
      if (!characterId) return
      const next = findCharacter(characterId)
      if (slot === 1) {
        if (this.versusP1Character.id === next.id) return
        if (this.versusP2Character.id === next.id) {
          this.versusP2Character = this.versusP1Character
          localStorage.setItem(STORAGE_KEYS.characterVersusP2, this.versusP2Character.id)
        }
        this.versusP1Character = next
        localStorage.setItem(STORAGE_KEYS.characterVersusP1, next.id)
      } else {
        if (this.versusP2Character.id === next.id) return
        if (this.versusP1Character.id === next.id) {
          this.versusP1Character = this.versusP2Character
          localStorage.setItem(STORAGE_KEYS.characterVersusP1, this.versusP1Character.id)
        }
        this.versusP2Character = next
        localStorage.setItem(STORAGE_KEYS.characterVersusP2, next.id)
      }
      this.audio.playSfx(ASSETS.audio.uiClick, 0.32)
      this.updateCharacterPicker()
      void this.applySelectionToPlayers()
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
    ctx.drawImage(skin, 0, 0)
    if (hue !== 0 || saturation !== 1 || brightness !== 1) {
      this.recolorCanvas(ctx, canvas.width, canvas.height, hue, saturation, brightness)
    }
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

  // Safari는 canvas ctx.filter(hue-rotate 등)를 적용하지 못해, CSS filter 사양과
  // 동일한 색행렬을 픽셀 단위로 직접 곱해 모든 브라우저에서 같은 재색칠을 만든다.
  private recolorCanvas(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    hueDeg: number,
    saturation: number,
    brightness: number,
  ): void {
    const image = ctx.getImageData(0, 0, width, height)
    const data = image.data
    const m = this.buildColorMatrix(hueDeg, saturation, brightness)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      data[i] = this.clamp255(m[0] * r + m[1] * g + m[2] * b)
      data[i + 1] = this.clamp255(m[3] * r + m[4] * g + m[5] * b)
      data[i + 2] = this.clamp255(m[6] * r + m[7] * g + m[8] * b)
    }
    ctx.putImageData(image, 0, 0)
  }

  private clamp255(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : v
  }

  private buildColorMatrix(hueDeg: number, saturation: number, brightness: number): number[] {
    const rad = (hueDeg * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    const hueM = [
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
    ]
    const satM = [
      0.213 + 0.787 * saturation, 0.715 - 0.715 * saturation, 0.072 - 0.072 * saturation,
      0.213 - 0.213 * saturation, 0.715 + 0.285 * saturation, 0.072 - 0.072 * saturation,
      0.213 - 0.213 * saturation, 0.715 - 0.715 * saturation, 0.072 + 0.928 * saturation,
    ]
    const out = new Array<number>(9)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        let sum = 0
        for (let k = 0; k < 3; k++) sum += satM[row * 3 + k] * hueM[k * 3 + col]
        out[row * 3 + col] = sum * brightness
      }
    }
    return out
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
    if (mode === 'versus') {
      this.loadVersusCharacters()
      localStorage.setItem(STORAGE_KEYS.characterVersusP2, this.versusP2Character.id)
    }
    this.setMobileCameraMode(this.readMobileCameraMode())
    this.updateModePicker()
    this.updateMapPicker()
    this.updateModeChrome()
    this.updateCharacterPicker()
    await this.applyActiveArena()
    await this.createPlayersForMode()
    this.resetToReady()
    this.syncLobbyBrowser()
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
    const onlineMenu = online && this.onlinePhase === 'menu'
    const onlineLobby = online && this.onlinePhase === 'lobby'
    this.soloPicker.hidden = !solo
    this.versusPicker.hidden = !versus
    this.onlinePicker.hidden = !onlineMenu
    this.onlineLobby.hidden = !onlineLobby
    this.mapPicker.hidden = !versus
    this.keyboardHelpSolo.hidden = !solo
    this.keyboardHelpVersus.hidden = !versus
    this.keyboardHelpOnline.hidden = !onlineLobby
    this.hud.setModeVisibility(solo, twoPlayer)
    this.touchControls.classList.toggle('is-hidden', !solo && !online)
    this.startButton.hidden = onlineMenu
    if (onlineLobby) {
      this.menuTitle.textContent = '온라인 대결전 로비'
      this.menuText.textContent = '캐릭터를 선택하고 준비를 누르세요. 둘 다 준비되면 시작합니다.'
    } else if (onlineMenu) {
      this.menuTitle.textContent = '온라인 대결전'
      this.menuText.textContent = '방을 만들거나 친구의 방 ID로 입장해 함께 회피하세요.'
    } else if (versus) {
      this.menuTitle.textContent = '대결전 출격 준비'
      this.menuText.textContent = '두 플레이어가 한 아레나에서 끝까지 살아남으세요.'
    } else {
      this.menuTitle.textContent = '춘식이 미사일 회피'
      this.menuText.textContent = '날아오는 궤적 사이를 빠져나가 오래 버티세요.'
    }
    if (versus || online) {
      this.hud.setPlayerNames(this.versusP1Character.name, this.versusP2Character.name)
    }
    document.body.classList.toggle('mode-versus', twoPlayer)
    this.updateStartButtonLabel()
  }

  private updateStartButtonLabel(): void {
    if (this.mode !== 'online' || this.onlinePhase !== 'lobby') return
    if (this.localReady && this.peerReady) {
      this.startButton.textContent = '시작 중…'
    } else if (this.localReady) {
      this.startButton.textContent = '준비됨 (취소)'
    } else if (this.peerReady) {
      this.startButton.textContent = '상대 준비됨 — 내 준비'
    } else {
      this.startButton.textContent = '준비'
    }
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
    this.resultPanel.hidden = true
    this.startButton.textContent = '시작'
    this.menu.classList.remove('is-hidden')
    this.updateModeChrome()
    this.updateLobbyView()
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
      if (this.mode === 'online' && this.onlinePhase === 'lobby') {
        this.localReady = false
        this.peerReady = false
        this.updateLobbyView()
      }
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
  private static readonly CHECKSUM_INTERVAL = 60
  private static readonly CHECKSUM_HISTORY = 8
  private static readonly PARTICLE_GEOMETRY = new THREE.SphereGeometry(1, 8, 8)
  // 매 스텝 재사용하는 스크래치 객체 — 핫패스에서 new를 피하기 위한 용도라
  // 호출 간 값이 유지된다고 가정하면 안 된다. ZERO_*는 읽기 전용.
  private static readonly SCRATCH_MATRIX = new THREE.Matrix4()
  private static readonly CAMERA_BASE = new THREE.Vector3()
  private static readonly UP = new THREE.Vector3(0, 1, 0)
  private static readonly ZERO_VEC3 = new THREE.Vector3()
  private static readonly ZERO_VEC2 = new THREE.Vector2()

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
      ChunsikDodgeGame.SCRATCH_MATRIX.lookAt(player.group.position, player.lookTarget, ChunsikDodgeGame.UP)
      player.targetQuaternion.setFromRotationMatrix(ChunsikDodgeGame.SCRATCH_MATRIX)
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
    this.hud.setRunActive(held)
  }

  private updateRollButtonState(): void {
    this.hud.updateRollButton(this.players[0], this.state, this.elapsed)
  }

  private updateAbilityTimers(): void {
    this.hud.updateAbilityTimers(this.players, this.state, this.elapsed)
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
      this.missileSystem.spawnOfKind(kind, this.refreshMissileCtx())
      const doubleChance = PHASES[getPhaseIndex(this.elapsed)].doubleSpawnChance
      if (doubleChance > 0 && gameRandom() < doubleChance) {
        this.pendingSpawns.push({ at: this.elapsed + 0.18, kind: 'straight' })
      }
    }

    while (this.pendingSpawns.length > 0 && this.pendingSpawns[0].at <= this.elapsed) {
      const next = this.pendingSpawns.shift()!
      this.missileSystem.spawnOfKind(next.kind, this.refreshMissileCtx())
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

  private refreshMissileCtx(): MissileSimContext {
    const ctx = this.missileCtx
    ctx.arena = this.arena
    ctx.players = this.players
    ctx.elapsed = this.elapsed
    ctx.mobile = this.isSimMobile()
    ctx.playerRadius = this.getPlayerRadius()
    ctx.playing = this.state === 'playing'
    return ctx
  }

  private updateMissiles(delta: number): void {
    const hit = this.missileSystem.update(delta, this.refreshMissileCtx())
    if (hit.size === 0 || this.state !== 'playing') return
    for (const player of hit) {
      player.alive = false
    }
    this.endGame()
  }

  // 구르기/클로킹으로 미사일을 통과했을 때의 상태 표시 (MissileSystem 콜백)
  private handleRollCleared(playerId: PlayerId): void {
    this.setStatus(playerId, '회피!')
    window.setTimeout(() => {
      if (this.state === 'playing' && this.getStatusText(playerId) === '회피!') {
        this.setStatus(playerId, '회피 중')
      }
    }, 420)
  }

  // 파티클은 단위 구 geometry를 공유하고 반지름은 scale로, 색은 material 재설정으로 표현한다.
  private spawnBurst(position: THREE.Vector3): void {
    for (let index = 0; index < 34; index += 1) {
      const mesh =
        this.particlePool.pop() ??
        new THREE.Mesh(ChunsikDodgeGame.PARTICLE_GEOMETRY, new THREE.MeshBasicMaterial({ transparent: true }))
      const material = mesh.material as THREE.MeshBasicMaterial
      material.color.setHex(index % 3 === 0 ? 0xffdd6e : index % 3 === 1 ? 0xe05a3b : 0x2e7b82)
      material.opacity = 1
      mesh.scale.setScalar(THREE.MathUtils.randFloat(0.04, 0.11))
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
        this.particlePool.push(particle.mesh)
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
    this.hud.updateScore(this.elapsed, this.bestScore, this.getWave())
    if (this.mode === 'versus') {
      this.hud.setPlayerNames(this.versusP1Character.name, this.versusP2Character.name)
    }
  }

  private setStatus(id: PlayerId, text: string): void {
    this.hud.setStatus(id, text)
  }

  private getStatusText(id: PlayerId): string {
    return this.hud.getStatusText(id)
  }

  private updateSoundButton(): void {
    this.soundButton.replaceChildren()
    const img = document.createElement('img')
    img.src = assetPath(this.audio.isEnabled() ? ASSETS.images.soundOn : ASSETS.images.soundOff)
    img.alt = ''
    this.soundButton.appendChild(img)
    this.soundButton.classList.toggle('is-active', this.audio.isEnabled())
  }

  private cameraStorageKey(): string {
    return `${STORAGE_KEYS.camera}-${this.mode}`
  }

  private cameraDefaultForMode(): MobileCameraMode {
    return this.mode === 'solo' ? 'chunsik' : 'arena'
  }

  private readMobileCameraMode(): MobileCameraMode {
    const stored = localStorage.getItem(this.cameraStorageKey())
    if (stored === 'chunsik' || stored === 'arena') return stored
    return this.cameraDefaultForMode()
  }

  private setMobileCameraMode(mode: MobileCameraMode): void {
    const changed = this.mobileCameraMode !== mode
    this.mobileCameraMode = mode
    localStorage.setItem(this.cameraStorageKey(), mode)
    this.updateCameraToggle()
    if (changed) this.updateCameraProjection(false)
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
    const player = this.players[cameraTargetIndex]?.group?.position ?? ChunsikDodgeGame.ZERO_VEC3
    const mobileArenaView = window.innerWidth < 720
    const followingSelf = this.mode === 'solo' || !!this.online
    const mobileChunsikView = mobileArenaView && this.mobileCameraMode === 'chunsik' && followingSelf

    if (mobileChunsikView) {
      const input = this.players[cameraTargetIndex]?.input ?? ChunsikDodgeGame.ZERO_VEC2
      this.mobileChunsikCameraPanTarget.set(
        THREE.MathUtils.clamp(player.x * 0.34 + input.x * 0.72, -3.4, 3.4),
        THREE.MathUtils.clamp(player.z * 0.1 + input.y * 0.28, -0.95, 0.95),
      )
      this.mobileChunsikCameraPan.lerp(this.mobileChunsikCameraPanTarget, 1 - Math.exp(-delta * 4.1))
    } else {
      this.mobileChunsikCameraPan.set(0, 0)
    }

    const desktopArenaView = !mobileArenaView && followingSelf && this.mobileCameraMode === 'arena'
    const base = ChunsikDodgeGame.CAMERA_BASE
    if (this.mode === 'versus') {
      const versusScale = Math.max(this.arena.width / 17, this.arena.depth / 11)
      if (mobileArenaView) base.set(0, 30 * versusScale, 7.6 * versusScale)
      else base.set(0, 14.2 * versusScale, 13.4 * versusScale)
    } else if (mobileArenaView) {
      if (mobileChunsikView) base.set(this.mobileChunsikCameraPan.x, 15.6, 16.4 + this.mobileChunsikCameraPan.y)
      else base.set(0, 27.5, 6.6)
    } else if (desktopArenaView) {
      base.set(0, 14.2, 13.4)
    } else {
      base.set(player.x * 0.16, 9.5, 12.2 + player.z * 0.12)
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
    this.missileSystem.clear()
  }

  private clearParticles(): void {
    for (const particle of this.particles) {
      this.scene.remove(particle.mesh)
      this.particlePool.push(particle.mesh)
    }
    this.particles.length = 0
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
    this.renderer.render(this.scene, this.camera)
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
    this.updateVisibilityToggle()
    this.onlineVisibilityGroup.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-room-visibility]')
      if (!button) return
      const next: RoomVisibility = button.dataset.roomVisibility === 'private' ? 'private' : 'public'
      if (next === this.roomVisibility) return
      this.audio.playSfx(ASSETS.audio.uiClick, 0.28)
      this.roomVisibility = next
      localStorage.setItem(STORAGE_KEYS.roomVisibility, next)
      this.updateVisibilityToggle()
    })
    this.onlineRoomList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-join-room-id]')
      if (!button) return
      if (this.online) return
      const roomId = button.dataset.joinRoomId
      if (!roomId) return
      this.audio.playSfx(ASSETS.audio.uiClick, 0.3)
      void this.startOnlineGuest(roomId)
    })
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
    this.onlineLobbyCopyBtn.addEventListener('click', () => {
      const roomId = this.onlineLobbyRoomId.textContent ?? ''
      if (!roomId) return
      void navigator.clipboard?.writeText(roomId)
    })
    this.onlineLobbySelfGrid.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-lobby-character-id]')
      if (!button) return
      const id = button.dataset.lobbyCharacterId
      if (!id) return
      this.audio.playSfx(ASSETS.audio.uiClick, 0.32)
      this.setOwnLobbyCharacter(findCharacter(id))
    })
    this.onlineLobbyLeaveBtn.addEventListener('click', () => {
      this.audio.playSfx(ASSETS.audio.uiClick, 0.3)
      this.leaveOnlineLobby()
    })
  }

  private updateVisibilityToggle(): void {
    for (const button of this.onlineVisibilityGroup.querySelectorAll<HTMLButtonElement>('[data-room-visibility]')) {
      const active = button.dataset.roomVisibility === this.roomVisibility
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
    this.onlineVisibilityHint.textContent =
      this.roomVisibility === 'public'
        ? '공개 방은 아래 대기실 목록에 노출됩니다'
        : '비공개 방은 방 ID를 아는 사람만 들어올 수 있어요'
  }

  // 온라인 메뉴(방 만들기 전)에서만 대기실 구독 연결을 유지한다
  private syncLobbyBrowser(): void {
    const shouldBrowse =
      this.mode === 'online' && this.onlinePhase === 'menu' && !this.online && !this.suppressLobbyBrowser
    if (!shouldBrowse) {
      if (this.lobbyBrowser) {
        this.lobbyBrowser.close()
        this.lobbyBrowser = null
      }
      return
    }
    if (this.lobbyBrowser) return
    const browser = new Signaling(SIGNAL_URL, {
      onOpen: () => browser.requestRoomList(),
      onRoomList: (rooms) => {
        if (this.lobbyBrowser === browser) this.renderRoomList(rooms)
      },
      onClose: () => {
        if (this.lobbyBrowser === browser) this.lobbyBrowser = null
      },
      onError: () => {},
    })
    this.lobbyBrowser = browser
    browser.connect()
  }

  // hostName은 외부 입력이므로 innerHTML이 아닌 createElement/textContent로만 그린다
  private renderRoomList(rooms: RoomSummary[]): void {
    this.onlineRoomList.replaceChildren()
    if (rooms.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'online-room-list-empty'
      empty.textContent = '지금 열려 있는 공개 방이 없어요'
      this.onlineRoomList.appendChild(empty)
      return
    }
    const sorted = [...rooms].sort((a, b) => b.createdAt - a.createdAt)
    for (const room of sorted) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'online-room-item'
      button.dataset.joinRoomId = room.roomId
      const name = document.createElement('span')
      name.className = 'online-room-item-name'
      name.textContent = `${room.hostName}의 방`
      const id = document.createElement('code')
      id.className = 'online-room-item-id'
      id.textContent = room.roomId
      const action = document.createElement('span')
      action.className = 'online-room-item-action'
      action.textContent = '입장'
      button.append(name, id, action)
      this.onlineRoomList.appendChild(button)
    }
  }

  private getOwnSlot(): 1 | 2 {
    if (!this.online) return 1
    return this.online.role === 'host' ? 1 : 2
  }

  private getOwnCharacter(): CharacterDefinition {
    return this.getOwnSlot() === 1 ? this.versusP1Character : this.versusP2Character
  }

  private getPeerCharacter(): CharacterDefinition {
    return this.getOwnSlot() === 1 ? this.versusP2Character : this.versusP1Character
  }

  private async setOwnLobbyCharacter(next: CharacterDefinition): Promise<void> {
    if (!this.online) return
    const slot = this.getOwnSlot()
    const current = slot === 1 ? this.versusP1Character : this.versusP2Character
    if (current.id === next.id) return
    if (slot === 1) {
      this.versusP1Character = next
    } else {
      this.versusP2Character = next
    }
    localStorage.setItem(STORAGE_KEYS.characterOnline, next.id)
    if (this.localReady) {
      this.localReady = false
      this.sendReadyToPeer()
    }
    await this.applySelectionToPlayers()
    this.sendCharacterPickToPeer()
    this.updateLobbyView()
  }

  private updateLobbyView(): void {
    if (this.mode !== 'online' || this.onlinePhase !== 'lobby') return
    const ownChar = this.getOwnCharacter()
    for (const button of this.onlineLobbySelfGrid.querySelectorAll<HTMLButtonElement>('[data-lobby-character-id]')) {
      const active = button.dataset.lobbyCharacterId === ownChar.id
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
    const peerChar = this.getPeerCharacter()
    this.onlineLobbyPeerSwatch.style.background = peerChar.swatch
    this.onlineLobbyPeerName.textContent = peerChar.name
    this.onlineLobbyPeerStatus.textContent = this.peerReady ? '준비 완료' : '아직 준비 안 됨'
    this.onlineLobbyPeerStatus.classList.toggle('is-ready', this.peerReady)
    this.updateStartButtonLabel()
  }

  private enterLobbyPhase(): void {
    this.onlinePhase = 'lobby'
    this.localReady = false
    this.peerReady = false
    const roomId = this.online?.getRoomId() ?? ''
    this.onlineLobbyRoomId.textContent = roomId
    this.updateModeChrome()
    this.updateLobbyView()
  }

  private leaveOnlineLobby(): void {
    this.exitOnlineMode()
    this.setOnlineButtonsBusy(false)
    this.onlineRoomIdRow.hidden = true
    this.onlineRoomIdLabel.textContent = ''
    this.setOnlineStatus('방을 만들거나 대기실에서 방을 고르세요')
    this.updateModeChrome()
    this.syncLobbyBrowser()
  }

  private toggleLocalReady(): void {
    if (!this.online || !this.online.isChannelOpen()) return
    if (this.onlinePhase !== 'lobby') return
    this.localReady = !this.localReady
    this.sendReadyToPeer()
    this.updateLobbyView()
    this.maybeStartFromLobby()
  }

  private sendReadyToPeer(): void {
    if (!this.online) return
    const slot = this.getOwnSlot()
    const charIdx = Math.max(0, CHARACTERS.findIndex((c) => c.id === this.getOwnCharacter().id))
    this.online.sendControl(MESSAGE_KIND.READY, new Uint8Array([this.localReady ? 1 : 0, slot, charIdx]))
  }

  private maybeStartFromLobby(): void {
    if (!this.online || !this.online.isChannelOpen()) return
    if (this.onlinePhase !== 'lobby') return
    if (!this.localReady || !this.peerReady) return
    if (this.online.role !== 'host') return
    const roomId = this.online.getRoomId()
    if (!roomId) return
    this.online.sendControl(MESSAGE_KIND.RESTART_ROUND)
    this.startOnlineGame(roomId)
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
        this.enterLobbyPhase()
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
    net.connectAsHost({
      visibility: this.roomVisibility,
      hostName: this.storedPickable(STORAGE_KEYS.characterOnline, CHARACTERS[0]!).name,
    })
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
        this.enterLobbyPhase()
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
    this.exitOnlineMode()
    if (this.state === 'playing') {
      this.resetToReady()
    } else {
      this.updateModeChrome()
    }
    this.syncLobbyBrowser()
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
    this.suppressLobbyBrowser = true
    const own = this.storedPickable(STORAGE_KEYS.characterOnline, CHARACTERS[0]!)
    if (role === 'host') {
      this.versusP1Character = own
      this.versusP2Character = CHARACTERS[1] ?? CHARACTERS[0]!
    } else {
      this.versusP2Character = own
      this.versusP1Character = CHARACTERS[0]!
    }
    this.onlinePhase = 'menu'
    this.localReady = false
    this.peerReady = false
    await this.setMode('online')
    await this.createPlayersForMode()
    this.resetToReady()
    this.online = new OnlineNet(role, events)
    this.suppressLobbyBrowser = false
    this.syncLobbyBrowser()
    return this.online
  }

  exitOnlineMode(): void {
    this.onlinePhase = 'menu'
    this.localReady = false
    this.peerReady = false
    if (!this.online) return
    this.online.close()
    this.online = null
    this.syncCounter = 0
    this.peerAbilityWasDown = false
    this.localAbilityWasDown = false
    this.localChecksums.clear()
    this.peerChecksums.clear()
    clearRngSeed()
  }

  startOnlineGame(roomId: string): void {
    if (!this.online) return
    setRngSeed(roomId)
    this.syncCounter = 0
    this.peerAbilityWasDown = false
    this.localAbilityWasDown = false
    this.localChecksums.clear()
    this.peerChecksums.clear()
    this.localReady = false
    this.peerReady = false
    this.online.local.reset()
    this.online.peer.reset()
    void this.ensureOnlineCharactersApplied()
    this.startGame()
    this.focusGameSurface()
  }

  private async ensureOnlineCharactersApplied(): Promise<void> {
    const p1 = this.players[0]
    const p2 = this.players[1]
    if (p1 && p1.character.id !== this.versusP1Character.id) {
      await this.swapCharacterForPlayer(p1, this.versusP1Character)
    }
    if (p2 && p2.character.id !== this.versusP2Character.id) {
      await this.swapCharacterForPlayer(p2, this.versusP2Character)
    }
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
      if (this.onlinePhase === 'lobby') this.toggleLocalReady()
      return
    }
    if (this.mode === 'online') return
    if (this.mode === 'solo' && this.soloPickerRandom) {
      void this.rerollSoloCharacterAndStart()
      return
    }
    this.startGame()
  }

  // 랜덤 선택 상태면 매 판 시작 직전에 다시 뽑는다. 모델 교체가 비동기라
  // 로딩이 끝난 뒤 시작하며, 그동안의 중복 시작 요청(Enter 연타 등)은 무시한다.
  private async rerollSoloCharacterAndStart(): Promise<void> {
    if (this.soloStartPending) return
    this.soloStartPending = true
    try {
      const next = pickRandomCharacter()
      if (next.id !== this.soloCharacter.id) {
        this.soloCharacter = next
        localStorage.setItem(STORAGE_KEYS.characterSolo, next.id)
        await this.applySelectionToPlayers()
      }
      this.updateCharacterPicker()
      this.startGame()
    } finally {
      this.soloStartPending = false
    }
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
    if (kind === MESSAGE_KIND.READY) {
      void this.applyPeerReady(payload)
      return
    }
    if (kind === MESSAGE_KIND.CHECKSUM) {
      this.applyPeerChecksum(payload)
      return
    }
  }

  private sendCharacterPickToPeer(): void {
    if (!this.online) return
    const slot = this.getOwnSlot()
    const character = this.getOwnCharacter()
    const charIdx = Math.max(0, CHARACTERS.findIndex((c) => c.id === character.id))
    this.online.sendControl(MESSAGE_KIND.CHARACTER_PICK, new Uint8Array([slot, charIdx]))
  }

  private async applyPeerCharacter(slot: number, charIdx: number): Promise<boolean> {
    const char = CHARACTERS[charIdx]
    if (!char) return false
    let changed = false
    if (slot === 1 && this.versusP1Character.id !== char.id) {
      this.versusP1Character = char
      changed = true
    } else if (slot === 2 && this.versusP2Character.id !== char.id) {
      this.versusP2Character = char
      changed = true
    }
    if (!changed) return false
    const player = this.players[slot - 1]
    if (player) {
      await this.swapCharacterForPlayer(player, char)
    } else {
      await this.createPlayersForMode()
    }
    return true
  }

  private async applyPeerCharacterPick(payload?: Uint8Array): Promise<void> {
    if (!this.online) return
    if (!payload || payload.byteLength < 2) return
    const changed = await this.applyPeerCharacter(payload[0], payload[1])
    if (changed && this.peerReady) this.peerReady = false
    this.updateLobbyView()
    this.updateModeChrome()
  }

  private async applyPeerReady(payload?: Uint8Array): Promise<void> {
    if (!this.online) return
    if (this.onlinePhase !== 'lobby') return
    if (!payload || payload.byteLength < 1) return
    const ready = payload[0] === 1
    if (ready && payload.byteLength >= 3) {
      await this.applyPeerCharacter(payload[1], payload[2])
    }
    this.peerReady = ready
    this.updateLobbyView()
    this.maybeStartFromLobby()
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

    const lead = syncDiff(this.online.local.peekNextCounter(), this.syncCounter)
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
    if (this.syncCounter % ChunsikDodgeGame.CHECKSUM_INTERVAL === 0) {
      this.exchangeChecksum(this.syncCounter)
    }
    return true
  }

  // 락스텝 디싱크 감지용 시뮬 상태 해시. 시뮬에 영향을 주는 상태만 포함하며
  // (연출·애니메이션 제외), 양쪽 피어가 같은 틱에서 같은 값을 얻어야 한다.
  // imul 기반 FNV-1a 변형이라 모든 JS 엔진에서 비트 단위로 동일하다.
  private computeSimChecksum(): number {
    let h = 0x811c9dc5 | 0
    const mix = (v: number) => {
      h = Math.imul(h ^ (v | 0), 0x01000193)
    }
    const q = (v: number) => Math.round(v * 1000)
    mix(q(this.elapsed))
    for (const player of this.players) {
      mix(player.alive ? 1 : 0)
      if (player.group) {
        mix(q(player.group.position.x))
        mix(q(player.group.position.z))
      }
    }
    const missiles = this.missileSystem.missiles
    mix(missiles.length)
    for (const missile of missiles) {
      mix(q(missile.group.position.x))
      mix(q(missile.group.position.z))
    }
    return h >>> 0
  }

  private exchangeChecksum(counter: number): void {
    if (!this.online) return
    const hash = this.computeSimChecksum()
    this.localChecksums.set(counter, hash)
    this.trimChecksumMap(this.localChecksums)
    const payload = new Uint8Array(6)
    const view = new DataView(payload.buffer)
    view.setUint16(0, counter, true)
    view.setUint32(2, hash, true)
    this.online.sendControl(MESSAGE_KIND.CHECKSUM, payload)
    this.compareChecksums(counter)
  }

  private applyPeerChecksum(payload?: Uint8Array): void {
    if (!payload || payload.byteLength < 6) return
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const counter = view.getUint16(0, true)
    const hash = view.getUint32(2, true)
    this.peerChecksums.set(counter, hash)
    this.trimChecksumMap(this.peerChecksums)
    this.compareChecksums(counter)
  }

  private compareChecksums(counter: number): void {
    const local = this.localChecksums.get(counter)
    const peer = this.peerChecksums.get(counter)
    if (local === undefined || peer === undefined) return
    this.localChecksums.delete(counter)
    this.peerChecksums.delete(counter)
    if (local !== peer) this.handleDesync(counter)
  }

  private trimChecksumMap(map: Map<number, number>): void {
    while (map.size > ChunsikDodgeGame.CHECKSUM_HISTORY) {
      const oldest = map.keys().next().value
      if (oldest === undefined) return
      map.delete(oldest)
    }
  }

  private handleDesync(counter: number): void {
    console.error(`[lockstep] desync detected at tick ${counter}`)
    if (this.state !== 'playing') return
    this.resetToReady()
    this.menuTitle.textContent = '동기화 오류'
    this.menuText.textContent = '두 화면의 게임 상태가 어긋나 라운드를 종료했어요. 한 번 더 시작해주세요.'
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
