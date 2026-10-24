import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import ts from 'typescript';

function loginHarness() {
  const filename = new URL('../src/components/CustomerLogin.tsx', import.meta.url);
  const require = createRequire(filename);
  const state = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useSyncExternalStore: () => true,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => {
        state[index] = typeof value === 'function' ? value(state[index]) : value;
      }];
    },
  };
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: name => {
    if (name === 'react') return hooks;
    if (name === '@/lib/customerReturn') return { safeUserNext() { assert.fail('No navigation during typing'); } };
    return require(name);
  } });
  return () => {
    cursor = 0;
    const elements = [];
    function visit(element) {
      if (!React.isValidElement(element)) return;
      elements.push(element);
      React.Children.forEach(element.props.children, visit);
    }
    visit(exports.default({ next: '/' }));
    return {
      input: elements.find(element => element.props.id === 'shared-password'),
      toggle: elements.find(element => element.props['aria-controls'] === 'shared-password'),
    };
  };
}

test('revealing replaces the password element while preserving Korean text through hide and reveal', () => {
  // Given: a masked login field with Korean, Latin, digits and punctuation.
  const render = loginHarness();
  const masked = render();
  assert.equal(masked.input.props.type, 'password');
  masked.input.props.onChange({ target: { value: '한글Password123!' } });
  assert.equal(render().input.key, masked.input.key);
  // When: the user explicitly reveals the field.
  masked.toggle.props.onClick();
  const visible = render();
  // Then: React must create a fresh text input, clearing Chrome's password history.
  assert.notEqual(visible.input.key, masked.input.key);
  assert.equal(visible.input.props.type, 'text');
  assert.equal(visible.input.props.value, '한글Password123!');
  assert.equal(visible.toggle.props.type, 'button');
  visible.toggle.props.onClick();
  assert.equal(render().input.props.type, 'password');
  assert.equal(render().input.props.value, '한글Password123!');
  render().toggle.props.onClick();
  assert.equal(render().input.props.value, '한글Password123!');
});
