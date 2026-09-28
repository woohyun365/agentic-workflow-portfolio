# Claude Code project adapter

공통 책임은 [실행 계약](../agent-execution-contract.md), [orchestration](../orchestration.md),
[QA](../qa.md), [위임 계약](../request-intake/delegation.md)이 소유합니다. 이 문서는 Claude의 실행 접점만
연결하며 Codex의 모델·effort·상한·runtime 규칙을 복사하지 않습니다.

## Cross-host direct CLI reviewer (static boundary)

[Claude-target bridge](../../../../scripts/agents/claude/review-bridge.mjs)는 아래 native child와 다른 transport입니다.
현재 command descriptor는 `enabled:false`이며 고정 fake CLI만 검증합니다. Lead가 별도 승인한 local subscription
CLI를 실행하는 구조와 native Agent 호출을 혼동하지 않습니다. `--restricted`, `--agent`, role 파일 존재만으로
project loading·실제 도구/권한·구독 인증·effective model을 입증하지 않습니다. OMC advisor도 프로젝트 reviewer의
대체 증거가 아닙니다. [교차 인계 계약](./cross-model-handoff.md#direct-cli-review-bridge-static-preparation-only)을
따르며 native 차단을 다른 CLI나 API-key SDK로 우회하지 않습니다.

## Loading and scope

`CLAUDE.md`는 `@AGENTS.md`를 import하고 이 adapter로 연결합니다. 현재 요청에 필요한 guide만 읽습니다.
공통 instructions를 네 role에 복제하거나 전체 docs를 startup context에 넣지 않습니다.

```sh
pnpm claude:preflight -- --mode fresh
pnpm claude:workflow -- --mode fresh --request '변경 내용을 설명해줘.'
pnpm claude:preflight -- --mode resume --plan .plans/example-plan.md
pnpm claude:workflow -- --mode resume --plan .plans/example-plan.md --request '이 계획을 분석해줘.'
```

`claude/session-preflight.mjs`는 raw Git 상태와 명시적으로 선택한 공통 `.plans` reader를 소비합니다. Fresh는 계획
목록·memory·Claude Home 설정·OMC state를 직접 탐색하지 않습니다. 오류/unknown을 clean으로 바꾸지 않습니다. 미추적 일반 파일은 내용 digest로 결합하며(파일당8MiB/총32MiB),
ignored 입력은 Git fingerprint 밖입니다. Native task가 명시한 ignored 파일은 별도 inventory로 결합하지만 ignored 디렉터리 전체를 자동 조사하지 않습니다. Codex 전용 `codex:preflight`를 대신 호출하지 않습니다.
현재 설정·loaded roles·실제 permissions는 별도 관측이 필요하고 Git hash가 이를 인증하지 않습니다.
Git filter의 설정 key만 bounded 조회해 clean/process·fsmonitor를 해당 명령에서 비활성화합니다. Submodule gitlink는
미점검 nested 설정을 실행하지 않도록 worktree 조회 전에 차단합니다. Snapshot은 비원자적 local 진단이며
`claude-git-baseline/v3`의 length-framed raw status/index stage records/HEAD binary diff/미추적 파일 digest를 SHA-256으로 결합합니다.
Dirty `currentSnapshot.dirtyDiffDigest`는 `sha256:`을 붙인 실제 fingerprint와 일치해야 합니다.

`claude/workflow-entry.mjs`의 `prepareClaudeWorkflow`는 공통 intake/context/문서 경로·명시 direct assignment·계획
진단을 연결합니다. `validateClaudeWorkflowResults`는 같은 원본 입력에서 계약을 다시 계산하고 공통 lane/result/fan-in
및 독립 QA packet을 검사합니다. 여섯 intent와 fresh/resume는 별도 축이며 Analyze·Plan을 제품 수정 권한으로 바꾸지
않습니다. CLI는 진단용이고 API의 source/assignment/QA 입력을 자동 발명하지 않습니다. 정적 `valid`는 실제 작업·검증·
권한 완료가 아닙니다.
표시용 objective는 공통 sanitized summary를 재사용하고 원문을 출력하지 않습니다. 전체 요청의 `requestDigest`를 별도로
계산해 lane identity와 QA wrapper에 연결합니다. QA 입력의 `requestDigest`도 현재 값과 일치해야 하므로 요약 뒤의
요구 변경이나 redaction으로 서로 다른 요청이 같은 요약이 되어도 결과를 재사용하지 않습니다. Digest는 인증·암호화나
비밀의 안전한 저장을 보장하지 않습니다.

Native 실행은 일반 interactive 세션과 아래 검증 전용 headless caller를 구분합니다. `claude:workflow --native`는
완전한 task 입력 없이 상태만 진단하는 명령이므로 실행하지 않습니다. JS validator의 `dispatchAuthorized:false`는
host 권한을 발급하지 않는다는 뜻이며 `runtimeQualified:false`도 해당 실행의 전체 검증을 대신하지 않습니다. 모든 정상 native 사용을 영구 금지한다는 뜻이 아닙니다.

## 일반 interactive auto 세션

기본 실행은 `claude --permission-mode auto`입니다. [시작과 승인 안내](../getting-started.md#claude-code-실행과-승인)를
따르고 실제 UI에서 auto 적용을 확인합니다. Home·project 설정과 owner가 사용 중인 OMC를 그대로 로드합니다.
`--safe-mode`, `--restricted`, project-only settings, 빈 MCP, 강제 tool 축소로 운영 환경을 대체하지 않습니다.
새 세션의 project `.claude/settings.json`은 hook과 네 Repo 역할의 `permissions.ask`만 추가하며 permission mode/allow/deny·plugin
설정을 덮어쓰지 않습니다. 실행 중인 세션에서 편집한 권한 규칙은 적용되지 않았으므로(CLI 2.1.283 실측) 새 세션에서 확인합니다.

`scripts/agents/claude/native-session.mjs`는 별도 Claude 프로세스를 만드는 launcher가 아니라 현재 세션의
SessionStart → task 등록 → native Agent PreToolUse → PermissionRequest grant → PostToolUse/Failure → SubagentStop·완료 알림 →
공통 QA 연결입니다.

1. SessionStart의 `session_id`를 사용합니다. cwd·최근 artifact에서 세션을 추측하지 않습니다.
2. Lead가 현재 요청·source·역할·acceptance·read/write 범위·QA 필요 여부와 아래 task profile을 명시합니다.
3. `pnpm claude:native register --input <JSON file>`로 task를 등록합니다. 입력은 `workflowInput`, `sessionId`,
   `prompt`, `expectedResolvedModel`입니다. `workflowInput`은 `prepareClaudeWorkflow`의 입력이며
   `nativeRequest`에 profile·선택 근거·task facts·issuedAt/expiresAt, `directAssignment`에 owner/dispatchId/
   acceptance/writeOwnership, `reviewDisposition`에 required/reason을 둡니다. currentSnapshot 생략 시 현재 Git을
   읽고, 제공하면 현재 source와 대조합니다. 임의 모델·역할 pin 대신 기존 model-policy를 재사용합니다. 독립 reviewer는
   아래의 `independentReview`를 추가하며 일반 task의 QA disposition을 임의로 끄지 않습니다.
4. 반환한 `invocation` 객체 그대로 **현재 세션의 Agent 도구**를 호출합니다. model 누락·임의 변경·미지원 인자·
   prompt 변경·다른 session·만료·재사용·source drift는 정상 PreToolUse가 거부합니다. 이 등록은 업무/host 승인이나
   악성 로컬 프로세스에 대한 인증 수단이 아닙니다. task artifact는 `artifacts/local/claude-native/`가 소유합니다.
5. `repo_*` Agent 호출은 project ask 규칙에 매치되므로 auto에서도 자동 승인되지 않습니다. 정상 PreToolUse는 입력을 검사해
   attempt를 기록하고 결정을 반환하지 않습니다. 이어지는 PermissionRequest hook은 같은 session·입력의 attempt가 있을 때만
   한 번 allow하고 grant를 남기며, 그 외에는 deny합니다.
   Repo role 또는 Repo marker를 가진 호출만 적용하고, 기존 OMC/기타 역할의 모델 통제를 대신하지 않습니다.
   필수 Repo 작업을 OMC 역할로 바꿔 이 계약을 피하지 않습니다.
6. Auto의 Agent는 background로 시작될 수 있고 현재 schema에는 `run_in_background` 입력이 없습니다. PostToolUse의
   `async_launched`는 같은 session/tool/input의 child ID·요청 모델 관측만 저장하며 완료가 아닙니다. SubagentStop도
   다시 실행될 수 있으므로 종료 보장으로 취급하지 않습니다. 같은 child/tool의 부모 `task-notification completed`와
   Stop, 한정된 child transcript의 최초 prompt·실제 assistant 모델·handback/마지막 응답을 함께 대조합니다.
   transcript는 CLI 2.1.283 실측 schema이며 지연 flush는 complete에서 같은 Stop에 한해서 재검사합니다.
   Child transcript4MiB/parent8MiB 한도를 넘으면 gap이지 PASS가 아닙니다. 누락·다른 모델·재개에 따른 transcript
   변경을 거부하고 output은 semantic PASS로 자동 승격하지 않습니다. Bound child에 대한 SendMessage 재개는 새 등록
   없이 허용하지 않습니다. OMC의 다른 child messaging은 이 registry가 소유하지 않습니다.
7. `pnpm claude:native complete --task <taskId> --input <JSON file>`로 결과를 판정합니다. 입력은 공통 `results`,
   관측한 `responseDigest`, `acceptance` 배열의 criterion/passed/evidenceRef, 그리고 독립 QA가 필요한 builder의
   `reviewerTaskId` 또는 reviewer task 자신의 `reviewResult`입니다. 별도 `review` 객체로 대체하지 않습니다.
   Result의 snapshot은 completion.json의 finalSnapshot을 사용합니다. 같은 응답에 대한 acceptance와 독립 QA를
   실제로 수행해야 하며 boolean·receipt·JSON만으로 수행 사실을 인증하지 않습니다. Parent는 finding과 변경 범위를
   독립 확인합니다. 오류·거부·취소·collector 누락이면 완료를 보고하지 않고 원인과 다음 행동을 남깁니다.

### Same-host independent review

Claude native reviewer는 공통 QA packet의 `same-host-independent-review` 방향을 사용합니다. 등록 입력의 선택적
`independentReview`는 `subjectTaskId`, `reviewerId`, `builderIds`, `packet`을 포함합니다. Registry는 실제 subject task와
관측 완료를 읽어 full request digest, binding, response, final snapshot에 packet을 연결합니다. Packet objective는 subject
request summary와 같고, write owner는 builder에 포함되며, reviewer는 builder와 다른 read-only lane owner여야 합니다.
Packet read scope는 reviewer task 범위 안에 있고 subject의 write ownership과 실제 변경 경로를 포함해야 합니다. Subject의
모든 acceptance criterion은 reviewer completion에서 result coverage로 검사합니다. Reviewer는 packet `authority.runnerOwner`가
될 수 없습니다.
검증된 packet은 reviewer의 bound prompt에 포함되므로 caller가 실행 전에 바꾸거나 다른 subject에 재사용할 수 없습니다.

Reviewer는 같은 session에 있을 필요는 없지만 fresh session에서도 동일한 current source를 사용해 명시적으로 새 task를
등록해야 합니다. 이 조건을 충족한 terminal reviewer task만 자기 `reviewDisposition.required:false`를 사용할 수 있습니다.
이는 reviewer를 다시 review하는 무한 재귀를 막기 위한 종료 규칙이며 builder의 필수 QA를 해제하지 않습니다.

Reviewer complete 입력은 `reviewResult`를 사용합니다. 값은 실제 관측 응답에서 parse한 JSON과 구조적으로 같아야 합니다.
Native 관측 model의 일치를 별도로 확인한 뒤 공통 `validateAdapterReview`가 packet, current snapshot, 독립
reviewer/builder identity와 acceptance coverage를 검사합니다. `complete + PASS`와 `complete + FAIL`은 reviewer task의
terminal 결과가 될 수 있지만 FAIL은 builder PASS가 아닙니다. `partial`·`denied`·`timed-out`·`cancelled` 또는
`BLOCKED`는 reviewer completion이 아닙니다.

Read-only reviewer는 명령을 실행하지 않습니다. Packet `authority.runnerOwner`가 실행하고 evidence로 제공한 검증은 result의
`commandsActuallyRun`에 그 runner·exit·관측 결과·환경으로 기록하며 reviewer가 실행했다고 쓰지 않습니다. `notRun`은 누구도
수행하지 않은 필수 검증, `knownGaps`는 acceptance를 막는 미해결 gap이며, 공통 validator는 이 둘이나 coverage gap이 남은
PASS를 거부합니다. Parent는 필요한 runner 증거를 같은 source digest와 함께 packet에 먼저 제공하고, 실행되지 않은 검증을
PASS로 바꾸거나 reviewer에게 기대 결론을 전달하지 않습니다.

Builder complete 입력은 연결된 `reviewerTaskId`를 받습니다. Registry는 해당 reviewer의 실제 task·완료·result가 이
builder의 subject binding/full request/response/snapshot과 일치할 때만 공통 review wrapper를 파생합니다. Caller가 만든
별도 PASS 객체나 unrelated reviewer result로 대체하지 않습니다. Reviewer FAIL이면 Parent가 finding을 판정하고 builder는
PASS할 수 없습니다. 같은 subject를 실제로 dispatch한 다른 reviewer가 PASS가 아닌 receipt를 남겼거나, 완료 기록에 PASS가 아닌
결과를 전달했거나, 아직 정산되지 않았다면 다른 reviewer의 PASS를 연결해도 builder는 완료되지 않습니다. 읽을 수 없는 native task
기록도 완료를 막습니다. 이는 [QA](../qa.md)의 Parent adjudication보다 엄격한 adapter 규칙입니다. Parent가 finding을
false positive로 판정해도 native 경로에서는 새 builder task와 새 review로 해소합니다. 이 연결은 coordination과 completion evidence이며
host 인증이나 권한 grant가 아닙니다. Parent가 직접 작성한 diff처럼 native subject task가 없는 검토에는 이 terminal 규칙이
적용되지 않습니다.

Native writer는 repository당 하나의 active lease로 직렬화합니다. 확인된 완료/관측된 tool failure는 해당 task의
lease만 해제합니다. 비동기는 완료 알림 뒤 complete가 회수합니다. 세션 종료·취소·권한 거부로 Post 이벤트가 없으면 실제 child 종료를 먼저 확인한 뒤
`pnpm claude:native release --task <taskId> --ended`로 그 task만 해제합니다. Timeout/만료를 종료 증거로 추측하지
않습니다. Release는 작업 완료가 아니며 다른 writer의 lease를 삭제하지 않습니다.

### 운영 보장과 제한

- Auto의 목적은 일상 개발의 승인 병목 감소입니다. 읽기 전용은 reviewer/explorer의 역할 경계이지 전체 session의
  강제 모드가 아닙니다. Executor의 명시된 구현과 검증도 같은 workflow에서 다룹니다.
- 정적 entry의 `interactive-auto` eligibility와 실제 현재 session의 모델/권한 입증은 별개입니다. 전역
  `runtimeQualified:true`를 저장하거나 다른 session에 과거 PASS를 재사용하지 않습니다.
- 호출 전 차단은 ask 규칙과 두 hook이 함께 담당합니다. PreToolUse 장애(부재·crash·malformed·timeout)는 non-blocking이지만
  정상 PermissionRequest가 attempt 없는 호출을 거부합니다. PermissionRequest 장애 시에는 ask 규칙 때문에 auto classifier가
  아니라 **사람의 승인 prompt**로 넘어가고, prompt를 띄울 수 없는 세션에서는 거부됩니다. 이는 fail-closed가 아니라
  **fail-safe to human**입니다. 다른 설정 출처(Home·plugin)의 PermissionRequest hook은 병렬로 실행되어
  같은 prompt에 allow할 수 있으므로 `/hooks`로 `Agent`에 매치되는 hook이 Repo hook뿐인지 확인합니다(현재 OMC 5.5.0은 `Bash` matcher만 관측).
  그 경우에도 Repo grant가 없으면 완료는 거부됩니다. `repo_*` 권한 prompt가 보이면 Repo hook이 승인하지 않았다는 뜻이므로 승인하지 않습니다.
  사람이 승인해도 Repo grant가 없으면 완료 판정이 거부됩니다. 이를 위해 auto를 manual/bypass로 바꾸지 않습니다.
- FORCE 환경변수의 명시적 충돌은 hook에서 거부하지만 Home/managed/provider의 모든 모델 대체를 사전에 인증하는
  것은 아닙니다. 정상 환경을 scrub하지 않고 실행 후 모델을 확인합니다. 정상 설정 출처/role precedence와 충돌을
  관측하고 owner와 수정하며 Home/managed 설정을 자동으로 삭제·덮어쓰지 않습니다.
- Project hook/role/settings와 task source의 변경은 재등록이 필요합니다. Hook 장애 이후에도 prompt가 알아서
  준수했을 것이라 가정하지 않습니다. 새로운 설정·CLI 버전·역할·OMC 조합의 실제 지원은 해당 조합의 증거로 판단합니다.
- 지원되는 auto 부모 모델과 child task 모델은 다른 선택입니다. Haiku child 가용성을 이유로 auto 부모도 Haiku로
  바꾸지 않습니다. [permission modes](https://code.claude.com/docs/en/permission-modes),
  [hooks](https://code.claude.com/docs/en/hooks), [설정 우선순위](https://code.claude.com/docs/en/settings)를 따릅니다.

### 프로젝트 역할과 실제 권한

| Role             | 도구 선언                             | 책임                                                 |
| ---------------- | ------------------------------------- | ---------------------------------------------------- |
| `repo_explorer`   | Read, Grep, Glob                      | 한 repository 질문의 현재 source/owner/evidence 조사 |
| `repo_researcher` | Read, Grep, Glob, WebSearch, WebFetch | 이미 선택한 기술의 공식 근거 조사                    |
| `repo_executor`   | Read, Grep, Glob, Edit, Write, Bash   | 명시적으로 소유한 구현·가까운 검증                   |
| `repo_reviewer`   | Read, Grep, Glob                      | builder reasoning을 받지 않는 독립 source 검토       |

네 `.claude/agents/repo_*.md`에는 영구 model pin이 없습니다. 그렇다고 parent 자동 상속을 task별 승인된 모델 선택으로
간주하지 않습니다. Lead가 bounded responsibility·source·acceptance·read/write scope·단일 writer를 정합니다.
Child는 다른 child/외부 CLI로 재위임하지 않고 blocker를 Lead에 반환합니다. Reviewer의 테스트 제안은 실행 승인이 아니며
write-producing 테스트는 별도 runner가 소유합니다.

Role의 tools 선언은 실제로 해당 정의가 로드되고 host가 적용했을 때만 도구 제한입니다. 같은 이름의 managed/CLI/project/
user/plugin 정의와 parent permission mode를 확인합니다. Managed 역할 위치는 managed-settings directory 아래
`.claude/agents/`이며 파일명만으로 frontmatter `name` 충돌을 배제하지 않습니다. Parent의 `auto`·`acceptEdits`·
`bypassPermissions`는 child mode를 덮어쓸 수 있으므로 read-only 선언만으로 sandbox를 입증하지 않습니다.
[공식 subagents](https://code.claude.com/docs/en/sub-agents)의 현재 버전 규칙과 실제 session을 함께 확인합니다.

## Finite native-subagent model candidates

[Claude model policy](../../../../scripts/agents/claude/model-policy.mjs)는 공통 risk/complexity·task authority를 소비합니다.
Lead가 현재 facts를 근거로 선택하며 role 이름·토큰 잔량만으로 자동 결정하지 않습니다.

| Task profile         | 요청 family alias | 조건                                      |
| -------------------- | ----------------- | ----------------------------------------- |
| `bounded-extraction` | `haiku`           | 낮은 위험·고정 입력·단일 추출·명시 oracle |
| `bounded-standard`   | `sonnet`          | bounded read/build·scope·검증·독립 QA     |
| `complex-critical`   | `opus`            | 복잡/고위험 또는 독립 review              |

이는 finite 후보이지 가용성·동등 품질·routine admission 보장이 아닙니다. `selectedBy/approvedBy` 문자열과 caller가
공급한 runtime report는 인증된 host grant가 아닙니다. 현재 static descriptor는 `dispatchAllowed:false`, `applied:false`,
`runtimeQualification:not-run`입니다. Source/config/scope/expiry·writer 충돌·missing/child-chosen/free-form 모델·unknown
runtime·unapproved fallback은 거부합니다. Source가 바뀌면 이전 binding을 재사용하지 않습니다.

### 명시적 native qualification caller

`scripts/agents/claude/native-qualification.mjs`는 `prepareClaudeNativeQualification()`과
`runClaudeNativeQualification()`으로 현재 workflow의 profile/binding을 실제 Claude CLI 내부 native Agent 호출에
연결하는 **격리된 headless 검증 전용 API**입니다. 위 ordinary interactive auto 운영 경로와 별개이며 교차 CLI bridge를 대신하지
않습니다. API를 호출할 수 있다는 사실은 외부 전송·모델 비용·host 권한 승인이 아닙니다.

- `prepareClaudeWorkflow()`의 current task/source와 full requestDigest, adapter source, project role bytes,
  task snapshot, 명시 launch config, 만료와 run/session identity를 별도로 묶습니다. 임의 JSON으로 복원한 plan은 실행하지 않습니다.
- 현재 구현은 명시한 파일의 `Read`만 지원하는 read-only qualification입니다. 추가 tool, write scope, custom project
  settings가 있으면 거부합니다. Native 역할 정의의 도구 목록을 runtime에서 모두 허용했다는 뜻이 아닙니다.
- `--safe-mode`와 `--restricted`는 이 caller에 사용하지 않습니다. Project role discovery를 유지하며
  `--setting-sources project`, 제한된 tools, 빈 MCP, `manual` 및 `--permission-prompts none`을 사용합니다.
  이 검증에만 OMC plugin을 명시적으로 비활성화하며 Home 설정을 수정하지 않습니다. Collector는 startup hook과
  builtin 이외 plugin, 다른 cwd·permission mode를 거부합니다. 이는 이미 실행된 startup side effect를 되돌리는 sandbox가
  아니므로 승인된 disposable fixture만 사용하고 숨겨진 managed 설정을 인증했다고 주장하지 않습니다.
- 모든 native Agent/Read/Grep/Glob 호출에 `permissions.ask`를 적용하고 `PermissionRequest` hook이 정확한 session,
  source/config, role, model, prompt와 파일 범위를 확인합니다. Agent grant는 한 번만 발급합니다. Hook 허용 결과는
  일반 dispatcher 활성화나 영구 permission 변경이 아닙니다.
- Agent는 기본적으로 승인 질문이 없는 도구이므로 `dontAsk`와 불완전한 allowlist만으로 default-deny를 주장하지 않습니다.
  `Tool(param:value)`는 ask/deny용이며 model parameter allow 규칙으로 사용하지 않습니다.
- Read 성공과 실행 중인 process의 stream을 `native-run-evidence.mjs`로 검증한 결과는 common result/QA validator에도
  전달합니다. 구조 검사만으로 의미상 acceptance를 입증하지 않았으므로 common result는 `partial`과 명시적 QA gap을
  유지합니다. Native readiness와 독립 QA가 미충족이면 common assessment도 완료로 승격되지 않습니다.

Collector는 실제 CLI의 init, Agent tool use, task lifecycle, forwarded child messages, structured tool_use_result,
terminal result를 같은 session/task/tool에 연결합니다. Chunk별 동일 message ID는 허용하지만 UUID 중복·역순·누락,
foreign session, 실제 시작·완료 prompt 변경, 모델/도구 불일치, timeout/비정상 종료/source drift를 거부합니다. Import한 event JSON은 구조 검사 자료이지
실행 provenance나 host authority가 아니며, 실제 caller만 자신의 subprocess stream과 종료 상태를 소유합니다.

`--no-session-persistence`가 child transcript까지 없애는 것은 아닙니다. Fixture 정리와 별도로 실제 session/task에 속한
출력 symlink 및 transcript를 확인합니다. Event의 임의 경로를 따라 삭제하지 않고 승인된 정확한 경로만 정리하며,
Home settings·다른 session·공유 runtime root는 보존합니다.

### Native failure qualification

`scripts/agents/claude/native-qualification-probe.mjs`는 일반 caller를 고치지 않고 유한한 실패 조건을 시험하는
별도 검증 API입니다. 실제 Claude subprocess와 전송 payload, 호출 수·시간·정리 범위를 먼저 승인받아야 합니다.
Proxy/interceptor는 승인 우회 수단이 아니며 host가 실행을 거절하면 다른 경로로 재시도하지 않습니다.

- `good`, `ambient-override`: 정상 production callback의 모델·파일 범위·collector 기준점입니다.
- `wrong-model`, `missing-model`: 부모에게 제공하는 native 입력의 모델 값 또는 키만 변경하고, 원래 production
  callback이 실제로 거부하는지 확인합니다.
- `hook-missing`, `hook-crash`, `hook-malformed`, `hook-timeout`: callback 명령의 실패 조건만 변경합니다.
  정상 callback 본문이 실행됐다는 주장이 아니라 **그 callback을 사용할 수 없을 때 host가 어떻게 처리하는지**를
  시험합니다. Crash는 유효한 allow 출력을 먼저 내보내지 않습니다.
- 원래/변형 argv·prompt, source/context, 실제 CLI 경로·PID·종료, interceptor digest를 별도 기록하고 유한 변경
  이외의 차이는 거부합니다. 다른 설정을 사용한 실험을 원래 config digest의 실행이라고 보고하지 않습니다.
- Negative PASS에는 실제 Agent 시도, 정확한 hook/tool/session 연결, 명시 거부, child 시작·message·completion 부재,
  terminal child count 0, 정상 CLI 종료가 모두 필요합니다. 모델의 자발적 포기, 빈 로그, timeout으로 잘린 stream,
  collector invalid만으로 통과하지 않습니다. 구조 판정 API에 JSON을 넣는 것 역시 actual-run authority가 아닙니다.
- Ambient model/FORCE 환경변수 제거와 project settings/frontmatter 변경의 사전 거부는 관리형 정책·provider 모델
  대체의 통제 증거가 아닙니다. 이 headless 증거로 일반 interactive/managed 조합의 강한 사전 보장을 선언하지
  않습니다. 일반 auto는 위 healthy-hook 요청 검사와 결과 관측 계약을 따릅니다. `--settings`나 설정 출처 목록만으로 모든 경쟁 허용 hook의 부재를
  인증하지 않습니다. [설정 우선순위](https://code.claude.com/docs/en/settings)와
  [모델 정책](https://code.claude.com/docs/en/model-config)을 별도로 확인합니다.

### 요청·차단·관측의 세 경계

1. **요청 선택:** 명시 task profile/binding으로 어떤 모델을 요청했는지 결정합니다.
2. **호출 전 차단:** 실제 host가 잘못되거나 누락된 모델 요청을 막았는지 별도로 입증합니다.
3. **호출 후 관측:** 해석된 시작 모델·실행 중 변경·완료와 같은 run의 결과를 연결합니다.

일반 auto의 호출 전 차단은 Repo 역할 ask 규칙과 PermissionRequest grant가 담당합니다. PreToolUse command hook의 장애는
[공식적으로 non-blocking](https://code.claude.com/docs/en/hooks#exit-code-output)이므로 단독 gate가 아닙니다. Explicit ask 규칙은
[어떤 mode에서도 자동 승인되지 않고](https://code.claude.com/docs/en/permission-modes#actions-no-mode-auto-approves) PreToolUse `allow`로도
건너뛸 수 없으며, PermissionRequest hook만 그 prompt에 답할 수 있습니다. 두 hook이 모두 실패하면 결과는 차단이 아니라 사람 prompt입니다.
`Agent(model:…)` parameter 규칙은 생략된 model에 매치되지 않으므로 모델 검사는 hook이 소유합니다.
[Permission과 hooks](https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks),
[hook 실패 처리](https://code.claude.com/docs/en/hooks)를 확인합니다.

이 검증 caller는 [headless 승인 계약](https://code.claude.com/docs/en/headless#turn-off-permission-prompts-in-unattended-runs)의
`manual` + `--permission-prompts none`을 사용합니다. Matching ask에 대한 PermissionRequest의 유효한 allow가 없으면
비대화식 실행은 거부되도록 구성합니다. 이 조합의 유한 정상·오류 시험을 모든 interactive mode, 다른 hook 조합이나
Home/managed 정책의 일반 보장으로 확대하지 않습니다. PermissionRequest에는 `tool_use_id`가 없으므로 caller가 소유한
일회용 request grant와 실제 Agent 입력을 대조하며 존재하지 않는 hook 필드를 만들어 연결하지 않습니다.

공식 parameter rule의 `Agent(model:opus)`는 literal 입력 비교이며 model 누락은 그 값 규칙에 매치되지 않습니다.
이를 task별 정확한 하나의 모델·provider-effective identity 강제로 과장하지 않습니다. Native invocation → frontmatter →
env default → parent 우선순위 외에도 FORCE override·managed 허용 모델 대체가 있습니다. Managed exact allowlist 역시
허용 집합 제한과 개별 task 선택은 별개입니다. [Model 설정](https://code.claude.com/docs/en/model-config)과
[env 규칙](https://code.claude.com/docs/en/env-vars)을 현재 설치 버전에서 확인합니다.

### 결과와 observation 경계

CLI `stream-json`의 complete assistant/user message `parent_tool_use_id`와 hook의 `session_id`·`agent_id`·
`tool_use_id`는 같은 envelope가 아닙니다. Agent PostToolUse의 `resolvedModel`은 시작 또는 background 전환 시점 모델이고
`modelsUsed`는 변경 관측입니다. Parent modelUsage나 응답 문장을 child model 입증으로 사용하지 않습니다.
[CLI streaming](https://code.claude.com/docs/en/headless#follow-subagent-messages)과 실제 설치본의 machine record를 대조합니다.

같은 tool ID라도 다른 parent/session/run/source/config/binding의 record를 합치지 않습니다. Child session ID가 parent와
다를 수 있으므로 단순 ID 동일성도 올바른 관계 검사의 대체물이 아닙니다. 누락·중복·역순·취소·불명확 provenance는 gap으로
남깁니다. Headless entry의 구조 collector와 interactive PostToolUse 결과 판정은 서로 다른 event 계약입니다.
Headless init/terminal·단일 child·plugin 배제 전제를 interactive event에 적용하지 않습니다. 임의 JSON receipt를 actual host observation으로 취급하지 않습니다. [qualification matrix](../../../../scripts/ci/fixtures/claude-subagent-model-qualification-matrix.json)는 test scenario이지
현재 세션의 PASS 증거가 아닙니다.

## Plan continuity

공통 [session continuity](../session-continuity.md#active-plan-lifecycle)가 lifecycle을 소유합니다.

- 새 계획은 `.plans/<plan-id>-plan.md`에 하나의 canonical Plan ID로 생성합니다. Native Plan Mode 파일은 초안이며
  현재 요청·source와 비교해 명시적으로 채택합니다. runtime draft를 자동 이동·덮어쓰거나 이중 계획으로 동기화하지 않습니다.
- Resume는 위 명령의 명시 plan 경로와 현재 branch/HEAD/변경 상태를 확인합니다. 진단용 경로만 전달해서 실행 권한이나
  checkpoint 일치를 얻지는 않습니다. `--continuation`에 `expectedPlanId`와 `checkpointSnapshot`(branch/head/diffHash)의
  JSON을 명시하면 현재 Git 진단과 대조합니다. 입력은 4096자로 제한하며 미제공 snapshot을 발명하지 않습니다.
  Missing/moved/terminal/reference/duplicate/불완전 identity는 공통 reader 판정을
  따릅니다. Full corpus 경고와 identity completeness도 구별합니다.
- Codex에 인계할 때 같은 `.plans` path/ID와 snapshot, changed files, verification, blocker, 다음 행동 및 기존 writer
  해제를 전달합니다. Codex runtime state를 Claude에 복사하거나 Codex 명령을 Claude preflight로 사용하지 않습니다.
- 완료 AC와 통합 근거가 충족되면 `.plans/finished/YYYY/MM/<domain>/`, 취소/대체는 `.plans/cancelled/YYYY/MM/<domain>/`에
  이동하고 링크를 갱신합니다. 독립 미완료 supporting plan을 함께 완료하지 않습니다.
- OMC 사용은 owner 선택입니다. 같은 repository 계획을 소비하되 실제 OMC 초안 경로·session 소유권·resume/stop API는
  현재 runtime의 확인된 절차를 따릅니다. `.omc/plans`를 자동 canonical로 추측하거나 `.omx` 명령/state를 사용하지 않습니다.
  OMC 없이도 위 Git/계획 진단은 작동합니다. 특정 session resume/cleanup 지원은 별도 live 증거가 필요합니다.

## Project visual skills

Taste (`design-taste-frontend`)와 Redesign (`redesign-existing-projects`)은 **Codex-only**입니다. Claude에 이식·설치·호출하지
않으며 개인 Codex skill을 수정하지 않습니다. Claude UI 작업은 공통 VisualBrief/content/a11y/독립 검토 계약을 직접
따르고 대체 skill 설치를 요구하지 않습니다. [Visual skill 선택](../visual-design/design-task-orchestration.md#task-fit-skills)을
참고합니다.

## Bounded fresh-host qualification

`repository-prepared`와 `runtime-qualified`는 별개입니다. Source entry/정적 테스트가 실제 model/role/permission을
입증하지 않습니다. Native pilot은 별도 승인된(separately authorized) 범위·비용·호출 수·timeout·정리 조건을 먼저 고정하고
필요한 최소 payload만 전송합니다. 로그인 완료나 Phase 요청을 secret·무제한 호출·권한 확대 승인으로 해석하지 않습니다.

Disposable fixture에서 readonly 도구 부재·자발적 거부·host denial을 구별하고, executor의 허용 write/test·실패 보고·
독립 QA·취소/결과 회수도 따로 관측합니다. 실제 지원 없는 mode는 scoped NO-GO로 두며 prompt/advisory로 몰래 낮추거나
다른 모델로 fallback하지 않습니다. Source/config/host drift가 있으면 관련 qualification을 다시 수행합니다.
Home/managed 정책을 바꾸거나 bypass로 성공시키지 않습니다.
