import { pathToFileURL } from 'node:url';
import { buildTaskEnvelope } from '../common/intake-policy.mjs';
import { discoverContextPack } from '../common/domain-guide-registry.mjs';
import { assessPlanReadiness } from '../common/plan-readiness-policy.mjs';
import { resolveWorkflowEntry } from '../common/workflow-entry.mjs';
import { readPlan, assessPlanContinuation } from '../common/plan-store.mjs';
import {
  validateBoundedLanes,
  validateFanIn,
  validateAdapterReview,
} from '../common/adapter-contract.mjs';
import { recommendDelegation } from './child-task-contract.mjs';
import { createDispatchRecommendation } from './orchestration-policy.mjs';

// Actual deterministic Codex composition, not a native scheduler or permission grant.
// A caller supplies current evidence; the Lead verifies its authenticity before host use.
export function prepareCodexWorkflow({
  request,
  mode,
  repositoryEvidence = [],
  laneCandidates = [],
  deliveryByLane = {},
  reportedRuntimeEvidence = null,
  modelUseByLane = {},
  concurrencyLimit,
  ownerDirectedChildLimit,
  currentSnapshot,
  adapterIdentity,
  assignments = {},
  directAssignment,
  root = process.cwd(),
  planPath,
  continuation,
  planReadiness,
  reviewDisposition,
} = {}) {
  const envelope = buildTaskEnvelope({ request });
  const contextPack = discoverContextPack({ envelope, repositoryEvidence });
  const route = resolveWorkflowEntry({ envelope, contextPack, host: 'codex', mode });
  if (planPath && mode !== 'resume') throw new TypeError('plan selection requires resume');
  if (planReadiness !== undefined && envelope.intent !== 'plan')
    throw new TypeError('readiness requires plan intent');
  const plan = planPath ? readPlan(root, planPath) : null;
  const continuationResult = planPath
    ? assessPlanContinuation({
        ...continuation,
        plan,
        mode,
        explicitlySelected: true,
      })
    : null;
  const delegation = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates,
    deliveryByLane,
    ...(ownerDirectedChildLimit === undefined ? {} : { ownerDirectedChildLimit }),
  });
  const dispatch = createDispatchRecommendation({
    delegation,
    reportedRuntimeEvidence,
    modelUseByLane,
    ...(concurrencyLimit === undefined ? {} : { concurrencyLimit }),
  });
  const children = delegation.recommendedChildren;
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments))
    throw new TypeError('assignments must be keyed by selected lane');
  if (Object.keys(assignments).some((id) => !children.some((child) => child.laneId === id)))
    throw new TypeError('assignment for unselected child');
  if (children.length && directAssignment)
    throw new TypeError('direct and child ownership cannot be mixed');
  if (
    directAssignment &&
    Object.keys(directAssignment).some(
      (key) => !['owner', 'dispatchId', 'acceptance', 'writeOwnership'].includes(key),
    )
  )
    throw new TypeError('unknown direct assignment field');
  const lanes = children.length
    ? children.flatMap((child) => {
        const assignment = assignments[child.laneId];
        if (!assignment) return [];
        if (Object.keys(assignment).some((key) => !['owner', 'dispatchId'].includes(key)))
          throw new TypeError('child assignment cannot override contract scope');
        return [
          {
            id: child.laneId,
            dispatchId: assignment.dispatchId,
            owner: assignment.owner,
            objective: child.objective,
            acceptance: child.verification,
            dependencies: [],
            writeOwnership: child.boundary.writeOwnership,
            sourceSnapshot: currentSnapshot,
          },
        ];
      })
    : directAssignment
      ? [
          {
            id: envelope.requestId,
            dispatchId: directAssignment.dispatchId,
            owner: directAssignment.owner,
            objective: request,
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
  if (
    reviewDisposition !== undefined &&
    (!reviewDisposition ||
      typeof reviewDisposition.required !== 'boolean' ||
      typeof reviewDisposition.reason !== 'string' ||
      !reviewDisposition.reason.trim() ||
      Object.keys(reviewDisposition).some((key) => !['required', 'reason'].includes(key)))
  )
    throw new TypeError('review disposition requires explicit required and reason');
  // Semantic risk remains a Lead judgement, not an intent/keyword heuristic.
  // Known profile obligations cannot be waived by a not-needed disposition.
  const mandatoryProfileReview = children.some(
    (child) =>
      child.routeRecommendation.modelRecommendation?.profileBinding.profileId === 'bounded-build',
  );
  const bindingComplete =
    lanes.length > 0 && (!children.length || lanes.length === children.length);
  const gaps = [
    ...(reviewDisposition === undefined ? ['independent-review-disposition-required'] : []),
    ...(!bindingComplete ? ['current-snapshot-and-explicit-assignment-required'] : []),
    ...(continuationResult?.decision === 'needs-review' ? continuationResult.reasons : []),
  ];
  return {
    schemaVersion: 1,
    host: 'codex',
    verificationClass: 'deterministic-static',
    dispatchAuthorized: false,
    runtimeQualified: false,
    envelope,
    contextPack,
    route,
    delegation,
    dispatch,
    plan,
    continuation: continuationResult,
    planReadiness: planReadiness === undefined ? null : assessPlanReadiness(planReadiness),
    currentSnapshot,
    adapterIdentity,
    lanes,
    laneValidation,
    gaps,
    reviewDisposition: reviewDisposition ?? null,
    requiresIndependentReview: mandatoryProfileReview || reviewDisposition?.required === true,
    requiresAstraReview: mandatoryProfileReview,
    liveChecks: [
      'current-source-and-user-authority',
      'host-role-model-permission-and-lifecycle',
      'required-codex-astra-qa',
    ],
  };
}

// Recompute the contract from original request/evidence, never trust an edited prepared object.
export function validateCodexWorkflowResults(input, { results = [], review } = {}) {
  const workflow = prepareCodexWorkflow(input);
  const fanIn = validateFanIn({
    envelope: workflow.envelope,
    contextPack: workflow.contextPack,
    lanes: workflow.lanes,
    currentSnapshot: workflow.currentSnapshot,
    hostId: 'codex',
    adapterIdentity: workflow.adapterIdentity,
    results,
  });
  const errors = [...workflow.gaps, ...fanIn.errors];
  let qa = null;
  if (review) {
    if (
      review.packet?.objective !== input.request ||
      !Array.isArray(review.builderIds) ||
      workflow.lanes.some((lane) => !review.builderIds.includes(lane.owner))
    )
      errors.push('QA must bind current objective and assigned builders');
    // The exchange snapshot comes from this task, not a caller-selected alternative.
    qa = validateAdapterReview({ ...review, currentSnapshot: workflow.currentSnapshot });
    errors.push(...qa.errors);
    const covers = (scope, path) =>
      typeof scope === 'string' && (path === scope || path.startsWith(`${scope}/`));
    const coverage = review.result?.acceptanceCoverage ?? [];
    const readPaths = review.packet?.boundaries?.allowedReadPaths ?? [];
    const requiredPaths = [
      ...workflow.lanes.flatMap((lane) => lane.writeOwnership),
      ...workflow.delegation.recommendedChildren.flatMap((child) => child.boundary.readScope),
    ];
    if (
      workflow.lanes.some((lane) =>
        lane.acceptance.some(
          (criterion) =>
            !Array.isArray(coverage) ||
            !coverage.some((item) => item?.criterion === criterion && item.gap === null),
        ),
      )
    )
      errors.push('QA must cover every current lane acceptance criterion');
    if (
      !Array.isArray(readPaths) ||
      requiredPaths.some((path) => !readPaths.some((scope) => covers(scope, path)))
    )
      errors.push('QA read scope must cover current assigned scope');
    if (review.result?.status !== 'complete' || review.result?.verdict !== 'PASS')
      errors.push('QA exchange does not report complete PASS');
    if (workflow.requiresAstraReview && review.result?.identity?.observedModel !== 'gpt-6-astra')
      errors.push(
        'bounded-build requires reported Astra QA; host observation still needs verification',
      );
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
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--json' || (key === '--' && i === 0)) continue;
    if (
      !['--request', '--mode', '--plan'].includes(key) ||
      options[key] ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new TypeError('expected --request TEXT --mode fresh|resume [--plan PATH] [--json]');
    options[key] = args[++i];
  }
  if (!options['--request']) throw new TypeError('request required');
  const workflow = prepareCodexWorkflow({
    request: options['--request'],
    mode: options['--mode'],
    planPath: options['--plan'],
  });
  process.stdout.write(JSON.stringify(workflow, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
