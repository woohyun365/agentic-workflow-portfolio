# 트러블슈팅: Subagent 완료 후 thread limit reached

**상태**: Current
**마지막 검증 환경**: Codex native collaboration surface; 지원 기능은 current-turn schema로 재확인
**현재 owner**: [Parent-owned subagent lifecycle](../../agent-workflows/subagent-lifecycle.md)

## 증상

새 child 생성 또는 기존 child follow-up에서 다음 오류가 발생합니다. 완료된 child가 목록에 보이는데도 나타날 수 있습니다.

```text
agent thread limit reached
```

이 오류와 OpenAI 사용량/주간 한도, role-routing/permission 거절은 다른 문제입니다. 원문 operation과 응답부터 확인합니다.

## 원인

작업 결과·runtime residency·저장 기록은 다른 상태입니다. 설치 version의 cap 단위와 현재 host의 산정 계약은
[tool family와 current schema](../../agent-workflows/subagent-lifecycle.md#capability-확인과-tool-family)에서 확인합니다.
Historical/completed 표시만으로 현재 점유 슬롯·mailbox 상태·특정 오류 원인을 단정할 수는 없습니다. 조건부 eviction이
있는 구현에서도 pending turn/message 등의 조건이 남을 수 있으며, roster만 보고 eviction bug라고 결론 내리지 않습니다.

현재 repository의 6 설정과 advisory hard cap을 늘려서 해결하지 않습니다. 공식 기본값과 모든 환경의 절대 한도가
6이라는 뜻도 아닙니다. 실행 중 writer, runtime residency, 누적 저장 대화, 실제 도구 지원을 분리해 확인합니다. V2의 close 부재는 정상이며
완료 child의 자동 eviction 계약과 특정 오류 원인 조사는 별개입니다. `/subagents` 누적 목록 수를 resident 슬롯 수로 세지 않습니다.

## 해결

[완료 시 절차와 Capacity error 복구](../../agent-workflows/subagent-lifecycle.md)를 Parent가 실행합니다.

- 현재 schema에 status 조회와 close 기능이 **둘 다** 있으면: 결과를 회수한 현재 소유 terminal child만 재확인하여
  정확히 종료하고 반환 증거를 확인합니다. 필요 dispatch만 bounded 재시도하며 dummy spawn으로 용량을 시험하지 않습니다.
- V2 followup family이면: [V1/V2 lifecycle 분기](../../agent-workflows/subagent-lifecycle.md#v1v2-lifecycle-분기)의
  runtime-managed 계약과 실제 schema를 대조합니다. 지원 close를 찾거나 내부 eviction 입증을 기다리지 않고 결과/pending을
  회수한 뒤 적합한 같은 lane에 `followup_task`를 사용합니다. 실제 call 결과와 release 관측은 분리하며 한 번의 실패를
  전체 재사용 불가로 확대하지 않습니다. 최초 독립 QA는 여전히 fresh scoped context가 필요합니다.
- close도 적용 가능한 runtime-managed 계약도 확인되지 않으면: [capability별 판정](../../agent-workflows/subagent-lifecycle.md#capability별-완료-판정)의
  unknown을 남깁니다. interrupt, CLI archive, history 삭제는 cleanup 대용이 아니며 Parent의 안전한 로컬 작업은 계속합니다.
- 모든 child가 실행 중이거나 follow-up 예정이면: 필요한 작업 완료를 기다린 뒤 결과 회수·정리합니다. 슬롯을 만들려고
  무관한 작업을 중단하거나 다른 parent의 thread를 닫지 않습니다.
- 실패 follow-up 대상이 roster에 없으면: 이름만으로 존재·소유를 가정하지도 영구 재사용 불가로 단정하지도 않습니다.
  `not-observed`와 원문 오류를 남기고 [cold resume 경계](../../agent-workflows/subagent-lifecycle.md#cold-resume-경계)를 확인합니다.
  현재 조회되는 적합한 owned target을 우선하며 기존 원문의 실패를 다른 target의 실패로 전용하지 않습니다.

새 session에서 진행해야만 하는 경우에도 상한 우회로 조용히 launch하지 않습니다. 현재 작업의 evidence·미정리 target·
필수 review gap을 보존하고 지원되는 환경의 handoff로 구분합니다. 더 자세한 상태/retry 계약을 이 문서에 복제하지 않습니다.
Cap/quota 오류에 대한 root rollover 우회는 금지합니다. Tool 부재, 실행 실패, 버전이 확인된 source issue를 구별하며
이름을 바꾼 새 root나 반복 restart로 같은 한도를 시험하지 않습니다.

## 도구 미노출과 restart/resume

**지침 반영과 기능 노출은 별개입니다.** 이미 읽은 새 지침은 현재 작업에서 적용할 수 있지만 Markdown이나 TOML 변경만으로
host가 제공하지 않은 native tool이 생기지 않습니다. 특히 follow-up family에 close가 없다는 이유만으로 설정 결함이라고 하지 않습니다.

1. Parent가 현재 schema의 조회/후속 입력/중단/종료 지원과 실제 오류를 기록합니다. 설치된 `codex --version`은 로컬 binary
   정보이지 실행 중 app/remote host의 버전 증거가 아닙니다. secret 없이 client 종류·선택 profile·workspace를 구분합니다.
2. 로컬 Codex에서는 지원되는 read-only config 확인으로 `agents.enabled`, `features.multi_agent` 및 managed 제한을 확인합니다.
   설정 파일 값은 effective host 설정의 증명이 아니며, 이미 enabled인데 close만 없다면 무조건 토글하지 않습니다.
   [공식 설정 참조](https://learn.chatgpt.com/docs/config-file/config-reference)
3. 문서가 stale한 경우, Codex의 AGENTS instruction chain은 실행 시작에 읽힙니다. 공식 문서는 재시작/새 실행으로
   지침을 다시 읽는 방법을 안내하지만 이를 native tool hot-reload 보장으로 확대하지 않습니다.
   [공식 AGENTS discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md#verify-your-setup)
4. client 재시작이 실제로 필요하고 승인된 경우 먼저 결과·미정리 child·pending 도구·branch/head·검증 gap을 보존합니다.
   로컬 interactive 기록이 있는 **정확한 부모 세션**은 `codex resume <SESSION_ID>`로 이어갈 수 있습니다. CLI 기록이 없는
   app/hosted 대화에 UUID를 임의 대응하지 않고 그 client의 지원 경로를 확인합니다. 잘못된 세션 선택을 피하려고 `--last`를
   기본 복구 명령으로 쓰지 않습니다. [공식 resume](https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-resume)
5. `resume_agent`의 child 재개와 `codex resume`의 부모 대화 재개는 다른 기능입니다. 재시작/resume은 `close_agent` 노출이나
   슬롯 반환을 보장하지 않습니다. 재개 후 현재 tool schema·scope·status를 재확인하고 필요한 정상 작업에만 적용합니다.
   같은 도구 미노출이면 반복 restart, history 삭제, cap 증액 대신 capability gap과 지원 host 필요성을 보고합니다.

일반 repository 작업 요청으로 client 업데이트·전역 설정 변경·자동 종료/재시작을 하지 않습니다.
지원 환경 변경은 별도 권한과 정확한 handoff 범위가 필요하며, [Session continuity](../../agent-workflows/session-continuity.md)를 따릅니다.

## 선택적 /agents 운영과 정상 exit/resume

한 owner 작업은 **single-root가 기본**입니다. `/agents`는 지원 CLI의 root session 조회·전환용 operator UI,
`/subagents`는 현재 root 안의 child 작업을 보는 UI로 구분합니다. 이는 delegation·capacity 복구의 필수 단계가 아닙니다.
Shared background server가 없다는 UI 안내는 child 도구 전체가 없다는 뜻이 아닙니다. 서버를 자동으로 시작하지 않습니다.

1. **현재 command/version 확인**: 로컬 `codex --version`·지원 help/menu와 실제 client의 명령을 대조합니다.
   [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)의 `/agent`·`/subagents` 안내와
   [rust-v0.155.1 slash source](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/tui/src/slash_command.rs#L75-L132)의 `/agents`·`/subagents`는 표면이 다를 수 있습니다.
   문서의 유사 이름을 현재 명령 alias로 만들지 않습니다. 도구 노출 변경을 얻으려고 무조건 upgrade·flag 변경하지 않습니다.
2. **정확한 부모 세션 확인**: 현재 parent ID, branch/HEAD, working tree, embedded/shared/remote 연결과 소유 runtime을
   확인합니다. 다른 root를 선택하거나 오래된 UUID를 임의 대응하지 않습니다. 여러 독립 root가 실제 필요할 때만 각자의
   worktree·branch·write owner·DB/port/test 자원·통합 책임을 먼저 정합니다. Shared UI는 파일 lock이나 자동 merge가 아닙니다.
3. **pending과 결과 회수**: 현재 소유 child의 결과·도구/process·mailbox와 미완료 writer를 확인하고 짧은 checkpoint를
   남깁니다. 미확인은 미확인으로 보존합니다. 일반 exit가 pending 외부 명령까지 취소한다고 가정하지 않으며 필요한 중단은
   정확한 scope/권한/지원 기능으로만 수행합니다. 작업 진행을 그대로 맡길 때는 계속 실행하는 owner와 결과 회수 경로를 명시합니다.
4. **정상 exit/resume**: 재시작이 필요하고 승인된 경우 현재 client의 정상 exit 경로를 사용하고, 로컬 저장 기록이 확인된
   정확한 parent만 `codex resume <SESSION_ID>`로 재개합니다. 불명확한 `--last`를 기본으로 쓰지 않습니다.
   Client exit와 root unload/stop·daemon 종료는 동일한 사건이 아닙니다. 연결 모드와 소유권을 확인하지 않은 daemon stop은 하지 않습니다.
   `archive`와 `delete`는 슬롯 회수 수단이 아닙니다. 전자는 저장 목록 관리, 후자는 영구 삭제이며 현재 명령은 descendant
   기록까지 영향을 줄 수 있습니다. 이 절차에서 자동 archive/delete나 타 session 정리를 하지 않습니다.
5. **재개 후 재확인**: 현재 요청·branch/HEAD/tree, schema·role·권한, 조회 가능한 child identity·상태·pending을 다시
   확인합니다. 과거 child 자동 승계·즉시 resident 복원·close 노출·슬롯 반환을 보장하지 않습니다. 필요한 same-scope 작업만
   지원 경로로 재개하고 미조회는 not-observed로 남깁니다. 반복 resume으로 cap/권한 gap을 우회하지 않습니다.

[해당 tag의 shared daemon](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/app-server-daemon/README.md)은 client별 환경 격리를 제공하지 않습니다.
따라서 shared 연결만으로 env/credential/profile/cwd가 분리됐다고 가정하지 않습니다. 새 server/startup service·network 노출·
전역 설정·실제 daemon stop은 별도 필요성과 정확한 소유·자원·권한·shutdown 범위가 확인될 때만 다룹니다. 위 절차를 읽는 것이
그 실행 승인이나 독립 worktree 생성을 대신하지 않습니다.

## 검증

```bash
node --test scripts/ci/codex-subagent-lifecycle-contract.test.mjs scripts/ci/codex-orchestration-policy.test.mjs
pnpm test:repo-policy
```

정적 문서/정책 테스트는 실제 thread 종료나 슬롯 반환을 증명하지 않습니다. 실제 검증은 다음을 별도로 기록합니다.

1. 완료 결과 보존 → exact target/status/pending → capability별 cleanup 판정 → 해당하는 경우만 지원 close 응답 → 별도 resource 관측.
2. 실제 필요한 다음 dispatch의 성공/실패(과거 특정 thread의 반환 여부와 구분).
3. 기능 미지원·정리 실패·보존 대상의 reason/revisit 및 cap/config 불변.

결과 회수 완료와 explicit cleanup 의무 및 release 상태를 각각 기록합니다. 검증된 no-close의 `not-required`는 native
release 성공이 아니며 unknown/실패도 “모두 정리됨”으로 기록하지 않습니다. 개별 상태/결과는 task evidence이지 저장소의
영구 runtime 사실이 아닙니다.

## 참고

- [OpenAI Subagents: thread orchestration and limits](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Orchestration recovery ceiling](../../agent-workflows/request-intake/orchestration-recovery.md#recovery-ceiling)
- [Independent review disposition](../../agent-workflows/qa.md#independent-review-disposition)
