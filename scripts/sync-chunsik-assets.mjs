import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..')
const monsterRoot = join(projectRoot, '..')
const demoAssets = join(monsterRoot, 'chunsik-demo', 'assets')
const cloneAssets = join(monsterRoot, 'chunsik-clone', 'public', 'assets')
const outRoot = join(projectRoot, 'public', 'assets', 'chunsik-dodge')

const assets = [
  ['models/chunsik.glb', join(demoAssets, '3d_models', '76071273_chunsik.glb')],
  ['models/idle-01.glb', join(demoAssets, '3d_models', '84020772_Idel_01.glb')],
  ['models/idle-02.glb', join(demoAssets, '3d_models', '84020786_Idel_02.glb')],
  ['models/walk.glb', join(demoAssets, '3d_models', '84020836_Walk.glb')],
  ['models/run.glb', join(demoAssets, '3d_models', '84020814_Run.glb')],
  ['models/rolling.glb', join(demoAssets, '3d_models', '84020804_Rolling.glb')],
  ['models/surprise.glb', join(demoAssets, '3d_models', '84020826_Surprise.glb')],
  ['images/chunsik-uv.png', join(cloneAssets, 'chunsik_01.png')],
  ['images/paper.jpg', join(demoAssets, 'images_original', '75542790_paper_A.jpg')],
  ['images/racing-map.png', join(demoAssets, 'images_original', '85552266_racingMap.png')],
  ['images/shadow.png', join(demoAssets, 'images_original', '81548820_shadow.png')],
  ['images/popup-chunsik.png', join(demoAssets, 'images_original', '85554189_popupChunsik.png')],
  ['images/icon-sound-on.png', join(demoAssets, 'images_original', '83421258_icon-sound-on.png')],
  ['images/icon-sound-off.png', join(demoAssets, 'images_original', '83421257_icon-sound-off.png')],
  ['images/icon-replay.png', join(demoAssets, 'images_original', '86033178_icon_replay.png')],
  ['audio/main.mp3', join(demoAssets, 'audio', '89140590_main.mp3')],
  ['audio/ui-click.wav', join(demoAssets, 'audio', '86593322_ui_click_001.wav')],
  ['audio/attack-a.mp3', join(demoAssets, 'audio', '85844463_zone03-ryanAttackA.mp3')],
  ['audio/attack-b.mp3', join(demoAssets, 'audio', '85844752_zone03-ryanAttackB.mp3')],
  ['audio/hit.mp3', join(demoAssets, 'audio', "80533488_[4. 29-1] Kakao Sound Effect '!'_01.mp3")],
  ['fonts/kyobo-handwriting.woff2', join(demoAssets, 'fonts', 'kyobo_handwriting_2019-webfont.woff2')],
]

const manifest = {}

for (const [target, source] of assets) {
  if (!existsSync(source)) {
    throw new Error(`Missing source asset: ${source}`)
  }
  const destination = join(outRoot, target)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  manifest[target] = `assets/chunsik-dodge/${target}`
}

writeFileSync(join(outRoot, 'manifest.generated.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Synced ${assets.length} assets to ${outRoot}`)
