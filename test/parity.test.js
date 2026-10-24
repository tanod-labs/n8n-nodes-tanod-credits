const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const { TanodCredits } = require('../dist/nodes/TanodCredits/TanodCredits.node.js');
const { OPS } = require('../dist/nodes/TanodCredits/operations.js');
const { FIELDS, OUTPUT_FIELDS, selectOutput } = require('../dist/nodes/TanodCredits/output.js');
const snapshot = require('./output-schema.snapshot.json');
const previousRoot = path.resolve(__dirname, '../../n8n-nodes-tanod');
const hasPrevious = fs.existsSync(path.join(previousRoot, 'package.json'));
let previousDist;
let PreviousNode;
let previousOps;

// Always compile the sibling's current sources: ignored dist files may be stale.
// Standalone public-repo CI has no wallet sibling and skips only those comparisons.
if (hasPrevious) {
  previousDist = fs.mkdtempSync(path.join(os.tmpdir(), 'tanod-credit-parity-'));
  try {
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project',
      path.join(previousRoot, 'tsconfig.json'), '--outDir', previousDist], { stdio: 'pipe', timeout: 30000 });
    fs.symlinkSync(path.resolve(__dirname, '../node_modules'), path.join(previousDist, 'node_modules'), 'dir');
    PreviousNode = require(path.join(previousDist, 'nodes/Tanod/Tanod.node.js')).Tanod;
    previousOps = require(path.join(previousDist, 'nodes/Tanod/operations.js')).OPS;
  } catch (error) {
    fs.rmSync(previousDist, { recursive: true, force: true });
    throw error;
  }
  test.after(() => fs.rmSync(previousDist, { recursive: true, force: true }));
}

function context(parameters, response = { ok: true }, Node = TanodCredits) {
  const calls = [];
  const inputs = [{ json: { untouched: true }, binary: { input: { data: 'aW5wdXQ=' } } }];
  const properties = new Node().description.properties;
  const ctx = {
    getInputData: () => inputs,
    getNode: () => ({ name: 'Tanod Credits', type: 'n8n-nodes-tanod-credits.tanodCredits', parameters: {} }),
    getCredentials: async (name) => {
      assert.ok(['tanodCreditsApi', 'tanodCreditsOnlyApi'].includes(name));
      return { creditKey: 'tnd_' + 'a'.repeat(43) };
    },
    getNodeParameter: (name, i, fallback) => {
      const supplied = { simplify: false, paymentMode: 'credits', ...parameters };
      return supplied[name] ?? fallback ?? properties.find((property) => property.name === name)?.default;
    },
    continueOnFail: () => false,
    helpers: {
      assertBinaryData: () => ({ fileName: 'example.pdf' }),
      getBinaryDataBuffer: async () => Buffer.from('synthetic'),
      prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: buffer.toString('base64'), fileName, mimeType }),
      httpRequestWithAuthentication: async (name, options) => {
        calls.push({ name, options });
        return { statusCode: 200, body: structuredClone(response) };
      },
    },
  };
  return { ctx, calls, inputs };
}

test('copied credit transport differs only in its distinct credential registration', { skip: !hasPrevious }, () => {
  const previous = fs.readFileSync(path.join(previousRoot, 'nodes/Tanod/creditsTransport.ts'), 'utf8');
  const current = fs.readFileSync(path.join(__dirname, '../nodes/TanodCredits/creditsTransport.ts'), 'utf8');
  assert.equal(current, previous.replaceAll("'tanodCreditsApi'", "'tanodCreditsOnlyApi'"));
});

test('operation route and input schemas equal the freshly compiled wallet-compatible credit mode', { skip: !hasPrevious }, () => {
  const schema = (ops) => ops.map(({ resource, value, name, path, input, fileField, returnsFile }) =>
    ({ resource, value, name, path, input, fileField, returnsFile }));
  assert.deepEqual(schema(OPS), schema(previousOps));
});

test('shared UI definition differs only in documented ordering, copy and required URLs', { skip: !hasPrevious }, () => {
  const previous = new PreviousNode().description.properties;
  const current = new TanodCredits().description.properties;
  const oldOnly = ['paymentMode', 'options'];
  const newOnly = ['spendNotice', 'simplify', 'outputMode', 'outputFields'];
  assert.deepEqual(previous.filter((p) => !current.some((q) => p.name === q.name)).map((p) => p.name).sort(), oldOnly.sort());
  assert.deepEqual(current.filter((p) => !previous.some((q) => p.name === q.name)).map((p) => p.name).sort(), newOnly.sort());
  const shared = (properties) => properties.filter((p) => ![...oldOnly, ...newOnly].includes(p.name)).map((p) => {
    const normalized = Object.fromEntries(['displayName', 'name', 'type', 'default', 'typeOptions', 'displayOptions', 'noDataExpression']
      .filter((key) => p[key] !== undefined).map((key) => [key, p[key]]));
    if (p.required !== undefined && p.name !== 'url') normalized.required = p.required;
    if (p.options) normalized.options = p.options.map((option) => p.name === 'operation'
      ? { name: option.name, value: option.value } : option).sort((a, b) => a.name.localeCompare(b.name));
    return normalized;
  }).sort((a, b) => JSON.stringify([a.name, a.displayOptions]).localeCompare(JSON.stringify([b.name, b.displayOptions])));
  assert.deepEqual(shared(current), shared(previous));
  assert.ok(current.filter((p) => p.name === 'url').every((p) => p.required === true));
  // Copy/placeholder differences are intentional: pricing/count text removed,
  // action proper nouns/articles corrected, and e.g. placeholders added.
});

test('every buildBody parameter is declared and each literal fallback matches its UI default', () => {
  const file = path.join(__dirname, '../nodes/TanodCredits/TanodCredits.node.ts');
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const buildBody = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === 'buildBody');
  assert.ok(buildBody);
  const properties = new TanodCredits().description.properties;
  const names = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'p') {
      assert.ok(ts.isStringLiteral(node.arguments[0]));
      const name = node.arguments[0].text;
      const property = properties.find((p) => p.name === name);
      assert.ok(property, `buildBody reads undefined UI parameter ${name}`);
      names.add(name);
      if (node.arguments[1]) {
        const literal = node.arguments[1];
        const value = ts.isStringLiteral(literal) ? literal.text : ts.isNumericLiteral(literal) ? Number(literal.text)
          : literal.kind === ts.SyntaxKind.TrueKeyword ? true : literal.kind === ts.SyntaxKind.FalseKeyword ? false : undefined;
        assert.notEqual(value, undefined, `${name}: unsupported fallback literal`);
        assert.equal(value, property.default, `${name}: fallback differs from UI default`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(buildBody);
  assert.equal(names.size, 17);
});

for (const operation of OPS) {
  for (const setting of ['unset', 'non-default']) {
    const sources = setting === 'unset' ? [undefined] : operation.input === 'file-or-url' ? ['binary', 'url'] : ['url'];
    for (const inputSource of sources) test(`${operation.value}/${setting}/${inputSource ?? 'default'}: request and raw-output parity`,
      { skip: !hasPrevious }, async () => {
        const parameters = { operation: operation.value, resource: operation.resource };
        if (setting === 'non-default') Object.assign(parameters, {
          inputSource, binaryPropertyName: 'attachment', url: 'https://example.com/nondefault',
          text: 'Guten Tag', source: 'de', target: 'fr', email: 'example@example.com',
          pages: '2-3', tablesFormat: 'xlsx', ocrLang: 'fra', js: true, shotFormat: 'jpeg', fullPage: true,
          width: 960, height: 720, language: 'es', translateToEnglish: true,
        });
        const previous = context(parameters, { ok: true }, PreviousNode);
        const current = context(parameters);
        assert.deepEqual(await TanodCredits.prototype.execute.call(current.ctx), await PreviousNode.prototype.execute.call(previous.ctx));
        assert.deepEqual(current.calls.map((call) => call.options), previous.calls.map((call) => call.options));
        assert.equal(current.calls.length, 1);
        assert.deepEqual(current.inputs, [{ json: { untouched: true }, binary: { input: { data: 'aW5wdXQ=' } } }]);
      });
  }
}

test('simplified fields are declared by the pinned API schema snapshot and never silently sliced', () => {
  assert.deepEqual(Object.keys(FIELDS).sort(), Object.keys(snapshot.operations).sort());
  const known = new Set(Object.values(snapshot.operations).flatMap((entry) => entry.fields));
  for (const field of OUTPUT_FIELDS) assert.ok(known.has(field), `Selected Fields has unknown API field ${field}`);
  for (const op of OPS) {
    const schema = snapshot.operations[op.value];
    assert.equal(new Set(FIELDS[op.value]).size, FIELDS[op.value].length);
    for (const field of FIELDS[op.value]) assert.ok(schema.fields.includes(field), `${op.value}: unknown field ${field}`);
    const all = Object.fromEntries(schema.fields.map((field) => [field, field]));
    const simplified = selectOutput(all, op.value, 'simplified', []);
    assert.ok(Object.keys(simplified).length <= 10, op.value);
    for (const field of FIELDS[op.value]) assert.ok(Object.hasOwn(simplified, field), `${op.value}: silently dropped ${field}`);
    for (const field of ['operation', 'untrusted_content']) if (schema.fields.includes(field)) assert.ok(Object.hasOwn(simplified, field));
  }
  assert.ok(FIELDS.toMarkdown.includes('note'));
  assert.ok(!FIELDS.toMarkdown.includes('warnings'));
  assert.ok(FIELDS.verifyEmail.includes('notes'));
});

test('selected output is own fields only and retains safety markers without inventing an ID', () => {
  const json = { operation: 'synthetic', text: 'untrusted', untrusted_content: true, model: { name: 'test' } };
  assert.deepEqual(selectOutput(json, 'speechToText', 'selected', ['text', '__proto__', 'constructor', 'missing']),
    { operation: 'synthetic', untrusted_content: true, text: 'untrusted' });
  assert.equal(selectOutput(json, 'speechToText', 'raw', []), json);
});

for (const mode of ['simplified', 'raw', 'selected']) {
  for (const format of ['csv', 'xlsx']) test(`multiple ${format} outputs retain binary data and metadata in tool ${mode} mode`, async () => {
    const response = { operation: 'tables', format, table_count: 2, tables: [], untrusted_content: true, extra: 'raw-only',
      files: ['first', 'second'].map((name) => ({ name: `${name}.${format}`, content_type: format === 'csv' ? 'text/csv' :
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data_base64: 'YWJj', bytes: 3 })) };
    const m = context({ operation: 'pdfTables', inputSource: 'url', tablesFormat: format,
      outputMode: mode, outputFields: ['files', 'table_count'] }, response);
    m.ctx.isToolExecution = () => true;
    const [[item]] = await TanodCredits.prototype.execute.call(m.ctx);
    assert.equal(m.calls.length, 1);
    assert.deepEqual(Object.keys(item.binary), ['data', 'data2']);
    for (const [index, field] of ['data', 'data2'].entries()) {
      assert.equal(item.binary[field].data, 'YWJj');
      assert.equal(item.binary[field].fileName, response.files[index].name);
      assert.equal(item.json.files[index].data_base64, undefined);
      assert.equal(item.json.files[index].bytes, 3);
    }
    assert.equal(item.binary.input, undefined, 'input binary is not passed through');
    assert.equal(item.json.extra, mode === 'raw' ? 'raw-only' : undefined);
    assert.deepEqual(item.pairedItem, { item: 0 });
  });
}

for (const mode of ['simplified', 'raw']) test(`tool output ${mode} obeys its selector`, async () => {
  const response = { operation: 'to-markdown', markdown: 'synthetic', note: 'keep this note',
    untrusted_content: true, input_bytes: 123, extra: true };
  const m = context({ operation: 'toMarkdown', inputSource: 'url', outputMode: mode }, response);
  m.ctx.isToolExecution = () => true;
  const [[item]] = await TanodCredits.prototype.execute.call(m.ctx);
  assert.equal(item.json.note, 'keep this note');
  assert.equal(item.json.extra, mode === 'raw' ? true : undefined);
  assert.equal(m.calls.length, 1);
});

test('isToolExecution-absent fallback obeys normal Simplify and ignores hidden tool controls', async () => {
  for (const simplify of [true, false]) {
    const m = context({ operation: 'verifyEmail', simplify, outputMode: 'selected', outputFields: [] },
      { email: 'synthetic@example.com', notes: ['DNS only'], extra: true });
    assert.equal(m.ctx.isToolExecution, undefined);
    const [[item]] = await TanodCredits.prototype.execute.call(m.ctx);
    assert.deepEqual(item.json.notes, ['DNS only']);
    assert.equal(item.json.extra, simplify ? undefined : true);
  }
});

test('normal simplified file output retains metadata and binary', async () => {
  const m = context({ operation: 'officeToPdf', inputSource: 'url', simplify: true },
    { operation: 'to-pdf', file: { name: 'example.pdf', data_base64: 'YWJj', content_type: 'application/pdf' }, extra: true });
  const [[item]] = await TanodCredits.prototype.execute.call(m.ctx);
  assert.equal(item.json.extra, undefined);
  assert.equal(item.json.file.data_base64, undefined);
  assert.equal(item.binary.data.data, 'YWJj');
});

test('invalid output settings stop before spending', async () => {
  const m = context({ operation: 'verifyEmail', outputMode: 'typo' });
  m.ctx.isToolExecution = () => true;
  await assert.rejects(TanodCredits.prototype.execute.call(m.ctx), /supported output/);
  assert.equal(m.calls.length, 0);
});

test('malformed successful response produces a fixed error and no replay', async () => {
  for (const body of [null, 'synthetic', 123, []]) {
    const m = context({ operation: 'verifyEmail' }, body);
    await assert.rejects(TanodCredits.prototype.execute.call(m.ctx), /unexpected response.*balance before retrying/);
    assert.equal(m.calls.length, 1);
  }
});
