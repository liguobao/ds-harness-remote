vi.mock('expo',()=>({requireOptionalNativeModule:()=>undefined}))
import { expect, it, vi } from 'vitest'
import { generateKeyPair, NoiseIkSession } from '@dsh-remote/crypto'
import { SecureMessageCodec, createLanUploadPrologue, createRpcResponse, decodeMessage, encodeMessage } from '@dsh-remote/protocol'
import { RemoteClientCore } from '@dsh-remote/client-core'
import { LanUploadTransport, LanUploadSecurityError } from '../src/services/lan-upload-transport'

const offer={connectionId:'connection-1',sessionId:'session-1',uploadId:'12345678-1234-4567-8901-123456789abc',url:`ws://192.168.31.61:30000/ds-harness-remote/upload/${'a'.repeat(43)}`,expiresInMs:10000}
function setup(wrongIdentity=false, silent=false){
 const client=generateKeyPair(),host=generateKeyPair(),other=generateKeyPair(),selected=wrongIdentity?other:host
 const noise=new NoiseIkSession({role:'responder',localPrivateKey:selected.privateKey,localPublicKey:selected.publicKey,remotePublicKey:client.publicKey,prologue:createLanUploadPrologue(offer)})
 const incoming=new SecureMessageCodec(),outgoing=new SecureMessageCodec()
 const socket:any={_socketId:1,readyState:0,onopen:null,onmessage:null,onerror:null,onclose:null,close:vi.fn(()=>{socket.readyState=3}),send:vi.fn((data:ArrayBuffer)=>{
  if(silent)return
  try{noise.readHandshake(new Uint8Array(data));const frame=noise.writeHandshake();socket.onmessage?.({data:frame.buffer.slice(frame.byteOffset,frame.byteOffset+frame.byteLength)})}
  catch{socket.onerror?.()}
 })}
 const received:Uint8Array[]=[],sends=vi.fn((_socket:unknown,data:Uint8Array)=>{
  const request=incoming.decode(noise.decrypt(data));if(!request)return
  const message=decodeMessage(request),p=message.payload as any
  received.push(p.params.data)
  for(const plain of outgoing.encode(encodeMessage(createRpcResponse(message.id,{receivedBytes:p.params.data.length})))){
   const bytes=noise.encrypt(plain);socket.onmessage?.({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})
  }
 })
 const controller=new AbortController()
 const transport=new LanUploadTransport(offer,{...client,deviceId:'client',name:'test',platform:'android'},
  {identityKey:host.publicKey} as any,sends,controller.signal,()=>{
   queueMicrotask(()=>{socket.readyState=1;socket.onopen?.()});return socket
  })
 return {transport,core:new RemoteClientCore(transport),socket,controller,sends,noise,received}
}
it('interoperates with the real Noise/secure codecs and native byte sends on concurrent large RPCs',async()=>{
 const f=setup();await f.core.connect()
 expect(f.transport.getStats()).toMatchObject({mode:'LAN',connected:true})
 const chunks=Array.from({length:4},(_,i)=>new Uint8Array(256*1024).fill(i))
 const results=await Promise.all(chunks.map(chunk=>f.core.rpc('workspace.upload.chunk.binary',{sessionId:offer.sessionId,uploadId:offer.uploadId,offset:0,data:chunk})))
 expect(results).toEqual(chunks.map(chunk=>({receivedBytes:chunk.length})))
 expect(f.received).toEqual(chunks)
 // Public WS send is used only for the small handshake, never bulk data/Base64.
 expect(f.socket.send).toHaveBeenCalledTimes(1)
 expect(f.sends.mock.calls.length).toBeGreaterThan(4)
 await f.core.close();f.noise.destroy()
 expect(f.transport.getStats()).toMatchObject({mode:'Disconnected',connected:false})
})
it('fails closed on a malformed authenticated-channel handshake without sending upload mutations',async()=>{
 const f=setup(false,true),connect=f.core.connect()
 const rejected=expect(connect).rejects.toBeInstanceOf(LanUploadSecurityError)
 await vi.waitFor(()=>expect(f.socket.send).toHaveBeenCalled())
 f.socket.onmessage({data:new Uint8Array(3).buffer})
 await rejected;expect(f.sends).not.toHaveBeenCalled();expect(f.socket.close).toHaveBeenCalled()
 await f.core.close();f.noise.destroy()
})
it('cancels a handshake immediately and removes timers/socket listeners',async()=>{
 const f=setup(false,true),connect=f.core.connect(),rejected=expect(connect).rejects.toThrow('cancelled')
 await vi.waitFor(()=>expect(f.socket.send).toHaveBeenCalled())
 f.controller.abort(new Error('cancelled'));await rejected
 expect(f.socket.onmessage).toBeNull();expect(f.socket.close).toHaveBeenCalledTimes(1)
 await f.core.close();f.noise.destroy()
})
it('never retries ciphertext when the native send fails and makes later RPCs terminal',async()=>{
 const f=setup();await f.core.connect()
 f.sends.mockImplementationOnce(()=>{throw new Error('native failed')})
 await expect(f.core.rpc('workspace.upload.chunk.binary',{data:new Uint8Array(256*1024)})).rejects.toThrow()
 await expect(f.core.rpc('workspace.upload.commit',{})).rejects.toThrow()
 expect(f.sends).toHaveBeenCalledTimes(1);expect(f.socket.close).toHaveBeenCalledTimes(1)
 await f.core.close();f.noise.destroy()
})
