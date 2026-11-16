import { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateKeyPair, NoiseIkSession } from '@dsh-remote/crypto'
import { SecureMessageCodec, createLanUploadPrologue, createRpcRequest, decodeMessage, encodeMessage, type LanUploadOffer } from '@dsh-remote/protocol'
import { LanUploadHost } from '../src/lan-upload.js'
import { WorkspaceUploadHost } from '../src/workspace-upload.js'
import { ConnectionController } from '../src/connection-controller.js'
import { RpcRouter } from '../src/rpc-router.js'
import type { IdentityStore } from '../src/identity-store.js'
import type { AuthenticatedPeerChannel } from '../src/types.js'

const address='192.168.41.8'
const hosts:LanUploadHost[]=[],uploads:WorkspaceUploadHost[]=[],roots:string[]=[],sockets:WebSocket[]=[]
// Bind real TCP sockets on loopback so the suite requires no physical LAN interface.
beforeEach(()=>{
 const listen=Server.prototype.listen
 vi.spyOn(Server.prototype,'listen').mockImplementation(function(this:Server,...args:any[]){
  if(args[1]===address) args[1]='127.0.0.1'
  return listen.apply(this,args as any)
 } as typeof listen)
})
afterEach(async()=>{
 for(const socket of sockets.splice(0)) socket.terminate()
 await Promise.all(hosts.splice(0).map(h=>h.closeAll()))
 await Promise.all(uploads.splice(0).map(h=>h.closeAll()))
 await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))
 vi.restoreAllMocks();vi.useRealTimers()
})
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'dsh-lan-upload-test-'));roots.push(root)
 const client=generateKeyPair(),server=generateKeyPair()
 let mode:string='LAN'
 const upload=new WorkspaceUploadHost(async id=>id==='session-1'?root:undefined,undefined,()=>mode);uploads.push(upload)
 const host=new LanUploadHost(upload,{connectionId:'connection-1',peerIdentityKey:client.publicKey,identity:()=>({...server,deviceId:'host',name:'host',fingerprint:'fp',schemaVersion:1}),mode:()=>mode},()=>[address]);hosts.push(host)
 return {root,host,upload,client,server,setMode:(value:string)=>{mode=value},scope:{sessionId:'session-1',uploadId:randomUUID()},offer:(scope:{sessionId:string;uploadId:string})=>host.open({...scope,address})}
}
async function connect(offer:LanUploadOffer,client:ReturnType<typeof generateKeyPair>,server:ReturnType<typeof generateKeyPair>){
 const socket=new WebSocket(offer.url.replace(address,'127.0.0.1'));sockets.push(socket)
 const noise=new NoiseIkSession({role:'initiator',localPrivateKey:client.privateKey,localPublicKey:client.publicKey,remotePublicKey:server.publicKey,prologue:createLanUploadPrologue(offer)})
 const incoming=new SecureMessageCodec(),outgoing=new SecureMessageCodec()
 const pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
 let ready!:()=>void,fail!:(e:Error)=>void
 const opened=new Promise<void>((resolve,reject)=>{ready=resolve;fail=reject})
 const timer=setTimeout(()=>{socket.terminate();fail(new Error('Handshake timeout'))},1500)
 const closed=()=>{
  clearTimeout(timer);fail(new Error('Socket closed'))
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Socket closed'))};pending.clear();noise.destroy()
 }
 socket.on('open',()=>socket.send(noise.writeHandshake()))
 socket.on('close',closed);socket.on('error',closed)
 socket.on('message',raw=>{
  try {
   const bytes=Buffer.from(raw as Buffer)
   if(!noise.complete){noise.readHandshake(bytes);clearTimeout(timer);ready();return}
   const frame=incoming.decode(noise.decrypt(bytes));if(!frame)return
   const message=decodeMessage(frame),payload=message.payload as any,p=pending.get(payload.requestId)
   if(!p)return
   clearTimeout(p.timer);pending.delete(payload.requestId)
   if(message.type==='rpc.error')p.reject(Object.assign(new Error(payload.message),{code:payload.code}));else p.resolve(payload.result)
  }catch(error){fail(error as Error);socket.terminate()}
 })
 await opened
 return {socket,rpc:(method:string,params:unknown)=>{
  const message=createRpcRequest(method as any,params)
  const response=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(message.id);reject(new Error('RPC timeout'))},1500);pending.set(message.id,{resolve,reject,timer})})
  if(socket.readyState!==WebSocket.OPEN){const p=pending.get(message.id)!;clearTimeout(p.timer);pending.delete(message.id);p.reject(new Error('Socket closed'));return response}
  for(const frame of outgoing.encode(encodeMessage(message))) socket.send(noise.encrypt(frame))
  return response
 }}
}
it('receives binary upload using a real pinned Noise/TCP connection and retains publication',async()=>{
 const s=await setup(),offer=await s.offer(s.scope),client=await connect(offer,s.client,s.server)
 const bytes=Buffer.alloc(256*1024,123)
 expect(await client.rpc('workspace.upload.open',{...s.scope,name:'file.bin',totalBytes:bytes.length,encoding:'binary-v1'})).toMatchObject({uploadId:s.scope.uploadId,encoding:'binary-v1'})
 expect(await client.rpc('workspace.upload.chunk.binary',{...s.scope,offset:0,data:bytes})).toMatchObject({receivedBytes:bytes.length})
 expect(await client.rpc('workspace.upload.commit',s.scope)).toEqual({name:'file.bin',path:'./file.bin',bytes:bytes.length})
 await s.host.closeAll()
 expect(await readFile(join(s.root,'file.bin'))).toEqual(bytes)
})
it('rejects non-LAN modes, foreign interfaces and public addresses before creating listeners',async()=>{
 const s=await setup()
 for(const mode of ['P2P','TURN','Relay','Disconnected']){s.setMode(mode);await expect(s.offer(s.scope)).rejects.toMatchObject({code:'FEATURE_NOT_SUPPORTED'})}
 s.setMode('LAN')
 for(const ip of ['127.0.0.1','8.8.8.8','192.168.41.9'])await expect(s.host.open({...s.scope,address:ip})).rejects.toMatchObject({code:'FEATURE_NOT_SUPPORTED'})
})
it('consumes tickets once and rejects another device static key',async()=>{
 const s=await setup(),offer=await s.offer(s.scope)
 const first=await connect(offer,s.client,s.server)
 await expect(connect(offer,s.client,s.server)).rejects.toThrow()
 first.socket.terminate()
 const second=await s.offer({...s.scope,uploadId:randomUUID()})
 await expect(connect(second,generateKeyPair(),s.server)).rejects.toThrow()
 expect(await readdir(s.root)).toEqual([])
})
it('never opens or commits files for a different upload/session or unrelated RPC',async()=>{
 const s=await setup()
 for(const request of [
  {method:'workspace.upload.open',params:{...s.scope,uploadId:randomUUID(),name:'bad.bin',totalBytes:1,encoding:'binary-v1'}},
  {method:'workspace.upload.open',params:{...s.scope,sessionId:'other',name:'bad.bin',totalBytes:1,encoding:'binary-v1'}},
  {method:'harness.remote.call',params:s.scope},
 ]){
  const scope={...s.scope,uploadId:randomUUID()},offer=await s.offer(scope),client=await connect(offer,s.client,s.server)
  await expect(client.rpc(request.method,{...request.params,uploadId:request.params.uploadId===s.scope.uploadId?scope.uploadId:request.params.uploadId})).rejects.toThrow()
 }
 expect(await readdir(s.root)).toEqual([])
})
it('cleans partial data on control-owner close, socket loss and LAN fallback',async()=>{
 for(const cause of ['owner','socket','mode']){
  const s=await setup(),offer=await s.offer(s.scope),client=await connect(offer,s.client,s.server)
  await client.rpc('workspace.upload.open',{...s.scope,name:'partial.bin',totalBytes:2,encoding:'binary-v1'})
  await client.rpc('workspace.upload.chunk.binary',{...s.scope,offset:0,data:Buffer.from('a')})
  if(cause==='owner')await s.host.closeAll()
  if(cause==='socket')client.socket.terminate()
  if(cause==='mode'){s.setMode('Relay');await expect(client.rpc('workspace.upload.commit',s.scope)).rejects.toThrow()}
  await vi.waitFor(async()=>expect(await readdir(s.root)).toEqual([]))
 }
})
it('limits outstanding tickets and closes listeners even when shutdown races binding',async()=>{
 const s=await setup()
 await s.offer(s.scope);await s.offer({...s.scope,uploadId:randomUUID()})
 await expect(s.offer({...s.scope,uploadId:randomUUID()})).rejects.toMatchObject({code:'FEATURE_NOT_SUPPORTED'})
 await s.host.closeAll()
 const other=await setup(),opening=other.offer(other.scope)
 const rejected=expect(opening).rejects.toMatchObject({code:'FEATURE_NOT_SUPPORTED'})
 await other.host.closeAll();await rejected
})
it('expires unused tickets without accepting a later connection',async()=>{
 const s=await setup()
 vi.useFakeTimers()
 const offer=await s.offer(s.scope)
 await vi.advanceTimersByTimeAsync(10001)
 vi.useRealTimers()
 await expect(connect(offer,s.client,s.server)).rejects.toThrow()
 expect(await readdir(s.root)).toEqual([])
})
it('rechecks workspace authority at commit and discards files after session revocation',async()=>{
 const s=await setup()
 const { root }=s
 let authorized=true
 const upload=new WorkspaceUploadHost(async()=>authorized?root:undefined,undefined,()=> 'LAN');uploads.push(upload)
 const host=new LanUploadHost(upload,{connectionId:'connection-1',peerIdentityKey:s.client.publicKey,identity:()=>({...s.server,deviceId:'host',name:'host',fingerprint:'fp',schemaVersion:1}),mode:()=> 'LAN'},()=>[address]);hosts.push(host)
 const offer=await host.open({...s.scope,address}),client=await connect(offer,s.client,s.server)
 await client.rpc('workspace.upload.open',{...s.scope,name:'revoked.bin',totalBytes:1,encoding:'binary-v1'})
 await client.rpc('workspace.upload.chunk.binary',{...s.scope,offset:0,data:Buffer.from('a')})
 authorized=false
 await expect(client.rpc('workspace.upload.commit',s.scope)).rejects.toThrow()
 await vi.waitFor(async()=>expect(await readdir(root)).toEqual([]))
})

it('retires real TCP listeners and partial files through controller replacement, disconnect and device revocation',async()=>{
 for(const cause of ['replacement','disconnect','revocation']){
  const s=await setup()
  const controller=new ConnectionController({isTrusted:()=>true} as unknown as IdentityStore,
   ()=>new RpcRouter(128,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,s.upload,undefined,s.host))
  const channel=(connectionId:string):AuthenticatedPeerChannel=>({
   security:{protocol:'Noise_IK_25519_ChaChaPoly_SHA256',connectionId,membershipId:'fixture-membership'},
   peerDeviceId:'fixture-phone',peerIdentityKey:s.client.publicKey,mode:'LAN',
   send:async()=>{},close:async()=>{},onMessage:()=>()=>{},
  })
  try {
   await controller.accept(channel('connection-1'))
   const offer=await s.offer(s.scope),client=await connect(offer,s.client,s.server)
   await client.rpc('workspace.upload.open',{...s.scope,name:'partial.bin',totalBytes:2,encoding:'binary-v1'})
   await client.rpc('workspace.upload.chunk.binary',{...s.scope,offset:0,data:Buffer.from('a')})
   expect((await readdir(s.root)).some(name=>name.endsWith('.part'))).toBe(true)
   if(cause==='replacement')await controller.accept(channel('connection-2'))
   if(cause==='disconnect')await controller.closeConnection('connection-1')
   if(cause==='revocation')await controller.revoke('fixture-phone')
   expect(await readdir(s.root)).toEqual([])
   await vi.waitFor(()=>expect(client.socket.readyState).toBe(WebSocket.CLOSED))
   await expect(connect(offer,s.client,s.server)).rejects.toThrow()
   await expect(client.rpc('workspace.upload.commit',s.scope)).rejects.toThrow()
  } finally { await controller.close() }
 }
})
