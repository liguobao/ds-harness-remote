/**
 * 会话列表可见性（对齐 Desktop `sessionVisible` / Android `apps/android/src/lib/session-visibility.ts`）。
 *
 * 规则：
 * - `origin === 'subagent'` 的子会话不在平铺列表出现；
 * - 空白占位会话（`blank`）只保留「当前打开的那个」，且永远不匹配搜索词。
 *
 * 参数用原始字段而不是整个会话对象，方便 Node 侧做纯逻辑测试，也避免
 * util → net 的反向依赖。
 */
export function isVisibleSession(sessionId: string, blank: boolean, origin: string,
  currentSessionId: string, searchQuery: string): boolean {
  if (origin === 'subagent') {
    return false;
  }
  if (blank) {
    if (searchQuery.trim().length > 0) {
      return false;
    }
    if (sessionId !== currentSessionId) {
      return false;
    }
  }
  return true;
}
