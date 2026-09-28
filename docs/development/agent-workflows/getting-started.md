# Coding agent와 작업 시작하기

이 문서는 이 저장소를 처음 접하는 개발자가 Codex, Claude Code 또는 다른 coding agent에 작업을 요청하는 방법을
설명합니다. 특정 skill 이름이나 과거 대화를 알 필요는 없습니다.

짧거나 모호한 요청은 [Request intake](./request-intake/README.md) 계약에 따라 요청한 결과, 수정 권한,
필요한 근거와 미확정 결정으로 나눕니다. 분석을 요청했다면 code를 수정하지 않고, 계획을 요청했다면
구현까지 자동으로 확장하지 않습니다.

## Host 선택

Codex/OMX에서는 아래의 native 실행·승인 경계를 따릅니다. Claude Code에서는 root `CLAUDE.md`가 `AGENTS.md`를
명시적으로 import하며, [Claude Code adapter](./adapters/claude-code.md)의 역할·도구·권한 확인을 거칩니다.
같은 요청 예시를 사용할 수 있지만 Codex의 model/effort/승인 옵션을 Claude 옵션으로 번역하지 않습니다.
모든 host는 [adapter index](./adapters/README.md)에서 명시적으로 경로를 선택하고 현재 로드된 권한을 확인합니다.
미등록 host에는 Codex 옵션을 대입하지 않습니다. 공통 입력·진행·QA 계약으로 허용된 직접 작업은 가능하지만,
미입증 위임·필수 독립 검토는 완료로 가장하지 않습니다. 실제 결과와 정적 문서 검사를 구분합니다.
아래 Codex 절은 Codex/OMX를 선택한 경우에만 읽으며, 다른 host는 **공통 입력**으로 이동합니다.

## Claude Code 실행과 승인

Claude Code를 선택했다면 저장소 root에서 다음 표준 명령으로 새 interactive session을 시작합니다.

```bash
claude --permission-mode auto
```

이 명령은 사용자의 기존 Home·project 설정을 그대로 로드합니다. OMC가 해당 설정에 설치·활성화되어 있으면 Claude가
함께 로드하므로 별도 `omc` CLI prefix가 필요하지 않습니다. 모든 Claude 설치에 OMC가 있다는 뜻은 아니며 plugin
loading은 현재 Claude 설정이 결정합니다. 저장소 작업을 위해 Home에 plugin·hook·role을 설치하거나 기존 설정을
바꾸지 않습니다. `auto`는 각 tool 요청을 Claude Code의 일반 승인 classifier로 판정하는 모드이며
`bypassPermissions`가 아닙니다. Codex/OMX의 `--approve-for-me`와 같은 사용자 의도를 지원하지만
sandbox·reviewer·보안 강제가 동일하다는 뜻은 아닙니다.

시작 후 현재 CLI의 실제 UI에서 permission mode, loaded source와 parent model을 확인합니다. 원하는 parent model이
가용하지 않아 fallback되거나 native Agent 지원이 보이지 않으면 실제 표시를 현재 사실로 사용합니다. 실행 명령이
model을 설정하거나 task 권한을 부여한다고 가정하지 않습니다.

Native Agent에 맡길 bounded task가 있을 때만 같은 parent session의 `session_id`로 manifest를 등록합니다.

```bash
pnpm claude:native register --input <JSON-file>
```

입력 파일의 manifest는 역할·범위·profile과 정확한 Agent 입력을 연결하는 coordination record입니다. 인증이나 업무 승인 수단이
아닙니다. 정상 hook은 manifest와 다른 model 또는 model 누락을 거부하고, Repo 역할 호출은 project ask 규칙 때문에 Repo hook의
grant 없이는 자동 승인되지 않습니다. **`repo_*` Agent에 대한 권한 prompt가 보이면 Repo hook이 승인하지 않은 것이므로 승인하지
않습니다.** Repo hook이 실패하면 차단이 아니라 사람 승인 prompt로 넘어가며(fail-safe to human), 실행 중인 세션에서 편집한 권한 규칙은
반영되지 않으므로 새 세션에서 확인합니다. 완료 판정에는 같은 session과 tool 호출의 grant·receipt, 현재 source, 의미 검증과
공통 QA가 모두 필요합니다. 일반 작업은 먼저 공통 문서를 따르고, 역할별 tool 제한·single writer·필요한 독립 QA를 유지합니다.

세부 hook과 증거 경계는 [Claude Code adapter](./adapters/claude-code.md)를 따릅니다. 기존 headless native
qualification은 별도 legacy 검증이며 interactive `auto`의 증거가 아닙니다. Cross-CLI bridge도 계속 미지원입니다.

## Codex/OMX 실행과 승인

저장소로 이동한 뒤, 설치된 `codex --help`가 `--approve-for-me`를 지원하고 계정·managed 정책이 허용하면
다음처럼 **새 세션**을 시작합니다. 모델·추론 수준은 작업에 맞게 선택하며 전역 설정 변경은 필수가 아닙니다.

```bash
omx --direct --approve-for-me
```

`--direct`는 OMX의 tmux/HUD 관리를 사용하지 않는 실행 방식이며 sandbox 해제가 아닙니다. 지원되는 Auto-review는
workspace-write 경계를 유지하면서 필요한 승인 요청을 reviewer에게 보냅니다. 이미 허용된 작업은 검토 없이 진행될
수 있습니다. 동작과 권한 구분은 [실행 계약](./agent-execution-contract.md#permission-modes-and-evidence)과
[공식 Auto-review 설명](https://learn.chatgpt.com/docs/sandboxing/auto-review)을 따릅니다.

시작 후 `/status`·`/permissions` 등 현재 CLI가 제공하는 화면에서 **sandbox와 reviewer를 각각** 확인합니다.
`on-request` 표시만으로 reviewer가 사람인지 Auto-review인지 단정하지 않습니다. 명령이 인식되거나 문서·fixture가
통과한 것만으로 실제 적용을 확인했다고 보고하지 않습니다. 확인이 필요하면 비밀이 없는 workspace 임시 파일,
정확히 승인한 disposable 외부 파일, 알려진 GitHub 대상 GET으로 제한하며 실제 PR/merge/delete로 시험하지 않습니다.
검증용 세션을 동시에 열 때는 기존 session/root를 재사용하지 말고 해당 OMX 버전의 독립 root 절차를 확인합니다.

지원되지 않거나 실제 reviewer를 확인하지 못하면 자동으로 full access로 바꾸지 않습니다. 사람에게 필요한 승인만
묻는 대안은 다음과 같습니다. 이 대안도 현재 설치 버전·managed 정책에서 허용되는지 확인합니다.

```bash
omx --direct --sandbox workspace-write --ask-for-approval on-request -c 'approvals_reviewer="user"'
```

기존 broad allow는 새 세션에도 남을 수 있습니다. 예를 들어 `gh api` 허용은 GET·이 저장소에 한정된 규칙이 아니므로,
필요하면 실제 로드되는 rule과 안전한 negative argv를 `codex execpolicy check`로 점검합니다. 이는 명령 실행이 아닌
정적 평가입니다. 기존 규칙 변경은 정확한 diff·백업·복구와 별도 권한을 먼저 정하며, 좁은 allow 추가만으로 해결됐다고
하지 않습니다. 기본 Auto-review policy는 유지합니다. `madmax`나 `never`는 위 대안과 동등한 보안 모드가 아닙니다.

승인된 구현·검증은 업무 재승인 없이 진행하지만 PR 생성 요청이 merge·배포까지 허용하는 것은 아닙니다.
GitHub 연결 실패는 [인증·접근 복구](../github/authentication-and-operator-access.md#failure-classification-before-authentication-recovery)에
따라 분류하며 token 만료나 재로그인을 곧바로 가정하지 않습니다.

## 공통 입력

좋은 요청은 다음 다섯 항목을 포함합니다.

- **목표**: 사용자가 얻어야 하는 결과
- **대상**: 화면, 도메인, 파일 또는 API 범위
- **근거**: 확인할 code, test, policy 또는 외부 공식 자료
- **완료 기준**: 기대 동작과 검증 명령
- **중단 조건**: 수정 금지 범위, credential·production·destructive 경계

## 새 작업

```text
AGENTS.md와 docs/development/agent-workflows/README.md를 먼저 읽어줘.
이 요청은 이전 세션을 이어받지 않는 새 작업이야.
목표: <원하는 결과>
대상: <도메인/파일/화면>
완료 기준: <테스트/동작/산출물>
제약: <수정 금지/외부 작업/검증 범위>
현재 branch와 working tree를 확인하고 관련 production code와 test를 근거로 구현·검증해줘.
```

## 중단된 작업 이어받기

```text
AGENTS.md를 읽고 <plan 경로 또는 task 이름> 작업을 이어서 진행해줘.
현재 요청, branch/HEAD, working tree, plan checkpoint를 순서대로 확인하고 commit·diff·test와 대조해줘.
완료 증거가 없는 항목은 완료로 가정하지 말고 현재 단계의 남은 작업만 구현·검증해줘.
session-continuity.md의 bounded 진단을 사용하되, 다른 작업의 pointer나 오래된 context를 실행 허가로 쓰지 마.
로컬 기억이 없으면 관련 code/contract와 PR/Issue에서 재구성하고, 중요한 결정이 없으면 질문이나 OQ로 남겨줘.
```

## 분석만 요청하기

```text
<대상>의 책임, 호출 흐름과 문제점을 분석해줘. 이번 요청에서는 파일을 수정하지 마.
사실은 file:line 또는 공식 URL로, 추론은 별도로 표시하고 권장안·대안·위험·confidence를 설명해줘.
```

## 구조 개선 계획 요청하기

```text
<대상>의 개선 지점을 현재 code/test/policy와 공식 근거로 분석하고 구현 계획을 작성해줘.
필요한 workflow를 자동 선택하고 Decision/OQ, dependency 순서, red test, acceptance, verification,
현재 결정할 수 없는 release 항목의 handoff를 포함해줘.
```

Architecture·feature·refactor 계획을 요청하면 agent는 [Plan authoring](./plan-authoring/README.md)의 core와
primary domain guide 하나를 먼저 선택하고, 보안/개인정보 또는 운영/배포 관점은 evidence가 요구할 때만
추가합니다. 계획 작성을 요청하지 않았다면 이 workflow를 이유로 plan artifact를 만들지 않습니다.

변경 범위가 여러 방향으로 갈린다면 agent는 임의로 고정하지 않고 질문, plan OQ 또는 future
release evidence handoff로 남깁니다.

## 승인된 계획 구현하기

```text
<plan>의 <단계>를 구현해줘.
선행 증거와 working tree를 확인하고, fresh dev에서 bounded branch를 생성한 뒤 작은 diff로 수정해줘.
targeted test와 필요한 정적 검증을 실행해줘.
변경 파일, 핵심 결정, 검증 결과와 남은 blocker를 보고해줘.
```

구현 branch와 PR 단위는 [Branch and PR strategy](../github/branch-and-pr-strategy.md)를 따릅니다. Agent가 이미 local
`dev`에서 task-owned uncommitted 파일을 발견하면 reset하지 않고 먼저 bounded branch를 생성합니다.

## 기술 동료처럼 협업하기

사람은 목표와 중요한 제품·비용·위험을 결정하고, Lead는 승인 범위의 기술 판단·구현·검증을 진행합니다.
별도 skill이나 팀 인원을 지정할 필요는 없습니다. [Owner–Lead collaboration](./owner-lead-collaboration.md)의 구조와 경계를
기본으로 따르며, 필요하면 아래처럼 조사 권한과 선택할 범위를 강조할 수 있습니다.

```text
<문제>를 먼저 조사해줘. 내가 제시한 <기술>은 확정 요구사항이 아니야.
유지안을 포함해 실제로 가능한 대안과 권장안·반론을 설명해줘. 이번에는 분석만 하고 구현하지 마.
```

```text
<승인된 범위>를 구현해줘. 명확한 기술 세부사항은 진행하고 중요한 제품·비용·위험 선택만 근거와 함께 알려줘.
Specialist가 유용하면 독립적인 범위만 맡기고, 막힌 작업이나 상충 결과는 Lead가 정리해서 보고해줘.
이미 승인한 방향을 다시 묻기보다 새 근거로 달라진 점을 설명해줘.
```

Agent가 필요한 선택을 물으면 해당 선택과 제약만 답하면 됩니다. 메시지마다 허락하거나 모든 기술 수단을 고를 필요는
없으며, 답하지 않은 중요한 선택을 Agent가 승인으로 간주하지도 않습니다.

## 디자인 동료처럼 작업하기

[Visual design workflow](./visual-design/README.md)는 특정 skill·Figma·디자이너 직군 지정을 요구하지 않습니다.
내용과 동작을 보존하면서 외형을 바꿀 수 있으며, 분석·계획·로컬 후보·제품 구현 중 허용한 산출물은 구분합니다.

**분석만:**

```text
<화면>의 시각적 위계와 읽기 어려운 부분을 분석해줘. 관찰과 취향·사용성 가설을 구분해줘.
이번에는 파일 수정·prototype 생성·Figma 연결 없이 대안만 설명해줘.
```

**새 방향의 로컬 후보:**

```text
<화면>의 정보·문구·동작은 유지하고, 배치·타이포는 다른 두 후보로 제안해줘.
artifacts/local/<작업명>/ 안의 로컬 prototype 생성과 검증은 허용하지만 제품 코드·Figma는 수정하지 마.
레퍼런스가 있으면 <타이포/목록 등 선택한 aspect>만 참고하고 그 사이트의 문구·지표는 가져오지 마.
실제 화면과 비평·수정 전후의 차이를 보여줘. 내가 선택하기 전에는 디자인 승인으로 처리하지 마.
```

**구현 계획만:**

```text
<화면>의 새 UI 방향을 검토하고 구현 계획을 작성해줘. 보존할 의미·동작과 탐색할 스타일을 구분해줘.
기능·접근성 검증과 시각적 선호의 완료 기준을 나눠줘. 이번에는 prototype이나 제품을 구현하지 마.
```

**선택한 방향 구현:**

```text
내가 선택한 <후보/revision>을 <대상 component>에 구현해줘. 정보·hook/API 동작은 유지해줘.
명확한 기술 세부사항은 진행하고, 승인 방향이나 제품·비용·위험을 바꾸는 선택만 나와 협의해줘.
```

User Web과 다른 Backoffice 방향을 원하면 대상 사용자·업무와 상속하지 않을 스타일을 알려주면 됩니다. 기존 스타일을
버리는 것도 새 스타일을 강제하는 것도 자동 결정은 아닙니다. 반대로 “이 카드의 잘못된 padding만 수정해줘” 같은
작은 기지 결함에는 디자인 후보·specialist·Figma를 강제하지 않고 직접 수정·검증하는 경로를 씁니다.

## 결과 읽기

### 독립 QA 요청

```text
<변경/PR>을 docs/development/agent-workflows/qa.md 기준으로 검증해줘.
base/head와 dirty 변경을 고정하고, 현재 requirement/policy/public contract에서 acceptance를 도출해줘.
의미 있는 위험이 있으면 구현 대화를 상속하지 않는 독립 reviewer에 bounded packet을 전달해줘.
역할 이름만 바꾼 self-review를 독립 검증으로 기록하지 마. Read-only 검토와 write-producing test runner를 분리해줘.
직접 처리해도 충분한 변경은 이유와 targeted checks를 남기고, 필수 증거가 없으면 PASS 대신 gap을 설명해줘.
```

### 사용자 이익이 불확실한 변경 요청

```text
<화면/기능>의 <문제 가설>을 검토해줘. 현재 관찰 근거: <근거 또는 아직 없음>.
development-lifecycle.md에 따라 작은 usable change와 verification, 적절한 관찰 방법을 나눠 제안해줘.
내가 방향을 결정할 수 있게 keep/change/stop 기준과 미확정 질문을 설명해줘.
이번 요청에서는 구현·analytics 설치·사용자 조사·외부 publication을 하지 마.
```

[Lifecycle 지도](./development-lifecycle.md)에서 intent, 현재 acceptance, 다음 evidence owner를 확인할 수 있습니다.
오탈자 같은 작은 변경에도 새 세션·실험·Issue를 반드시 만드는 것은 아닙니다.

완료 근거는 agent의 역할명이나 “완료했습니다”라는 문장이 아니라 실제 변경 파일, git 상태, 실행한 테스트와 그
결과입니다. production credential, 외부 배포 또는 파괴적 작업이 필요하면 agent가 실행 전에 필요한 권한과 선택을
명시해야 합니다.
