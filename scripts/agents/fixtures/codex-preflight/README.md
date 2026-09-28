# Codex status 회귀 oracle

이 fixture는 production parser를 복제하지 않고 **실제 disposable Git index/worktree와 literal porcelain-v1 NUL bytes**로
독립 oracle을 만듭니다. 저장소 checkout에는 stage/commit하지 않으며 기존 disposable preflight helper를 재사용합니다.
실제 Codex preflight source를 그대로 복사하고 optional OMX read만 stub 처리합니다. Native/model/sandbox 증거가 아닙니다.

- Green: `node --test scripts/ci/codex-git-status.test.mjs`
- 계획 root·명시적 binding·OMX context: `node --test scripts/ci/codex-session-preflight.test.mjs`

첫 unstaged, staged-only, mixed, untracked, unstaged/staged delete, rename+edit, 일곱 unmerged shape와
공백·한글·quote·newline·tab·backslash·화살표 파일명을 검사합니다.
`stagedPaths`/`unstagedPaths`는 실제 현재 경로를 반환해야 하며 rename의 현재 경로는 destination입니다. NUL stream의
추가 source-path 필드를 또 다른 status record로 읽지 않아야 합니다. 별도 original-path 필드 추가 여부는 구현 owner 결정이며
이 fixture가 schema를 추가하지는 않습니다. scalar branch/SHA trim은 정상 동작으로 보존합니다.

모든 intended assertion은 일반 CI에서 실행됩니다. 결함의 깨진 출력 자체를 기대값으로 삼지 않습니다.
Source startup/Git oracle 실패는 동작 회귀와 구분합니다. 별도 과거 probe wrapper 없이 일반 CI가 intended behavior를 보호합니다.
