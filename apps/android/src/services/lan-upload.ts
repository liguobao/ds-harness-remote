import { RemoteClientCore } from '@dsh-remote/client-core'
import { LAN_UPLOAD_MIN_BYTES, isLanUploadAddress, validateLanUploadOffer } from '@dsh-remote/protocol'
import type { AdaptiveConnectionDetails } from '@dsh-remote/webrtc'
import type { DeviceIdentity, RemoteDevice } from '../types'
import { LanUploadTransport, LanUploadUnavailable } from './lan-upload-transport'
import type { BinarySocketSender } from './native-websocket-binary'

interface Rpc { rpc<T=unknown>(method:string,params:unknown,signal?:AbortSignal):Promise<T> }
interface DirectRpc extends Rpc { connect():Promise<void>;close():Promise<void> }
export interface LanUploadRouteOptions {
  control: Rpc
  identity: DeviceIdentity
  host: RemoteDevice
  sender: BinarySocketSender
  current: () => boolean
  mode: () => string | undefined
  details: () => Promise<AdaptiveConnectionDetails | undefined>
  connectionId: () => string
  createClient?: (offer:ReturnType<typeof validateLanUploadOffer>,signal:AbortSignal)=>DirectRpc
}
interface Route { sessionId:string; client:DirectRpc }

/** Per-main-connection routing. Failed data calls never migrate to the original carrier. */
export class LanUploadRoutes {
  private readonly lifetime = new AbortController()
  private readonly routes = new Map<string,Route>()
  private readonly preparing = new Set<string>()
  private readonly failed = new Set<string>()

  constructor(private readonly options:LanUploadRouteOptions) {}

  async rpc<T=unknown>(method:string,params:unknown,signal?:AbortSignal):Promise<T> {
    this.assertCurrent(signal)
    const p=record(params)
    const id=typeof p?.uploadId==='string' ? p.uploadId : undefined
    const sessionId=typeof p?.sessionId==='string' ? p.sessionId : undefined
    if (!method.startsWith('workspace.upload.') || !id || !sessionId) return this.options.control.rpc<T>(method,params,signal)
    const route=this.routes.get(id)
    if(route && route.sessionId!==sessionId) throw new Error('LAN upload scope mismatch')
    if(this.failed.has(id) && method!=='workspace.upload.abort') throw new Error('LAN upload failed; retry with a new upload ID')
    if(method==='workspace.upload.open') {
      if(route || this.preparing.has(id)) throw new Error('Upload ID already in use')
      const direct=await this.prepare(p!,signal)
      try { this.assertCurrent(signal) } catch(error) { await direct?.close().catch(()=>undefined);throw error }
      if(!direct) return this.options.control.rpc<T>(method,params,signal)
      this.routes.set(id,{sessionId,client:direct})
      try { return await direct.rpc<T>(method,params,signal) }
      catch(error) { await this.retire(id,true);throw error }
    }
    if(method==='workspace.upload.abort') {
      // Cleanup may use the control channel even after an ambiguous data-channel failure.
      try { return await this.options.control.rpc<T>(method,params,signal) }
      finally { await this.retire(id,false);this.failed.delete(id) }
    }
    if(!route) {
      if(this.preparing.has(id)) throw new Error('LAN upload has not opened')
      return this.options.control.rpc<T>(method,params,signal)
    }
    if(this.options.mode()!=='LAN') { await this.retire(id,true);throw new Error('LAN upload path changed') }
    try {
      const value=await route.client.rpc<T>(method,params,signal)
      this.assertCurrent(signal)
      if(method==='workspace.upload.commit') await this.retire(id,false)
      return value
    } catch(error) { await this.retire(id,true);throw error }
  }

  async close():Promise<void> {
    this.lifetime.abort(new Error('Main Remote connection closed'))
    const routes=[...this.routes.values()];this.routes.clear();this.failed.clear()
    await Promise.all(routes.map(route=>route.client.close().catch(()=>undefined)))
  }

  private assertCurrent(signal?:AbortSignal) {
    if(signal?.aborted) throw signal.reason ?? new Error('Upload cancelled')
    if(this.lifetime.signal.aborted || !this.options.current()) throw new Error('Remote connection replaced')
  }

  private async prepare(params:Record<string,unknown>,signal?:AbortSignal):Promise<DirectRpc | undefined> {
    const id=params.uploadId as string
    if(params.encoding!=='binary-v1' || typeof params.totalBytes!=='number' || params.totalBytes<LAN_UPLOAD_MIN_BYTES
      || this.options.mode()!=='LAN' || this.routes.size+this.preparing.size>=2) return undefined
    this.preparing.add(id)
    let client:DirectRpc | undefined
    const combined=AbortSignal.any([this.lifetime.signal,...(signal?[signal]:[])])
    try {
      const details=await this.options.details().catch(()=>undefined)
      this.assertCurrent(signal)
      const address=details?.webRtc?.remoteAddress
      if(!address || !isLanUploadAddress(address) || details?.webRtc?.mode!=='LAN' || this.options.mode()!=='LAN') return undefined
      let input:unknown
      try {
        input=await this.options.control.rpc('workspace.upload.lan.open',{sessionId:params.sessionId,uploadId:id,address},combined)
      } catch(error) {
        this.assertCurrent(signal)
        // Negotiation creates only an expiring ticket, never a file; no mutation is replayed.
        if((error as {code?:unknown})?.code==='FEATURE_NOT_SUPPORTED' || (error as {code?:unknown})?.code==='METHOD_NOT_FOUND' || (error as {code?:unknown})?.code==='RPC_TIMEOUT') return undefined
        throw error
      }
      this.assertCurrent(signal)
      if(this.options.mode()!=='LAN') return undefined
      const offer=validateLanUploadOffer(input,{connectionId:this.options.connectionId(),sessionId:params.sessionId as string,uploadId:id,address})
      client=this.options.createClient?.(offer,combined) ?? new RemoteClientCore(
        new LanUploadTransport(offer,this.options.identity,this.options.host,this.options.sender,combined),35_000)
      try { await client.connect() }
      catch(error) {
        await client.close().catch(()=>undefined)
        this.assertCurrent(signal)
        if(error instanceof LanUploadUnavailable) return undefined
        throw error
      }
      this.assertCurrent(signal)
      if(this.options.mode()!=='LAN'){await client.close();return undefined}
      return client
    } catch(error) { await client?.close().catch(()=>undefined);throw error }
    finally { this.preparing.delete(id) }
  }

  private async retire(id:string,failed:boolean) {
    const route=this.routes.get(id);this.routes.delete(id)
    if(failed) {
      this.failed.add(id)
      if(this.failed.size>64) this.failed.delete(this.failed.values().next().value!)
    }
    await route?.client.close().catch(()=>undefined)
  }
}
function record(input:unknown):Record<string,unknown> | undefined {
  return input && typeof input==='object' && !Array.isArray(input) ? input as Record<string,unknown> : undefined
}
