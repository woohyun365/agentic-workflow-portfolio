import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildTaskEnvelope } from '../common/intake-policy.mjs';
import { discoverContextPack } from '../common/domain-guide-registry.mjs';
import { assessPlanReadiness } from '../common/plan-readiness-policy.mjs';
import { resolveWorkflowEntry } from '../common/workflow-entry.mjs';
import {
  ADAPTER_CONTRACT_SCHEMA,
  validateAdapterDescriptor,
  validateBoundedLanes,
  validateFanIn,
  validateAdapterReview,
} from '../common/adapter-contract.mjs';
import { evaluateClaudeProfileEligibility, createClaudeSubagentBinding } from './model-policy.mjs';
import { runClaudePreflight } from './session-preflight.mjs';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed, label) {
  if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new TypeError(`${label}: unsupported fields or malformed object`);
}

// No provider transport is accepted here. Native reports remain caller-supplied data;
// even an eligible immutable model binding is not a dispatch or runtime permission.
function nativeAssessment(nativeRequest, envelope, adapterIdentity, nativeMode) {
  let profileAssessment = null,
    binding = null;
  if (nativeRequest !== undefined) {
    const selectionFields = [
      'profileId',
      'selectedBy',
      'selectionBasisRef',
      'task',
      'issuedAt',
      'expiresAt',
    ];
    const selection =
      record(nativeRequest) &&
      Object.keys(nativeRequest).every((key) => selectionFields.includes(key))
        ? {
            ...nativeRequest,
            envelope,
            sourceDigest: adapterIdentity?.sourceDigest,
            configDigest: adapterIdentity?.configDigest,
          }
        : {};
    profileAssessment = evaluateClaudeProfileEligibility(selection);
    if (profileAssessment.eligible) binding = createClaudeSubagentBinding(selection);
  }
  const eligible = Boolean(binding && nativeMode === 'interactive-auto');
  return {
    mode: nativeMode ?? 'unselected',
    status: eligible ? 'policy-ready' : 'not-ready',
    requestStatus:
      nativeRequest === undefined ? 'not-requested' : eligible ? 'eligible' : 'blocked',
    reason: eligible
      ? 'live-hook-and-result-checks-required'
      : 'strict-native-dispatch-not-qualified',
    runtimeSupport: 'unknown',
    reportedEvidenceAuthority: 'none',
    profileAssessment,
    binding,
    dispatchAuthorized: false,
    runtimeQualified: false,
  };
}

// Actual deterministic direct-task composition, not a universal host dispatcher.
// Caller-supplied snapshots/identity/QA are validated structurally, not authenticated.
export function prepareClaudeWorkflow({
  request,
  mode,
  root = process.cwd(),
  repositoryEvidence = [],
  currentSnapshot,
  adapterIdentity,
  directAssignment,
  planPath,
  continuation,
  planReadiness,
  reviewDisposition,
  nativeRequest,
  nativeMode,
  reportedRuntimeEvidence,
  ...extra
} = {}) {
  fields(extra, [], 'workflow');
  if (nativeMode !== undefined && nativeMode !== 'interactive-auto')
    throw new TypeError('unsupported native mode');
  const envelope = buildTaskEnvelope({ request });
  // A sanitized display summary can truncate or redact distinct requests to the same text.
  // Bind the full input independently without storing its plaintext in portable outputs.
  const requestDigest = `sha256:${createHash('sha256').update(request).digest('hex')}`;
  const contextPack = discoverContextPack({ envelope, repositoryEvidence });
  const route = resolveWorkflowEntry({ envelope, contextPack, host: 'claude-code', mode });
  const preflight = runClaudePreflight({ root, mode, planPath, continuation });
  if (planReadiness !== undefined && envelope.intent !== 'plan')
    throw new TypeError('readiness requires plan intent');
  if (directAssignment !== undefined)
    fields(
      directAssignment,
      ['owner', 'dispatchId', 'acceptance', 'writeOwnership'],
      'direct assignment',
    );
  if (reviewDisposition !== undefined) {
    fields(reviewDisposition, ['required', 'reason'], 'review disposition');
    if (
      typeof reviewDisposition.required !== 'boolean' ||
      typeof reviewDisposition.reason !== 'string' ||
      !reviewDisposition.reason.trim()
    )
      throw new TypeError('review disposition requires explicit required and reason');
  }
  const adapter =
    adapterIdentity === undefined
      ? null
      : {
          schemaVersion: ADAPTER_CONTRACT_SCHEMA,
          hostId: 'claude-code',
          entry: 'scripts/agents/claude/workflow-entry.mjs',
          identity: adapterIdentity,
          capabilities: {
            direct: 'supported',
            'native-child': nativeMode === 'interactive-auto' ? 'unknown' : 'unsupported',
            'model-observation': 'unknown',
            'permission-observation': 'unknown',
          },
        };
  const adapterValidation = adapter ? validateAdapterDescriptor(adapter) : null;
  const lanes =
    directAssignment && currentSnapshot
      ? [
          {
            id: `${envelope.requestId}-${requestDigest.slice(7)}`,
            dispatchId: directAssignment.dispatchId,
            owner: directAssignment.owner,
            objective: envelope.requestSummary,
            acceptance: directAssignment.acceptance,
            dependencies: [],
            writeOwnership: directAssignment.writeOwnership,
            sourceSnapshot: currentSnapshot,
          },
        ]
      : [];
  const laneValidation = lanes.length
    ? validateBoundedLanes({ envelope, contextPack, lanes, currentSnapshot })
    : null;
  if (laneValidation && !laneValidation.valid)
    throw new TypeError(laneValidation.errors.join('; '));
  const native = nativeAssessment(nativeRequest, envelope, adapterIdentity, nativeMode);
  // Reports do not change this gate; no alternate CLI or provider path is selected.
  void reportedRuntimeEvidence;
  const gaps = [
    ...preflight.diagnostics,
    ...(preflight.continuation?.decision === 'needs-review' ? preflight.continuation.reasons : []),
    ...(!lanes.length ? ['current-snapshot-and-explicit-assignment-required'] : []),
    ...(currentSnapshot && currentSnapshot.headSHA !== preflight.baseline.head
      ? ['current-source-head-mismatch']
      : []),
    ...(currentSnapshot &&
    preflight.baseline.diffHash &&
    currentSnapshot.dirtyDiffDigest !==
      (preflight.baseline.clean ? null : `sha256:${preflight.baseline.diffHash}`)
      ? ['current-source-diff-mismatch']
      : []),
    ...(currentSnapshot &&
    !isDeepStrictEqual(
      currentSnapshot.untrackedInputDigests,
      preflight.baseline.untrackedInputDigests,
    )
      ? ['current-untracked-input-mismatch']
      : []),
    ...(adapterValidation ? adapterValidation.errors : ['adapter-identity-required']),
    ...(reviewDisposition === undefined ? ['independent-review-disposition-required'] : []),
    ...(native.requestStatus === 'blocked' ? [native.reason] : []),
  ];
  return {
    schemaVersion: 1,
    host: 'claude-code',
    requestDigest,
    verificationClass: 'deterministic-static',
    dispatchAuthorized: false,
    runtimeQualified: false,
    envelope,
    contextPack,
    route,
    preflight,
    native,
    plan: preflight.plan,
    continuation: preflight.continuation,
    planReadiness: planReadiness === undefined ? null : assessPlanReadiness(planReadiness),
    currentSnapshot,
    adapterIdentity,
    adapterValidation,
    lanes,
    laneValidation,
    gaps,
    reviewDisposition: reviewDisposition ?? null,
    requiresIndependentReview: reviewDisposition?.required === true,
    liveChecks: [
      'current-user-authority-and-host-permissions',
      'caller-source-config-and-snapshot-authenticity',
      'required-independent-qa-evidence',
    ],
  };
}

// Rebuild from request/source evidence; an edited prepared output cannot authorize work.
export function validateClaudeWorkflowResults(input, { results = [], review } = {}) {
  const workflow = prepareClaudeWorkflow(input);
  const fanIn = validateFanIn({
    envelope: workflow.envelope,
    contextPack: workflow.contextPack,
    lanes: workflow.lanes,
    currentSnapshot: workflow.currentSnapshot,
    hostId: 'claude-code',
    adapterIdentity: workflow.adapterIdentity,
    results,
  });
  const errors = [...workflow.gaps, ...fanIn.errors];
  let qa = null;
  if (review !== undefined) {
    if (review?.requestDigest !== workflow.requestDigest)
      errors.push('QA must bind full current request digest');
    if (
      review?.packet?.objective !== workflow.envelope.requestSummary ||
      !Array.isArray(review?.builderIds) ||
      workflow.lanes.some((lane) => !review.builderIds.includes(lane.owner))
    )
      errors.push('QA must bind current objective and assigned builders');
    const { requestDigest: _reportedDigest, ...commonReview } = review ?? {};
    qa = validateAdapterReview({ ...commonReview, currentSnapshot: workflow.currentSnapshot });
    errors.push(...qa.errors);
    const coverage = review?.result?.acceptanceCoverage;
    if (
      !Array.isArray(coverage) ||
      workflow.lanes.some((lane) =>
        lane.acceptance.some(
          (criterion) =>
            !coverage.some((item) => item?.criterion === criterion && item.gap === null),
        ),
      )
    )
      errors.push('QA must cover every current lane acceptance criterion');
    const readPaths = review?.packet?.boundaries?.allowedReadPaths;
    if (
      !Array.isArray(readPaths) ||
      workflow.lanes
        .flatMap((lane) => lane.writeOwnership)
        .some(
          (path) =>
            !readPaths.some(
              (scope) =>
                typeof scope === 'string' && (path === scope || path.startsWith(`${scope}/`)),
            ),
        )
    )
      errors.push('QA read scope must cover current assigned scope');
    if (review?.result?.status !== 'complete' || review?.result?.verdict !== 'PASS')
      errors.push('QA exchange does not report complete PASS');
  } else if (workflow.requiresIndependentReview) errors.push('independent QA exchange required');
  return {
    valid: errors.length === 0,
    errors,
    fanIn,
    qa,
    verificationClass: 'static-contract',
    dispatchAuthorized: false,
    runtimeQualified: false,
    liveChecks: [...workflow.liveChecks, 'parent-reproduces-findings-and-verifies-actual-changes'],
  };
}

function main(args) {
  const options = {};
  let separatorSeen = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--json') continue;
    if (key === '--' && !separatorSeen) {
      separatorSeen = true;
      continue;
    }
    if (key === '--native' && !Object.hasOwn(options, key)) {
      options[key] = true;
      continue;
    }
    if (
      !['--request', '--mode', '--plan', '--continuation'].includes(key) ||
      Object.hasOwn(options, key) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new TypeError(
        'expected --request TEXT --mode fresh|resume [--plan PATH] [--continuation JSON] [--native] [--json]',
      );
    options[key] = args[++i];
  }
  if (!options['--request']) throw new TypeError('request required');
  if (options['--continuation']?.length > 4096)
    throw new TypeError('continuation JSON exceeds 4096 characters');
  const workflow = prepareClaudeWorkflow({
    request: options['--request'],
    mode: options['--mode'],
    planPath: options['--plan'],
    continuation:
      options['--continuation'] === undefined ? undefined : JSON.parse(options['--continuation']),
    ...(options['--native'] ? { nativeRequest: {} } : {}),
  });
  process.stdout.write(JSON.stringify(workflow, null, 2) + '\n');
  if (workflow.native.requestStatus === 'blocked') process.exitCode = 2;
  else if (
    workflow.preflight.diagnostics.length ||
    workflow.continuation?.decision === 'needs-review'
  )
    process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
