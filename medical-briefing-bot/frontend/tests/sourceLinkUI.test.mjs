import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Exercise the real TSX without adding a second test runner or DOM dependency.
const filename = new URL('../src/components/SourceLink.tsx', import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const require = createRequire(filename);
const exports = {};
runInNewContext(compiled, { exports, require: (name) => require(name === '../lib/sourceLinks' ? '../lib/sourceLinks.ts' : name) });
const render = (article, props = {}) => renderToStaticMarkup(React.createElement(exports.SourceLink, { article, ...props }));
const hira = { source: '심평원 e-평가 (평가알림방)', title: '전체 공지 제목 <원문>', url: 'https://aq.hira.or.kr/hira_aq/index.jsp#brdSno=2279' };
const mfds = { source: '식품의약품안전처 보도자료', title: '식약처 공지', url: 'https://www.mfds.go.kr/brd/m_99/view.do?seq=50403' };

test('table guidance and direct actions share the same 44px button style without visible long labels', () => {
  const guidance = render(hira, { variant: 'icon' });
  const direct = render(mfds, { variant: 'icon' });
  const trigger = guidance.split('</button>')[0];
  assert.equal(trigger.match(/class="([^"]+)"/)[1], direct.match(/class="([^"]+)"/)[1]);
  assert.match(trigger, /h-11 w-11/);
  assert.match(trigger, /aria-haspopup="dialog"/);
  assert.match(trigger, /lucide-info/);
  assert.doesNotMatch(trigger, />기관에서 공지 찾기</);
  assert.match(direct, /lucide-external-link/);
  assert.match(direct, /target="_blank" rel="noopener noreferrer"/);
  assert.ok(direct.includes(`href="${mfds.url}"`));
});

test('guidance has a labelled modal, complete escaped title, procedure and canonical homepage', () => {
  const html = render(hira);
  assert.match(html, /<dialog[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);
  assert.match(html, /전체 공지 제목 &lt;원문&gt;/);
  assert.match(html, /건강보험심사평가원 e-평가 · 평가알림방/);
  assert.match(html, /직접 상세 링크가 확인되지 않았습니다/);
  assert.match(html, /기관 홈페이지 열기/);
  assert.match(html, /aria-label="기관 안내 닫기"/);
  assert.match(html, /href="https:\/\/aq.hira.or.kr\/hira_aq\/index.jsp"/);
  assert.doesNotMatch(html, /href="[^"]*brdSno/);
});

test('unsafe URLs remain noninteractive in both variants', () => {
  for (const variant of ['icon', 'content']) {
    const html = render({ ...hira, url: 'javascript:alert(1)' }, { variant });
    assert.doesNotMatch(html, /<(a|button|dialog)\b/);
  }
});

test('unknown safe links retain the unverified accessible label and original href', () => {
  const html = render({ source: 'Unknown', title: '제목', url: 'https://example.org/article' }, { variant: 'icon' });
  assert.match(html, /상세 미확인/);
  assert.match(html, /href="https:\/\/example.org\/article"/);
  assert.match(html, /lucide-info/);
});
