import '../src/polyfills'
import { LanUploadRoutes } from '../src/services/lan-upload'
import { nativeWebSocketSender } from '../src/services/native-websocket-binary'
import { uploadStagedFileToWorkspace, bytesToBase64 } from '../src/screens/chat-files'
// Dedicated Gradle entry. Never imported by the shipping application.
import React, { useEffect, useState } from 'react'
import { ScrollView, Text } from 'react-native'
import { registerRootComponent, requireOptionalNativeModule } from 'expo'
import { File, Paths } from 'expo-file-system'
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy'
import { RTCPeerConnection, registerGlobals } from 'react-native-webrtc'
import { generateKeyPair, NoiseIkSession, fromBase64Url } from '@dsh-remote/crypto'
import { createRpcRequest, encodeMessage, decodeMessage, SecureMessageCodec, type RpcMethod } from '@dsh-remote/protocol'
import { RtcChunkCodec } from '../../../packages/webrtc/src/rtc-chunking'
import { encodeBulkFrame, BULK_DATA_BYTES } from '../../../scripts/transport-bench/stream-codec'
import { nativeChaChaEncryptor } from '../src/services/native-chacha-poly'
import { createNativeRtcSender } from '../src/services/native-rtc-binary'

registerGlobals()
const url = process.env.EXPO_PUBLIC_DSH_BENCH_URL!
const awake = requireOptionalNativeModule<any>('ExpoKeepAwake')
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function run(log: (line: string) => void) {
 if (!url) throw new Error('EXPO_PUBLIC_DSH_BENCH_URL required')
 await awake?.activate('isolated-bench')
 const post = async (path: string, body: unknown) => {
  const response = await fetch(`${url}/${path}`, {method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})
  if(!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json()
 }
 const report = async (data: unknown) => { log(JSON.stringify(data)); await post('result',data) }
 const file = new File(Paths.cache, 'dsh-isolated-bench.bin')
 const pc = new RTCPeerConnection({iceServers:[]})
 const identity = generateKeyPair()
 const config = await (await fetch(`${url}/config`)).json()
 if(config.production) {
  let active=true
  let routes:LanUploadRoutes | undefined
  try {
   const sender=nativeWebSocketSender()
   if(!sender) throw new Error('Production native WebSocket sender unavailable')
   const {connectionId}=await post('production/setup',{publicKey:identity.publicKey})
   const control={rpc:async<T=unknown>(method:string,params:unknown,signal?:AbortSignal):Promise<T>=>{
    if(method.startsWith('workspace.upload.') && method!=='workspace.upload.lan.open') throw new Error('Production benchmark unexpectedly fell back to the control path')
    const result=await fetch(`${url}/production/rpc`,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({data:bytesToBase64(encodeMessage(createRpcRequest(method as RpcMethod,params)))})})
    const response=decodeMessage(fromBase64Url((await result.json()).data)),payload=response.payload as any
    if(response.type==='rpc.error') throw Object.assign(new Error(payload.message),{code:payload.code})
    return payload.result as T
   }}
   routes=new LanUploadRoutes({control,identity:{...identity,deviceId:'fixture-phone',name:'fixture',platform:'android'},host:{identityKey:config.publicKey} as any,sender,
    current:()=>active,mode:()=> 'LAN',connectionId:()=>connectionId,details:async()=>({webRtc:{mode:'LAN',remoteAddress:config.lanAddress}} as any)})
   const manager=routes
   const rpc=Object.assign((method:string,params:unknown,signal?:AbortSignal)=>manager.rpc(method,params,signal),{supportsBinaryUpload:true})
   if(file.exists) file.delete()
   await File.downloadFileAsync(`${url}/fixture`,file)
   await report({phase:'production-ready',size:file.size,nativeSocket:true})
   for(let i=1;i<=2;i++) {
    const start=performance.now()
    const result=await uploadStagedFileToWorkspace(rpc,'bench',{id:`production-${i}`,name:`dsh-production-${i}-200MiB.bin`,uri:file.uri,size:file.size})
    const elapsedMs=performance.now()-start
    const verification=await post('production/verify',{name:result.name})
    if(!verification.verified || verification.sha256!==config.sha256 || result.bytes!==config.size) throw new Error('Production upload checksum mismatch')
    await report({phase:'production-upload',elapsedMs,mibPerSecond:file.size/1048576/(elapsedMs/1000),result,verification})
   }
   await report({phase:'complete',transport:'production-lan'})
  } catch(error) { await report({phase:'error',error:String(error)}).catch(()=>undefined);throw error }
  finally {active=false;await routes?.close();pc.close();if(file.exists)file.delete();await awake?.deactivate('isolated-bench')}
  return
 }
 const cipher = nativeChaChaEncryptor()
 const nativeSend = createNativeRtcSender(requireOptionalNativeModule<any>('RemoteWebRtcBinary') ?? undefined)
 const noise = new NoiseIkSession({role:'initiator',localPrivateKey:identity.privateKey,localPublicKey:identity.publicKey,remotePublicKey:config.publicKey,prologue:new TextEncoder().encode('dsh-isolated-bench-v1'),encryptChaChaPoly:cipher})
 const websocket=config.transport === 'websocket'
 const channel: any = websocket ? new WebSocket(`${config.wsUrl}/${identity.publicKey}`) : pc.createDataChannel('bench',{ordered:true})
 const nativeSocket = websocket && config.nativeSocket ? requireOptionalNativeModule<any>('RemoteWebRtcBinary') : undefined
 if(websocket && config.nativeSocket && typeof nativeSocket?.sendSocket !== 'function') throw new Error('Native WebSocket benchmark bridge unavailable')
 channel.binaryType = 'arraybuffer'
 const rtcOut = new RtcChunkCodec(), rtcIn = new RtcChunkCodec(), secureOut = new SecureMessageCodec(), secureIn = new SecureMessageCodec()
 const waiting = new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
 let bulkState: {uploadId:string;sent:number;acked:number;error?:Error;wake?:()=>void} | undefined
 let ready!: () => void
 const handshake = new Promise<void>(resolve => { ready = resolve })
 const opened = new Promise<void>((resolve,reject) => { channel.onopen = () => resolve(); channel.onerror = () => reject(new Error('DataChannel error')) })
 channel.onclose = () => {
  const error=new Error('Benchmark channel closed')
  if(bulkState){bulkState.error=error;bulkState.wake?.()}
  for(const item of waiting.values()){clearTimeout(item.timer);item.reject(error)}
  waiting.clear()
 }
 channel.onmessage = ({data}: {data: ArrayBuffer | string}) => {
  try {
   if(typeof data === 'string') throw new Error('Expected binary')
   const frame = rtcIn.decode(new Uint8Array(data)); if(!frame) return
   if(!noise.complete) { noise.readHandshake(frame); ready(); return }
   const plain = secureIn.decode(noise.decrypt(frame)); if(!plain) return
   const message = decodeMessage(plain), payload = message.payload as any
   if (bulkState && payload.requestId === `stream:${bulkState.uploadId}`) {
    if (message.type === 'rpc.error') bulkState.error = new Error(payload.message)
    else {
     const offset=payload.result?.receivedBytes
     if(!Number.isSafeInteger(offset) || offset < bulkState.acked || offset > bulkState.sent) throw new Error('Invalid cumulative acknowledgement')
     bulkState.acked=offset
    }
    bulkState.wake?.(); return
   }
   const pending = waiting.get(payload.requestId); if(!pending) return
   clearTimeout(pending.timer); waiting.delete(payload.requestId)
   if(message.type === 'rpc.error') pending.reject(new Error(payload.message)); else pending.resolve(payload.result)
  } catch(error) { log(String(error)); if(bulkState){bulkState.error=error as Error;bulkState.wake?.()}; for(const item of waiting.values()) item.reject(error as Error) }
 }
 let metrics = {readMs:0,encodeMs:0,encryptMs:0,sendMs:0,frames:0,maxBuffered:0}
 let sendTail = Promise.resolve()
 let sequence = 0
 const rpc = (method: string, params: unknown): Promise<any> => {
  const id = `bench-${++sequence}`
  const response = new Promise((resolve,reject) => {
   const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`RPC timeout: ${method}`)) },60000)
   waiting.set(id,{resolve,reject,timer})
  })
  // Serialize nonce/framing just as SecureTransport does, without waiting for RPC ACKs.
  sendTail = sendTail.then(async () => {
   let t = performance.now()
   const frames = secureOut.encode(encodeMessage(createRpcRequest(method as RpcMethod,params,id)))
   metrics.encodeMs += performance.now()-t
   for(const plain of frames) {
    t = performance.now(); const encrypted = noise.encrypt(plain); metrics.encryptMs += performance.now()-t
    t = performance.now()
    for(const frame of websocket ? [encrypted] : rtcOut.encode(encrypted)) {
     while((channel.bufferedAmount ?? 0) > 512*1024) await pause(2)
     const buffer = frame.buffer.slice(frame.byteOffset,frame.byteOffset+frame.byteLength) as ArrayBuffer
     if(nativeSocket) nativeSocket.sendSocket(channel._socketId,new Uint8Array(buffer))
     else if(!nativeSend?.(channel,buffer)) channel.send(buffer)
     metrics.frames++; metrics.maxBuffered = Math.max(metrics.maxBuffered,channel.bufferedAmount ?? 0)
    }
    metrics.sendMs += performance.now()-t
   }
  }).catch(error => { const item=waiting.get(id); if(item){clearTimeout(item.timer);waiting.delete(id);item.reject(error)} })
  return response
 }
 const sendBulk = (plain: Uint8Array) => {
  const task = sendTail.then(async () => {
   let t=performance.now(); const encrypted=noise.encrypt(plain); metrics.encryptMs+=performance.now()-t
   t=performance.now()
   for(const frame of (websocket || config.largeRtcFrames) ? [encrypted] : rtcOut.encode(encrypted)) {
    while((channel.bufferedAmount ?? 0)>512*1024) await pause(2)
    const buffer=frame.buffer.slice(frame.byteOffset,frame.byteOffset+frame.byteLength) as ArrayBuffer
    if(nativeSocket) nativeSocket.sendSocket(channel._socketId,new Uint8Array(buffer))
     else if(!nativeSend?.(channel,buffer)) channel.send(buffer)
    metrics.frames++;metrics.maxBuffered=Math.max(metrics.maxBuffered,channel.bufferedAmount ?? 0)
   }
   metrics.sendMs+=performance.now()-t
  })
  sendTail=task.catch(()=>undefined)
  return task
 }
 const waitAck = async (target:number) => {
  if(!bulkState) throw new Error('No bulk upload')
  if(bulkState.error) throw bulkState.error
  if(bulkState.acked>=target) return
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{if(bulkState)bulkState.wake=undefined;reject(new Error('Bulk credit timeout'))},60000)
   bulkState!.wake=()=>{
    if(!bulkState?.error && (bulkState?.acked??0)<target) return
    clearTimeout(timer)
    if(bulkState?.error) reject(bulkState.error); else resolve()
    if(bulkState) bulkState.wake=undefined
   }
  })
 }
 try {
  log(`Downloading fixture over ADB control channel; payload benchmark uses LAN ${websocket?'TCP/WebSocket':'UDP'}.`)
  if(file.exists) file.delete()
  await File.downloadFileAsync(`${url}/fixture`,file)
  if(!websocket) {
  await pc.setLocalDescription(await pc.createOffer())
  for(let i=0;i<100 && pc.iceGatheringState!=='complete';i++) await pause(50)
  const {answer,candidates} = await post('offer',{publicKey:identity.publicKey,offer:pc.localDescription})
  await pc.setRemoteDescription(answer)
  for(const candidate of candidates) await pc.addIceCandidate(candidate)
  }
  await Promise.race([opened,pause(20000).then(()=>{throw new Error('RTC open timeout')})])
  channel.send(noise.writeHandshake().buffer as ArrayBuffer)
  await Promise.race([handshake,pause(10000).then(()=>{throw new Error('Noise timeout')})])
  await report({phase:'ready',transport:config.transport,nativeSocket:!!nativeSocket,nativeCipher:!!cipher,nativeRtc:!websocket && !!nativeSend,size:config.size})
  for(const {window,binary,stream} of config.experiment ? [{window:4,binary:true,stream:false},{window:4,binary:true,stream:true},{window:4,binary:true,stream:false},{window:4,binary:true,stream:true}] : [{window:4,binary:false,stream:false}, ...[4,8,16,4].map(window=>({window,binary:true,stream:false}))]) {
   metrics = {readMs:0,encodeMs:0,encryptMs:0,sendMs:0,frames:0,maxBuffered:0}
   const uploadId = crypto.randomUUID(), name = `bench-${uploadId}.bin`
   const handle = file.open()
   const started = performance.now(), latencies:number[]=[]
   const pending: Promise<void>[]=[]
   let failed: unknown, received=0, offset=0
   try {
    const opened = await rpc(stream ? 'bench.stream.open' : 'workspace.upload.open',{sessionId:'bench',uploadId,name,totalBytes:file.size,...(binary ? {encoding:'binary-v1'} : {})})
    if(stream) {
     bulkState={uploadId,sent:0,acked:0}
     const credit=1024*1024
     while(offset<file.size) {
      if(bulkState.error) throw bulkState.error
      if(offset-bulkState.acked>=credit) await waitAck(offset-credit+1)
      const count=Math.min(BULK_DATA_BYTES,file.size-offset,credit-(offset-bulkState.acked))
      let t=performance.now(); const data=handle.readBytes(count);metrics.readMs+=performance.now()-t
      if(data.length!==count) throw new Error('Short bulk read')
      t=performance.now();const frame=encodeBulkFrame(uploadId,offset,data);metrics.encodeMs+=performance.now()-t
      offset+=count;bulkState.sent=offset
      await sendBulk(frame)
     }
     await waitAck(file.size)
     received=bulkState.acked;bulkState=undefined
    }
    while(!stream && (offset<file.size || pending.length)) {
     while(offset<file.size && pending.length<window && !failed) {
      const start=offset, count=Math.min(opened.chunkBytes,file.size-offset)
      const t=performance.now(), data=binary ? handle.readBytes(count) : await readAsStringAsync(file.uri,{encoding:EncodingType.Base64,position:offset,length:count}); metrics.readMs+=performance.now()-t
      if(typeof data!=='string' && data.length!==count) throw new Error('Short fixture read')
      const sent=performance.now(),end=offset+count
      pending.push(rpc(binary ? 'workspace.upload.chunk.binary' : 'workspace.upload.chunk',{sessionId:'bench',uploadId,offset,data}).then(ack=>{
       if(ack.receivedBytes!==end) throw new Error('Bad offset acknowledgement')
       received+=count; latencies.push(performance.now()-sent)
      }).catch(error=>{failed=error}))
      offset=start+count
     }
     if(pending.length) await pending.shift()
     if(failed) throw failed
    }
    const result=await rpc('workspace.upload.commit',{sessionId:'bench',uploadId})
    const elapsedMs=performance.now()-started
    if(!result.verified || result.sha256!==config.sha256 || received!==file.size) throw new Error('Checksum mismatch')
    latencies.sort((a,b)=>a-b)
    await report({phase:'window',transport:config.transport,nativeSocket:!!nativeSocket,encoding:stream?(config.largeRtcFrames?'bulk-stream-large-rtc-v1':'bulk-stream-v1'):binary?'binary-v1':'base64',window,elapsedMs,mibPerSecond:file.size/1048576/(elapsedMs/1000),metrics,ackP50:latencies[Math.floor(latencies.length*.5)],ackP95:latencies[Math.floor(latencies.length*.95)],sha256:result.sha256,verified:true})
   } finally { await Promise.all(pending); handle.close() }
   await pause(1500)
  }
  const stats = websocket ? new Map() : await pc.getStats()
  await report({phase:'complete',transport:config.transport,stats:[...stats.values()].filter((s:any)=>s.type==='candidate-pair' || s.type==='local-candidate' || s.type==='remote-candidate')})
 } catch(error) { await report({phase:'error',error:String(error)}).catch(()=>log(String(error))); throw error }
 finally { channel.close(); pc.close(); noise.destroy(); for(const item of waiting.values()){clearTimeout(item.timer);item.reject(new Error('Benchmark closed'))}; if(file.exists)file.delete(); await awake?.deactivate('isolated-bench') }
}
let started=false
function Bench() {
 const [lines,setLines]=useState<string[]>([])
 useEffect(()=>{ if(started)return; started=true; void run(line=>setLines(old=>[...old,line])).catch(error=>setLines(old=>[...old,String(error)])) },[])
 return <ScrollView style={{padding:24,paddingTop:60,backgroundColor:'#fff'}}><Text selectable style={{color:'#111'}}>Independent transport benchmark{'\n'}{lines.join('\n\n')}</Text></ScrollView>
}
registerRootComponent(Bench)
