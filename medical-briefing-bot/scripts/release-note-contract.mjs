import { isDeepStrictEqual } from 'node:util';

export const NOTE_PATH = 'medical-briefing-bot/frontend/src/data/generatedReleaseNotes.json';
export const AUTOMATION_PREFIX = 'automation/release-note/pr-';
export const CATEGORIES = ['기능', '개선', '버그 수정', '운영'];
const fail = message => { throw new Error(message); };
const string = value => typeof value === 'string' && value.trim().length > 0;
const section = (text, heading) => {
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, i) => line.trim() === `## ${heading}` ? [i] : []);
  if (starts.length > 1) fail(`Duplicate ${heading} section.`);
  if (!starts.length) return null;
  let end = starts[0] + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  return lines.slice(starts[0] + 1, end).join('\n').trim();
};

export function parseReleaseDecision(body, labels) {
  if (typeof body !== 'string' || body.length > 65536) fail('Invalid PR body.');
  if (!Array.isArray(labels) || labels.some(label => typeof label !== 'string')) fail('Invalid PR label metadata.');
  const visible = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const note = section(visible, 'Release Note');
  const excluded = section(visible, 'No Release Note');
  if (!labels.includes('release-note')) {
    if (note !== null) fail("A Release Note section requires the release-note label.");
    if (excluded === null || !/^Reason:\s*\S/m.test(excluded)) fail('No Release Note requires a non-empty Reason.');
    return { kind: 'excluded' };
  }
  if (excluded !== null) fail('Use either Release Note or No Release Note, not both.');
  if (note === null) fail('Release Note section is required.');
  const field = name => {
    const matches = [...note.matchAll(new RegExp(`^${name}:[ \\t]*(.*)$`, 'gm'))];
    if (matches.length !== 1 || !string(matches[0][1])) fail(`Release Note needs one non-empty ${name}.`);
    return matches[0][1].trim();
  };
  const category = field('Category');
  if (!CATEGORIES.includes(category)) fail('Release Note Category must match the supported display categories.');
  return { kind: 'note', category, title: field('Title'), changes: note.split(/\r?\n/).filter(line => line.trim().startsWith('- ')).map(line => line.trim().slice(2).trim()).filter(Boolean) };
}

export function validateNotes(notes) {
  if (!Array.isArray(notes)) fail('Release notes must be an array.');
  const ids = new Set();
  for (const note of notes) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) fail('Invalid release note object.');
    for (const key of ['id', 'date', 'category', 'title', 'summary']) if (!string(note[key])) fail(`Invalid release note ${key}.`);
    if (ids.has(note.id)) fail('Duplicate release note ID.');
    ids.add(note.id);
    // Historical categories remain valid data, even if excluded by the current UI.
    for (const key of ['issues', 'changes', 'verification']) if (!Array.isArray(note[key]) || note[key].some(x => typeof x !== 'string')) fail(`Invalid release note ${key}.`);
    if (!Array.isArray(note.links) || note.links.some(link => !link || !string(link.label) || !string(link.url))) fail('Invalid release note links.');
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(note.date)) fail('Invalid release note date.');
  }
  return notes;
}

export function sourceIdentity(pr, repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(pr.number) || pr.number < 1) fail('Invalid source repository/PR.');
  if (!pr.merged_at || !/^\d{4}-\d{2}-\d{2}T/.test(pr.merged_at) || !Number.isFinite(Date.parse(pr.merged_at))) fail('Source PR must be merged.');
  if (pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== repository) fail('Source PR must target repository main.');
  const url = `https://github.com/${repository}/pull/${pr.number}`;
  if (pr.html_url !== url) fail('Invalid source PR URL.');
  const date = pr.merged_at.slice(0, 10);
  return { id: `${date}-pr-${pr.number}`, date: date.replaceAll('-', '.'), url };
}

export function appendNote(existing, pr, repository) {
  validateNotes(existing);
  const identity = sourceIdentity(pr, repository);
  if (existing.some(note => note.id === identity.id)) return { notes: existing, added: false };
  const decision = parseReleaseDecision(pr.body || '', pr.labels.map(label => label.name));
  if (decision.kind !== 'note') fail('Source PR has no release note.');
  const note = { id: identity.id, date: identity.date, category: decision.category, title: decision.title,
    summary: `PR #${pr.number} merge로 반영된 변경입니다.`, issues: [],
    changes: decision.changes.length ? decision.changes : ['PR의 Release Note 메타데이터로 자동 등록'],
    verification: ['PR merge 완료'], links: [{ label: `PR #${pr.number}`, url: identity.url }] };
  return { notes: validateNotes([note, ...existing]), added: true };
}

export function validateAddition(base, candidate, pr, repository) {
  validateNotes(base); validateNotes(candidate);
  const identity = sourceIdentity(pr, repository);
  if (base.some(note => note.id === identity.id)) fail('Source release note already exists in base.');
  if (candidate.length !== base.length + 1 || !isDeepStrictEqual(candidate.slice(1), base)) fail('Existing release notes must be preserved in order without changes.');
  const note = candidate[0];
  if (note.id !== identity.id || note.date !== identity.date || !CATEGORIES.includes(note.category) || !isDeepStrictEqual(note.links, [{ label: `PR #${pr.number}`, url: identity.url }])) fail('Release note does not match its source PR.');
  return true;
}
