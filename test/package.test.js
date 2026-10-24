const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
const root = path.join(__dirname, '..');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

test('metadata registers only the credit-only node and credential, without wallet dependencies', () => {
  assert.equal(pkg.name, 'n8n-nodes-tanod-credits');
  assert.match(pkg.name, /^n8n-nodes-.+$/);
  assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.keywords.includes('n8n-community-node-package'));
  assert.equal(pkg.repository.url, 'git+https://github.com/tanod-labs/n8n-nodes-tanod-credits.git');
  assert.deepEqual(pkg.dependencies, {});
  assert.equal(pkg.optionalDependencies, undefined);
  assert.deepEqual(pkg.peerDependencies, { 'n8n-workflow': '*' });
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['@types/node', 'n8n-workflow', 'typescript']);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  assert.ok(!Object.keys(lock.packages).some((name) => /@x402|\/viem$|\/esbuild$/.test(name)));
  assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/TanodCreditsOnlyApi.credentials.js']);
  assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/TanodCredits/TanodCredits.node.js']);
  for (const name of ['prepare', 'preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'postprepare']) {
    assert.equal(pkg.scripts[name], undefined);
  }
});

test('shipped code uses only relative modules and the n8n peer, with no restricted globals or wallet SDK', () => {
  for (const file of walk(path.join(root, 'dist')).filter((file) => file.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8');
    const ts = require('typescript');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const restricted = new Set(['process', 'global', 'globalThis', '__dirname', '__filename', 'setTimeout',
      'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'eval', 'fetch']);
    const visit = (node) => {
      if (ts.isIdentifier(node)) assert.ok(!restricted.has(node.text), `${file}: ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.doesNotMatch(source, /@x402|\bviem\b|walletSdk|privateKey|X-Tanod-Free|console\./);
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      assert.ok(match[1] === 'n8n-workflow' || match[1].startsWith('./'), match[1]);
    }
  }
});

test('source and compiled credential icons exist; node codex and registrations are complete', () => {
  const credential = new (require('../dist/credentials/TanodCreditsOnlyApi.credentials.js').TanodCreditsOnlyApi)();
  for (const folder of ['credentials', 'dist/credentials', 'nodes/TanodCredits', 'dist/nodes/TanodCredits']) {
    const svg = fs.readFileSync(path.join(root, folder, 'tanod.svg'), 'utf8');
    assert.equal(svg, fs.readFileSync(path.join(root, 'nodes/TanodCredits/tanod.svg'), 'utf8'));
    assert.doesNotMatch(svg, /<script|<image|href=/);
  }
  assert.equal(credential.test.request.url, 'https://tanod.dev/v1/credits/balance');
  const codex = require('../dist/nodes/TanodCredits/TanodCredits.node.json');
  assert.equal(codex.node, pkg.name);
  assert.deepEqual(codex.categories, ['Productivity', 'Utility']);
});

test('README example contains no credential and is wired to the new node', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const workflow = JSON.parse(readme.match(/```json\n([\s\S]*?)\n```/)[1]);
  const node = workflow.nodes.find((node) => node.type === `${pkg.name}.tanodCredits`);
  assert.equal(node.credentials, undefined);
  assert.equal(node.parameters.paymentMode, undefined);
  assert.equal(node.parameters.simplify, false);
  assert.equal(workflow.active, false);
  assert.equal(workflow.connections['Run Example'].main[0][0].node, node.name);
  for (const pattern of [/Open source \(MIT\)/, /operated by an autonomous AI agent/,
    /Each input item is one paid call/, /Retry On Fail/, /Loop Over Items/, /Split in Batches/,
    /Retrying an execution/, /Execute step/, /usableAsTool/, /AI Agent/,
    /fund a key with only what you are willing to spend/, /Allowed HTTP Request Domains/,
    /This is an unverified community node; n8n has not reviewed it\./,
    /not verified for n8n Cloud/, /does \*\*not\*\* use the free daily\nallowance/]) assert.match(readme, pattern);
  assert.doesNotMatch(readme, /USD\s+[0-9]|\$[0-9]|\/root\/|\/opt\/|\/etc\/|\/var\/|systemd|NPM_TOKEN|npm-publish|Co-Authored-By/);
});

test('release workflow is tag-only, repo-bound, uses provenance and separates build from publishing', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8');
  assert.ok(!workflow.includes('workflow_dispatch:'));
  assert.match(workflow, /tags:\s+\- 'v\*'/);
  assert.match(workflow, /github\.repository == 'tanod-labs\/n8n-nodes-tanod-credits'/);
  assert.match(workflow, /npm publish \.\/release\/n8n-nodes-tanod-credits\.tgz --provenance --access public --ignore-scripts/);
  assert.ok(!/secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN/.test(workflow));
  const build = workflow.slice(workflow.indexOf('  build:'), workflow.indexOf('  publish:'));
  const publish = workflow.slice(workflow.indexOf('  publish:'));
  assert.ok(!build.includes('id-token: write'));
  assert.ok(!/npm install|12\.2\.0/.test(build));
  assert.match(build, /npm --version.*11\.19\.0/);
  assert.match(build, /git merge-base --is-ancestor "\$RELEASE_SHA" origin\/main/);
  assert.match(build, /fetch-depth: 0/);
  assert.match(build, /npm ci --include=dev --ignore-scripts/);
  assert.match(build, /TANOD_PACKAGE_TARBALL: release\/n8n-nodes-tanod-credits\.tgz/);
  assert.match(publish, /environment: npm-publish/);
  assert.match(publish, /id-token: write/);
  assert.match(publish, /EXPECTED_SHA256: \$\{\{ needs.build.outputs.tarball_sha256 \}\}/);
  assert.ok(!/uses: actions\/checkout|run: npm (ci|test|install)|run: npm run (build|lint)|contents: read/.test(publish));
  assert.match(publish, /Node 24\.21\.0 bundles npm 11\.19\.0/);
  const npmGuard = publish.match(/NPM_VERSION="\$\(npm --version\)" node <<'NODE'\n([\s\S]*?)\n          NODE/)[1]
    .split('\n').map((line) => line.slice(10)).join('\n');
  for (const version of ['11.5.1', '11.19.0', '12.0.0']) execFileSync(process.execPath, ['-e', npmGuard], {
    cwd: root, env: { ...process.env, NPM_VERSION: version }, stdio: 'pipe',
  });
  for (const version of ['11.5.0', '11.4.9', '10.9.0', '11.5.1-beta', 'invalid']) assert.throws(() =>
    execFileSync(process.execPath, ['-e', npmGuard], { cwd: root,
      env: { ...process.env, NPM_VERSION: version }, stdio: 'pipe' }));
  for (const match of workflow.matchAll(/uses: actions\/[^\n]+/g)) assert.match(match[0], /@[a-f0-9]{40}/);
  const validation = workflow.match(/node <<'NODE'\n([\s\S]*?)\n          NODE/)[1]
    .split('\n').map((line) => line.slice(10)).join('\n');
  execFileSync(process.execPath, ['-e', validation], { cwd: root, env: { ...process.env, RELEASE_TAG: `v${pkg.version}` }, stdio: 'pipe' });
  for (const tag of ['v999.999.999', `v${pkg.version}-rc.1`, pkg.version, 'v$(printf injected)']) {
    assert.throws(() => execFileSync(process.execPath, ['-e', validation], {
      cwd: root, env: { ...process.env, RELEASE_TAG: tag }, stdio: 'pipe',
    }));
  }
});

test('main-history guard rejects off-main releases in an offline git fixture', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8');
  const guard = workflow.match(/test "\$\(git rev-parse HEAD\)" = "\$RELEASE_SHA"\n          git merge-base --is-ancestor "\$RELEASE_SHA" origin\/main/)[0].replace(/\n          /g, '\n');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tanod-credits-release-'));
  const git = (...args) => execFileSync('git', args, { cwd: temp, stdio: 'pipe', encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '--initial-branch=main');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', base);
    execFileSync('bash', ['-euo', 'pipefail', '-c', guard], { cwd: temp, env: { ...process.env, RELEASE_SHA: base }, stdio: 'pipe' });
    git('checkout', '-q', '-b', 'unmerged');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'unmerged');
    const unmerged = git('rev-parse', 'HEAD');
    assert.throws(() => execFileSync('bash', ['-euo', 'pipefail', '-c', guard], {
      cwd: temp, env: { ...process.env, RELEASE_SHA: unmerged }, stdio: 'pipe',
    }));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('packed artifact runs with only an n8n peer stub and contains no wallet or build/test tooling', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tanod-credits-pack-'));
  try {
    let archive;
    if (process.env.TANOD_PACKAGE_TARBALL) archive = path.resolve(root, process.env.TANOD_PACKAGE_TARBALL);
    else {
      const output = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
        { cwd: root, encoding: 'utf8', timeout: 30000 }));
      const pack = Array.isArray(output) ? output[0] : Object.values(output)[0];
      archive = path.join(temp, pack.filename);
    }
    const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', timeout: 30000 }).trim().split('\n');
    for (const entry of [...pkg.n8n.nodes, ...pkg.n8n.credentials, 'README.md', 'LICENSE', 'index.js', 'package.json',
      'dist/credentials/tanod.svg', 'dist/nodes/TanodCredits/tanod.svg', 'dist/nodes/TanodCredits/TanodCredits.node.json']) {
      assert.ok(names.includes(`package/${entry}`), entry);
    }
    assert.ok(names.every((name) => /^package\/(?:dist\/|README\.md$|LICENSE$|index\.js$|package\.json$)/.test(name)));
    assert.ok(!names.some((name) => /wallet|x402|viem|node_modules|\.env|\.map$/.test(name)));
    execFileSync('tar', ['-xzf', archive, '-C', temp], { timeout: 30000 });
    const isolated = path.join(temp, 'package');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(isolated, 'package.json'))).dependencies, {});
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const Module = require('node:module');
      const original = Module._load;
      class NodeOperationError extends Error {}
      Module._load = function (name, ...args) {
        if (name === 'n8n-workflow') return { NodeOperationError, NodeConnectionTypes: { Main: 'main' } };
        if (!name.startsWith('./') && !name.startsWith('../') && !name.startsWith('node:')) throw new Error('Unexpected module: ' + name);
        return original.call(this, name, ...args);
      };
      const { TanodCredits } = require('./dist/nodes/TanodCredits/TanodCredits.node.js');
      const { TanodCreditsOnlyApi } = require('./dist/credentials/TanodCreditsOnlyApi.credentials.js');
      const { OPS } = require('./dist/nodes/TanodCredits/operations.js');
      assert.equal(new TanodCreditsOnlyApi().test.request.method, 'GET');
      assert.equal(OPS.length, 10);
      let calls = 0;
      const ctx = {
        getInputData: () => [{ json: {} }],
        getNodeParameter: (name, i, fallback) => ({ operation: 'verifyEmail', simplify: false, email: 'person@example.com' }[name] ?? fallback),
        getCredentials: async (name) => { assert.equal(name, 'tanodCreditsOnlyApi'); return { creditKey: 'tnd_' + 'a'.repeat(43) }; },
        helpers: { httpRequestWithAuthentication: async (name, options) => {
          assert.equal(options.url, 'https://tanod.dev/v1/email/verify');
          assert.equal(options.disableFollowRedirect, true);
          calls++;
          return { statusCode: 200, body: { verdict: 'synthetic' } };
        } },
      };
      TanodCredits.prototype.execute.call(ctx).then((result) => {
        assert.equal(result[0][0].json.verdict, 'synthetic');
        assert.equal(calls, 1);
      }).catch((error) => { console.error(error); process.exitCode = 1; });
    `], { cwd: isolated, env: { ...process.env, NODE_PATH: '' }, stdio: 'pipe', timeout: 30000 });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
