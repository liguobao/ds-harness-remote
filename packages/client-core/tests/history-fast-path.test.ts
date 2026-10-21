import {describe,it,expect,vi} from 'vitest'
import {CodexRemoteClient} from '../src/codex-client.js'
import {runScenarios} from '../../../scripts/test-scenarios.mjs'
describe('history fast-path recovery',()=>{
 it('returns small history in one round trip and falls back only on explicit read-only compatibility/size errors',async()=>{
  await runScenarios([undefined,'INVALID_MESSAGE','RESPONSE_TOO_LARGE','RPC_TIMEOUT','RPC_ABORTED','PERMISSION_DENIED'].map(code => ({name:code ?? 'small history',run:async()=>{
   const rpc=vi.fn(async(method:string)=>{if(method==='codex.app.call'){if(code)throw Object.assign(Error(code),{code});return {records:[]}}
    if(method==='codex.app.transfer.commit')return {kind:'inline',response:{records:[]}};return {}})
   const client=new CodexRemoteClient({rpc} as never,true)
   if(code && !['INVALID_MESSAGE','RESPONSE_TOO_LARGE'].includes(code)) {await expect(client.request('dsh/sessionHistory',{threadId:'t'})).rejects.toMatchObject({code});expect(rpc).toHaveBeenCalledTimes(1)}
   else {expect(await client.request('dsh/sessionHistory',{threadId:'t'})).toEqual({records:[]});expect(rpc).toHaveBeenCalledTimes(code?5:1)}
  }})))
 })
})

it('keeps legacy desktop/web history complete unless preview was explicitly enabled',async()=>{
 const rpc=vi.fn(async(method:string)=>method==='codex.app.transfer.commit'?{kind:'inline',response:{records:[]}}:{})
 await new CodexRemoteClient({rpc} as never).request('dsh/sessionHistory',{threadId:'t'})
 expect(rpc.mock.calls.some(call=>call[0]==='codex.app.call')).toBe(false)
 expect(rpc).toHaveBeenCalledTimes(4)
})
