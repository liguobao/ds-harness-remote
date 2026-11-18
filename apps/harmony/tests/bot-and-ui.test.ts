import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets');
const bundlePath = join(here, '.bot-ui-bundle.mjs');

const kitStub = `
export const network = {}
export const webSocket = {}
export const cryptoFramework = {
  createRandom: () => ({ generateRandomSync: (len) => ({ data: new Uint8Array(len) }) })
}
export const hilog = { info: () => undefined, warn: () => undefined, error: () => undefined }
`;

let mod: any;

beforeAll(async () => {
  const entry = `
export * from ${JSON.stringify(join(etsRoot, 'net', 'BotClient.ets'))}
export * from ${JSON.stringify(join(etsRoot, 'util', 'UiArtifacts.ets'))}
`;
  const entryPath = join(here, '.bot-ui-entry.ts');
  writeFileSync(entryPath, entry, 'utf8');
  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      write: false,
      platform: 'neutral',
      loader: { '.ets': 'ts' },
      resolveExtensions: ['.ets', '.ts', '.js'],
      plugins: [
        {
          name: 'kit-stub',
          setup(pluginBuild) {
            pluginBuild.onResolve({ filter: /^@kit\./ }, () => ({ path: 'kit', namespace: 'kit-stub' }));
            pluginBuild.onLoad({ filter: /.*/, namespace: 'kit-stub' }, () => ({
              contents: kitStub,
              loader: 'ts'
            }));
          }
        }
      ]
    });
    writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8');
  } finally {
    rmSync(entryPath, { force: true });
  }
  mod = await import(`file://${bundlePath}`);
});

afterAll(() => {
  rmSync(bundlePath, { force: true });
});

describe('BotClient & DS-Bot catalog', () => {
  it('parses full state, delta updates, and usage summaries', () => {
    const raw = {
      revision: 7,
      liveKey: 'lk-1',
      mainBotId: 'bot-main',
      bots: [
        { id: 'bot-main', sessionId: 's-1', name: 'Architect', role: 'Lead', model: 'deepseek-chat', color: '#22D3EE' },
        { id: 'bot-qa', sessionId: 's-2', name: 'Tester', role: 'QA' },
      ],
      rooms: [
        { id: 'room-1', sessionId: 'sr-1', name: 'Release Squad', members: ['bot-main', 'bot-qa'], notice: 'Ship v2' },
      ],
      btwCards: {
        'bot-main': [{ id: 'c1', botId: 'bot-main', question: 'Status?', answer: 'Green', status: 'done' }],
      },
      work: { bots: { 'bot-qa': true }, rooms: {}, waiting: {} },
      questions: { 's-1': { id: 'q1', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] } },
      views: { 's-1': { id: 'v1', title: 'Deploy', view: { type: 'confirm', confirmLabel: 'Go' } } },
      approvals: [{ id: 'ap1', sessionId: 's-1', toolName: 'bash', reason: 'Run tests' }],
      browser: true,
      memory: false,
    };
    const snap = mod.parseBotState(raw);
    expect(snap.mainBotId).toBe('bot-main');
    expect(snap.bots[0].main).toBe(true);
    expect(snap.rooms[0].members).toEqual(['bot-main', 'bot-qa']);
    expect(snap.btwSupported).toBe(true);
    expect(snap.btwCards[0].answer).toBe('Green');
    expect(snap.busyBotIds).toEqual(['bot-qa']);
    expect(snap.pendingQuestions[0].options.length).toBe(2);
    expect(snap.pendingViews[0].id).toBe('v1');
    expect(snap.approvals[0].id).toBe('ap1');

    const delta = mod.parseBotState({
      unchanged: true,
      revision: 8,
      liveKey: 'lk-2',
      work: { bots: {}, rooms: { 'room-1': true }, waiting: {} },
    }, snap);
    expect(delta.revision).toBe(8);
    expect(delta.bots.length).toBe(2);
    expect(delta.busyRoomIds).toEqual(['room-1']);

    const usage = mod.parseUsageSummary({
      records: [
        { ownerId: 'bot-main', model: 'deepseek-chat', inputTokens: 100, cacheReadTokens: 300, outputTokens: 50, calls: 2 },
        { ownerId: 'bot-qa', model: 'deepseek-reasoner', inputTokens: 200, cacheReadTokens: 0, outputTokens: 100, calls: 1 },
      ],
    }, snap.bots);
    expect(usage.totalTokens).toBe(750);
    expect(usage.totalCalls).toBe(3);
    expect(usage.hitRatePct).toBe(50);
    expect(usage.byOwner[0].label).toBe('Architect');
  });

  it('routes /btw only to individual bots and rejects disallowed ops', async () => {
    const snap = mod.parseBotState({
      bots: [{ id: 'b1', sessionId: 'sb1', name: 'Coder' }],
      rooms: [{ id: 'r1', sessionId: 'sr1', name: 'War Room', members: ['b1'] }],
      btwCards: {},
    });

    const btwPlan = mod.buildBotDispatchPlan(snap, 'b1', '  /btw check tests  ');
    expect(btwPlan.endpoint).toBe('btw');
    expect(btwPlan.payload.text).toBe('check tests');

    const sendPlan = mod.buildBotDispatchPlan(snap, 'r1', '@Coder hello');
    expect(sendPlan.endpoint).toBe('send');
    expect(sendPlan.payload.sessionId).toBe('r1');

    expect(() => mod.buildBotDispatchPlan(snap, 'r1', '/btw nope')).toThrow();

    const calls: string[] = [];
    const client = new mod.BotRemoteClient({
      rpc: async (method: string, params: Record<string, Object>) => {
        calls.push(method + ':' + JSON.stringify(params));
        return { status: 200, json: { ok: true, value: { sent: true } } };
      },
    });

    await client.sendMessage(snap, 'b1', '/btw ping');
    expect(calls[0]).toContain('"endpoint":"btw"');
    await expect(client.call('arbitrary-evil-route')).rejects.toThrow();
  });
});

describe('Intelligent UI artifacts & action guard', () => {
  it('projects ui_render, monotonic ui_patch, ui_compose, and rejects stale patches', () => {
    const t1 = new mod.UiToolInput();
    t1.id = 'ui-1';
    t1.toolName = 'ui_render';
    t1.toolState = 'finished';
    t1.seq = 10;
    t1.uiMetaJson = JSON.stringify({ ok: true });
    t1.toolArguments = JSON.stringify({
      title: 'Dashboard',
      root: 'root',
      components: [{ id: 'root', type: 'column', children: ['m1'] }, { id: 'm1', type: 'metric', label: 'Hits', value: '42' }],
    });

    const pValid = new mod.UiToolInput();
    pValid.id = 'patch-1';
    pValid.toolName = 'ui_patch';
    pValid.toolState = 'finished';
    pValid.seq = 12;
    pValid.toolArguments = JSON.stringify({ uiId: 'ui-1', baseVersion: 1 });
    pValid.uiMetaJson = JSON.stringify({
      ok: true,
      ui: {
        uiId: 'ui-1',
        version: 2,
        title: 'Dashboard v2',
        root: 'root',
        components: [{ id: 'root', type: 'column', children: ['m1'] }, { id: 'm1', type: 'metric', label: 'Hits', value: '99' }],
      },
    });

    const pStale = new mod.UiToolInput();
    pStale.id = 'patch-stale';
    pStale.toolName = 'ui_patch';
    pStale.toolState = 'finished';
    pStale.seq = 14;
    pStale.toolArguments = JSON.stringify({ uiId: 'ui-1', baseVersion: 1 });
    pStale.uiMetaJson = JSON.stringify({
      ok: true,
      ui: { uiId: 'ui-1', version: 2, root: 'root', components: [{ id: 'root', type: 'text', text: 'stale' }] },
    });

    const artifacts = mod.projectUiArtifacts([t1, pStale, pValid]);
    const snap = artifacts.get('ui-1');
    expect(snap.version).toBe(2);
    expect(snap.title).toBe('Dashboard v2');
  });

  it('enforces throttled one-shot admission in UiActionGuard & validates safe Bot views', () => {
    const guard = new mod.UiActionGuard();
    expect(guard.admit(1, 1000)).toBe(true);
    expect(guard.admit(1, 1500)).toBe(false);
    guard.finish(1);
    expect(guard.admit(2, 1400)).toBe(false);
    expect(guard.admit(3, 2100)).toBe(true);
    expect(guard.invalidate()).toBe(true);
    expect(guard.invalidate()).toBe(false);
    expect(mod.isSafeBotViewTree({ type: 'confirm', label: 'Go' })).toBe(true);
  });
});
