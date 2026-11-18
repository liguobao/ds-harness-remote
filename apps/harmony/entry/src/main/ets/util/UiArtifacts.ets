import { asArray, asBool, asNum, asRecord, asStr, jsonNum, jsonStr } from '../protocol/Types';

export const UI_TOOLS: string[] = ['ui_render', 'ui_patch', 'ui_render_widget', 'ui_compose'];
const MAX_UI_CHARS = 480000;

export class UiArtifactSnapshot {
  kind: string = 'declarative'; // 'declarative' | 'widget' | 'composition'
  uiId: string = '';
  version: number = 1;
  title: string = '';
  definition: Record<string, Object> = {};
  originSeq: number = 0;
}

export class UiToolInput {
  id: string = '';
  toolName: string = '';
  toolState: string = '';
  toolArguments: string = '';
  uiMetaJson: string = '';
  seq: number = 0;
  timestamp: number = 0;
}

/**
 * Throttled one-shot admission guard matching Android UiActionGuard:
 * rejects replay / rapid double-taps (< 1000ms) and revokes pending tickets on context change.
 */
export class UiActionGuard {
  private lastId: number = 0;
  private lastAdmittedAt: number = -1;
  private pendingId: number = -1;

  admit(id: number, now: number): boolean {
    if (!Number.isInteger(id) || id <= this.lastId) {
      return false;
    }
    this.lastId = id;
    if (this.pendingId >= 0 || (this.lastAdmittedAt >= 0 && now - this.lastAdmittedAt < 1000)) {
      return false;
    }
    this.lastAdmittedAt = now;
    this.pendingId = id;
    return true;
  }

  finish(id: number): void {
    if (this.pendingId === id) {
      this.pendingId = -1;
    }
  }

  invalidate(): boolean {
    if (this.pendingId < 0) return false;
    this.pendingId = -1;
    return true;
  }
}

function safeJsonRecord(raw: string): Record<string, Object> | undefined {
  if (raw.length === 0 || raw.length > MAX_UI_CHARS) return undefined;
  try {
    const parsed = JSON.parse(raw) as Object;
    return asRecord(parsed);
  } catch (e) {
    return undefined;
  }
}

export function isValidUiTree(def: Record<string, Object>): boolean {
  const root = jsonStr(def, 'root', '');
  const comps = asArray(def['components']);
  if (root.length === 0 || comps === undefined || comps.length > 2000) return false;
  const ids = new Set<string>();
  for (const raw of comps) {
    const node = asRecord(raw);
    if (node === undefined) return false;
    const id = jsonStr(node, 'id', '');
    const type = jsonStr(node, 'type', '');
    if (id.length === 0 || type.length === 0 || ids.has(id)) return false;
    ids.add(id);
  }
  return ids.has(root);
}

export function isValidComposition(def: Record<string, Object>): boolean {
  const blocks = asArray(def['blocks']);
  if (blocks === undefined || blocks.length === 0 || blocks.length > 24) return false;
  const ids = new Set<string>();
  for (const raw of blocks) {
    const b = asRecord(raw);
    if (b === undefined) return false;
    const id = jsonStr(b, 'id', '');
    const type = jsonStr(b, 'type', '');
    if (id.length === 0 || ids.has(id)) return false;
    ids.add(id);
    if (type === 'markdown') {
      if (jsonStr(b, 'text', '').trim().length === 0) return false;
    } else if (type === 'catalog') {
      if (!isValidUiTree(b)) return false;
    } else if (type === 'widget') {
      if (jsonStr(b, 'html', '').length === 0) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Projects latest verified UI snapshots from settled ui_render/ui_patch/ui_compose/ui_render_widget items.
 * Keyed by tool item id -> latest UiArtifactSnapshot.
 */
export function projectUiArtifacts(tools: UiToolInput[]): Map<string, UiArtifactSnapshot> {
  const latest = new Map<string, UiArtifactSnapshot>();
  const ordered = tools.slice().sort((a: UiToolInput, b: UiToolInput) => {
    const seqA = a.seq > 0 ? a.seq : a.timestamp;
    const seqB = b.seq > 0 ? b.seq : b.timestamp;
    return seqA - seqB;
  });

  for (const tool of ordered) {
    if (tool.toolState !== 'finished' || !UI_TOOLS.includes(tool.toolName)) continue;
    const meta = safeJsonRecord(tool.uiMetaJson);
    if (meta === undefined || asBool(meta['ok']) !== true) continue;
    const args = safeJsonRecord(tool.toolArguments);
    if (args === undefined) continue;
    const seq = tool.seq > 0 ? tool.seq : tool.timestamp;

    if (tool.toolName === 'ui_render' && isValidUiTree(args)) {
      if (!latest.has(tool.id)) {
        const snap = new UiArtifactSnapshot();
        snap.kind = 'declarative';
        snap.uiId = tool.id;
        snap.version = 1;
        snap.definition = args;
        snap.title = jsonStr(args, 'title', '');
        snap.originSeq = seq;
        latest.set(tool.id, snap);
      }
    } else if (tool.toolName === 'ui_compose' && isValidComposition(args)) {
      if (!latest.has(tool.id)) {
        const snap = new UiArtifactSnapshot();
        snap.kind = 'composition';
        snap.uiId = tool.id;
        snap.version = 1;
        snap.definition = args;
        snap.title = jsonStr(args, 'title', '');
        snap.originSeq = seq;
        latest.set(tool.id, snap);
      }
    } else if (tool.toolName === 'ui_render_widget' && jsonStr(args, 'html', '').length > 0) {
      if (!latest.has(tool.id)) {
        const snap = new UiArtifactSnapshot();
        snap.kind = 'widget';
        snap.uiId = tool.id;
        snap.version = 1;
        snap.definition = args;
        snap.title = jsonStr(args, 'title', '');
        snap.originSeq = seq;
        latest.set(tool.id, snap);
      }
    } else if (tool.toolName === 'ui_patch') {
      const targetUiId = jsonStr(args, 'uiId', '');
      const baseVersion = asNum(args['baseVersion']) ?? 0;
      const snapshot = asRecord(meta['ui']);
      if (targetUiId.length === 0 || baseVersion < 1 || snapshot === undefined) continue;
      if (jsonStr(snapshot, 'uiId', '') !== targetUiId) continue;
      const snapVersion = asNum(snapshot['version']) ?? 0;
      if (snapVersion !== baseVersion + 1 || !isValidUiTree(snapshot)) continue;

      const hashIdx = targetUiId.indexOf('#');
      if (hashIdx > 0 && hashIdx < targetUiId.length - 1) {
        const compId = targetUiId.slice(0, hashIdx);
        const blockId = targetUiId.slice(hashIdx + 1);
        const existing = latest.get(compId);
        if (existing !== undefined && existing.kind === 'composition') {
          const oldBlocks = asArray(existing.definition['blocks']) ?? [];
          const nextBlocks: Object[] = [];
          for (const rawB of oldBlocks) {
            const b = asRecord(rawB);
            if (b !== undefined && jsonStr(b, 'type', '') === 'catalog' && jsonStr(b, 'id', '') === blockId) {
              const patched: Record<string, Object> = {
                'id': blockId,
                'type': 'catalog',
                'root': jsonStr(snapshot, 'root', ''),
                'components': snapshot['components'] ?? []
              };
              const snapTitle = jsonStr(snapshot, 'title', '');
              if (snapTitle.length > 0) patched['title'] = snapTitle;
              nextBlocks.push(patched);
            } else {
              nextBlocks.push(rawB);
            }
          }
          const updated = new UiArtifactSnapshot();
          updated.kind = 'composition';
          updated.uiId = compId;
          updated.version = existing.version + 1;
          updated.title = existing.title;
          updated.originSeq = existing.originSeq;
          updated.definition = {
            'title': existing.definition['title'] ?? existing.title,
            'blocks': nextBlocks
          };
          latest.set(compId, updated);
        }
      } else {
        const existing = latest.get(targetUiId);
        if (existing !== undefined && existing.kind === 'declarative'
          && snapVersion > existing.version && baseVersion >= existing.version) {
          const updated = new UiArtifactSnapshot();
          updated.kind = 'declarative';
          updated.uiId = targetUiId;
          updated.version = snapVersion;
          updated.definition = snapshot;
          const t = jsonStr(snapshot, 'title', '');
          updated.title = t.length > 0 ? t : existing.title;
          updated.originSeq = existing.originSeq;
          latest.set(targetUiId, updated);
        }
      }
    }
  }
  return latest;
}

/** Recursively indexes component nodes by ID from a catalog definition. */
export function indexCatalogNodes(def: Record<string, Object>): Map<string, Record<string, Object>> {
  const map = new Map<string, Record<string, Object>>();
  const comps = asArray(def['components']) ?? [];
  for (const raw of comps) {
    const rec = asRecord(raw);
    if (rec === undefined) continue;
    const id = jsonStr(rec, 'id', '');
    if (id.length > 0) map.set(id, rec);
  }
  return map;
}

/** Bounded depth check for DS-Bot view blueprints before native rendering. */
export function isSafeBotViewTree(rawView: Record<string, Object>): boolean {
  const stack: Object[] = [rawView];
  let visited = 0;
  while (stack.length > 0) {
    const cur = stack.pop();
    if (++visited > 2048) return false;
    const rec = asRecord(cur);
    if (rec !== undefined) {
      for (const k of Object.keys(rec)) {
        stack.push(rec[k]);
      }
    } else {
      const arr = asArray(cur);
      if (arr !== undefined) {
        for (const el of arr) {
          stack.push(el);
        }
      }
    }
  }
  return jsonStr(rawView, 'type', '').length > 0;
}

export function extractCatalogStr(node: Record<string, Object>, key: string, fallback: string = ''): string {
  const direct = asStr(node[key]);
  if (direct !== undefined) return direct;
  const props = asRecord(node['props']);
  if (props !== undefined) {
    const nested = asStr(props[key]);
    if (nested !== undefined) return nested;
  }
  return fallback;
}

export function extractCatalogChildren(node: Record<string, Object>): string[] {
  const out: string[] = [];
  let arr = asArray(node['children']);
  if (arr === undefined) {
    const props = asRecord(node['props']);
    if (props !== undefined) arr = asArray(props['children']);
  }
  if (arr !== undefined) {
    for (const item of arr) {
      const s = asStr(item);
      if (s !== undefined && s.length > 0) out.push(s);
    }
  }
  return out;
}
