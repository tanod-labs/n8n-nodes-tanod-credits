const test = require('node:test');
const assert = require('node:assert/strict');
const { TanodCredits } = require('../dist/nodes/TanodCredits/TanodCredits.node.js');
const { TanodCreditsOnlyApi } = require('../dist/credentials/TanodCreditsOnlyApi.credentials.js');
const { tanodCreditRequest } = require('../dist/nodes/TanodCredits/creditsTransport.js');
const { OPS } = require('../dist/nodes/TanodCredits/operations.js');
const KEY = 'tnd_' + 'a'.repeat(43); // Synthetic, never sent to a network service.

function context({ key = KEY, status = 200, body = { ok: true }, error } = {}) {
  const calls = [], credentials = [];
  const ctx = {
    getCredentials: async (name) => { credentials.push(name); return { creditKey: key }; },
    getNode: () => ({ name: 'Tanod', type: 'n8n-nodes-tanod-credits.tanodCredits', typeVersion: 1, position: [0, 0], parameters: {} }),
    helpers: {
      httpRequestWithAuthentication: async function (name, options) {
        assert.equal(this, ctx);
        calls.push({ name, options });
        if (error) throw error;
        return { statusCode: status, body };
      },
    },
  };
  return { ctx, calls, credentials };
}

function execution({ parameters = {}, items = [{ json: {} }], continueOnFail = false, ...options } = {}) {
  const mock = context(options);
  mock.ctx.getInputData = () => items;
  mock.ctx.getNodeParameter = (name, _i, fallback) => ({
    operation: 'verifyEmail', simplify: false, email: 'person@example.com', ...parameters,
  }[name] ?? fallback);
  mock.ctx.continueOnFail = () => continueOnFail;
  mock.ctx.getNode = () => ({ name: 'Tanod', type: 'n8n-nodes-tanod-credits.tanodCredits', typeVersion: 1, position: [0, 0], parameters: {} });
  mock.ctx.helpers.prepareBinaryData = async (buffer, name, mimeType) => ({
    data: buffer.toString('base64'), fileName: name, mimeType,
  });
  return mock;
}

test('credit credential uses secret field, accepted Bearer header and free non-redirecting balance test', () => {
  const c = new TanodCreditsOnlyApi();
  assert.equal(c.name, 'tanodCreditsOnlyApi');
  assert.equal(c.properties[0].name, 'creditKey');
  assert.equal(c.properties[0].typeOptions.password, true);
  assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.creditKey}}');
  assert.deepEqual(c.test.request, { method: 'GET', url: 'https://tanod.dev/v1/credits/balance', disableFollowRedirect: true, timeout: 15000 });
  assert.equal(c.documentationUrl, 'https://tanod.dev/credits/');
  assert.deepEqual(c.icon, { light: 'file:tanod.svg', dark: 'file:tanod.svg' });
});

test('only one required credit credential; no legacy controls or fallback', () => {
  const d = new TanodCredits().description;
  assert.equal(d.name, 'tanodCredits');
  assert.equal(d.usableAsTool, true);
  assert.deepEqual(d.inputs, ['main']);
  assert.deepEqual(d.outputs, ['main']);
  assert.deepEqual(d.credentials, [{ name: 'tanodCreditsOnlyApi', required: true }]);
  assert.ok(!d.properties.some((p) => ['paymentMode', 'options', 'privateKey'].includes(p.name)));
  assert.match(d.properties.find((p) => p.name === 'spendNotice').displayName, /Each input item is one paid call/);
});

for (const op of OPS) test(`credit request ${op.value}: exact destination and one n8n-authenticated call`, async () => {
  const m = context();
  const body = { url: 'https://example.com/input', nested: { a: 1 } };
  assert.deepEqual(await tanodCreditRequest(m.ctx, op.path, body), { ok: true });
  assert.equal(m.calls.length, 1);
  assert.deepEqual(m.credentials, ['tanodCreditsOnlyApi']);
  assert.equal(m.calls[0].name, 'tanodCreditsOnlyApi');
  assert.deepEqual(m.calls[0].options, {
    method: 'POST', url: 'https://tanod.dev' + op.path, body,
    headers: { accept: 'application/json' }, json: true, returnFullResponse: true,
    ignoreHttpStatusErrors: true, disableFollowRedirect: true, timeout: 120000,
  });
  assert.ok(!JSON.stringify(m.calls).includes(KEY), 'only n8n injects the key');
});

for (const path of ['https://evil.invalid/v1/ocr', '//evil.invalid', '/v1/ocr?key=x', '/v1/ocr#fragment',
  '/v1/../credits/topup', '/v1/ocr/../credits/topup', '/v1/credits/topup', '/v1/ocr/', '/v1/%6fcr']) {
  test(`reject unapproved destination ${path} before credential lookup or HTTP`, async () => {
    const m = context();
    await assert.rejects(tanodCreditRequest(m.ctx, path, {}), /Unsupported/);
    assert.equal(m.calls.length, 0);
    assert.equal(m.credentials.length, 0);
  });
}

for (const key of ['', 'bad', 'tnd_' + 'a'.repeat(42), 'tnd_' + 'a'.repeat(44), KEY + '\n', ' ' + KEY,
  KEY + '\r\nX-Injected: yes', 'tnd_' + '/'.repeat(43), undefined, null, 42]) {
  test(`malformed key case ${JSON.stringify(key)?.slice(0, 28)} is rejected before HTTP`, async () => {
    const m = context();
    m.ctx.getCredentials = async () => ({ creditKey: key });
    await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), /must be tnd_/);
    assert.equal(m.calls.length, 0);
  });
}

test('missing HTTP response preserves unknown charge outcome and sanitized error', async () => {
  const m = context();
  m.ctx.helpers.httpRequestWithAuthentication = async () => undefined;
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (error) => {
    assert.match(error.message, /no valid response status.*balance before retrying/);
    assert.doesNotMatch(error.message, /Not charged|failed/);
    return true;
  });
});

test('missing credential never falls back to free tier or wallet', async () => {
  const m = context();
  m.ctx.getCredentials = async () => { throw new Error(KEY); };
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), /Select a Tanod prepaid/);
  assert.equal(m.calls.length, 0);
});

for (const status of [301, 302, 307, 308, 400, 401, 402, 422, 429, 500, 503, undefined]) {
  test(`credit HTTP ${status}: one attempt, no reflected secret and no fallback`, async () => {
    const m = context({ status, body: { error: { message: KEY } } });
    if (status === undefined) m.ctx.helpers.httpRequestWithAuthentication = async () => ({ body: { error: KEY } });
    await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (e) => {
      assert.ok(!e.message.includes(KEY));
      if (status >= 400 && status < 500) assert.match(e.message, /Not charged/);
      else {
        assert.match(e.message, /charge outcome is unknown.*balance before retrying/);
        assert.doesNotMatch(e.message, /Not charged/);
      }
      if (status === 401) assert.match(e.message, /invalid or revoked/);
      if (status === 402) assert.match(e.message, /not accepted by the service right now.*No wallet payment or automatic retry/);
      if (status >= 300 && status < 400) assert.match(e.message, /redirect/);
      return true;
    });
    assert.ok(m.calls.length <= 1);
  });
}

for (const [status, body] of [
  [502, ''], [524, '<html>gateway timeout ' + KEY + '</html>'], [500, 'Internal Server Error ' + KEY],
  [504, { error: 'timeout' }], [503, { error: { code: 123, message: KEY } }],
]) test(`unstructured HTTP ${status} leaves the charge outcome unknown`, async () => {
  const m = context({ status, body });
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (error) => {
    assert.match(error.message, /charge outcome is unknown.*balance before retrying/);
    assert.doesNotMatch(error.message, /Not charged|Check the input|failed/);
    assert.ok(!error.message.includes(KEY));
    return true;
  });
  assert.equal(m.calls.length, 1);
});

for (const [status, code, expected] of [
  [503, 'busy', /at capacity/], [504, 'timeout', /took too long/], [503, 'unknown_api_code', /Try again later/],
]) test(`structured API HTTP ${status}/${code} is not charged`, async () => {
  const m = context({ status, body: { error: { code, message: KEY } } });
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (error) => {
    assert.match(error.message, expected);
    assert.match(error.message, /Not charged/);
    assert.doesNotMatch(error.message, /charge outcome is unknown|Check the input|failed/);
    assert.ok(!error.message.includes(KEY));
    return true;
  });
  assert.equal(m.calls.length, 1);
});

for (const upstreamError of ['Credit balance too low: ' + KEY, 'Payment required: ' + KEY,
  'Credit balance too low', KEY, { code: 'credits_insufficient', message: KEY }, '__proto__', undefined, null, 402]) {
  test(`credit 402 ${JSON.stringify(upstreamError)?.slice(0, 28)} selects only fixed text`, async () => {
    const m = context({ status: 402, body: { x402Version: 2, error: upstreamError, resource: { url: 'https://tanod.dev/v1/ocr' }, accepts: [] } });
    await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (error) => {
      assert.ok(!error.message.includes(KEY));
      assert.match(error.message, typeof upstreamError === 'string' && upstreamError.startsWith('Credit balance too low')
        ? /balance is insufficient/ : /not accepted by the service right now/);
      assert.match(error.message, /Not charged/);
      assert.match(error.message, /https:\/\/tanod.dev\/credits\//);
      return true;
    });
    assert.equal(m.calls.length, 1);
  });
}

test('real invalid_credit_key body produces a fixed 401 message without reflecting text', async () => {
  const m = context({ status: 401, body: { error: { code: 'invalid_credit_key', message: KEY } } });
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (error) => {
    assert.match(error.message, /invalid or revoked.*Not charged/);
    assert.ok(!error.message.includes(KEY));
    return true;
  });
  assert.equal(m.calls.length, 1);
});

for (const [code, expected] of [
  ['too_large', /input is too large/], ['body_too_large', /input is too large/],
  ['input_too_large', /input is too large/], ['document_too_large', /document is too large/],
  ['output_too_large', /result is too large/], ['response_too_large', /result is too large/],
  ['unsupported_format', /file format is not supported/], ['unsupported_content_type', /file type is not supported/],
  ['unsupported_encoding', /encoding is not supported/], ['pdf_encrypted', /PDF is encrypted/],
  ['encrypted_document', /document is encrypted/], ['unsupported_encryption', /encryption is not supported/],
  ['rate_limited', /request limit/], ['busy', /at capacity/], ['queue_full', /at capacity/],
  ['micro_unavailable', /temporarily unavailable/], ['timeout', /took too long/], ['__proto__', /not accepted/],
  ['constructor', /not accepted/], [KEY, /not accepted/],
]) test(`allowlisted response ${code.slice(0, 24)} selects a fixed actionable message`, async () => {
  const m = context({ status: 422, body: { error: { code, message: KEY } } });
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (error) => {
    assert.match(error.message, expected);
    assert.match(error.message, /Not charged/);
    assert.doesNotMatch(error.message, /failed/);
    assert.ok(!error.message.includes(KEY));
    return true;
  });
  assert.equal(m.calls.length, 1);
});

for (const reason of ['timeout', 'redirect', 'socket']) test(`credit ${reason}: HTTP exceptions cannot leak headers`, async () => {
  const m = context({ error: new Error(`${reason}: Authorization: Bearer ${KEY}`) });
  await assert.rejects(tanodCreditRequest(m.ctx, '/v1/ocr', {}), (e) => {
    assert.match(e.message, /No automatic retry.*charge outcome is unknown.*balance before retrying/);
    assert.doesNotMatch(e.message, /Not charged/);
    assert.ok(!e.message.includes(KEY));
    return true;
  });
  assert.equal(m.calls.length, 1);
});

test('node credit mode ignores free/cap options, never reads wallet, pairs output', async () => {
  const m = execution({ parameters: { options: { useFree: true, maxPriceUsd: 0 } } });
  const result = await TanodCredits.prototype.execute.call(m.ctx);
  assert.deepEqual(result, [[{ json: { ok: true }, pairedItem: { item: 0 } }]]);
  assert.deepEqual(m.credentials, ['tanodCreditsOnlyApi']);
  assert.deepEqual(m.calls[0].options.body, { email: 'person@example.com' });
  assert.equal(m.calls[0].options.headers['X-Tanod-Free'], undefined);
});

test('credit mode preserves binary file output and per-item pairing', async () => {
  const m = execution({ items: [{ json: {} }, { json: {} }],
    body: { file: { name: 'result.pdf', content_type: 'application/pdf', data_base64: 'YWJj' } } });
  // Return a fresh answer per item because output extraction removes base64 from the JSON.
  m.ctx.helpers.httpRequestWithAuthentication = async () => ({ statusCode: 200,
    body: { file: { name: 'result.pdf', content_type: 'application/pdf', data_base64: 'YWJj' } } });
  const [results] = await TanodCredits.prototype.execute.call(m.ctx);
  assert.equal(results.length, 2);
  for (const [i, item] of results.entries()) {
    assert.equal(item.binary.data.data, 'YWJj');
    assert.equal(item.json.file.data_base64, undefined);
    assert.deepEqual(item.pairedItem, { item: i });
  }
});

test('credit mode builds the existing binary input schema', async () => {
  const m = execution({ parameters: { operation: 'toMarkdown', inputSource: 'binary' } });
  m.ctx.helpers.assertBinaryData = () => ({ fileName: 'example.pdf' });
  m.ctx.helpers.getBinaryDataBuffer = async () => Buffer.from('synthetic');
  await TanodCredits.prototype.execute.call(m.ctx);
  assert.deepEqual(m.calls[0].options.body, { file_base64: Buffer.from('synthetic').toString('base64'), filename: 'example.pdf' });
});

test('continueOnFail emits only sanitized credit errors per item', async () => {
  const m = execution({ continueOnFail: true, items: [{ json: {} }, { json: {} }], error: new Error(KEY) });
  const [results] = await TanodCredits.prototype.execute.call(m.ctx);
  assert.equal(results.length, 2);
  assert.ok(!JSON.stringify(results).includes(KEY));
  assert.match(results[0].json.error, /No automatic retry/);
});

test('continueOnFail mixed 402/200 results make exactly one request per item with no replay', async () => {
  const m = execution({ continueOnFail: true, items: [{ json: {} }, { json: {} }, { json: {} }] });
  const statuses = [402, 200, 402];
  let attempts = 0;
  m.ctx.helpers.httpRequestWithAuthentication = async (name, options) => {
    m.calls.push({ name, options });
    const statusCode = statuses[attempts++];
    return { statusCode, body: statusCode === 200 ? { accepted: true } :
      { x402Version: 2, error: 'Credit balance too low: ' + KEY, accepts: [] } };
  };
  const [results] = await TanodCredits.prototype.execute.call(m.ctx);
  assert.equal(attempts, 3);
  assert.equal(m.calls.length, 3);
  assert.equal(results.length, 3);
  for (const [i, result] of results.entries()) assert.deepEqual(result.pairedItem, { item: i });
  assert.match(results[0].json.error, /balance is insufficient.*Not charged/);
  assert.deepEqual(results[1].json, { accepted: true });
  assert.match(results[2].json.error, /balance is insufficient.*Not charged/);
  assert.ok(!JSON.stringify(results).includes(KEY));
});

test('normal node error does not embed the underlying credit HTTP error', async () => {
  const m = execution({ error: new Error(KEY) });
  await assert.rejects(TanodCredits.prototype.execute.call(m.ctx), (e) => !e.message.includes(KEY) && /No automatic retry/.test(e.message));
});

test('unknown operation cannot make any request or read a credential', async () => {
  const m = execution({ parameters: { operation: 'typo' } });
  await assert.rejects(TanodCredits.prototype.execute.call(m.ctx), /Unsupported Tanod/);
  assert.equal(m.calls.length, 0);
  assert.equal(m.credentials.length, 0);
});
