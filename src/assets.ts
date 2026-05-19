export function assetPath(path: string): string {
  return `${import.meta.env.BASE_URL}assets/chunsik-dodge/${path}`
}

export const ASSETS = {
  models: {
    chunsik: 'models/chunsik.glb',
    idle01: 'models/idle-01.glb',
    idle02: 'models/idle-02.glb',
    walk: 'models/walk.glb',
    run: 'models/run.glb',
    rolling: 'models/rolling.glb',
    surprise: 'models/surprise.glb',
    bear: 'models/bear.glb',
    bearIdle: 'models/bear-idle.glb',
    bearWalk: 'models/bear-walk.glb',
    bearRun: 'models/bear-run.glb',
    bearSurprise: 'models/bear-surprise.glb',
  },
  images: {
    chunsikUv: 'images/chunsik-uv.png',
    chunsikUvSkin: 'images/chunsik-uv-skin.png',
    chunsikUvDetails: 'images/chunsik-uv-details.png',
    paper: 'images/paper.jpg',
    racingMap: 'images/racing-map.png',
    shadow: 'images/shadow.png',
    popupChunsik: 'images/popup-chunsik.png',
    menuChunsik: 'images/menu-chunsik.png',
    soundOn: 'images/icon-sound-on.png',
    soundOff: 'images/icon-sound-off.png',
    replay: 'images/icon-replay.png',
  },
  audio: {
    main: 'audio/main.mp3',
    uiClick: 'audio/ui-click.wav',
    attackA: 'audio/attack-a.mp3',
    attackB: 'audio/attack-b.mp3',
    hit: 'audio/hit.mp3',
  },
  fonts: {
    kyobo: 'fonts/kyobo-handwriting.woff2',
  },
} as const

export type CharacterId = 'chunsik' | 'gomdori' | 'mochi' | 'mint' | 'bear'

export type CharacterAnimSet = {
  idle: string
  idle2?: string
  walk: string
  run: string
  rolling?: string
  surprise: string
}

export type CharacterAppearance =
  | { type: 'uvFilter'; hue: number; saturation: number; brightness: number }
  | { type: 'embedded' }

export type CharacterAbility = 'roll' | 'cloak'

export type CharacterDefinition = {
  id: CharacterId
  name: string
  description: string
  swatch: string
  modelPath: string
  bonePrefix: string
  desiredHeight: number
  animations: CharacterAnimSet
  appearance: CharacterAppearance
  ability: CharacterAbility
  pickerVisible: boolean
}

const CHUNSIK_ANIMS: CharacterAnimSet = {
  idle: ASSETS.models.idle01,
  idle2: ASSETS.models.idle02,
  walk: ASSETS.models.walk,
  run: ASSETS.models.run,
  rolling: ASSETS.models.rolling,
  surprise: ASSETS.models.surprise,
}

export const CHARACTERS: readonly CharacterDefinition[] = [
  {
    id: 'chunsik',
    name: '춘식이',
    description: '원조 카나리아 친구',
    swatch: '#f3c34a',
    modelPath: ASSETS.models.chunsik,
    bonePrefix: 'Choonsik_',
    desiredHeight: 1.58,
    animations: CHUNSIK_ANIMS,
    appearance: { type: 'uvFilter', hue: 0, saturation: 1, brightness: 1 },
    ability: 'roll',
    pickerVisible: true,
  },
  {
    id: 'gomdori',
    name: '깜식이',
    description: '구수한 갈색 친구',
    swatch: '#8a5a36',
    modelPath: ASSETS.models.chunsik,
    bonePrefix: 'Choonsik_',
    desiredHeight: 1.58,
    animations: CHUNSIK_ANIMS,
    appearance: { type: 'uvFilter', hue: -18, saturation: 1.18, brightness: 0.74 },
    ability: 'roll',
    pickerVisible: true,
  },
  {
    id: 'mochi',
    name: '춘홍이',
    description: '말랑한 분홍 친구',
    swatch: '#ec7eb4',
    modelPath: ASSETS.models.chunsik,
    bonePrefix: 'Choonsik_',
    desiredHeight: 1.58,
    animations: CHUNSIK_ANIMS,
    appearance: { type: 'uvFilter', hue: 295, saturation: 1.55, brightness: 1.02 },
    ability: 'roll',
    pickerVisible: true,
  },
  {
    id: 'mint',
    name: '춘백이',
    description: '뽀얀 하얀 친구',
    swatch: '#f3ede0',
    modelPath: ASSETS.models.chunsik,
    bonePrefix: 'Choonsik_',
    desiredHeight: 1.58,
    animations: CHUNSIK_ANIMS,
    appearance: { type: 'uvFilter', hue: 0, saturation: 0.08, brightness: 1.18 },
    ability: 'roll',
    pickerVisible: true,
  },
  {
    id: 'bear',
    name: '북극곰',
    description: '뜨겁뜨겁 도전자',
    swatch: '#ffffff',
    modelPath: ASSETS.models.bear,
    bonePrefix: 'Bear_',
    desiredHeight: 1.72,
    animations: {
      idle: ASSETS.models.bearIdle,
      walk: ASSETS.models.bearWalk,
      run: ASSETS.models.bearRun,
      surprise: ASSETS.models.bearSurprise,
    },
    appearance: { type: 'embedded' },
    ability: 'cloak',
    pickerVisible: false,
  },
] as const

export function pickRandomCharacter(): CharacterDefinition {
  const index = Math.floor(Math.random() * CHARACTERS.length)
  return CHARACTERS[index] ?? CHARACTERS[0]!
}

export const DEFAULT_CHARACTER_ID: CharacterId = 'chunsik'

export function findCharacter(id: string | null | undefined): CharacterDefinition {
  return CHARACTERS.find((character) => character.id === id) ?? CHARACTERS[0]!
}
