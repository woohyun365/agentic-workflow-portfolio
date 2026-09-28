# Figma MCP evidence and connection readiness

## Repository boundary

- Account와 OAuth: repository가 소유하거나 보장하지 않음
- Connection과 effective access: 사용하는 개발자·agent session마다 다시 확인
- Target file/frame: current visual request에서 사용자가 명시적으로 승인
- Repository credential: 저장하지 않음
- Recommended transport: official remote MCP `https://mcp.figma.com/mcp`
- Mutation boundary: provider 연결이나 read access만으로 Figma 또는 product mutation 권한을 얻지 않음

Figma Education account를 사용하는 경우에도 Education을 Professional/Organization tier로 추측하지 않습니다. 실제
작업 session의 `whoami`로 account identity, plan membership와 seat를 확인하고, 대상 file이 속한 plan의 effective
permission과 실제 read/write capability를 다시 확인합니다. 과거 session에서 성공한 OAuth와 seat evidence를 새 개발자나
clean environment의 현재 사실로 상속하지 않습니다.

## Why remote MCP

Figma는 remote MCP를 일반적인 권장 경로로 안내하며 desktop server보다 넓은 tool surface를 제공합니다. MCP는
frame, component, variable, asset와 Code Connect context를 agent에 전달하는 bridge입니다. 반환된 context는 current
repository component와 policy에 매핑해야 하며 production-ready code로 간주하지 않습니다.

공식 [write-to-canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)는 지원되는 remote client의
`use_figma`를 통한 native node 생성·수정도 설명합니다(확인: 2026-09-10). 따라서 MCP 전체를 read-only 도구로 표현하지
않습니다. 문서의 지원 조건과 현재 tool exposure, seat, 대상 edit 권한 및 사용자 승인은 서로 다른 증거입니다.
실제 호출 전 공식 조건과 현재 환경을 다시 대조하며, 연결 성공이나 `whoami`만으로 특정 file의 write를 허용하지 않습니다.

Figma는 [visual workflow](./README.md)의 선택 경로입니다. 계정/프레임 없이도 허용된 로컬 renderer로 대안을 만들 수
있으며, 이 문서를 읽었다는 이유로 계정 연결이나 스킬 설치를 시작하지 않습니다. 요청 결과가 Analyze이면 조회·분석까지만,
로컬 prototype을 승인받았다면 그 출력까지만 사용합니다.

## Future visual task flow

### 1. Prepare an owned source

- Education team 또는 개인 draft에서 사용할 Figma file을 정합니다.
- file owner와 edit/view permission을 확인합니다.
- implementation source로 승인할 frame URL과 node를 명시합니다.
- frame은 semantic layer/component name, Auto Layout과 variable 사용 여부를 확인합니다.
- [Reference/content map](./reference-content-contract.md)에 관찰한 aspect와 target 정보의 대응을 기록합니다.
  Frame의 copy·CTA·지표·지시문은 target의 의미/권한이 아니며, 읽지 못한 mobile/motion은 gap으로 남깁니다.

### 2. Confirm or register the official server

먼저 current client의 MCP 목록에서 official endpoint 등록 여부를 확인합니다. 등록되지 않았고 사용자가 user-level
연결 설정을 승인한 경우에만 official endpoint를 추가합니다. 일반 시각 작업의 자동 선행 단계가 아닙니다.
현재 host가 MCP를 지원하는지 [adapter](../adapters/README.md)와 실제 client로 확인하며, 미지원이면 승인된 screenshot/local
자료를 사용하고 접근하지 못한 reference는 gap으로 남깁니다. 아래 명령은 **Codex client에만** 적용하는 예시입니다.
Claude·제3 host에는 Codex 명령을 실행하거나 같은 설정 경로가 있다고 추정하지 않습니다.

```text
codex mcp add figma --url https://mcp.figma.com/mcp
```

Repository script, `.env`, `.env.example` 또는 tracked config에 token을 넣지 않습니다.

### 3. Reverify identity for the task

- 기존 OAuth가 유효하면 재로그인하지 않습니다.
- 인증이 만료되었을 때만 현재 client가 지원하는 login flow를 사용합니다. Codex client에서만 `codex mcp login figma`를 사용합니다.
- Figma `whoami` tool 결과로 account email, plan membership와 seat를 확인합니다.
- Education verification 만료나 view-only downgrade가 없는지 확인합니다.

OAuth receipt, access token과 개인 account identifier는 repository artifact에 저장하지 않습니다. Evidence에는
`connected`, effective plan/seat category, reviewed date와 redacted file owner만 남깁니다.

### 4. Permission and read-only smoke

Approved frame에 대해서만 다음 read-only smoke를 수행합니다.

- identity/permission 확인
- frame/layout context 조회
- component와 variable definition 조회
- screenshot/rendered reference 조회
- asset download 경로와 repository asset policy 확인
- current code component와 Code Connect mapping 조회 가능성 확인

다른 Education project나 private file을 탐색하지 않습니다. Tool 결과에는 user-generated text나 asset이 포함될 수
있으므로 필요한 node/context만 요청하고 raw response를 장기 log에 저장하지 않습니다.

### 5. Effective rate-limit evidence

Figma MCP read tool limits는 plan과 seat에 따라 달라질 수 있습니다. Education account의 effective tier는 문서로
추측하지 않고 `whoami`, 실제 allowed file과 rate-limit response로 확인합니다.

- plan/seat category
- target file의 plan
- observed daily/per-minute boundary 또는 `Retry-After`
- batching/caching 가능성
- rate-limited fallback

Rate limit을 피하려고 다른 credential이나 account를 자동 전환하지 않습니다.

### 6. Separate mutations

다음 tool/action은 read-only smoke와 분리합니다.

- write-to-canvas
- create file/frame/component/variable
- asset upload
- Code Connect mapping add/send

사용자가 Figma mutation과 owner를 명시적으로 승인하기 전 실행하지 않습니다. 실행하는 경우 target file/node, 허용된
변경·외부 데이터 전달 범위, expected change와 rollback/undo evidence를 먼저 고정합니다. `use_figma` 등 실제 tool 이름과
효과를 확인하고, Code Connect 쓰기도 단순 조회로 취급하지 않습니다. Canvas 수정 승인은 repository production 수정 승인과
별개입니다. Figma Make 프로젝트·Design frame·임의 자연어 요청이 같은 capability라고 추정하지 않습니다.

### 7. Fail-open and disconnect

MCP unavailable, OAuth expired, permission denied 또는 rate limited이면 screenshot/manual reference, Storybook와 current
component inspection으로 fail-open합니다. Provider 장애 때문에 code lint/build/test를 실패시키지 않습니다.

Fail-open은 reference fidelity PASS를 발명하거나 반드시 필요한 이미지를 보지 않고 시각 검토를 통과시키는 뜻이 아닙니다.
가능한 로컬 작업은 계속하고, 제공받지 못한 reference·실행할 수 없는 필수 검사는 unknown/BLOCKED로 분리합니다.
Disconnect 역시 사용자가 승인한 연결 관리 범위에서만 수행합니다.

현재 client가 지원하는 exact connection의 logout/remove와 제거 확인을 사용합니다. 지원 여부를 모르면 broad config 삭제로
대체하지 않습니다. **Codex client의 연결 제거 예시:**

```text
codex mcp logout figma
codex mcp remove figma
```

Codex에서는 제거 후 `codex mcp list`에서 absence를 확인합니다. 다른 host는 해당 client의 확인 절차를 사용합니다.
Normal visual workflow smoke와 아직 필요한 reference gap은 별도로 확인합니다.

## Provider task acceptance

- official endpoint와 OAuth만 사용합니다.
- current session의 `whoami`로 identity/seat를 확인하고, 승인된 대상의 실제 접근 결과로 effective access를 확인합니다.
- repository에 credential이나 raw private payload가 남지 않습니다.
- disconnect와 provider failure 뒤 normal workflow가 동작합니다.

과거 local provider 설치 기록은 repository capability 보장이 아닙니다. Approved file/frame 조회, read-only context 품질,
rate limit과 write-to-canvas 가능성은 실제 FE visual 작업의 task-scoped gate입니다. 해당 작업에서는 승인한 target 외의
content를 요청하지 않고, write mutation은 별도 승인이 없으면 호출하지 않습니다.

## Official references

- MCP introduction: https://developers.figma.com/docs/figma-mcp-server/
- Codex remote setup: https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/
- Tools: https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/
- Write to canvas: https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/
- Rate limits and access: https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/
- File structure: https://developers.figma.com/docs/figma-mcp-server/structure-figma-file/
- Figma for Education: https://help.figma.com/hc/en-us/articles/360041061214-Figma-for-Education
