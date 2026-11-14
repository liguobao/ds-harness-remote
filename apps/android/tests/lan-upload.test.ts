vi.mock('expo',()=>({requireOptionalNativeModule:()=>undefined}))
import { expect, it, vi } from 'vitest'
import { LAN_UPLOAD_MIN_BYTES } from '@dsh-remote/protocol'
import { LanUploadRoutes, type LanUploadRouteOptions } from '../src/services/lan-upload'
import { LanUploadSecurityError, LanUploadUnavailable } from '../src/services/lan-upload-transport'
import { uploadStagedFileToWorkspace } from '../src/screens/chat-files'
const id='12345678-1234-4567-8901-123456789abc'
const params={sessionId:'session-1',uploadId:id,name:'file.bin',totalBytes:LAN_UPLOAD_MIN_BYTES,encoding:'binary-v1'}
const offer={connectionId:'connection-1',sessionId:params.sessionId,uploadId:id,url:`ws://192.168.31.61:30000/ds-harness-remote/upload/${'a'.repeat(43)}`,expiresInMs:10000}
function fixture(){
 let mode='LAN',current=true
 const fast={connect:vi.fn(async()=>{}),close:vi.fn(async()=>{}),rpc:vi.fn(async(method:string,p:any)=>{
  if(method==='workspace.upload.open') return {uploadId:p.uploadId,chunkBytes:256*1024,encoding:'binary-v1'}
  if(method==='workspace.upload.chunk.binary')return {uploadId:p.uploadId,receivedBytes:p.offset+p.data.length}
  if(method==='workspace.upload.commit')return {name:'file.bin',path:'./file.bin',bytes:params.totalBytes}
  return {}
 })}
 const control={rpc:vi.fn(async(method:string,p:any)=>method==='workspace.upload.lan.open'?{...offer,uploadId:p.uploadId,sessionId:p.sessionId}:{legacy:true})}
 const options:LanUploadRouteOptions={control:control as any,identity:{} as any,host:{} as any,sender:vi.fn(),current:()=>current,mode:()=>mode,
  details:async()=>({webRtc:{remoteAddress:'192.168.31.61',mode:'LAN'}} as any),connectionId:()=>offer.connectionId,createClient:()=>fast as any}
 const routes=new LanUploadRoutes(options)
 return {routes,options,control,fast,setMode:(v:string)=>{mode=v},replace:()=>{current=false}}
}
it('routes a complete real uploader through the negotiated client and closes it after commit',async()=>{
 const f=fixture(),content='x'.repeat(params.totalBytes)
 const rpc=Object.assign((m:string,p:unknown,s?:AbortSignal)=>f.routes.rpc(m,p,s),{supportsBinaryUpload:true})
 expect(await uploadStagedFileToWorkspace(rpc,'session-1',{id:'f',uri:'',name:'file.bin',size:content.length,content})).toMatchObject({path:'./file.bin',bytes:content.length})
 expect(f.control.rpc.mock.calls.map(([method])=>method)).toEqual(['workspace.upload.lan.open'])
 expect(f.fast.rpc.mock.calls.filter(([m])=>m==='workspace.upload.chunk.binary')).toHaveLength(4)
 expect(f.fast.close).toHaveBeenCalledTimes(1)
 await f.routes.close()
})
it('keeps non-LAN, small and legacy uploads on the existing carrier without a negotiation probe',async()=>{
 for(const patch of [{mode:'P2P'},{mode:'TURN'},{mode:'Relay'},{totalBytes:LAN_UPLOAD_MIN_BYTES-1},{encoding:undefined}]){
  const f=fixture();if(patch.mode)f.setMode(patch.mode)
  await f.routes.rpc('workspace.upload.open',{...params,...patch})
  expect(f.control.rpc.mock.calls.map(([m])=>m)).toEqual(['workspace.upload.open'])
  expect(f.fast.connect).not.toHaveBeenCalled();await f.routes.close()
 }
})
it('falls back only before upload open on unsupported Host or an unreachable TCP endpoint',async()=>{
 for(const failure of ['unsupported','tcp']){
  const f=fixture()
  if(failure==='unsupported') f.control.rpc.mockRejectedValueOnce(Object.assign(new Error('unsupported'),{code:'FEATURE_NOT_SUPPORTED'}))
  else f.fast.connect.mockRejectedValueOnce(new LanUploadUnavailable('unreachable'))
  expect(await f.routes.rpc('workspace.upload.open',params)).toEqual({legacy:true})
  expect(f.fast.rpc).not.toHaveBeenCalled()
  expect(f.control.rpc.mock.calls.map(([m])=>m)).toEqual(['workspace.upload.lan.open','workspace.upload.open'])
  await f.routes.close()
 }
})
it('does not downgrade invalid offers, pinned identity failures or cancellation',async()=>{
 for(const failure of ['offer','identity','abort']){
  const f=fixture(),controller=new AbortController()
  if(failure==='offer')f.control.rpc.mockResolvedValueOnce({...offer,url:offer.url.replace('192.168.31.61','192.168.31.62')})
  if(failure==='identity')f.fast.connect.mockRejectedValueOnce(new LanUploadSecurityError('peer mismatch'))
  if(failure==='abort'){controller.abort(new Error('cancelled'))}
  await expect(f.routes.rpc('workspace.upload.open',params,controller.signal)).rejects.toThrow()
  expect(f.control.rpc.mock.calls.filter(([m])=>m==='workspace.upload.open')).toHaveLength(0)
  expect(f.fast.rpc).not.toHaveBeenCalled();await f.routes.close()
 }
})
it('never replays an ambiguously delivered open, chunk or commit over the original carrier',async()=>{
 for(const method of ['workspace.upload.open','workspace.upload.chunk.binary','workspace.upload.commit']){
  const f=fixture()
  if(method!=='workspace.upload.open')await f.routes.rpc('workspace.upload.open',params)
  f.fast.rpc.mockRejectedValueOnce(new Error('response lost'))
  await expect(f.routes.rpc(method,params)).rejects.toThrow('response lost')
  await expect(f.routes.rpc('workspace.upload.chunk.binary',params)).rejects.toThrow('new upload ID')
  expect(f.control.rpc.mock.calls.map(([m])=>m)).toEqual(['workspace.upload.lan.open'])
  await f.routes.rpc('workspace.upload.abort',params)
  expect(f.control.rpc.mock.calls.at(-1)?.[0]).toBe('workspace.upload.abort')
  await f.routes.close()
 }
})
it('retires pending negotiations after main-connection replacement and refuses later writes',async()=>{
 const f=fixture();let resume!:()=>void
 f.fast.connect.mockImplementationOnce(()=>new Promise<void>(resolve=>{resume=resolve}))
 const upload=f.routes.rpc('workspace.upload.open',params)
 const rejected=expect(upload).rejects.toThrow('replaced')
 await vi.waitFor(()=>expect(f.fast.connect).toHaveBeenCalled())
 await f.routes.close();f.replace();resume();await rejected
 expect(f.fast.close).toHaveBeenCalled();expect(f.fast.rpc).not.toHaveBeenCalled()
})
it('stops a fast upload after a route change and rejects cross-session access',async()=>{
 const f=fixture();await f.routes.rpc('workspace.upload.open',params)
 await expect(f.routes.rpc('workspace.upload.chunk.binary',{...params,sessionId:'other'})).rejects.toThrow('scope')
 f.setMode('Relay')
 await expect(f.routes.rpc('workspace.upload.chunk.binary',params)).rejects.toThrow('path changed')
 expect(f.control.rpc.mock.calls.map(([m])=>m)).toEqual(['workspace.upload.lan.open'])
 expect(f.fast.rpc).toHaveBeenCalledTimes(1);await f.routes.close()
})
