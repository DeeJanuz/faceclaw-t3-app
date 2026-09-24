const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Production TypeScript compiled to CommonJS for vm-based test harnesses.
// Paths are relative to the repository root, matching how the suite runs.
const root = path.resolve(__dirname, '../..');
const cache = new Map();

function transpileSource(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

function transpile(file) {
  const resolved = path.resolve(root, file);
  if (!cache.has(resolved)) cache.set(resolved, transpileSource(fs.readFileSync(resolved, 'utf8')));
  return cache.get(resolved);
}

module.exports = { transpile, transpileSource };
