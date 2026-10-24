export function safeUserNext(value: unknown): '/' | '/neurology-dashboard' {
  return value === '/neurology-dashboard' ? value : '/';
}
