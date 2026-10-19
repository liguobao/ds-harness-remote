import { afterEach, expect, it, vi } from 'vitest'

const f=vi.hoisted(() => ({state:{} as any,memory:{ready:true,notifications:true,entries:{}} as any,phase:'active',changed:()=>{},notify:vi.fn()}))
vi.mock('react-native', () => ({AppState:{get currentState(){return f.phase},addEventListener:()=>({remove(){}})}}))
vi.mock('../src/state/store', () => ({useAppStore:{getState:()=>f.state,subscribe:(fn:()=>void)=>{f.changed=fn;return()=>{}}}}))
vi.mock('../src/services/foreground-service', () => ({foregroundService:{notifyTask:f.notify}}))
vi.mock('../src/services/browse-memory', () => ({
  browseScope:()=> 'scope',browseKey:(s:string,id:string)=>s+id,useBrowseMemory:{getState:()=>f.memory},
  updateBrowseEntry:(s:string,id:string,p:unknown)=>{f.memory.entries[s+id]={...f.memory.entries[s+id],...p as object}},
  saveBrowseCatalog(){},browsePreference(){},flushBrowseMemory(){},
}))
import {startBrowseTracking} from '../src/services/browse-tracking'
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
