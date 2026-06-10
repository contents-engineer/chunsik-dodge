# `main.ts`에서 MissileSystem과 HUD 표시 계층 분리

`main.ts`가 3,100줄을 넘으며 DOM 템플릿·UI 갱신·렌더링·시뮬레이션·넷코드 글루를 한 클래스에 담게 됐다. 어떤 기능을 고쳐도 같은 파일을 건드리게 되어 회귀 위험과 탐색 비용이 커졌으므로, 의존성이 가장 적고 응집도가 높은 두 덩어리를 먼저 분리한다: 미사일 수명주기(`src/missile-system.ts`)와 HUD 렌더링(`src/ui/hud.ts` + `src/ui/shell.ts`).

## Considered Options

- **ECS 전환**: 거절 — 엔티티 종류가 셋(플레이어/미사일/파티클)뿐이라 과도한 추상화. 컴포넌트 쿼리 인프라 비용이 이득을 넘는다.
- **이벤트 버스 전면 도입**: 거절 — 호출 경로가 한눈에 보이는 직접 호출 + 좁은 콜백 인터페이스로 충분. 버스는 호출 순서를 흐리게 해 락스텝 디버깅을 어렵게 한다.
- **컨텍스트 전달 방식의 시스템 클래스** (선택): `MissileSystem`은 게임 상태를 직접 들지 않고 `MissileSimContext`(arena·players·elapsed·mobile·playerRadius·playing)를 매 호출 받는다. UI 의존(상태 필 텍스트, 효과음)은 `MissileSystemEvents` 콜백 2개로 역전한다.

## 분리 경계

- **`src/missile-system.ts`** — 스폰(단발/볼리/호밍/대형), 경고선, 이동·호밍 스티어링, 충돌 판정, 풀 반환. 충돌 결과는 `Set<PlayerRuntime>`으로 반환만 하고, 사망 처리·게임 종료는 게임 본체가 결정한다.
- **`src/ui/shell.ts`** — 게임 셸 정적 마크업(`renderShellHtml`)과 DOM 헬퍼(`renderTemplate`, `getElement`).
- **`src/ui/hud.ts`** — 점수판·상태 필·능력 타이머·구르기/달리기 버튼의 렌더링. 마지막 적용값 캐시로 중복 DOM 쓰기를 막는다. 입력 이벤트 연결은 게임 본체가 `hud.rollButton`/`hud.runButton`을 받아 수행한다 (렌더링과 입력 정책의 분리).

## 락스텝 결정성 제약

- `simulateStep` 내부 호출 순서(updateGame → updatePlayer → resolvePlayerCollisions → updateMissiles)는 변경하지 않았다.
- `MissileSimContext`에는 시뮬에 영향을 주는 값이 들어가므로 온라인 모드에서 양쪽 피어가 같은 값을 만들어야 한다 (`isSimMobile()`은 온라인에서 항상 false).
- 체크섬(`computeSimChecksum`)은 `missileSystem.missiles`를 그대로 순회한다.

## Consequences

- `main.ts` 3,142줄 → 2,616줄. 미사일 튜닝은 `missile-system.ts`만, HUD 표시는 `ui/hud.ts`만 보면 된다.
- 남은 분리 후보(후속 작업): 메뉴/픽커/온라인 로비 UI, 카메라 리그, 온라인 로비 상태기계, 파티클 시스템.
- 미사일 시스템 단위 테스트가 가능해졌다 — scene mock + 컨텍스트 객체만 주입하면 된다.
