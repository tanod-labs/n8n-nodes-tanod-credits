const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'nodes', 'TanodCredits', 'tanod.svg');
for (const dir of ['nodes/TanodCredits', 'credentials']) {
  const dstDir = path.join(__dirname, '..', 'dist', dir);
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, path.join(dstDir, 'tanod.svg'));
}
fs.copyFileSync(path.join(__dirname, '..', 'nodes', 'TanodCredits', 'TanodCredits.node.json'),
  path.join(__dirname, '..', 'dist', 'nodes', 'TanodCredits', 'TanodCredits.node.json'));

