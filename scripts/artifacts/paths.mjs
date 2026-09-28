import { resolve } from 'node:path';

export const DEFAULT_ARTIFACTS_DIRECTORY = 'artifacts/local';

export function resolveArtifactsDirectory(repoRoot, environment = process.env) {
  const configuredDirectory = environment.REPO_ARTIFACTS_DIR?.trim();
  return resolve(repoRoot, configuredDirectory || DEFAULT_ARTIFACTS_DIRECTORY);
}

export function resolveArtifactPath(repoRoot, segments, environment = process.env) {
  return resolve(resolveArtifactsDirectory(repoRoot, environment), ...segments);
}
