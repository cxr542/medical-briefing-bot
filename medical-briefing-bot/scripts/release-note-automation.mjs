import { NOTE_PATH, AUTOMATION_PREFIX, appendNote, sourceIdentity, validateAddition } from './release-note-contract.mjs';

export const marker = number => `<!-- release-note-source-pr:${number} -->`;
export const noteBody = pr => `${marker(pr.number)}\n## Summary\n\nRegister the release note for ${pr.html_url}.\n\n## No Release Note\nReason: This PR records an already merged source PR; generating another note would duplicate that change.\n\n## Verification\n\nApprove eligible CI workflows, review the exact head SHA, and merge manually. No automatic merge.\n`;
const readNotes = async (api, repo, ref) => {
  const { data } = await api.repos.getContent({ ...repo, path: NOTE_PATH, ref });
  if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('Release note file is unavailable.');
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
};
const refHead = async (api, repo, branch) => (await api.git.getRef({ ...repo, ref: `heads/${branch}` })).data.object.sha;
const optionalRef = async (api, repo, branch) => {
  try { return await refHead(api, repo, branch); } catch (e) { if (e.status === 404) return null; throw e; }
};
const eligible = pr => pr.merged_at && pr.base?.ref === 'main' && !pr.head?.ref?.startsWith(AUTOMATION_PREFIX) && pr.labels?.some(x => x.name === 'release-note');
const safeFailure = message => { throw new Error(message); };

export async function generateNotePR({ github, repository, number, dryRun = true }) {
  const api = github.rest;
  const [owner, repo] = repository.split('/');
  if (!owner || !repo || !Number.isSafeInteger(number) || number < 1) safeFailure('Invalid source PR number.');
  const target = { owner, repo };
  const { data: pr } = await api.pulls.get({ ...target, pull_number: number });
  if (!eligible(pr)) return { status: 'excluded', number };
  const base = await refHead(api, target, 'main');
  const existing = await readNotes(api, target, base);
  const generated = appendNote(existing, pr, repository);
  if (!generated.added) return { status: 'already-recorded', number };
  const branch = `${AUTOMATION_PREFIX}${number}`;
  const listPRs = async state => (await api.pulls.list({ ...target, state, base: 'main', head: `${owner}:${branch}`, per_page: 100 })).data;
  const open = await listPRs('open');
  if (open.length > 1) safeFailure('Multiple note PRs require manual review.');
  let head = await optionalRef(api, target, branch);
  if (open.length && !head) safeFailure('Existing note PR branch is unavailable.');
  if (head) {
    const { data: commit } = await api.git.getCommit({ ...target, commit_sha: head });
    // Never reset/rebase/force-push existing automation or manually amended data.
    if (commit.parents.length !== 1 || commit.parents[0].sha !== base) safeFailure('Main/branch moved; reconcile the note PR manually.');
    const { data: diff } = await api.repos.compareCommitsWithBasehead({ ...target, basehead: `${base}...${head}` });
    if (diff.files?.length !== 1 || diff.files[0].filename !== NOTE_PATH || diff.files[0].status !== 'modified') safeFailure('Automation branch contains unexpected changes.');
    validateAddition(existing, await readNotes(api, target, head), pr, repository);
    if (open.length) {
      const notePR = open[0];
      if (!notePR.body?.includes(marker(number)) || notePR.labels.some(x => x.name === 'release-note')) safeFailure('Existing note PR metadata requires manual review.');
      return { status: 'existing-pr', number, pr: notePR.number };
    }
    if ((await listPRs('closed')).length) safeFailure('Closed note PR requires explicit operator review before retry.');
  }
  if (dryRun) return { status: head ? 'would-reuse-branch' : 'would-create-pr', number };
  if (await refHead(api, target, 'main') !== base) safeFailure('Main moved before branch creation; retry safely.');
  if (!head) {
    const { data: parent } = await api.git.getCommit({ ...target, commit_sha: base });
    const { data: tree } = await api.git.createTree({ ...target, base_tree: parent.tree.sha,
      tree: [{ path: NOTE_PATH, mode: '100644', type: 'blob', content: JSON.stringify(generated.notes, null, 2) + '\n' }] });
    const { data: commit } = await api.git.createCommit({ ...target, message: `docs: record release note for PR #${number}`, tree: tree.sha, parents: [base] });
    head = commit.sha;
    try { await api.git.createRef({ ...target, ref: `refs/heads/${branch}`, sha: head }); }
    catch (e) { if (e.status !== 422) throw e; safeFailure('Branch creation raced; retry to validate the existing branch.'); }
  }
  if (await refHead(api, target, 'main') !== base || await refHead(api, target, branch) !== head) safeFailure('Main/automation branch moved; existing branch preserved for review.');
  try {
    const { data: created } = await api.pulls.create({ ...target, head: branch, base: 'main', title: `docs: release note for PR #${number}`, body: noteBody(pr), maintainer_can_modify: false });
    return { status: 'created-pr', number, pr: created.number };
  } catch (error) {
    if (error.status !== 422) throw error;
    const raced = await listPRs('open');
    if (raced.length === 1 && raced[0].body?.includes(marker(number)) && !raced[0].labels.some(x => x.name === 'release-note')) return { status: 'existing-pr', number, pr: raced[0].number };
    safeFailure('PR creation failed; branch preserved for safe retry.');
  }
}

export async function reconcile({ github, repository, since, dryRun = true }) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(since || '') || !Number.isFinite(Date.parse(since))) safeFailure('Reconciliation requires an explicit UTC cutover timestamp.');
  const [owner, repo] = repository.split('/');
  const pulls = await github.paginate(github.rest.pulls.list, { owner, repo, state: 'closed', base: 'main', per_page: 100 });
  const results = [];
  for (const pr of pulls.filter(pr => eligible(pr) && Date.parse(pr.merged_at) >= Date.parse(since)).sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.number - b.number)) {
    try { results.push(await generateNotePR({ github, repository, number: pr.number, dryRun })); }
    catch { results.push({ number: pr.number, status: 'needs-review' }); }
  }
  return results;
}

export async function validateNotePullRequest({ github, repository, number }) {
  const [owner, repo] = repository.split('/');
  const target = { owner, repo };
  const { data: pr } = await github.rest.pulls.get({ ...target, pull_number: number });
  if (!pr.head.ref.startsWith(AUTOMATION_PREFIX)) return { status: 'not-note-pr' };
  if (pr.head.repo?.full_name !== repository || pr.base.repo?.full_name !== repository || pr.base.ref !== 'main') safeFailure('Note PR must stay within the repository and target main.');
  const suffix = pr.head.ref.slice(AUTOMATION_PREFIX.length);
  if (!/^[1-9]\d*$/.test(suffix) || !Number.isSafeInteger(Number(suffix))) safeFailure('Invalid automation branch.');
  const sourceNumber = Number(suffix);
  if (!pr.body?.includes(marker(sourceNumber)) || pr.labels.some(x => x.name === 'release-note')) safeFailure('Invalid note PR metadata.');
  const files = await github.paginate(github.rest.pulls.listFiles, { ...target, pull_number: number, per_page: 100 });
  if (files.length !== 1 || files[0].filename !== NOTE_PATH || files[0].status !== 'modified') safeFailure('Note PR may modify only generated release notes.');
  const { data: source } = await github.rest.pulls.get({ ...target, pull_number: sourceNumber });
  sourceIdentity(source, repository);
  validateAddition(await readNotes(github.rest, target, pr.base.sha), await readNotes(github.rest, target, pr.head.sha), source, repository);
  return { status: 'valid-note-pr', number, sourceNumber, head: pr.head.sha };
}
