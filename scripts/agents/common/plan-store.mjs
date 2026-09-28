import {
  lstatSync,
  readdirSync,
  openSync,
  readSync,
  fstatSync,
  closeSync,
  constants,
} from 'node:fs';
import { resolve, join } from 'node:path';

export const PLAN_ROOT = '.plans';
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_ENTRIES = 512;
const TERMINAL = new Set(['completed', 'cancelled', 'superseded']);

// Read-only authoring metadata. Neither this module nor a path grants runtime ownership.
function safePath(root, path) {
  if (typeof path !== 'string' || !/^\.plans\/.+\.md$/u.test(path) || path.includes('\\'))
    throw new Error('unsafe-path');
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0')))
    throw new Error('unsafe-path');
  let current = resolve(root);
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))
        throw new Error('unsafe-path');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

function metadata(root, path) {
  let fd;
  try {
    const absolute = safePath(root, path);
    fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('unsafe-path');
    const bytes = Buffer.alloc(MAX_HEADER_BYTES + 1);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    let fence = null,
      headerEnded = false;
    const ids = [],
      statuses = [],
      documentTypes = [];
    const lines = bytes
      .subarray(0, Math.min(count, MAX_HEADER_BYTES))
      .toString('utf8')
      .split(/\r?\n/u);
    // A partial last line cannot prove a heading boundary or a complete declaration.
    if (count > MAX_HEADER_BYTES) lines.pop();
    for (const line of lines) {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence.character &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        )
          fence = null;
        continue;
      }
      if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
        fence = { character: marker[1][0], length: marker[1].length };
        continue;
      }
      if (/^##\s/u.test(line)) {
        headerEnded = true;
        break;
      }
      const field = line.match(/^ {0,3}-\s*(Plan ID|Status|상태|Document Type):\s*(.*)$/u);
      if (field)
        (field[1] === 'Plan ID'
          ? ids
          : field[1] === 'Document Type'
            ? documentTypes
            : statuses
        ).push(
          field[2]
            .trim()
            .replace(/^`([^`]+)`/u, '$1')
            .split(/\s*[;—]\s*/u)[0]
            .trim(),
        );
    }
    if (
      count < Math.min(stat.size, bytes.length) ||
      (!headerEnded && count > MAX_HEADER_BYTES) ||
      fence
    )
      return {
        path,
        state: 'unknown',
        reasons: ['header-incomplete'],
        identityIssues: ['header-incomplete'],
      };
    const id = ids.length === 1 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(ids[0]) ? ids[0] : null;
    const statusMap = {
      active: 'active',
      'in-progress': 'active',
      draft: 'proposed',
      진행중: 'active',
      초안: 'proposed',
      제안: 'proposed',
      차단: 'blocked',
      '구현 준비 완료': 'implementation-ready',
      'implementation-ready': 'implementation-ready',
      proposed: 'proposed',
      blocked: 'blocked',
      paused: 'paused',
      completed: 'completed',
      complete: 'completed',
      done: 'completed',
      finished: 'completed',
      cancelled: 'cancelled',
      canceled: 'cancelled',
      superseded: 'superseded',
      '진행 중': 'active',
      완료: 'completed',
      취소: 'cancelled',
    };
    const status =
      statuses.length === 1 && Object.hasOwn(statusMap, statuses[0].toLowerCase())
        ? statusMap[statuses[0].toLowerCase()]
        : 'unknown';
    const navigation = path.split('/').at(-1).toLowerCase() === 'readme.md';
    const archived = /^\.plans\/(finished|cancelled)\//u.test(path);
    const reference = documentTypes.length === 1 && documentTypes[0] === 'reference';
    const classificationInvalid = documentTypes.length > 0 && !reference;
    const identityIssues = ids.length && !id ? ['identity-invalid'] : [];
    const metadataInvalid =
      classificationInvalid ||
      identityIssues.length > 0 ||
      (reference || navigation
        ? statuses.length > 0 && status === 'unknown'
        : !id || status === 'unknown');
    const state = classificationInvalid
      ? 'unknown'
      : navigation
        ? 'navigation'
        : archived
          ? 'archived'
          : reference
            ? 'reference'
            : !id || status === 'unknown'
              ? 'unknown'
              : TERMINAL.has(status)
                ? 'terminal'
                : status === 'implementation-ready'
                  ? 'active'
                  : status;
    return {
      path,
      id,
      declaredIds: ids.filter((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)),
      status,
      state,
      identityIssues,
      reasons: metadataInvalid ? ['metadata-invalid'] : [],
    };
  } catch (error) {
    return {
      path,
      state:
        error.code === 'ENOENT'
          ? 'missing'
          : error.message === 'unsafe-path' || error.code === 'ELOOP'
            ? 'unsafe'
            : 'unknown',
      reasons: [error.code === 'ENOENT' ? 'missing-path' : 'unreadable-or-unsafe'],
      identityIssues: [error.code === 'ENOENT' ? 'missing-path' : 'unreadable-or-unsafe'],
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function inventory(root) {
  const plans = [],
    issues = [],
    identityIssues = [];
  const scanIssue = (issue) => {
    issues.push(issue);
    identityIssues.push(issue);
  };
  let count = 0;
  function visit(path) {
    let entries;
    try {
      const absolute = resolve(root, path),
        stat = lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        scanIssue('unsafe-directory');
        return;
      }
      entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch (error) {
      scanIssue(error.code === 'ENOENT' ? 'missing-root' : 'unreadable-directory');
      return;
    }
    for (const entry of entries) {
      if (++count > MAX_ENTRIES) {
        scanIssue('candidate-limit');
        return;
      }
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        scanIssue('unsafe-entry');
        continue;
      }
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const plan = metadata(root, child);
        plans.push(plan);
        if (plan.reasons.length) issues.push('metadata-unknown');
        for (const issue of plan.identityIssues) scanIssue(issue);
      }
    }
  }
  visit(PLAN_ROOT);
  const ids = new Map();
  for (const plan of plans)
    for (const id of plan.declaredIds ?? []) ids.set(id, (ids.get(id) ?? 0) + 1);
  for (const plan of plans)
    if (plan.declaredIds?.some((id) => ids.get(id) > 1)) {
      plan.state = 'ambiguous';
      plan.reasons.push('duplicate-plan-id');
      scanIssue('duplicate-plan-id');
    }
  return {
    plans,
    issues: [...new Set(issues)],
    complete: issues.length === 0,
    identityComplete: identityIssues.length === 0,
    identityIssues: [...new Set(identityIssues)],
  };
}

export function discoverPlans(root) {
  const result = inventory(root);
  return {
    ...result,
    plans: result.plans.filter(
      (plan) =>
        result.identityComplete && plan.path.split('/').length === 2 && plan.state === 'active',
    ),
  };
}

export function readPlan(root, path) {
  const selected = metadata(root, path);
  if (['missing', 'unsafe'].includes(selected.state)) return selected;
  const { plans, ...audit } = inventory(root);
  const plan = plans.find((plan) => plan.path === path) ?? selected;
  if (
    !audit.identityComplete &&
    !['archived', 'terminal', 'ambiguous', 'navigation', 'reference'].includes(plan.state)
  )
    return {
      ...plan,
      ...audit,
      state: 'unknown',
      reasons: [...new Set([...plan.reasons, ...audit.identityIssues])],
    };
  return { ...plan, ...audit };
}

export function assessPlanContinuation({
  plan,
  mode,
  explicitlySelected,
  expectedPlanId,
  checkpointSnapshot,
  currentSnapshot,
} = {}) {
  const reasons = [];
  if (mode !== 'resume' || explicitlySelected !== true) reasons.push('explicit-resume-required');
  if (!plan || plan.state !== 'active') reasons.push('active-plan-required');
  if (!expectedPlanId || expectedPlanId !== plan?.id) reasons.push('identity-mismatch');
  for (const snapshot of [checkpointSnapshot, currentSnapshot]) {
    if (
      !snapshot ||
      typeof snapshot.branch !== 'string' ||
      !snapshot.branch ||
      !/^[a-f0-9]{40}$/u.test(snapshot.head ?? '') ||
      !/^[a-f0-9]{64}$/u.test(snapshot.diffHash ?? '')
    )
      reasons.push('snapshot-unknown');
  }
  if (
    !reasons.includes('snapshot-unknown') &&
    ['branch', 'head', 'diffHash'].some((key) => checkpointSnapshot[key] !== currentSnapshot[key])
  )
    reasons.push('source-changed');
  return {
    decision: reasons.length ? 'needs-review' : 'candidate',
    reasons: [...new Set(reasons)],
    grantsExecutionAuthority: false,
  };
}
