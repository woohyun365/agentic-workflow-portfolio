# Frontend plan authoring

`apps/web`의 Next.js UI, BFF, interaction, design system과 browser runtime이 primary owner인 계획에 사용합니다.
[Core](./core.md)를 먼저 읽습니다.

## Product and policy surface

- 사용자 목표와 화면이 소유하는 정보·action을 정의합니다.
- season, registration, permission, loading, empty, stale, error, blocked, terminal 상태를 state matrix로 만듭니다.
- UI gating은 UX 표현이며 최종 action precondition은 API owner가 검증하도록 분리합니다.
- policy copy, shared contract, BFF mapper, API response가 같은 의미를 사용하는지 확인합니다.

## Next.js, React, and BFF boundary

- current lockfile과 Next.js/React 공식 문서로 실제 version behavior를 확인합니다.
- Server Component는 data access·initial shell에, Client Component는 interaction이 필요한 최소 경계에 둡니다.
- BFF는 cookie/auth, upstream allowlist, privacy shaping, error translation 책임이 있을 때만 둡니다.
- Server Action, Route Handler, client fetch 중 선택은 auth, CSRF, cache, rate limit, error semantics를 비교합니다.
- server/client module graph, serialization, hydration, navigation과 modal/scroll ownership을 명시합니다.

## State, form, mutation, and cache

- source state, derived state, URL state, server cache, ephemeral UI state를 구분합니다.
- form은 validation, pending, duplicate submit, retry, focus, error announcement, browser autofill을 포함합니다.
- optimistic update는 rollback과 server conflict semantics가 명확할 때만 사용합니다.
- invalidation, refresh, back/forward, stale response, abort/race가 user-visible state와 일치하는지 확인합니다.

## Accessibility and responsive interaction

- 작은 responsive 수리를 포함해 [표현 책임·device 검증](../visual-design/device-presentation-and-verification.md)에서
  shared/split/unchanged를 판단합니다. 변경 surface만 적용하며 전체 디자인 탐색이나 기존 화면 선행 분해를 요구하지 않습니다.
- semantic HTML, label, keyboard order, visible focus, modal focus trap/restore, live status를 acceptance에 포함합니다.
- 320px mobile, tablet landscape, desktop, zoom/reflow, safe area와 virtual keyboard를 점검합니다.
- sticky/fixed/portal/scroll lock은 실제 scroll owner와 stacking context를 근거로 설계합니다.
- disabled action은 이유를 전달하고, information card를 disabled button처럼 오해하게 만들지 않습니다.

## Visual and component boundary

- 승인된 개편은 기존 미감을 자동 상속하지 않되 [assertion 전환](../visual-design/design-review-and-acceptance.md#assertion-transition-before-ui-changes)을
  UI 변경 전에 설계합니다. 문구 분류·명시적으로 허용된 font/dependency 실험은 [VisualBrief](../visual-design/visual-brief.md)를 소비하며 제품 정책 변경 권한은 별도입니다.
- token 역할·값·theme·override는 [Web semantic token 계약](../visual-design/web-semantic-token-contract.md)을
  변경 surface에만 적용합니다. 작은 수리는 직접 판단하고, 지침 채택을 위한 전수 CSS migration은 하지 않습니다.
- existing production component의 의미·interaction·state owner를 먼저 조사하고 재사용합니다. 시각적 방향은
  [Visual design workflow](../visual-design/README.md)의 `maintain | reimagine | new-surface`와 surface별 승인 범위로
  판단하며, 명시적으로 새 방향을 탐색할 때 기존 token/layout의 외형을 의무로 상속하지 않습니다.
- content/state/action map과 reference aspect를 분리하고 제안·계획·승인된 구현의 권한을 명시합니다. 실제 화면 없이
  미적 성과를 추측하지 않으며 기능/a11y, reference fidelity, usability, Owner 선호의 acceptance를 나눕니다.
- 공통화는 외형 유사성이 아니라 semantics, interaction, state contract가 같은 경우에만 수행합니다.
- page/flow/domain UI/shared primitive의 owner를 구분하고 단순 re-export와 god component를 피합니다.
- Storybook fixture는 production controller/contract를 우회하는 별도 behavior owner가 되지 않습니다.

## Performance and browser reliability

- LCP, INP, CLS, hydration cost, route transition, bundle/image/font/CSS loading 후보를 점검합니다.
- error boundary, browser runtime error, Web Vitals, BFF failure telemetry의 현재 owner와 개인정보 경계를 확인합니다.
- 성능 최적화는 측정 가능한 bottleneck 또는 target budget에 연결하며 유행성 library를 먼저 도입하지 않습니다.

## Security and privacy

- XSS, open redirect, cookie/token exposure, sensitive payload logging, enumeration copy를 점검합니다.
- profile/chat/analytics/observability payload는 공개 범위와 최소 수집 원칙을 유지합니다.
- auth, PII, moderation, legal surface이면 [Security and privacy](./cross-cutting/security-privacy.md)를 추가합니다.

## Frontend verification

- pure logic: unit test
- component state and interaction: Vitest + Testing Library
- production controller and Storybook parity: shared fixture/interaction test
- navigation, browser API, responsive modal/scroll: Playwright when risk justifies it
- accessibility: semantic query, keyboard/focus test, 필요 시 automated scan
- BFF contract: route test + shared schema + upstream failure cases
- visual changes: production surface and Storybook consistency, bounded screenshot evidence

Plan은 target component tree, server/client/BFF boundary, UI state matrix, responsive/a11y behavior, contract mapper,
test ownership과 rollout risk를 명시합니다.
