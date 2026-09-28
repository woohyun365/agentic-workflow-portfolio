import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPlan, assessPlanContinuation } from '../common/plan-store.mjs';

// Repository diagnostics only: no Claude Home/settings discovery, model process or host grant.
export function runClaudePreflight({
  root = process.cwd(),
  mode = 'fresh',
  planPath,
  continuation,
} = {}) {
  if (!['fresh', 'resume'].includes(mode))
    throw new TypeError('explicit fresh/resume mode required');
  if (planPath !== undefined && (mode !== 'resume' || typeof planPath !== 'string' || !planPath))
    throw new TypeError('explicit plan selection requires resume');
  if (
    continuation !== undefined &&
    (!planPath ||
      !continuation ||
      typeof continuation !== 'object' ||
      Array.isArray(continuation) ||
      Object.keys(continuation).some(
        (key) => !['expectedPlanId', 'checkpointSnapshot'].includes(key),
      ))
  )
    throw new TypeError(
      'continuation requires selected plan and expectedPlanId/checkpointSnapshot only',
    );

  const diagnostics = [];
  const overrides = ['-c', 'core.fsmonitor=false'];
  const git = (label, args, { noMatch = false, maxBuffer = 1024 * 1024 } = {}) => {
    try {
      return execFileSync('git', [...overrides, ...args], {
        cwd: root,
        timeout: 5000,
        maxBuffer,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // Only config's documented empty match is successful; errors/limits stay unknown.
      if (
        noMatch &&
        error.status === 1 &&
        !error.signal &&
        !error.stdout?.length &&
        !error.stderr?.length
      )
        return Buffer.alloc(0);
      diagnostics.push(`git-${label}-unavailable`);
      return null;
    }
  };
  const disableFilters = () => {
    // Discover keys only, never command values. Git status/diff can invoke clean/process
    // drivers even with --no-ext-diff; all configured drivers must be neutralized first.
    const bytes = git(
      'filter-config',
      [
        'config',
        '--null',
        '--name-only',
        '--get-regexp',
        '^filter\\..*\\.(clean|process|required)$',
      ],
      { noMatch: true, maxBuffer: 64 * 1024 },
    );
    if (bytes === null) return false;
    const names = bytes.toString('utf8');
    if (!Buffer.from(names, 'utf8').equals(bytes) || (names && !names.endsWith('\0'))) {
      diagnostics.push('git-filter-config-invalid');
      return false;
    }
    const drivers = new Set();
    for (const key of names ? names.slice(0, -1).split('\0') : []) {
      const match = /^filter\.(.+)\.(clean|process|required)$/u.exec(key);
      // '=' cannot be represented unambiguously in Git's -c key=value grammar.
      // Reject controls/oversize keys rather than silently leaving any driver active.
      if (!match || /[=\x00-\x1f\x7f]/u.test(key) || Buffer.byteLength(key) > 256) {
        diagnostics.push('git-filter-config-invalid');
        return false;
      }
      drivers.add(match[1]);
      if (drivers.size > 64) {
        diagnostics.push('git-filter-config-limit');
        return false;
      }
    }
    for (const driver of drivers)
      overrides.push(
        '-c',
        `filter.${driver}.clean=`,
        '-c',
        `filter.${driver}.process=`,
        '-c',
        `filter.${driver}.required=false`,
      );
    return true;
  };
  const top = git('root', ['rev-parse', '--show-toplevel']);
  let rootMatches = false;
  try {
    rootMatches =
      top !== null && realpathSync(top.toString('utf8').trim()) === realpathSync(resolve(root));
  } catch {
    /* Root failure is a diagnostic, not a clean repository. */
  }
  if (!rootMatches) diagnostics.push('repository-root-required');
  const branch = rootMatches
    ? (git('branch', ['symbolic-ref', '--quiet', '--short', 'HEAD'])?.toString('utf8').trim() ??
      null)
    : null;
  const head = rootMatches
    ? (git('head', ['rev-parse', '--verify', 'HEAD'])?.toString('utf8').trim() ?? null)
    : null;
  const safeToInspect = rootMatches && disableFilters();
  const indexBytes = safeToInspect ? git('index', ['ls-files', '--stage', '-z']) : null;
  const hasGitlinks = indexBytes
    ?.toString('utf8')
    .split('\0')
    .some((entry) => entry.startsWith('160000 '));
  if (hasGitlinks) diagnostics.push('submodule-content-not-supported');
  // Do not traverse repositories whose nested filter configuration was not inspected.
  const inspectWorktree = safeToInspect && indexBytes !== null && !hasGitlinks;
  const statusBytes = inspectWorktree
    ? git('status', ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    : null;
  const rawStatus = statusBytes?.toString('utf8') ?? null;
  const diff = inspectWorktree
    ? git('diff', ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'])
    : null;
  const untracked = inspectWorktree
    ? git('untracked', ['ls-files', '--others', '--exclude-standard', '-z'])
    : null;
  if (
    rootMatches &&
    (!branch ||
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(head ?? '') ||
      (rawStatus !== null && rawStatus !== '' && !rawStatus.endsWith('\0')))
  )
    diagnostics.push('git-baseline-invalid');
  // Fingerprint new source files as well as tracked bytes; stage is not an execution prerequisite.
  const untrackedInputDigests = [];
  try {
    if (untracked !== null) {
      const names = untracked.toString('utf8');
      if (!Buffer.from(names).equals(untracked)) throw new Error('non-UTF8 untracked path');
      let total = 0;
      for (const path of names.split('\0').filter(Boolean)) {
        const full = resolve(realpathSync(root), path),
          stat = lstatSync(full);
        if (realpathSync(resolve(full, '..')) !== resolve(full, '..'))
          throw new Error('untracked ancestor symlink');
        if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('untracked non-file');
        if (stat.size > 8 * 1024 * 1024 || (total += stat.size) > 32 * 1024 * 1024)
          throw new Error('untracked byte limit');
        const bytes = stat.isSymbolicLink()
          ? readlinkSync(full, { encoding: 'buffer' })
          : readFileSync(full);
        const digest =
          'sha256:' + createHash('sha256').update(`${stat.mode}\n`).update(bytes).digest('hex');
        untrackedInputDigests.push({ path, digest });
      }
    }
  } catch {
    diagnostics.push('untracked-content-unobservable');
  }
  const gitComplete = diagnostics.length === 0;
  // Length-framed raw status/index/diff plus bounded new-file digests. Ignored inputs remain outside Git.
  const diffHash = gitComplete
    ? [statusBytes, indexBytes, diff, Buffer.from(JSON.stringify(untrackedInputDigests))]
        .reduce(
          (hash, bytes) => hash.update(`${bytes.length}\n`).update(bytes),
          createHash('sha256').update('claude-git-baseline/v3\n'),
        )
        .digest('hex')
    : null;
  const snapshot = diffHash ? { branch, head, diffHash } : null;
  // The common owner performs canonical-path, bounded-header and identity-inventory checks.
  // Fresh mode never enumerates .plans or any host memory.
  const plan = planPath ? readPlan(root, planPath) : null;
  const continuationResult = planPath
    ? assessPlanContinuation({
        ...continuation,
        plan,
        mode,
        explicitlySelected: true,
        currentSnapshot: snapshot,
      })
    : null;
  return {
    schemaVersion: 1,
    host: 'claude-code',
    mode,
    verificationClass: 'deterministic-static',
    identityEvidence: 'local-git-diagnostic-only',
    dispatchAuthorized: false,
    runtimeQualified: false,
    native: { status: 'not-ready', runtimeSupport: 'unknown' },
    baseline: {
      branch,
      head,
      rawStatus,
      rawStatusBase64: statusBytes?.toString('base64') ?? null,
      clean: gitComplete ? statusBytes.length === 0 : null,
      diffHash,
      untrackedInputDigests,
    },
    snapshot,
    snapshotLimits: [
      'configured-git-clean-process-filters-disabled',
      'ignored-inputs-excluded',
      'non-atomic-local-read',
      'not-runtime-or-config-authentication',
    ],
    plan,
    continuation: continuationResult,
    diagnostics,
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
    if (
      !['--mode', '--plan', '--continuation'].includes(key) ||
      Object.hasOwn(options, key) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new TypeError(
        'expected [--mode fresh|resume] [--plan PATH] [--continuation JSON] [--json]',
      );
    options[key] = args[++i];
  }
  if (options['--continuation']?.length > 4096)
    throw new TypeError('continuation JSON exceeds 4096 characters');
  const output = runClaudePreflight({
    mode: options['--mode'] ?? 'fresh',
    planPath: options['--plan'],
    continuation:
      options['--continuation'] === undefined ? undefined : JSON.parse(options['--continuation']),
  });
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  if (output.diagnostics.length || output.continuation?.decision === 'needs-review')
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
