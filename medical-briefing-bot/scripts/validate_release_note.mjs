import { parseReleaseDecision } from './release-note-contract.mjs';

try {
  const decision = parseReleaseDecision(process.env.PR_BODY || '', JSON.parse(process.env.PR_LABELS || '[]'));
  console.log(decision.kind === 'note' ? 'Release Note metadata OK.' : 'Explicit no-release-note reason OK.');
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
}
