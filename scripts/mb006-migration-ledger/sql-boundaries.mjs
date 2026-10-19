import { createHash } from 'node:crypto';
import { LedgerError } from './manifest.mjs';

export function statements(source) {
  const result = [];
  let start = 0;
  let tokens = [];
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('--', i)) {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new LedgerError('UNTERMINATED_COMMENT');
      continue;
    }
    if (c === "'" || c === '"') {
      const escaped = c === "'" && /[eE]/.test(source[i - 1] || '') && !/[\w$]/.test(source[i - 2] || '');
      i++;
      let closed = false;
      while (i < source.length) {
        if (escaped && source[i] === '\\') { i += 2; continue; }
        if (source[i] === c) {
          if (source[i + 1] === c) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) throw new LedgerError('UNTERMINATED_QUOTE');
      tokens.push('<QUOTED>');
      continue;
    }
    if (c === '$') {
      const tag = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (!tag) throw new LedgerError('UNSUPPORTED_DOLLAR_TOKEN');
      const end = source.indexOf(tag, i + tag.length);
      if (end < 0) throw new LedgerError('UNTERMINATED_DOLLAR_QUOTE');
      tokens.push('<DOLLAR_BODY>'); i = end + tag.length;
      continue;
    }
    if (c === '\\') throw new LedgerError('PSQL_META_COMMAND_FORBIDDEN');
    if (c === ';') {
      if (tokens.length) result.push({ start, end: i + 1, tokens });
      tokens = []; start = ++i; continue;
    }
    const word = source.slice(i).match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0];
    if (word) { tokens.push(word.toUpperCase()); i += word.length; }
    else { tokens.push(c); i++; }
  }
  if (tokens.length) throw new LedgerError('MISSING_STATEMENT_TERMINATOR');
  return result;
}

export function transactionBody(source) {
  const parts = statements(source);
  if (parts.length < 3 || parts[0].tokens.join(' ') !== 'BEGIN' || parts.at(-1).tokens.join(' ') !== 'COMMIT') {
    throw new LedgerError('UNEXPECTED_TRANSACTION_ENVELOPE');
  }
  const forbidden = new Set(['BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE', 'PREPARE']);
  if (parts.slice(1, -1).some(part => forbidden.has(part.tokens[0]))) throw new LedgerError('INNER_TRANSACTION_CONTROL');
  return source.slice(parts[0].end, parts.at(-2).end);
}

export function checkedBody(source, migration) {
  if (createHash('sha256').update(source).digest('hex') !== migration.sha256) throw new LedgerError('CHECKSUM_MISMATCH');
  return transactionBody(source);
}
