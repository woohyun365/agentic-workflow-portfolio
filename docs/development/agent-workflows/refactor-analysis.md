# Refactor analysis workflow

리팩터링 분석은 파일 크기 자체가 아니라 변경 이유와 책임 경계를 찾는 작업입니다. 사용자가 분석만 요청했다면
제품 코드, 테스트, 파일 구조를 수정하지 않습니다.

공통 source priority, 사실·추론 구분과 handoff 방식은
[Agent execution contract](./agent-execution-contract.md)를 따릅니다. 이 문서는 refactor signal과 책임 경계 판단만
소유합니다.

## Analysis order

1. 대상 경로와 기대 결과를 고정합니다.
2. 현재 코드, call site, contract, test를 repository 전체에서 찾습니다.
3. 상태, 파생 계산, 비동기 흐름, side effect, UI 조립, 접근성 같은 책임 묶음을 구분합니다.
4. 변경 이유와 dependency 방향이 다른 책임이 한 owner에 섞였는지 확인합니다.
5. 유지·부분 분리·이동·삭제 대안을 비교하고 순이익이 큰 변경만 제안합니다.
6. 동작 보존에 필요한 regression test와 검증 명령을 제시합니다.

## Refactor signals

- 서로 독립적인 도메인 상태나 lifecycle이 한 파일에 함께 있습니다.
- 작은 변경이 여러 계층이나 넓은 diff를 요구합니다.
- 정책, API, persistence, presentation 책임의 dependency 방향이 뒤섞였습니다.
- 상태 주입과 side effect 분리가 어려워 테스트가 복잡하거나 false positive가 생깁니다.
- 공개 contract와 내부 구현 경계가 불명확합니다.
- 호출부가 없거나 현재 framework convention으로 도달할 수 없는 코드가 남아 있습니다.

줄 수는 보조 신호일 뿐입니다. 큰 파일이 하나의 응집된 흐름이면 유지할 수 있고, 작은 파일도 변경 이유가 서로
다르면 분리 후보가 될 수 있습니다.

## Decision labels

- **유지**: 현재 owner와 책임 경계가 자연스럽고 변경 이득이 작습니다.
- **부분 분리**: 특정 계산, side effect, UI 조각만 분리하면 테스트성과 변경 국소화가 좋아집니다.
- **이동**: 책임은 유효하지만 현재 디렉터리나 owner가 dependency 방향과 맞지 않습니다.
- **삭제**: 호출부·framework 진입점·정책 책임이 없고 보존할 동작도 없습니다.
- **분리 권장**: 독립 lifecycle 또는 contract boundary가 존재하고 분리 순이익이 명확합니다.

## Recommendation format

각 권장안에는 다음을 포함합니다.

1. 현재 책임과 구체적인 코드 근거
2. 리팩터링을 촉발한 변경 이유
3. 고려한 대안과 기각 이유
4. 권장 owner와 최종 구조
5. migration 순서와 regression protection
6. 테스트, lint, typecheck, build, a11y 또는 성능 검증 중 필요한 항목

공통화는 재사용처와 계약이 실제로 존재할 때만 권장합니다. 새 abstraction보다 삭제, 기존 owner 복구, dependency
방향 정리를 우선합니다.
