import { isDeepStrictEqual } from 'node:util';
import { posix } from 'node:path';
import { listDomainGuides } from './domain-guide-registry.mjs';
import { validateTaskEnvelope } from './intake-policy.mjs';
import { PLAN_ROOT } from './plan-store.mjs';
import { validateCrossModelExchange } from './cross-model-handoff.mjs';

export const ADAPTER_CONTRACT_SCHEMA = 'workflow-adapter/v1';
const STATES = new Set(['supported', 'unsupported', 'unknown']);
const CAPABILITIES = new Set([
  'direct',
  'native-child',
  'lead-cli-review',
  'model-observation',
  'permission-observation',
  'cancel',
  'result-recovery',
]);
const text = (value) =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 2000;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const texts = (value) => Array.isArray(value) && value.every(text);
const digest = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const commit = (value) =>
  typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
const identityValid = (value) =>
  record(value) &&
  digest(value.sourceDigest) &&
  digest(value.configDigest) &&
  Object.keys(value).length === 2;
const safePath = (value) =>
  text(value) &&
  !value.includes('\\') &&
  !/^[a-z]:/i.test(value) &&
  !/[\x00-\x1f*?\[\]{}]/.test(value) &&
  !posix.isAbsolute(value) &&
  posix.normalize(value) === value &&
  !value.split('/').some((part) => ['.', '..', ''].includes(part));
const overlaps = (left, right) =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

// These functions inspect supplied data only. A receipt is not sandbox authority,
// dispatch, telemetry authentication, cancellation, or independent QA completion.
// valid means structurally valid data, not capability support or permission to act.
function outcome(errors, extra = {}) {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...errors]),
    verificationClass: 'static-contract',
    dispatchAuthorized: false,
    liveChecks: Object.freeze(extra.liveChecks ?? []),
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'liveChecks')),
  });
}

function unknownFields(value, fields, label, errors) {
  for (const key of Object.keys(value))
    if (!fields.includes(key)) errors.push(`${label}: unsupported field ${key}.`);
}

export function validateAdapterDescriptor(adapter) {
  const errors = [];
  if (!record(adapter)) return outcome(['adapter must be an explicit descriptor.']);
  unknownFields(
    adapter,
    ['schemaVersion', 'hostId', 'entry', 'identity', 'capabilities'],
    'adapter',
    errors,
  );
  if (adapter.schemaVersion !== ADAPTER_CONTRACT_SCHEMA)
    errors.push('adapter schemaVersion is unsupported.');
  if (!text(adapter.hostId)) errors.push('adapter hostId is required.');
  if (!safePath(adapter.entry)) errors.push('adapter entry must be a canonical repository path.');
  if (!identityValid(adapter.identity)) errors.push('adapter source/config identity is required.');
  if (!record(adapter.capabilities)) errors.push('adapter capabilities must be explicit.');
  else
    for (const [name, state] of Object.entries(adapter.capabilities)) {
      if (!CAPABILITIES.has(name) || !STATES.has(state))
        errors.push(`invalid capability declaration: ${name}.`);
    }
  return outcome(errors);
}

export function assessAdapterCapability({
  adapter,
  hostId,
  currentIdentity,
  capability,
  observations = [],
} = {}) {
  const errors = [...validateAdapterDescriptor(adapter).errors];
  if (!text(hostId) || hostId !== adapter?.hostId)
    errors.push('host must match explicit adapter registration.');
  if (!identityValid(currentIdentity) || !isDeepStrictEqual(currentIdentity, adapter?.identity))
    errors.push('adapter source/config identity is stale or absent.');
  if (!CAPABILITIES.has(capability)) errors.push('unknown capability name.');
  if (!Array.isArray(observations)) errors.push('observations must be an array.');
  if (errors.length) return outcome(errors, { decision: 'reject' });
  const declared = adapter.capabilities[capability] ?? 'unknown';
  if (declared !== 'supported') return outcome([], { decision: declared });
  const observed = observations.filter(
    (item) =>
      record(item) &&
      item.hostId === hostId &&
      item.capability === capability &&
      isDeepStrictEqual(item.identity, currentIdentity) &&
      item.evidenceKind === 'runtime' &&
      text(item.evidenceRef),
  );
  if (
    observed.some((item) => !STATES.has(item.state)) ||
    new Set(observed.map((item) => item.state)).size > 1
  ) {
    return outcome(['conflicting or invalid capability observations.'], { decision: 'reject' });
  }
  return outcome([], {
    decision:
      observed[0]?.state === 'supported' ? 'observed-supported' : (observed[0]?.state ?? 'unknown'),
    liveChecks: ['observation-authenticity-and-current-host-permissions'],
  });
}

// Same snapshot representation as the existing QA packet; no host state pointers.
function snapshotValid(value) {
  return (
    record(value) &&
    commit(value.baseSHA) &&
    commit(value.headSHA) &&
    (value.dirtyDiffDigest === null || digest(value.dirtyDiffDigest)) &&
    Array.isArray(value.untrackedInputDigests) &&
    value.untrackedInputDigests.every(
      (item) => record(item) && safePath(item.path) && digest(item.digest),
    ) &&
    new Set(value.untrackedInputDigests.map((item) => item.path)).size ===
      value.untrackedInputDigests.length
  );
}

function laneErrors(lane, currentSnapshot) {
  if (!record(lane)) return ['lane must be an object.'];
  const errors = [];
  unknownFields(
    lane,
    [
      'id',
      'dispatchId',
      'owner',
      'objective',
      'acceptance',
      'dependencies',
      'writeOwnership',
      'sourceSnapshot',
    ],
    'lane',
    errors,
  );
  for (const field of ['id', 'dispatchId', 'owner', 'objective'])
    if (!text(lane[field])) errors.push(`lane ${field} is required.`);
  for (const field of ['acceptance', 'dependencies', 'writeOwnership']) {
    if (!texts(lane[field])) errors.push(`lane ${field} must be text entries.`);
    else if (new Set(lane[field]).size !== lane[field].length)
      errors.push(`lane ${field} has duplicate entries.`);
  }
  if (!lane.acceptance?.length) errors.push('lane acceptance must be bounded and nonempty.');
  if (Array.isArray(lane.writeOwnership) && lane.writeOwnership.some((path) => !safePath(path)))
    errors.push('writeOwnership path must be canonical and relative; globs are unsupported.');
  if (
    !snapshotValid(currentSnapshot) ||
    !snapshotValid(lane.sourceSnapshot) ||
    !isDeepStrictEqual(currentSnapshot, lane.sourceSnapshot)
  )
    errors.push('lane source snapshot is missing or stale.');
  return errors;
}

export function validateBoundedLanes({ envelope, contextPack, lanes, currentSnapshot } = {}) {
  // Avoid allowing malformed collections to reach older nested validators.
  const errors = [];
  if (
    !record(envelope) ||
    ['domainCandidates', 'constraints', 'evidence', 'requiredEvidence', 'ambiguities'].some(
      (key) => !Array.isArray(envelope[key]) || envelope[key].some((item) => item === null),
    )
  ) {
    errors.push('TaskEnvelope is malformed.');
  } else {
    try {
      errors.push(...validateTaskEnvelope(envelope).errors);
    } catch {
      errors.push('TaskEnvelope is malformed.');
    }
  }
  const guidePaths = new Set(listDomainGuides().map((guide) => guide.path));
  if (
    !record(contextPack) ||
    contextPack.schemaVersion !== 1 ||
    contextPack.requestId !== envelope?.requestId ||
    contextPack.intent !== envelope?.intent ||
    !Array.isArray(contextPack.selectedGuides) ||
    (envelope?.intent !== 'plan' && contextPack.selectedGuides.length > 0) ||
    contextPack.selectedGuides.some((guide) => !record(guide) || !guidePaths.has(guide.path)) ||
    !Array.isArray(contextPack.sources) ||
    !Array.isArray(contextPack.gaps)
  )
    errors.push('ContextPack must match the existing TaskEnvelope.');
  if (!Array.isArray(lanes) || lanes.length === 0)
    return outcome([...errors, 'bounded lanes must be a nonempty array.']);
  for (const lane of lanes) errors.push(...laneErrors(lane, currentSnapshot));
  if (errors.length) return outcome(errors);
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  if (byId.size !== lanes.length) errors.push('duplicate lane id.');
  if (new Set(lanes.map((lane) => lane.dispatchId)).size !== lanes.length)
    errors.push('duplicate lane dispatchId.');
  for (const lane of lanes) {
    const planOnly =
      envelope.authorizedAction === 'produce-plan' &&
      lane.writeOwnership.every((path) => path.startsWith(`${PLAN_ROOT}/`) && path.endsWith('.md'));
    if (lane.writeOwnership.length && envelope.authorizedAction !== 'mutate' && !planOnly)
      errors.push(`lane ${lane.id}: write exceeds TaskEnvelope authority.`);
    for (const dependency of lane.dependencies)
      if (!byId.has(dependency) || dependency === lane.id)
        errors.push(`lane ${lane.id}: invalid dependency ${dependency}.`);
  }
  for (let i = 0; i < lanes.length; i++)
    for (let j = i + 1; j < lanes.length; j++) {
      if (
        lanes[i].writeOwnership.some((left) =>
          lanes[j].writeOwnership.some((right) => overlaps(left, right)),
        )
      )
        errors.push(
          `write ownership overlap: ${lanes[i].id}/${lanes[j].id}; parent must assign one writer.`,
        );
    }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      errors.push('lane dependency cycle.');
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return outcome(errors, { liveChecks: ['current-user-authority-and-host-admission'] });
}

export function validateLaneResult({
  lane,
  result,
  currentSnapshot,
  hostId,
  adapterIdentity,
  seenResultIds = [],
} = {}) {
  const errors = laneErrors(lane, currentSnapshot);
  if (errors.length) return outcome(errors);
  if (!record(result)) return outcome([...errors, 'lane result is required.']);
  unknownFields(
    result,
    [
      'resultId',
      'dispatchId',
      'laneId',
      'owner',
      'hostId',
      'adapterIdentity',
      'sourceSnapshot',
      'status',
      'checks',
      'findings',
      'gaps',
      'changedPaths',
    ],
    'result',
    errors,
  );
  if (
    !text(result.resultId) ||
    !Array.isArray(seenResultIds) ||
    seenResultIds.includes(result.resultId)
  )
    errors.push('resultId is missing or duplicate.');
  if (result.dispatchId !== lane?.dispatchId)
    errors.push('result dispatchId does not match current assignment.');
  if (result.laneId !== lane?.id || result.owner !== lane?.owner)
    errors.push('result lane/owner identity mismatch.');
  if (
    !text(hostId) ||
    result.hostId !== hostId ||
    !identityValid(adapterIdentity) ||
    !isDeepStrictEqual(result.adapterIdentity, adapterIdentity)
  )
    errors.push('result host/adapter identity mismatch.');
  if (
    !snapshotValid(result.sourceSnapshot) ||
    !isDeepStrictEqual(result.sourceSnapshot, currentSnapshot)
  )
    errors.push('result source snapshot is stale.');
  if (!['complete', 'partial', 'blocked', 'cancelled'].includes(result.status))
    errors.push('result status is invalid.');
  for (const field of ['checks', 'findings', 'gaps', 'changedPaths'])
    if (!texts(result[field])) errors.push(`result ${field} must be text entries.`);
  if (result.status === 'complete' && (!result.checks?.length || result.gaps?.length))
    errors.push('complete result requires checks and no gaps.');
  if (result.status !== 'complete' && !result.gaps?.length)
    errors.push('incomplete result requires an explicit gap.');
  if (
    Array.isArray(result.changedPaths) &&
    result.changedPaths.some(
      (path) =>
        !safePath(path) ||
        !lane?.writeOwnership?.some((owner) => path === owner || path.startsWith(`${owner}/`)),
    )
  )
    errors.push('result changedPaths exceeds write ownership.');
  return outcome(errors, {
    liveChecks: [
      'parent-reproduces-findings-and-verifies-evidence',
      'actual-changed-paths-and-host-identity',
    ],
  });
}

export function assessLaneReadiness({
  laneId,
  results = [],
  hostId,
  adapterIdentity,
  ...input
} = {}) {
  const validation = validateBoundedLanes(input);
  if (!validation.valid) return outcome(validation.errors, { decision: 'reject' });
  const lane = input.lanes.find((item) => item.id === laneId);
  if (!lane || !Array.isArray(results))
    return outcome(['unknown lane or malformed results.'], { decision: 'reject' });
  const errors = [];
  const accepted = new Map();
  const resultIds = [];
  for (const result of results) {
    const producer = input.lanes.find((item) => item.id === result?.laneId);
    errors.push(
      ...validateLaneResult({
        lane: producer,
        result,
        currentSnapshot: input.currentSnapshot,
        hostId,
        adapterIdentity,
        seenResultIds: resultIds,
      }).errors,
    );
    if (accepted.has(result?.laneId)) errors.push('duplicate lane result.');
    accepted.set(result?.laneId, result);
    resultIds.push(result?.resultId);
  }
  if (errors.length) return outcome(errors, { decision: 'reject' });
  const waitingFor = lane.dependencies.filter((id) => accepted.get(id)?.status !== 'complete');
  return outcome([], {
    decision: waitingFor.length ? 'blocked' : 'ready',
    waitingFor: Object.freeze(waitingFor),
    liveChecks: ['current-user-authority-and-host-admission'],
  });
}

export function validateFanIn({ results, hostId, adapterIdentity, ...input } = {}) {
  const errors = [...validateBoundedLanes(input).errors];
  if (errors.length || !Array.isArray(results))
    return outcome([...errors, ...(!Array.isArray(results) ? ['results must be an array.'] : [])]);
  const ids = [];
  const lanesSeen = new Set();
  for (const result of results) {
    const lane = input.lanes.find((item) => item.id === result?.laneId);
    errors.push(
      ...validateLaneResult({
        lane,
        result,
        currentSnapshot: input.currentSnapshot,
        hostId,
        adapterIdentity,
        seenResultIds: ids,
      }).errors,
    );
    if (lanesSeen.has(result?.laneId)) errors.push('duplicate lane result.');
    if (result?.status !== 'complete') errors.push('fan-in requires complete results.');
    ids.push(result?.resultId);
    lanesSeen.add(result?.laneId);
  }
  for (const lane of input.lanes)
    if (!lanesSeen.has(lane.id)) errors.push(`missing result for lane ${lane.id}.`);
  return outcome(errors, {
    liveChecks: [
      'parent-reproduces-findings-and-verifies-evidence',
      'independent-qa-and-integration-verification',
      'dependency-dispatch-order-observed',
    ],
  });
}

export function validateAdapterReview({ reviewerId, builderIds, ...exchange } = {}) {
  const errors = [];
  if (
    !text(reviewerId) ||
    !texts(builderIds) ||
    builderIds.length === 0 ||
    builderIds.includes(reviewerId)
  )
    errors.push('reviewer must be independent from explicitly identified builders.');
  if (!snapshotValid(exchange.currentSnapshot))
    errors.push('current QA source snapshot is required.');
  if (texts(builderIds) && !builderIds.includes(exchange.packet?.authority?.writeOwner))
    errors.push('builders must include packet write owner.');
  let validation;
  try {
    validation = validateCrossModelExchange(exchange);
  } catch {
    validation = { errors: ['QA packet/result is malformed.'], liveChecks: [] };
  }
  return outcome([...errors, ...validation.errors], { liveChecks: validation.liveChecks });
}
