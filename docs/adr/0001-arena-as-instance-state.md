# `ARENA`를 모듈 상수에서 게임 인스턴스 상태로 이동

대결전(versus)에 일반맵/확장맵 선택 기능을 도입하면서, 아레나 치수가 더 이상 컴파일 타임 상수가 아니게 됐다. 기존에는 `config.ts`의 `ARENA` 단일 상수를 `main.ts`에서 25곳 직접 참조했지만, 이제는 `config.ts`에 `MAP_PRESETS: Record<'normal' | 'extended', ArenaSpec>`을 두고, `Game` 클래스가 게임 시작 시 활성 프리셋을 `this.arena`에 캐시하며, 모든 참조를 `this.arena.*`로 교체한다.

## Considered Options

- **모듈 상수 mutation** (`let ARENA = ...; ARENA = MAP_PRESETS.extended`): 변경 최소. 거절 — 모듈 전역 가변 상태는 hidden state로, 어느 코드가 어느 시점에 어떤 값을 보는지 추적 불가.
- **`getArena()` 함수 + 모듈 전역 활성 키**: 호출처 패치 최소. 거절 — 여전히 hidden global state. 테스트·다중 게임 인스턴스 가능성 차단.
- **`Game.arena` 인스턴스 프로퍼티** (선택): 25곳 패치 비용은 있지만 상태가 인스턴스에 묶여 명시적이고, 향후 다른 아레나 의존 파라미터(미사일 스폰 마진 등)를 묶어 확장하기 쉽다.

## Consequences

- `import { ARENA } from './config'`이 사라지고 `Game` 메소드들은 `this.arena`를 참조한다.
- `config.ts`에는 `MAP_PRESETS`와 `ArenaSpec` 타입이 추가되며, 기존 `ARENA`는 `MAP_PRESETS.normal`과 동일.
- 새로운 맵 프리셋(예: 토너먼트맵)을 추가할 때는 `MAP_PRESETS`에 한 줄 추가하고 UI 선택지에 노출하면 끝.
