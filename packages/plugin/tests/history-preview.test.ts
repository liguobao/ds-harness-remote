import {afterEach, describe, expect, it, vi} from 'vitest'
import {previewCall} from '../src/codex/history-preview.js'
import {CodexPeerBridge} from '../src/codex/peer-bridge.js'
import {randomUUID} from 'node:crypto'
const result = {header:{id:'codex:t'},hasMore:false,records:[{type:'event',event:{type:'tool/result',seq:1,time:1,data:{callId:'tool',isError:true,message:{source:{callId:'tool'},content:[{type:'text',text:'output'.repeat(2000)}]}}}}]}
afterEach(()=>vi.useRealTimers())
describe('authenticated history preview',()=>{
  it('retrieves deferred output through the real peer bridge bounded-transfer path',async()=>{
    const call=vi.fn(async()=>result)
    const domain={call,detachPeer:vi.fn(async()=>undefined)}
    const bridge=new CodexPeerBridge(domain as never,{connectionId:'peer-a'} as never,async()=>undefined)
    const page:any=await bridge.call({method:'dsh/sessionHistory',params:{threadId:'t'},previewHistory:true})
    const params=page.records[0].event.data.remoteDetail
    const bytes=Buffer.from(JSON.stringify({method:'dsh/historyDetail',params})), transferId=randomUUID()
    bridge.openTransfer({transferId,totalBytes:bytes.length,totalChunks:1})
    bridge.appendTransfer({transferId,index:0,data:bytes.toString('base64')})
    expect(await bridge.commitTransfer({transferId})).toEqual({kind:'inline',response:result.records[0]})
    expect(call).toHaveBeenLastCalledWith('peer-a',{method:'thread/read',params:{threadId:'t',includeTurns:false}})
    const other=new CodexPeerBridge(domain as never,{connectionId:'peer-b'} as never,async()=>undefined)
    await expect(other.call({method:'dsh/historyDetail',params})).rejects.toMatchObject({code:'HISTORY_DETAIL_EXPIRED'})
    await bridge.closeAll()
    await expect(bridge.call({method:'dsh/historyDetail',params})).rejects.toBeDefined()
    await other.closeAll()
  })
  it('one request returns a lightweight preview and a peer/thread-scoped detail handle',async()=>{
    const peer={}, invoke=vi.fn(async()=>result)
    const page:any=await previewCall(peer,{method:'dsh/sessionHistory',params:{threadId:'t'},previewHistory:true},invoke)
    expect(invoke).toHaveBeenCalledWith({method:'dsh/sessionHistory',params:{threadId:'t'}})
    expect(JSON.stringify(page).length).toBeLessThan(1500)
    const params=page.records[0].event.data.remoteDetail
    expect(page.records[0].event.data.isError).toBe(true)
    expect(await previewCall(peer,{method:'dsh/historyDetail',params},invoke)).toEqual(result.records[0])
    expect(invoke).toHaveBeenLastCalledWith({method:'thread/read',params:{threadId:'t',includeTurns:false}})
    await expect(previewCall({}, {method:'dsh/historyDetail',params},invoke)).rejects.toMatchObject({code:'HISTORY_DETAIL_EXPIRED'})
    await expect(previewCall(peer,{method:'dsh/historyDetail',params:{...params,threadId:'other'}},invoke)).rejects.toMatchObject({code:'HISTORY_DETAIL_EXPIRED'})
  })
  it('revalidates authority, expires handles and never forwards preview flags to a mutation',async()=>{
    vi.useFakeTimers(); const peer={},invoke=vi.fn(async()=>result)
    const page:any=await previewCall(peer,{method:'dsh/sessionHistory',params:{threadId:'t'},previewHistory:true},invoke)
    const params=page.records[0].event.data.remoteDetail
    await expect(previewCall(peer,{method:'dsh/historyDetail',params},async()=>{throw Error('revoked')})).rejects.toThrow('revoked')
    vi.advanceTimersByTime(11*60000)
    await expect(previewCall(peer,{method:'dsh/historyDetail',params},invoke)).rejects.toMatchObject({code:'HISTORY_DETAIL_EXPIRED'})
    const mutation=vi.fn()
    await expect(previewCall(peer,{method:'turn/start',params:{threadId:'t'},previewHistory:true},mutation)).rejects.toMatchObject({code:'INVALID_MESSAGE'})
    expect(mutation).not.toHaveBeenCalled()
  })
  it('requires bounded transfer for oversized text and does not alter normal calls',async()=>{
    const large={...result,records:[{event:{type:'assistant/message',data:{text:'x'.repeat(3*1024*1024)}}}]}
    await expect(previewCall({}, {method:'dsh/sessionHistory',params:{threadId:'t'},previewHistory:true},async()=>large)).rejects.toMatchObject({code:'RESPONSE_TOO_LARGE'})
    const call={method:'turn/start',params:{threadId:'t'}};const invoke=vi.fn(async()=>({ok:true}))
    expect(await previewCall({},call,invoke)).toEqual({ok:true});expect(invoke).toHaveBeenCalledWith(call)
  })
})
