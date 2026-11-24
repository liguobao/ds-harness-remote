import { afterEach, expect, it, vi } from 'vitest'

const f=vi.hoisted(() => ({
  state:{} as any,
  memory:{ready:true,notifications:true,entries:{}} as any,
  phase:'active',
  changed:()=>{},
  appStateChanged:undefined as ((p: string) => void) | undefined,
  notify:vi.fn(),
  flush:vi.fn(),
}))
vi.mock('react-native', () => ({AppState:{
  get currentState(){return f.phase},
  addEventListener:(_ev: string, fn: (p: string) => void)=>{f.appStateChanged=fn; return{remove(){f.appStateChanged=undefined}}},
}}))
vi.mock('../src/state/store', () => ({useAppStore:{getState:()=>f.state,subscribe:(fn:()=>void)=>{f.changed=fn;return()=>{}}}}))
vi.mock('../src/services/foreground-service', () => ({foregroundService:{notifyTask:f.notify,updateLiveTask:vi.fn(),clearLiveTask:vi.fn()}}))
vi.mock('../src/services/browse-memory', () => ({
  browseScope:()=> 'scope',browseKey:(s:string,id:string)=>s+id,useBrowseMemory:{getState:()=>f.memory,subscribe:()=>()=>{}},
  updateBrowseEntry:(s:string,id:string,p:unknown)=>{f.memory.entries[s+id]={...f.memory.entries[s+id],...p as object}},
  saveBrowseCatalog(){},browsePreference(){},flushBrowseMemory:()=>f.flush(),
}))
import {pickActiveLiveTask, startBrowseTracking} from '../src/services/browse-tracking'
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.clearAllMocks()})

it('notifies once for confirmed completion and live questions, respecting foreground and preference', () => {
  vi.useFakeTimers();f.phase='active';f.memory={ready:true,notifications:true,entries:{}}
  const session={sessionId:'s',backend:'codex',nativeId:'n',title:'Task',running:true,updatedAt:1}
  f.state={selectedDevice:{deviceId:'host'},connection:{phase:'connected'},sessions:[session],selectedSession:session,
    workspaces:[],messages:{s:[]},sessionLifecycles:{s:{running:true}}}
  const stop=startBrowseTracking(),tick=()=>{f.changed();vi.advanceTimersByTime(800)}
  f.phase='background';delete f.state.sessionLifecycles.s;session.running=false;tick();expect(f.notify).not.toHaveBeenCalled()
  f.state.sessionLifecycles.s={running:false};tick();tick();expect(f.notify).toHaveBeenCalledTimes(1)
  f.state.messages.s=[{kind:'approval',id:'q',approvalId:'h'}];tick();tick();expect(f.notify).toHaveBeenCalledTimes(2)
  f.state.sessionLifecycles.s.running=true;tick();f.phase='active';f.state.sessionLifecycles.s.running=false;tick();expect(f.notify).toHaveBeenCalledTimes(2)
  f.memory.notifications=false;f.phase='background';f.state.sessionLifecycles.s.running=true;tick();f.state.sessionLifecycles.s.running=false;tick();expect(f.notify).toHaveBeenCalledTimes(2)
  stop()
})

it('flushes pending observe() before flushBrowseMemory on background and unmount', () => {
  vi.useFakeTimers()
  f.phase = 'active'
  f.memory = { ready: true, notifications: true, entries: {} }
  const s1 = { sessionId: 's1', backend: 'antigravity', nativeId: 'n1', title: 'S1', running: false, updatedAt: 1 }
  const s2 = { sessionId: 's2', backend: 'hermes', nativeId: 'n2', title: 'S2', running: false, updatedAt: 2 }
  f.state = {
    selectedDevice: { deviceId: 'host' },
    connection: { phase: 'connected' },
    sessions: [s1, s2],
    selectedSession: s1,
    workspaces: [],
    sessionLifecycles: {},
    messages: { s1: [{ kind: 'message', id: 'm1', role: 'user', text: 'hello' }], s2: [{ kind: 'message', id: 'm2', role: 'user', text: 'world' }] },
  }
  const stop = startBrowseTracking()

  // Update selected session without waiting 800ms, then go to background
  f.state = { ...f.state, selectedSession: s2 }
  f.changed()
  f.phase = 'background'
  f.appStateChanged?.('background')
  expect(f.memory.entries['scopes2']?.messages).toHaveLength(1)
  expect(f.flush).toHaveBeenCalledTimes(1)

  // Update messages without waiting 800ms, then unmount
  const nextMsgs = [{ kind: 'message', id: 'm2', role: 'user', text: 'world' }, { kind: 'message', id: 'm3', role: 'assistant', text: 'done' }]
  f.state = { ...f.state, messages: { ...f.state.messages, s2: nextMsgs } }
  f.changed()
  stop()
  expect(f.memory.entries['scopes2']?.messages).toHaveLength(2)
  expect(f.flush).toHaveBeenCalledTimes(2)
})

it('triggers background notification and lock-screen live task for ACP approvals and questions without frameRpcId', () => {
  vi.useFakeTimers()
  f.phase = 'active'
  f.memory = { ready: true, notifications: true, entries: {} }
  const agy = { sessionId: 'antigravity:a1', backend: 'antigravity', nativeId: 'a1', title: 'AGY', running: true, updatedAt: 10 }
  const hermes = { sessionId: 'hermes:h1', backend: 'hermes', nativeId: 'h1', title: 'Hermes', running: true, updatedAt: 20 }
  f.memory.entries['scope' + hermes.sessionId] = { visitedAt: 1 }
  f.state = {
    selectedDevice: { deviceId: 'host' },
    connection: { phase: 'connected' },
    sessions: [agy, hermes],
    selectedSession: agy,
    workspaces: [],
    sessionLifecycles: {},
    messages: { [agy.sessionId]: [], [hermes.sessionId]: [] },
  }

  const stop = startBrowseTracking()
  f.phase = 'background'
  f.state.messages[agy.sessionId] = [{ kind: 'approval', id: 'cursor-approval:req-1', approvalId: 'req-1' }]
  f.changed()
  vi.advanceTimersByTime(800)
  expect(f.notify).toHaveBeenCalledTimes(1)
  expect(pickActiveLiveTask(f.state)).toMatchObject({ sessionId: agy.sessionId, isWaitingInput: true })

  f.state.messages[hermes.sessionId] = [{ kind: 'question', id: 'q-no-rpc', outcome: undefined, questionState: 'open' }]
  f.changed()
  vi.advanceTimersByTime(800)
  expect(f.notify).toHaveBeenCalledTimes(2)
  expect(pickActiveLiveTask({ ...f.state, selectedSession: hermes })).toMatchObject({ sessionId: hermes.sessionId, isWaitingInput: true })
  stop()
})
