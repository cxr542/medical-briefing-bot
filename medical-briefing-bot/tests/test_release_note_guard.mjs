import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../scripts/validate_release_note.mjs', import.meta.url));

const validate = (body, labels = []) => spawnSync(
  process.execPath,
  [scriptPath],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_BODY: body,
      PR_LABELS: JSON.stringify(labels),
    },
  },
);

test('release-note label with complete metadata passes', () => {
  const result = validate('## Release Note\nCategory: 개선\nTitle: 표시 개선\n- 날짜 표시를 고칩니다.', ['release-note']);

  assert.equal(result.status, 0, result.stderr);
});

test('release-note label without complete metadata fails', () => {
  const result = validate('## Summary\nFix something.', ['release-note']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release Note/);
});

test('unlabeled PR with a Release Note section fails rather than being silently skipped', () => {
  const result = validate('## Release Note\nCategory: 개선\nTitle: 표시 개선');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /release-note/);
});

test('internal-only PR with an explicit no-release-note reason passes', () => {
  const result = validate('## Summary\nTests only.\n\n## No Release Note\nReason: 테스트 전용 변경으로 사용자 영향이 없습니다.');

  assert.equal(result.status, 0, result.stderr);
});

test('PR without an explicit release decision fails', () => {
  const result = validate('## Summary\nA user-visible change.');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No Release Note/);
});

test('HTML-commented template guidance does not count as an explicit exclusion', () => {
  const result = validate('<!--\n## No Release Note\nReason: template guidance only\n-->\n## Summary\nA change.');

  assert.equal(result.status, 1);
});
