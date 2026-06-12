import { ASSETS, CHARACTERS, assetPath } from '../assets'

export function renderTemplate(target: HTMLElement, html: string): void {
  const fragment = document.createRange().createContextualFragment(html)
  target.replaceChildren(fragment)
}

export function getElement<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const element = root.querySelector<T>(`#${id}`)
  if (!element) {
    throw new Error(`Missing element #${id}`)
  }
  return element
}

// 게임 셸 전체 마크업. 동적 갱신은 각 뷰(HudView 등)와 게임 본체가 담당하고
// 이 함수는 정적 구조만 만든다.
export function renderShellHtml(): string {
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
          <button class="camera-option" type="button" data-camera-mode="arena" aria-pressed="true">멀리</button>
          <button class="camera-option" type="button" data-camera-mode="chunsik" aria-pressed="false">가까이</button>
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
                  aria-label="랜덤 선택 - 매 판 새로 뽑으며 1/5 확률로 북극곰이 나옵니다"
                >
                  <span class="character-swatch character-swatch--random">?</span>
                  <span class="character-name">랜덤</span>
                </button>
              </div>
              <p class="character-picker-hint">랜덤은 매 판 새로 뽑아요 — 1/5 확률로 <strong>북극곰</strong>이 등장합니다</p>
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
                <div class="online-create-row">
                  <div id="online-visibility" class="online-visibility" role="radiogroup" aria-label="방 공개 설정">
                    <button class="online-visibility-option" type="button" data-room-visibility="public" role="radio" aria-checked="true">공개</button>
                    <button class="online-visibility-option" type="button" data-room-visibility="private" role="radio" aria-checked="false">비공개</button>
                  </div>
                  <button id="online-create-btn" class="online-action" type="button">방 만들기</button>
                </div>
                <p id="online-visibility-hint" class="online-visibility-hint">공개 방은 아래 대기실 목록에 노출됩니다</p>
                <div id="online-room-id-row" class="online-room-id-row" hidden>
                  <span class="online-room-id-label">방 ID</span>
                  <code id="online-room-id" class="online-room-id"></code>
                  <button id="online-copy-btn" class="online-mini-btn" type="button">복사</button>
                </div>
              </div>
              <div class="online-section">
                <span class="online-room-list-title">공개 대기실</span>
                <div id="online-room-list" class="online-room-list">
                  <p class="online-room-list-empty">지금 열려 있는 공개 방이 없어요</p>
                </div>
              </div>
              <div class="online-section">
                <label class="online-join-label" for="online-room-id-input">비공개 방 ID로 입장</label>
                <div class="online-join-row">
                  <input id="online-room-id-input" class="online-room-id-input" type="text" placeholder="예: 02d361" maxlength="32" autocomplete="off" spellcheck="false" />
                  <button id="online-join-btn" class="online-action" type="button">들어가기</button>
                </div>
              </div>
              <p id="online-status" class="online-status" role="status">방을 만들거나 대기실에서 방을 고르세요</p>
              <p class="character-picker-hint">테스트할 때는 두 탭을 동시에 보이게 띄워주세요 — 비활성 탭은 브라우저가 멈춰서 락스텝이 진행되지 않습니다.</p>
            </div>
            <div id="online-lobby" class="online-lobby" hidden>
              <div class="online-lobby-room">
                <span class="online-lobby-room-label">방 ID</span>
                <code id="online-lobby-room-id" class="online-room-id"></code>
                <button id="online-lobby-copy" class="online-mini-btn" type="button">복사</button>
              </div>
              <div class="online-lobby-slots">
                <div class="online-lobby-slot online-lobby-slot--self">
                  <span class="online-lobby-slot-label">내 캐릭터</span>
                  <div id="online-lobby-self-grid" class="online-lobby-grid">
                    ${CHARACTERS.filter((character) => character.pickerVisible).map(
                      (character) => `
                      <button
                        class="character-option"
                        type="button"
                        data-lobby-character-id="${character.id}"
                        role="radio"
                        aria-checked="false"
                        aria-label="${character.name}"
                      >
                        <span class="character-swatch" style="background:${character.swatch};"></span>
                        <span class="character-name">${character.name}</span>
                      </button>
                    `,
                    ).join('')}
                  </div>
                </div>
                <div class="online-lobby-slot online-lobby-slot--peer">
                  <span class="online-lobby-slot-label">상대 캐릭터</span>
                  <div class="online-lobby-peer-card">
                    <span id="online-lobby-peer-swatch" class="character-swatch online-lobby-peer-swatch"></span>
                    <span id="online-lobby-peer-name" class="character-name">선택 대기 중…</span>
                  </div>
                  <span id="online-lobby-peer-status" class="online-lobby-peer-status">아직 준비 안 됨</span>
                </div>
              </div>
              <button id="online-lobby-leave" class="online-mini-btn online-lobby-leave" type="button">방 나가기</button>
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
                  <span><kbd>L Ctrl</kbd></span>
                </div>
                <div class="versus-keys-row">
                  <strong class="versus-keys-row-label">2P</strong>
                  <span><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span>
                  <span><kbd>R Shift</kbd></span>
                  <span><kbd>R Ctrl</kbd></span>
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
