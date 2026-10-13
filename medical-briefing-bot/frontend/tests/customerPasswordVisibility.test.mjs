import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function loadComponent(filename) {
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const require = createRequire(filename);
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: name => name === './Dialog'
      ? loadComponent(new URL('../src/components/customer-admin/Dialog.tsx', import.meta.url))
      : name === '@/lib/customer-auth/validation.mjs'
        ? require('../../lib/customer-auth/validation.mjs')
        : require(name),
  });
  return exports;
}

const { ChangePasswordDialog } = loadComponent(new URL('../src/components/customer-admin/AccountDialogs.tsx', import.meta.url));
const render = () => renderToStaticMarkup(React.createElement(ChangePasswordDialog, {
  onClose() {},
  async onConfirm() { assert.fail('Rendering must not submit a password change'); },
}));

test('all three password fields start masked with independent accessible visibility controls', () => {
  const html = render();
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
  const toggles = [...html.matchAll(/<button\b[^>]*aria-controls="[^"]+"[^>]*>/g)].map(match => match[0]);
  assert.equal(inputs.length, 3);
  assert.equal(toggles.length, 3);
  const ids = inputs.map(input => input.match(/\bid="([^"]+)"/)[1]);
  assert.equal(new Set(ids).size, 3);
  inputs.forEach((input, index) => {
    assert.match(input, /type="password"/);
    assert.match(input, /maxLength="512"/);
    assert.match(input, /class="ca-input pr-12"/);
    assert.ok(toggles[index].includes(`aria-controls="${ids[index]}"`));
    assert.match(toggles[index], /type="button"/);
    assert.match(toggles[index], /aria-label="비밀번호 표시"/);
    assert.match(toggles[index], /title="비밀번호 표시"/);
    assert.match(toggles[index], /aria-pressed="false"/);
  });
  assert.equal((html.match(/lucide-eye\b/g) || []).length, 3);
});

test('a newly mounted password dialog always renders all fields hidden', () => {
  for (let opening = 0; opening < 2; opening++) {
    const html = render();
    assert.equal((html.match(/type="password"/g) || []).length, 3);
    assert.doesNotMatch(html, /type="text"|aria-pressed="true"/);
  }
});

test('password dialog retains labels, autocomplete, length guidance and a single submit button', () => {
  const html = render();
  for (const label of ['새 비밀번호', '새 비밀번호 확인', '현재 관리자 비밀번호']) {
    assert.ok(html.includes(`>${label}</label>`));
  }
  assert.equal((html.match(/autoComplete="new-password"/g) || []).length, 2);
  assert.equal((html.match(/autoComplete="current-password"/g) || []).length, 1);
  assert.match(html, /12자 이상, UTF-8 512바이트 이하/);
  assert.equal((html.match(/type="submit"/g) || []).length, 1);
  assert.match(html, /type="submit"[^>]*>비밀번호 변경<\/button>/);
});
