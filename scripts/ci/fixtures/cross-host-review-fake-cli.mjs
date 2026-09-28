import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fixtureCase = process.argv[2];
if (fixtureCase === 'hang') {
  setInterval(() => {}, 1000);
} else if (fixtureCase === 'error') {
  process.stderr.write('fixture provider error\n');
  process.exitCode = 23;
} else if (fixtureCase === 'malformed') {
  process.stdout.write('{not-json');
} else if (fixtureCase === 'multi') {
  process.stdout.write('{}{}');
} else if (fixtureCase === 'oversize') {
  process.stdout.write('x'.repeat(200_000));
} else if (fixtureCase === 'early-close') {
  process.stdin.destroy();
  const corpus = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'cross-model-handoff-cases.json'), 'utf8'),
  );
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 'cross-host-fake-output/v1',
      packetReceived: false,
      result: corpus.baseResult,
    }),
  );
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const packet = JSON.parse(input);
  const corpus = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'cross-model-handoff-cases.json'), 'utf8'),
  );
  const result = structuredClone(corpus.baseResult);
  result.packetId = packet.packetId;
  result.dispatchId = packet.lifecycle.dispatchId;
  result.reviewedSnapshot = packet.snapshot;
  result.contextIsolationMethod = packet.review.contextIsolationMethod;
  result.identity.requestedModelIntent = packet.intent.modelIntent;
  result.disposition.owner = packet.authority.integrationOwner;
  result.cleanup.owner = packet.lifecycle.cleanupOwner;
  result.handoff.integrationOwner = packet.authority.integrationOwner;
  result.commandsActuallyRun = [];
  if (fixtureCase === 'partial') {
    result.status = 'partial';
    result.verdict = 'BLOCKED';
    result.blocker = 'Fixture returned only partial evidence.';
  }
  if (fixtureCase === 'stale') result.reviewedSnapshot.headSHA = 'f'.repeat(64);
  if (fixtureCase === 'secret') result.secret = 'fixture-secret';
  if (fixtureCase === 'wrong-model') result.identity.requestedModelIntent = 'wrong-model';
  if (fixtureCase === 'wrong-dispatch') result.dispatchId = 'wrong-dispatch';
  if (
    fixtureCase === 'env' &&
    Object.keys(process.env).some((key) => /^(ANTHROPIC|OPENAI|CLAUDE_CODE)_/u.test(key))
  ) {
    result.secret = 'inherited-credential-variable';
  }
  process.stdout.write(
    JSON.stringify({ schemaVersion: 'cross-host-fake-output/v1', packetReceived: true, result }),
  );
}
