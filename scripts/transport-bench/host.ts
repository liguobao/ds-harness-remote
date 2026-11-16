import { LanUploadHost } from '../../packages/plugin/src/lan-upload.js'
import { RpcRouter } from '../../packages/plugin/src/rpc-router.js'
/** Isolated device benchmark; control binds loopback and is reached with adb reverse. */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, networkInterfaces } from 'node:os'
import { WebSocketServer } from 'ws'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { generateKeyPair, NoiseIkSession } from '../../packages/crypto/src/index.js'
import { SecureMessageCodec, decodeMessage, encodeMessage, createRpcResponse, createRpcError, type RemoteMessage } from '../../packages/protocol/src/index.js'
import { RtcChunkCodec } from '../../packages/webrtc/src/rtc-chunking.js'
import { loadNodeRtcFactory } from '../../packages/plugin/src/werift-rtc.js'
import { decodeBulkFrame } from './stream-codec.js'
import { WorkspaceUploadHost } from '../../packages/plugin/src/workspace-upload.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-transport-bench-'))
const identity = generateKeyPair()
const factory = await loadNodeRtcFactory()
if (!factory) throw new Error('No RTC backend')
const peers: ReturnType<typeof factory.create>[] = []
const uploads: WorkspaceUploadHost[] = []
const sessions: NoiseIkSession[] = []
const fixture = randomBytes(1024 * 1024)
const size = Number(process.env.DSH_BENCH_MIB ?? 64) * 1024 * 1024
if (!Number.isSafeInteger(size) || size < fixture.length || size > 200 * 1024 * 1024) throw new Error('Size must be 1..200 MiB')
const source = Buffer.alloc(size)
for (let offset = 0; offset < size; offset += fixture.length) fixture.copy(source, offset)
const sha256 = createHash('sha256').update(source).digest('hex')
const token = randomBytes(16).toString('hex')
const results: unknown[] = []
let productionRouter: RpcRouter | undefined
const productionConnectionId=`production-${randomBytes(12).toString('hex')}`
type BenchChannel = {binaryType:string;send(data:ArrayBuffer):void;onmessage:((event:{data:ArrayBuffer|string})=>void)|null;close():void}
function attachSession(publicKey: string) {
  const upload = new WorkspaceUploadHost(async session => session === 'bench' ? root : undefined, 120000, () => 'LAN'); uploads.push(upload)
  const noise = new NoiseIkSession({role:'responder', localPrivateKey:identity.privateKey,localPublicKey:identity.publicKey,remotePublicKey:publicKey,prologue:new TextEncoder().encode('dsh-isolated-bench-v1')})
  sessions.push(noise)
  const rtcIn = new RtcChunkCodec(), rtcOut = new RtcChunkCodec(), secureIn = new SecureMessageCodec(), secureOut = new SecureMessageCodec()
  const streams = new Map<string,{total:number;received:number;written:number;acknowledged:number;parts:Uint8Array[];bytes:number;failed?:unknown}>()
  let bulkTail = Promise.resolve()
  return ({channel}: {channel: BenchChannel}) => {
   channel.binaryType = 'arraybuffer'
   const send = (message: RemoteMessage) => {
    for (const plain of secureOut.encode(encodeMessage(message))) for (const frame of rtcOut.encode(noise.encrypt(plain))) channel.send(frame.buffer.slice(frame.byteOffset,frame.byteOffset+frame.byteLength) as ArrayBuffer)
   }
   channel.onmessage = ({data: raw}) => {
    try {
     if (typeof raw === 'string') throw new Error('Expected binary')
     const frame = rtcIn.decode(new Uint8Array(raw)); if(!frame) return
     if (!noise.complete) { noise.readHandshake(frame); channel.send(noise.writeHandshake().buffer as ArrayBuffer); return }
     const decrypted = noise.decrypt(frame)
     const bulk = decodeBulkFrame(decrypted)
     if (bulk) {
      const stream = streams.get(bulk.uploadId)
      if (!stream || stream.failed || bulk.offset !== stream.received || bulk.offset + bulk.data.length > stream.total || stream.received + bulk.data.length - stream.written > 2*1024*1024) throw new Error('Invalid bulk scope or offset')
      stream.received += bulk.data.length
      // Bounded sender credit; coalesce to existing <=256 KiB Host writes.
      bulkTail = bulkTail.then(async () => {
       if (stream.failed) return
       const flush = async () => {
        if (!stream.bytes) return
        const data = Buffer.concat(stream.parts,stream.bytes)
        await upload.call('workspace.upload.chunk.binary',{sessionId:'bench',uploadId:bulk.uploadId,offset:stream.written,data})
        stream.written += stream.bytes; stream.parts=[]; stream.bytes=0
        if (stream.written-stream.acknowledged >= 512*1024 || stream.written === stream.total) {
         stream.acknowledged=stream.written
         send(createRpcResponse(`stream:${bulk.uploadId}`,{receivedBytes:stream.written}))
        }
       }
       if (stream.bytes + bulk.data.length > 256*1024) await flush()
       stream.parts.push(bulk.data); stream.bytes += bulk.data.length
       if (bulk.offset + bulk.data.length === stream.total) await flush()
      }).catch(error => { stream.failed=error; send(createRpcError(`stream:${bulk.uploadId}`,'BENCH_STREAM_ERROR',String(error))) })
      return
     }
     const plain = secureIn.decode(decrypted); if(!plain) return
     const message = decodeMessage(plain), payload = message.payload as {method:string;params:any}
     if(message.type !== 'rpc.request') throw new Error('Expected request')
     void (async () => {
      try {
       if (payload.method === 'bench.stream.open') {
        const result = await upload.call('workspace.upload.open',payload.params)
        streams.set(payload.params.uploadId,{total:payload.params.totalBytes,received:0,written:0,acknowledged:0,parts:[],bytes:0})
        send(createRpcResponse(message.id,result)); return
       }
       if (payload.method === 'workspace.upload.commit') {
        await bulkTail
        const stream=streams.get(payload.params.uploadId)
        if(stream && (stream.failed || stream.written!==stream.total)) throw new Error('Bulk stream incomplete')
       }
       const result = await upload.call(payload.method,payload.params)
       if(payload.method === 'workspace.upload.commit') {
        const output = result as {name:string;bytes:number}
        const bytes = await readFile(join(root,output.name))
        const hash = createHash('sha256').update(bytes).digest('hex')
        await rm(join(root,output.name))
        streams.delete(payload.params.uploadId)
        send(createRpcResponse(message.id,{...output,sha256:hash,verified:hash === sha256}))
       } else send(createRpcResponse(message.id,result))
      } catch(error) { send(createRpcError(message.id,'BENCH_ERROR',String(error))) }
     })().catch(console.error)
    } catch(error) { console.error(error); channel.close() }
   }
  }
}
const server = createServer(async (req, res) => {
 try {
  const path = req.url?.replace(`/${token}`, '')
  if (!req.url?.startsWith(`/${token}/`)) { res.writeHead(404).end(); return }
  const reply = (data: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
  if (req.method === 'GET' && path === '/config') { reply({ publicKey: identity.publicKey, size, sha256, experiment: process.env.DSH_BENCH_EXPERIMENT?.startsWith('stream') || process.env.DSH_BENCH_TRANSPORT === 'websocket', largeRtcFrames: process.env.DSH_BENCH_EXPERIMENT === 'stream-large', production: process.env.DSH_BENCH_PRODUCTION === '1', lanAddress, transport: process.env.DSH_BENCH_TRANSPORT ?? 'rtc', nativeSocket: process.env.DSH_BENCH_NATIVE_WS === '1', wsUrl: websocketUrl }); return }
  if (req.method === 'GET' && path === '/fixture') { res.setHeader('Content-Length', source.length); res.end(source); return }
  let body = ''; for await (const part of req) { body += part; if(body.length > 1024 * 1024) throw new Error('Body too large') }
  const data = JSON.parse(body || '{}')
  if (path === '/production/setup') {
   if(process.env.DSH_BENCH_PRODUCTION!=='1' || !lanAddress || !/^[A-Za-z0-9_-]{43}$/.test(data.publicKey)) throw new Error('Invalid production fixture setup')
   await productionRouter?.closePeerStreams()
   const upload=new WorkspaceUploadHost(async session=>session==='bench'?root:undefined,120000,()=> 'LAN')
   uploads.push(upload)
   const lan=new LanUploadHost(upload,{connectionId:productionConnectionId,peerIdentityKey:data.publicKey,
    identity:()=>({...identity,schemaVersion:1,deviceId:'fixture-host',name:'fixture',fingerprint:'fixture'}),mode:()=> 'LAN'})
   productionRouter=new RpcRouter(undefined,undefined,undefined,undefined,()=>['workspace.upload.v1'],undefined,undefined,undefined,undefined,undefined,upload,undefined,lan)
   reply({connectionId:productionConnectionId});return
  }
  if (path === '/production/rpc') {
   if(!productionRouter) throw new Error('Fixture control connection is not initialized')
   const result=await productionRouter.handle(decodeMessage(Buffer.from(data.data,'base64')))
   reply({data:Buffer.from(encodeMessage(result)).toString('base64')});return
  }
  if (path === '/production/verify') {
   if(typeof data.name!=='string' || /[/\\]/.test(data.name) || data.name==='.' || data.name==='..') throw new Error('Invalid verification filename')
   const bytes=await readFile(join(root,data.name)),hash=createHash('sha256').update(bytes).digest('hex')
   await rm(join(root,data.name))
   reply({sha256:hash,bytes:bytes.length,verified:hash===sha256 && bytes.length===size});return
  }
  if (path === '/result') { results.push(data); console.log(JSON.stringify(data)); await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2)); reply({ok:true}); return }
  if (path !== '/offer') { res.writeHead(404).end(); return }
  const pc = factory.create({ iceServers: [] }); peers.push(pc)
  pc.ondatachannel = attachSession(data.publicKey)
  const candidates: unknown[] = []
  let gathered!: () => void
  const gathering = new Promise<void>(resolve => { gathered = resolve })
  pc.onicecandidate = ({candidate}) => { if(candidate) candidates.push(candidate); else gathered() }
  await pc.setRemoteDescription(data.offer)
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  await Promise.race([gathering, new Promise(resolve => setTimeout(resolve, 3000))])
  reply({answer,candidates})
 } catch(error) { res.writeHead(500).end(JSON.stringify({error:String(error)})); console.error(error) }
})
const lanAddress=process.env.DSH_BENCH_LAN_ADDRESS ?? networkInterfaces().en0?.find(address=>address.family==='IPv4' && !address.internal)?.address
if(process.env.DSH_BENCH_TRANSPORT==='websocket' && !lanAddress) throw new Error('Set DSH_BENCH_LAN_ADDRESS to the Mac LAN IPv4 address')
const websocketUrl=lanAddress ? `ws://${lanAddress}:18793/${token}` : undefined
const sockets=new Set<import('ws').WebSocket>()
const wsServer=process.env.DSH_BENCH_TRANSPORT==='websocket' ? new WebSocketServer({host:lanAddress!,port:18793,maxPayload:65535}) : undefined
wsServer?.on('connection',(socket,request)=>{
 const prefix=`/${token}/`
 if(!request.url?.startsWith(prefix)){socket.close();return}
 const publicKey=request.url.slice(prefix.length)
 if(!/^[A-Za-z0-9_-]{43}$/.test(publicKey)){socket.close();return}
 sockets.add(socket);socket.on('close',()=>sockets.delete(socket))
 const channel: BenchChannel={
  binaryType:'arraybuffer',onmessage:null,
  send:data=>socket.send(data),close:()=>socket.close(),
 }
 attachSession(publicKey)({channel})
 socket.on('message',(data,isBinary)=>{
  if(!isBinary){socket.close();return}
  const buffer=Buffer.from(data as Buffer)
  channel.onmessage?.({data:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer})
 })
})
server.listen(18792,'127.0.0.1',async () => {
 const config = {url:`http://127.0.0.1:18792/${token}`,root,sha256,size}
 await writeFile('/tmp/dsh-transport-bench-config.json',JSON.stringify(config),{mode:0o600})
 console.log(JSON.stringify({ready:true,root,size,sha256}))
})
async function close() {
 await productionRouter?.closePeerStreams()
 for (const upload of uploads) await upload.closeAll()
 for (const noise of sessions) noise.destroy()
 for (const pc of peers) pc.close()
 await rm('/tmp/dsh-transport-bench-config.json', {force:true})
 for(const socket of sockets) socket.terminate()
 wsServer?.close()
 server.close()
 process.exit(0)
}
process.on('SIGTERM',()=>void close()); process.on('SIGINT',()=>void close())
