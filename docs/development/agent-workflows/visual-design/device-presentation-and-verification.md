# Desktop / Mobile 표현 책임과 검증

이 문서는 Web의 표현 책임 선택, 공통 행동 비복제, 변경할 때의 점진 적용과 device evidence 계약을 소유합니다.
목표는 전면 디자인 개편이 아니라 **향후 개편과 Native 확장을 불필요한 결합이 막지 않는 baseline**입니다.
기존 화면을 그대로 전수 분해하거나 모든 화면의 Desktop/Mobile 파일 쌍을 만드는 작업이 아닙니다.

[Frontend guide](../plan-authoring/frontend.md)는 Server/Client/BFF·성능·접근성 책임을,
[Visual workflow](./README.md)는 시각 방향·copy·실험 권한을 계속 소유합니다. Token/theme의 의미와 값도 해당 styling
owner에서 판단하며 이 계약이 팔레트·폰트·CSS 통합을 지시하지 않습니다. Dependency·전역 설정·배포 권한을 추가하지 않습니다.

## 언제 적용하는가

새 화면, 승인된 redesign, 기존 기능 변경·좁은 결함 수정에서 **영향받는 surface만** 판단합니다. 작은 responsive 수리도
아래 기준을 짧게 사용하되, 전체 시각 탐색 workflow·두 디자인 후보·새 Storybook·subagent를 자동 요구하지 않습니다.
변경하지 않는 화면은 미전환 상태로 남겨도 됩니다. 문서 채택과 개별 화면 적용 완료는 서로 다른 결과입니다.

## 표현 책임 선택

| 관찰한 차이                                              | 선택과 구현 단위                                                          | 피할 과잉 구조                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| 간격·너비·글자 크기·줄바꿈·열 수만 다름                  | `shared-responsive`: 동일 부품/구조에 Tailwind responsive 조정            | 작은 버튼마다 Desktop/Mobile 복제                |
| 탐색·정보 위계·목록/상세 배치·상호작용이 실질적으로 다름 | `split-presentation`: 차이가 있는 subtree의 Desktop/Mobile View 책임 분리 | 전체 page 복제 또는 거대 TSX 안 두 journey 혼합  |
| 현재 변경 요청이 없거나 기능 수리에 표현 차이가 무관함   | `unchanged-out-of-scope`: 기존 표현 유지, 해당 행동 owner에서 최소 수정   | 지침 적용을 위한 전수 분해·CSS rename·강제 pilot |

Tailwind는 유지하며 각 표현 내부의 layout 조정 수단으로 사용합니다. `DesktopView`/`MobileView`라는 이름이나 파일 수는
품질 기준이 아닙니다. 파일 분리 자체보다 실제 IA·interaction 차이와 유지할 공통 계약을 먼저 설명합니다.

## 공통 행동과 표현 전용 state

- 같은 데이터·업무 규칙·validation·mutation·cache 의미를 device별로 복제하지 않습니다. 기존 resource/action owner를
  두 표현이 소비합니다. 같은 서버 initial read와 client interaction을 거대한 공통 Client Component로 몰지 않습니다.
- auth identity, stale response/취소, privacy, 계정·시즌 reset, refresh 의미는 기존 owner를 보존합니다. viewport는
  권한·계정·업무 규칙의 source가 아닙니다. Mock/local-only state는 명시하고 toast만으로 저장 완료를 주장하지 않습니다.
- drawer 열림·hover·접힘처럼 표현 전용 state는 해당 View가 소유할 수 있습니다. 공유할 이유가 있는 draft/선택/action만
  공통 owner에서 조정하며 모든 UI state를 전역화하거나 mega-controller를 만들지 않습니다.
- 동일 action의 pending·중복 submit 방지·실패·성공 후 갱신은 한 의미를 유지합니다. UI 위치가 두 곳이라는 이유로
  API client·mutation·invalidation을 두 벌 만들지 않습니다.

## 같은 URL과 rendering 안전

동일 URL·제품·배포가 기본입니다. 별도 URL/배포는 제품·운영 evidence가 있을 때 별도 결정하며, 검증 편의나 미래 RN만으로
`m.` 사이트를 만들지 않습니다. UA 추정으로 auth/data 경계를 나누지 않습니다.

- 두 View가 DOM에 공존하면 중복 fetch/effect/submit, duplicate ID, 숨은 focus 대상과 스크린리더 content를 확인합니다.
- 조건부 mount를 선택해도 SSR/hydration/flicker와 resize 상태를 검증합니다. 이 지침은 두 View의 동시 mount나 특정
  viewport hook/runtime 분기를 일괄 강제하지 않습니다.
- resize/회전 때 draft·선택·scroll·focus의 유지/reset 규칙을 정합니다. desktop sidebar와 mobile drawer의 표현은 달라도
  행동 결과·privacy/visibility는 같아야 합니다. 실제 API 부작용 검증과 UI 모양 비교를 분리합니다.

## 변경할 때 점진 적용

1. `affected surface → mode → Desktop/Mobile IA·interaction 차이 → 공통 data/action owner`를 확인합니다.
2. `shared-responsive | split-presentation | unchanged-out-of-scope`와 이유, 표현 전용 state를 기록합니다.
3. 영향받는 assertion을 `보호 intent → preserve/replace → 대체 검증`으로 나눕니다. 기능·privacy·a11y·정책 의미는
   보존하고, 승인된 새 디자인과 충돌하는 class/DOM/snapshot은 **대체 회귀를 먼저 정의한 뒤** 전환합니다.
   미감·copy 변경의 authority는 [VisualBrief](./visual-brief.md)와 기존 visual owner가 판단합니다.
4. 승인된 surface 작업에서 필요한 구조와 디자인을 함께 전환합니다. 옛 미감을 영구 고정하거나 파일 전체 test 삭제·일괄
   snapshot 갱신으로 오류를 숨기지 않습니다. 변경하지 않는 화면의 migration 비율은 완료 기준이 아닙니다.
5. `assertion transition → device verification → remaining gaps`를 남기고 실제 적용한 surface만 완료로 기록합니다.

`unchanged-out-of-scope`는 표현 분리를 하지 않는다는 판단이지 필요한 보안·기능 수리까지 미룬다는 뜻이 아닙니다.
문서-only 작업을 통과하려고 production pilot-refactor나 기존 화면 screenshot 전수 수집을 추가하지 않습니다.

## Device verification packet

실제 UI를 바꾼 작업은 다음 항목을 **Desktop과 Mobile 각각** 기록합니다. 390px와 1280–1440px는 검증 출발 예시이지
생산 breakpoint 규칙이 아닙니다. [기존 Storybook presets](../../../../apps/web/.storybook/preview.tsx)와
[Playwright 설정](../../../../apps/web/playwright.config.ts)을 재사용하되 설정 존재를 실행 결과로 세지 않습니다.

| 항목          | 기록할 evidence                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 대상과 환경   | production route / fixture·story(존재 시), revision, browser, 실제 viewport 크기, pointer/touch/keyboard 입력, theme, locale, font 조건 |
| 상태와 행동   | seed/content, loading/empty/error/pending/success·privacy 등 영향 상태, 실행 action·결과·network/refresh 횟수                           |
| 시각과 접근성 | 양쪽 성공 캡처 경로, keyboard/focus·touch·읽기 순서·scroll/reflow 결과, 변경 전후 비교 조건                                             |
| gap           | 실행하지 않은 row, mock/stub, capture와 실제 API 검증의 차이, 남은 담당 owner·확인 조건                                                 |

320px reflow, 변경 breakpoint 직전/직후, zoom, 긴 한글·font fallback, safe area·가상 키보드, reduced motion은 영향에
맞게 검사합니다. 기존 접근성 의무를 줄이지 않으며 무관한 전체 browser matrix를 모든 작업에 강제하지 않습니다.
Production과 Storybook fixture가 있으면 같은 상태·행동 계약인지 확인하고, story가 없으면 필요한 다른 bounded fixture를
선택합니다. 실제 화면 변경이 없는 기능 수리는 해당 action/error/privacy 검증과 UI matrix가 불필요한 이유를 남깁니다.

- 프로젝트 이름만 다른 같은 viewport 캡처는 dual-device PASS가 아닙니다. 예를 들어
  [Legal 모바일 목차 case](../../../../apps/web/e2e/legal.spec.ts)는 두 project에서도 390×844로 override합니다.
  다른 case까지 같은 크기라고 일반화하지 말고 실행된 case의 viewport를 확인합니다.
- 한쪽 evidence가 없으면 그쪽은 미검증입니다. Static screenshot만으로 mutation 완료, 에뮬레이션만으로 실제 OS
  keyboard·모바일 브라우저 전체 동작 PASS를 주장하지 않습니다.
- 기능/a11y, reference fidelity, usability, 사람의 취향 승인은 [Review contract](./design-review-and-acceptance.md)의
  별도 판정입니다. 실제 렌더 없이 시각적 개선을 주장하지 않습니다.

## Mobile Web과 미래 Native

Mobile Web DOM/TSX/Tailwind는 RN UI와 같지 않습니다. 현재 Web data/state composition과 Web 부품은 Web owner에
남깁니다. 미래 Native는 별도 renderer와 transport/storage/navigation adapter가 필요하며 실제 재사용이 확인된
contract/pure logic만 공유 후보입니다. 이를 이유로 지금 shared UI package, native 앱, adapter framework를 만들거나
RN build·성능·호환성을 실증했다고 말하지 않습니다.

## 읽기 전용 적용 예시

다음은 후속 task packet을 구성하는 예시이지 현재 화면 migration이나 구현 승인이 아닙니다. 실행 시 current source와
대조합니다. 작업 모드/수정 권한은 [VisualBrief](./visual-brief.md)를 따릅니다.

| 입력과 source                                                                                                                            | 선택·owner·보호 행동                                                                                               | 후속 evidence / gap                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home dialog 여백·너비만 수리: [overlay](../../../../apps/web/src/main/tabs/home/overlays/HomeResponsiveDialog.tsx)                       | maintain / shared-responsive. 기존 focus/close/scroll lock 유지                                                    | affected viewport·reflow·[overlay 행동 회귀](../../../../apps/web/src/main/tabs/home/__tests__/HomeResponsiveOverlay.test.tsx). 작은 차이에 두 View 불필요                                                      |
| Profile desktop 편집 패널과 mobile 단계형 편집을 승인받은 경우: [route](../../../../apps/web/src/main/routes/ProfileRoute.tsx)           | split-presentation을 편집 subtree에 한정. field/draft/validation/save 의미는 공통, local open state만 각 View 소유 | draft·pending/error·취소·resize/focus·실제 저장을 별도 검증. [현재 local hook](../../../../apps/web/src/main/hooks/useMainProfileState.ts)의 toast는 영속 save 증거가 아니며 persistence owner의 후속 수리 필요 |
| Home의 같은 시즌 참여 철회 action을 두 표현에 배치: [HomeRoute](../../../../apps/web/src/main/routes/HomeRoute.tsx)                      | 기존 action/resource·중복 submit 방지 공유, 성공 refetch once / 실패 no refresh                                    | [runtime 회귀](../../../../apps/web/src/main/runtime/MainRuntime.test.tsx)와 실제 후속 network/action 검사. 기숙사 선택의 local toast를 실제 mutation 성공으로 혼동하지 않음                                    |
| 변경 요청 없는 Chat 또는 표현과 무관한 Profile 저장 실패 수리                                                                            | unchanged-out-of-scope. 전자는 no-op, 후자는 기존 data/action seam의 필요한 결함만 수정                            | 전자는 diff 없음/이유, 후자는 action/error/privacy 회귀. 모든 legacy 분해·디자인 후보 불필요                                                                                                                    |
| 승인된 Home IA 변경이 [layout test](../../../../apps/web/src/main/tabs/home/__tests__/HomeDashboardLayout.test.tsx)의 class/order와 충돌 | class/order의 대체 layout·읽기 순서 검증 먼저 정의, named region/content와 행동 의미 보존                          | assertion 단위 replacement map과 변경 surface의 device 결과. 전체 test 삭제 금지                                                                                                                                |

## 강제력과 완료 범위

이 지침은 `advisory-policy`, 독립 적용 walkthrough는 `model-mediated`, 문서 링크/필드/유한 corpus 검사는
`deterministic-static`입니다. [정적 contract test](../../../../scripts/ci/visual-design-workflow-contract.test.mjs)와
[corpus](../../../../scripts/ci/fixtures/visual-capability-cases.json)의 GREEN은 agent 준수·미감·현재 제품 구조·RN 호환성의
runtime proof가 아닙니다. Reviewer에게는 request/input만 전달하고 evaluator expectations를 정답으로 주입하지 않습니다.

완료 보고는 **지침 채택 / 읽기 전용 사례 검토 / 실제 surface 적용 / browser·Native evidence**를 구분합니다.
검증과 남은 gap은 [QA](../qa.md)의 snapshot-bound 결과로 남기고, 기존 화면 전체 적용을 지침 완료 조건으로 삼지 않습니다.
