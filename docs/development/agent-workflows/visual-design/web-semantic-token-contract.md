# Web semantic token 책임과 점진 적용

이 문서는 Web styling의 semantic 역할·값·namespace·theme·mapping·override 판단을 소유합니다.
**한 계약 owner는 한 CSS 파일을 뜻하지 않습니다.** 기존 화면의 선행 token 정리나 현재 팔레트의 영구 보존이 아니라,
향후 승인된 디자인·기능 변경에서 필요한 부분만 안전하게 전환하는 기준입니다.

작은 token 수리는 이 계약을 직접 사용합니다. 전체 시각 탐색·새 dependency·전 화면 migration을 요구하지 않습니다.
[표현 책임·device 검증](./device-presentation-and-verification.md)은 shared/split/unchanged와 device matrix를,
[VisualBrief](./visual-brief.md)는 mode·디자인 방향·수정 권한을,
[Review contract](./design-review-and-acceptance.md)는 assertion intent와 시각 판정을 계속 소유합니다.

## 현재 구현과 목표 계약

아래는 source에서 재확인할 대표 구조이지 영구 파일명·팔레트 규칙이나 runtime PASS가 아닙니다.

| 현재 source                                                                                                              | 관찰한 책임                                                                                              | 변경 시 판단                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [globals.css](../../../../apps/web/src/app/globals.css)                                                                  | generic 역할, `.dark` 값, `@theme inline` mapping. `--primary`는 root `#030213`, dark `oklch(0.985 0 0)` | 역할과 theme별 의미를 확인한 뒤 영향받는 정의·mapping·consumer를 함께 평가                           |
| [repo.css](../../../../apps/web/src/styles/repo.css)                                                                       | `--repo-primary: #1e40af`, 별도 hover/light 등 Repo palette. 이 파일에 dark override 없음                  | generic primary와 이름만 비슷하다고 alias하지 않음. 전체 앱 dark 지원 여부는 별도 확인               |
| [root layout](../../../../apps/web/src/app/layout.tsx), [Storybook preview](../../../../apps/web/.storybook/preview.tsx) | globals 다음 repo import                                                                                  | 현재 production/fixture 연결의 근거. 실제 cascade와 computed value를 import 순서만으로 단정하지 않음 |
| [Button](../../../../apps/web/src/components/ui/Button.tsx), [Chip](../../../../apps/web/src/components/ui/Chip.tsx)     | Repo 참조와 local Tailwind 색/크기 공존                                                                   | local 값 자체는 결함이 아님. 재사용 의미·변경 범위 없이 전부 shared token으로 승격하지 않음          |

목표 계약은 **의미와 값의 분리**입니다. 같은 값이어도 서로 다른 역할이면 분리할 수 있고, 같은 역할도 theme/device별
표현 값은 달라질 수 있습니다. 실제 사용 의미를 확인하지 않은 “중복 값 제거”는 안전한 공통화 근거가 아닙니다.
Token은 업무 상태를 표현하지만 지원 자격·privacy·action의 source of truth가 되지 않습니다. 상태는 색만으로 전달하지 않습니다.

## Namespace, mapping, theme, override

- **Definition owner:** 영향받는 역할의 정의·theme variant·consumer를 함께 책임지는 Web owner를 정합니다.
  여러 CSS 파일을 유지할 수 있으며 전역 정의가 여러 곳이면 cascade·적용 범위를 명시합니다. 한 파일 병합이 완료 조건은 아닙니다.
- **Namespace:** generic semantic role, brand/palette value, feature-local presentation을 구분합니다. 새 공용 이름은
  사용 의도와 consumer 범위를 설명하고 기존 같은 역할을 먼저 조사합니다. 기존 이름의 전역 rename이나 `repo` prefix 고정은 요구하지 않습니다.
- **Public mapping:** CSS custom property와 Tailwind utility mapping은 같은 개념이 아닙니다. 현재 generic은
  `@theme inline`의 `--color-primary: var(--primary)` 연결을, Repo consumer는 `bg-(--repo-primary)` 같은 참조를 사용합니다.
  후속 변경은 lockfile의 Tailwind 버전·실제 mapping·생성 스타일을 확인합니다. mapping만 바꾸고 직접 참조를 빠뜨리지 않습니다.
- **Theme:** base/hover/focus/disabled와 지원하는 light/dark 조합의 기대 의미를 기록합니다. `.dark` 정의의 존재가
  모든 Repo consumer의 dark 대응 증거는 아닙니다. 미지원·미검증 범위를 구분하며 문서 채택을 위해 테마 전체를 구현하지 않습니다.
- **Override:** feature-local 또는 device별 density/spacing/type/layout 값은 해당 presentation owner에 둘 수 있습니다.
  공용 역할을 바꾸려면 영향 consumer와 theme를 함께 검토하고, 특정 화면을 위해 전역 의미를 조용히 재정의하지 않습니다.
  Desktop/Mobile 의미 공유는 모든 값의 동일화를 뜻하지 않습니다. data/action 의미는 기존 공통 owner를 유지합니다.
- **Fallback:** 정의 없는 참조는 declaration·import/cascade·fallback·실제 상태에서 확인합니다. 비슷한 이름의 변수나
  임의 brand 값으로 메우지 않습니다. 수정 권한과 기대 역할이 확인된 뒤 필요한 최소 변경을 선택합니다.

## 변경할 때의 packet

영향받는 surface만 다음 순서로 짧게 기록합니다. 전체 앱 inventory나 별도 token framework를 선행하지 않습니다.

```text
surface + mode + authority
→ token role / value / theme
→ definition / direct reference / Tailwind mapping / import·override owner
→ maintain / replace / new / unchanged + reason
→ consumer delta + assertion intent / preserve-or-replace / replacement evidence
→ production / fixture parity + device verification
→ evidence / gap / follow-up owner·trigger
```

1. `maintain`은 영향 surface의 승인된 외형과 동작을 보존합니다. `reimagine`는 승인된 새 palette/type/layout에 맞게
   값과 미감 baseline을 바꿀 수 있으며, `new-surface`도 과거 Repo 스타일을 자동 상속하지 않습니다. mode는 수정 권한이 아닙니다.
2. 기존 class/token/snapshot assertion의 보호 intent를 먼저 분류합니다. 승인된 디자인과 충돌하는 미감 assertion은
   **대체 회귀를 먼저 정의한 뒤** 교체하고, 기능·상태·정책 copy·privacy·접근성 회귀는 유지합니다. 일괄 snapshot 갱신은 근거가 아닙니다.
3. 필요한 정의·mapping·직접 참조·feature override만 함께 전환합니다. 변경하지 않는 화면은 `unchanged`와 이유로 남깁니다.
   선행 alias/rename/dead-token cleanup이나 전체 화면 적용률은 완료 조건이 아닙니다.
4. **실제 CSS/UI를 변경할 때** production과 Storybook(존재 시)의 해당 state/consumer 연결, computed value와 지원 theme,
   contrast·focus·reflow를 확인합니다. 양쪽 viewport·입력·상태 증거는 위 device 계약을 소비합니다. story가 없으면 필요한
   다른 bounded fixture를 선택하며, 새 Storybook이나 전 화면 screenshot을 자동 요구하지 않습니다.
5. 해당 변경으로 obsolete가 된 정의/alias만 repo-wide caller·dynamic 참조·framework convention을 확인한 뒤 삭제합니다.
   scope 밖 cleanup은 하지 않습니다. 실패 시 해당 surface의 definition/mapping/consumer와 관련 회귀를 한 단위로 복구합니다.
   지침-only 변경은 해당 docs/corpus만 독립 rollback하며 제품 CSS migration을 rollback 조건에 넣지 않습니다.

## 읽기 전용 적용 예시

아래는 후속 판단 예시이며 source 수정 승인이나 실행 evidence가 아닙니다.

| 입력                                              | 판단·후속 packet                                                              | 피할 결과                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Button의 승인된 작은 maintain 수정                | 현재 Repo base/hover와 해당 state 외형 보존, 영향 consumer만 검증; direct path | 지침 채택을 핑계로 모든 버튼 alias/rename         |
| Home reimagine에서 새 palette 승인                | behavior/a11y/privacy 보존, 미감 assertion 대체 설계 후 새 값·baseline 검증   | 과거 Repo blue 또는 snapshot을 영구 의무로 고정    |
| generic/Repo primary를 같은 이름으로 합치자는 제안 | root/dark 값·역할·참조 조사; 이름만으로 alias 거절, runtime 미확인 부분 명시  | 두 파일 공존 자체를 결함으로 보고 병합            |
| background와 surface가 모두 white                 | 값이 같아도 역할이 다른지 확인; 향후 독립 theme 변화 가능하면 분리 유지       | 같은 값이라는 이유만으로 semantic identity 병합   |
| Desktop sidebar와 Mobile drawer의 밀도 차이       | 업무 의미 공유, 간격/type 값은 표현 owner별 선택, 기존 device packet으로 검증 | geometry 일괄 동일화 또는 device별 업무 로직 복제 |
| 이번에 수정하지 않는 Chat                         | unchanged, no-op 이유만 남기고 실제 요청 surface 진행                         | 전체 앱 token 전환이 끝날 때까지 현재 작업 차단   |

## 미확인 참조의 인계

Home에서 `--repo-primary-dark`를 참조하지만 두 CSS owner에서 정의를 찾지 못한 관찰은 **해결된 결함이 아닙니다**.
대표 [PrimaryWithdrawalSheet](../../../../apps/web/src/main/tabs/home/sections/primary/PrimaryWithdrawalSheet.tsx)와
[Home activity dialogs](../../../../apps/web/src/main/tabs/home/sections/activity/dialogs)를 다시 검색합니다. 정확한 참조 목록·개수와
revision은 해당 작업 evidence에 남기고 장기 지침의 고정 개수로 삼지 않습니다. source search만으로 실제 hover 영향은 확정하지 않습니다.

- **Owner:** 영향받는 Home modal/sheet의 다음 승인된 UI/bugfix 작업자.
- **Trigger:** 해당 consumer 수정 또는 computed-style/fallback 결함의 실제 재현.
- **Required evidence:** current definition/reference·cascade/fallback, 영향 state/viewport/theme, 기대 스타일 의미와 재현 결과.
- **Disposition:** 현재 값/alias를 추측해 추가하지 않고 미검증으로 인계합니다. 실제 기능·접근성 결함이 확인되면 별도 bounded
  fix의 범위·권한으로 올립니다. “나중 redesign”을 이유로 확인된 결함을 숨기지 않으며 cosmetic 불확실성만으로 전체 작업을 막지 않습니다.

## 미래 Native와 검증 한계

Web CSS/Tailwind와 token mapping은 Web owner에 남깁니다. 실제 두 번째 renderer와 동등한 의미의 사용이 확인될 때만
공유 token/contract 추출을 검토합니다. 지금 `packages/design-tokens`, RN UI나 adapter framework를 만들지 않습니다.
CSS 변수를 RN에 그대로 전달할 수 있다거나 RN build·호환성을 검증했다고 주장하지 않습니다.

이 문서는 **advisory-policy**, 독립 적용 사례의 의미 검토는 **model-mediated**, 링크·필드·유한 corpus 정합성은
**deterministic-static**입니다. 정적 PASS는 runtime token resolution·visual parity·접근성·전체 채택률을 보장하지 않습니다.
문서-only 작업에서는 제품 검증을 실행하지 않은 이유와 후속 activation 조건을 남기고, 문서 채택과 실제 화면 migration을 구분합니다.
