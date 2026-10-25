// What a failed Anthropic call means for AI prep (worker/prep.js): retry it, or end the job with a message
// the app shows as is. The detail (status, error type, Anthropic's message) goes to the logs and the
// Workflow's output, never to the app: it names no player, but it is about the server, not the user.

/** -> { retry: true } for a busy or unreachable API, else { error, detail }. */
export function aiFailure(e) {
  const status = e?.status;
  const body = e?.error?.error || {};
  const detail = [status, body.type, body.message || e?.message].filter(Boolean).join(' ');
  if (!status || status === 408 || status === 409 || status === 429 || status >= 500) return { retry: true, detail };
  if (/credit balance|usage limit|spend limit/i.test(body.message || '')) {
    return { error: 'AI prep is paused: its budget is used up. Try again later. The quick plan above still works.', detail };
  }
  if (status === 401 || status === 403) return { error: 'AI prep is not set up correctly on this server.', detail };
  return { error: 'The AI service turned down this request. Try again later.', detail };
}
