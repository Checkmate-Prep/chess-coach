// Keeps the org project "Checkmate Prep roadmap" in step with pull requests (.github/workflows/project.yml).
// GitHub's built-in project workflows don't move an issue when a PR that closes it opens, so the issues a PR
// closes ("Closes #N", or the issue number in a claude/issue-N-… branch) are moved here:
//   branch claude/issue-N-… created, PR opened as draft, or changes requested -> In progress
//   PR opened, ready for review, or new commits on it                         -> In review
//   PR merged -> Done; PR closed without merging -> Next (back in the queue)
// `--sync` (manual run) applies the same rules to every open PR, to repair the board.
// Needs PROJECT_TOKEN (classic token with `project` and `repo`, or a fine-grained one with organization
// Projects read/write): the workflow's own GITHUB_TOKEN can't reach organization projects. Without it, it skips.
import { readFileSync } from 'node:fs';

export const PROJECT = 'Checkmate Prep roadmap';
export const OWNER = 'Checkmate-Prep';

/** The board status a pull request event puts its issues in, or null when it changes nothing. */
export function statusFor({ event, action, draft = false, merged = false, review = null }) {
  if (event === 'create') return 'In progress';
  if (event === 'pull_request_review') return review === 'changes_requested' ? 'In progress' : null;
  if (event !== 'pull_request') return null;
  if (action === 'closed') return merged ? 'Done' : 'Next';
  if (action === 'converted_to_draft') return 'In progress';
  if (['opened', 'reopened', 'ready_for_review', 'synchronize'].includes(action)) return draft ? 'In progress' : 'In review';
  return null;
}

/** Issue numbers a PR body closes (Closes/Fixes/Resolves #N), plus the one in a claude/issue-N-… branch. */
export function issuesOf({ body = '', branch = '' }) {
  const out = new Set();
  for (const m of String(body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)) out.add(+m[1]);
  const b = /(?:^|\/)issue-(\d+)(?:-|$)/.exec(branch || '');
  if (b) out.add(+b[1]);
  return [...out];
}

// ---------- GitHub (only when run as a script) ----------
async function gql(token, query, variables = {}) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }),
  });
  const out = await r.json();
  if (!r.ok || out.errors) throw new Error(`GitHub: ${JSON.stringify(out.errors || out)}`);
  return out.data;
}

async function board(token) {
  const d = await gql(token, `query($o: String!) { organization(login: $o) { projectsV2(first: 50) { nodes { id title
    field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } } } }`, { o: OWNER });
  const p = d.organization.projectsV2.nodes.find((x) => x.title === PROJECT);
  if (!p) throw new Error(`No project called "${PROJECT}" in ${OWNER}.`);
  return { id: p.id, field: p.field.id, options: Object.fromEntries(p.field.options.map((o) => [o.name, o.id])) };
}

async function move(token, b, repo, number, status) {
  const [owner, name] = repo.split('/');
  const d = await gql(token, `query($o: String!, $n: String!, $i: Int!) { repository(owner: $o, name: $n) { issue(number: $i) { id state
    projectItems(first: 20) { nodes { id project { id } } } } } }`, { o: owner, n: name, i: number });
  const issue = d.repository.issue;
  if (!issue) return console.log(`#${number}: not an issue, skipped`);
  if (issue.state === 'CLOSED' && status !== 'Done') return console.log(`#${number}: closed, left in place`);
  let item = issue.projectItems.nodes.find((x) => x.project.id === b.id)?.id;
  if (!item) item = (await gql(token, 'mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }', { p: b.id, c: issue.id })).addProjectV2ItemById.item.id;
  if (!b.options[status]) throw new Error(`The Status field has no option "${status}".`);
  await gql(token, `mutation($p: ID!, $i: ID!, $f: ID!, $v: String!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f,
    value: { singleSelectOptionId: $v } }) { projectV2Item { id } } }`, { p: b.id, i: item, f: b.field, v: b.options[status] });
  console.log(`#${number} -> ${status}`);
}

/** Issues a PR closes: GitHub's own link (closingIssuesReferences) and what issuesOf reads. */
async function linked(token, repo, pr) {
  const [owner, name] = repo.split('/');
  const d = await gql(token, `query($o: String!, $n: String!, $i: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $i) {
    closingIssuesReferences(first: 20) { nodes { number } } } } }`, { o: owner, n: name, i: pr.number });
  return [...new Set([...d.repository.pullRequest.closingIssuesReferences.nodes.map((x) => x.number), ...issuesOf({ body: pr.body, branch: pr.head.ref })])];
}

async function main() {
  const token = process.env.PROJECT_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token) return console.log('PROJECT_TOKEN is not set: the board is not updated.');
  const b = await board(token);
  if (process.argv.includes('--sync')) {
    const r = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, { headers: { authorization: `Bearer ${token}` } });
    for (const pr of await r.json()) {
      const status = pr.draft ? 'In progress' : 'In review';
      for (const n of await linked(token, repo, pr)) await move(token, b, repo, n, status);
    }
    return;
  }
  const event = process.env.GITHUB_EVENT_NAME, payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (event === 'create') {
    if (payload.ref_type !== 'branch') return;
    const status = statusFor({ event });
    for (const n of issuesOf({ branch: payload.ref })) await move(token, b, repo, n, status);
    return;
  }
  const pr = payload.pull_request;
  const status = statusFor({ event, action: payload.action, draft: pr.draft, merged: pr.merged, review: payload.review?.state });
  if (!status) return console.log(`${event} ${payload.action}: nothing to move`);
  for (const n of await linked(token, repo, pr)) await move(token, b, repo, n, status);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
