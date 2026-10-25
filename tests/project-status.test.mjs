import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusFor, issuesOf } from '../scripts/project-status.mjs';

test('a pull request moves its issues through the board', () => {
  const pr = (action, o = {}) => statusFor({ event: 'pull_request', action, ...o });
  assert.equal(pr('opened'), 'In review');
  assert.equal(pr('opened', { draft: true }), 'In progress');
  assert.equal(pr('ready_for_review'), 'In review');
  assert.equal(pr('converted_to_draft'), 'In progress');
  assert.equal(pr('synchronize'), 'In review', 'new commits after changes were requested: back to review');
  assert.equal(pr('closed', { merged: true }), 'Done');
  assert.equal(pr('closed'), 'Next', 'closed without merging: back in the queue');
  assert.equal(pr('labeled'), null);
  assert.equal(statusFor({ event: 'pull_request_review', review: 'changes_requested' }), 'In progress');
  assert.equal(statusFor({ event: 'pull_request_review', review: 'approved' }), null);
  assert.equal(statusFor({ event: 'create' }), 'In progress');
});

test('linked issues come from the PR body and the branch name', () => {
  assert.deepEqual(issuesOf({ body: 'Closes #127\n\nAlso fixes #12 and resolves: #3' }), [127, 12, 3]);
  assert.deepEqual(issuesOf({ body: 'See #5, related to #6' }), [], 'a mention is not a link');
  assert.deepEqual(issuesOf({ branch: 'claude/issue-128-drill-ids' }), [128]);
  assert.deepEqual(issuesOf({ body: 'Closes #128', branch: 'claude/issue-128-drill-ids' }), [128]);
  assert.deepEqual(issuesOf({ branch: 'claude/upbeat-albattani-f6ivy9' }), []);
  assert.deepEqual(issuesOf({}), []);
});
