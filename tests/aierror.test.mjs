import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiFailure } from '../worker/aierror.js';

// The shape of the SDK's APIError: status, and the response body under error.
const apiError = (status, type, message) => ({ status, message: `${status} ${message}`, error: { type: 'error', error: { type, message } } });

test('aiFailure says the budget is used up when the account is out of credit', () => {
  const f = aiFailure(apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'));
  assert.match(f.error, /budget is used up/);
  assert.equal(f.retry, undefined);
  assert.equal(f.detail, '400 invalid_request_error Your credit balance is too low to access the Anthropic API.');
});

test('aiFailure says the budget is used up when the workspace hits its spend limit', () => {
  assert.match(aiFailure(apiError(400, 'invalid_request_error', 'You have reached your specified workspace API usage limits.')).error, /budget is used up/);
});

test('aiFailure blames the server setup for a bad or unauthorized key', () => {
  assert.match(aiFailure(apiError(401, 'authentication_error', 'invalid x-api-key')).error, /not set up correctly/);
  assert.match(aiFailure(apiError(403, 'permission_error', 'not allowed')).error, /not set up correctly/);
});

test('aiFailure ends the job on any other rejected request', () => {
  const f = aiFailure(apiError(400, 'invalid_request_error', 'max_tokens: too large'));
  assert.match(f.error, /turned down/);
  assert.match(f.detail, /max_tokens/);
});

test('aiFailure retries a busy API, a server error and a network failure', () => {
  assert.equal(aiFailure(apiError(429, 'rate_limit_error', 'slow down')).retry, true);
  assert.equal(aiFailure(apiError(529, 'overloaded_error', 'Overloaded')).retry, true);
  assert.equal(aiFailure(apiError(500, 'api_error', 'oops')).retry, true);
  assert.equal(aiFailure(new Error('fetch failed')).retry, true);
});
