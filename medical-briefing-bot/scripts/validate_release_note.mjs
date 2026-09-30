const body = process.env.PR_BODY || '';
const rawLabels = process.env.PR_LABELS || '[]';
const visibleBody = body.replace(/<!--[\s\S]*?-->/g, '');

const parseLabels = value => {
  try {
    const labels = JSON.parse(value);
    return Array.isArray(labels) && labels.every(label => typeof label === 'string')
      ? labels
      : null;
  } catch {
    return null;
  }
};

const getSection = (text, heading) => {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join('\n').trim();
};

const labels = parseLabels(rawLabels);
if (!labels) {
  console.error('::error::PR label metadata could not be parsed.');
  process.exit(1);
}

const releaseNote = getSection(visibleBody, 'Release Note');
const noReleaseNote = getSection(visibleBody, 'No Release Note');
const hasReleaseLabel = labels.includes('release-note');

if (hasReleaseLabel) {
  if (noReleaseNote !== null) {
    console.error('::error::Use either release-note metadata or an explicit no-release-note reason, not both.');
    process.exit(1);
  }
  if (releaseNote === null) {
    console.error("::error::A PR with the 'release-note' label needs a '## Release Note' section.");
    process.exit(1);
  }
  for (const field of ['Category', 'Title']) {
    if (!new RegExp(`^${field}:\\s*\\S`, 'm').test(releaseNote)) {
      console.error(`::error::The Release Note section needs a non-empty '${field}:' field.`);
      process.exit(1);
    }
  }
  console.log('Release Note metadata OK.');
  process.exit(0);
}

if (releaseNote !== null) {
  console.error("::error::A '## Release Note' section must use the 'release-note' label, or be replaced by '## No Release Note'.");
  process.exit(1);
}

if (noReleaseNote === null || !/^Reason:\s*\S/m.test(noReleaseNote)) {
  console.error("::error::Choose release-note metadata with the 'release-note' label, or add '## No Release Note' with a non-empty Reason.");
  process.exit(1);
}

console.log('Explicit no-release-note reason OK.');
