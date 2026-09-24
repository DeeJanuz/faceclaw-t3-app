const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

test('Hub regex literals avoid ICU properties and retain Unicode character membership', () => {
  const file = 'app/apps/t3/hub-view-model.ts';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const literals = [];
  function visit(node) {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const literal = node.getText(source);
      assert.equal(/\\[pP]\{/.test(literal), false, 'Android cannot parse ICU regex properties: ' + literal);
      literals.push(literal);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const compile = (literal) =>
    new RegExp(
      literal.slice(1, literal.lastIndexOf('/')),
      literal.slice(literal.lastIndexOf('/') + 1).replace('g', ''),
    );
  const dash = compile(literals.find((value) => value.includes('_\\s')));
  const control = compile(literals.find((value) => value.includes('\\u0000-\\u001f')));
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const ch = String.fromCodePoint(cp);
    assert.equal(dash.test(ch), /[\p{Dash_Punctuation}_\s]/u.test(ch), 'dash U+' + cp.toString(16));
    assert.equal(control.test(ch), /[\p{Cc}\p{Cf}]/u.test(ch), 'control U+' + cp.toString(16));
  }
});
