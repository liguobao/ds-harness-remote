import { NoiseIkSession } from '@dsh-remote/crypto'
import { LAN_UPLOAD_CONNECT_MS, SecureMessageCodec, createLanUploadPrologue, type LanUploadOffer, type TransportStats } from '@dsh-remote/protocol'
import { SerialSend, type RemoteTransport } from '@dsh-remote/webrtc'
import { nativeChaChaEncryptor } from './native-chacha-poly'
import type { BinarySocketSender } from './native-websocket-binary'
import type { DeviceIdentity, RemoteDevice } from '../types'

export class LanUploadUnavailable extends Error {}
export class LanUploadSecurityError extends Error {}

/** Independent upload-only Noise session. The main connection continues owning authorization. */
export class LanUploadTransport implements RemoteTransport {
  private socket?: WebSocket
  private noise?: NoiseIkSession
  private closed = false
  private ready = false
  private readonly sends = new SerialSend()
  private readonly incoming = new SecureMessageCodec()
  private readonly outgoing = new SecureMessageCodec()
  private readonly messages = new Set<(data:Uint8Array)=>void>()
  private readonly closes = new Set<(error?:Error)=>void>()
  private removeAbort?: () => void
  private settleConnect?: (error?:Error)=>void
  private bytesSent = 0
  private bytesReceived = 0

  constructor(
    private readonly offer: LanUploadOffer,
    private readonly identity: DeviceIdentity,
    private readonly host: RemoteDevice,
    private readonly sender: BinarySocketSender,
    private readonly signal: AbortSignal,
    private readonly createSocket: (url:string)=>WebSocket = url => new WebSocket(url),
  ) {}

  async connect(): Promise<void> {
    if(this.closed || this.signal.aborted) throw this.signal.reason ?? new Error('LAN upload closed')
    const noise = new NoiseIkSession({role:'initiator',localPrivateKey:this.identity.privateKey,localPublicKey:this.identity.publicKey,
      remotePublicKey:this.host.identityKey,prologue:createLanUploadPrologue(this.offer),encryptChaChaPoly:nativeChaChaEncryptor()})
    this.noise = noise
    try {
      await new Promise<void>((resolve,reject) => {
        const finish = (error?:Error) => {
          clearTimeout(timer)
          this.settleConnect=undefined
          if(error) reject(error); else resolve()
        }
        const timer=setTimeout(()=>this.fail(new LanUploadUnavailable('LAN upload connection timed out')),LAN_UPLOAD_CONNECT_MS)
        this.settleConnect=finish
        const socket=this.createSocket(this.offer.url)
        this.socket=socket
        socket.binaryType='arraybuffer'
        const abort=()=>this.fail(this.signal.reason instanceof Error ? this.signal.reason : new Error('LAN upload aborted'))
        this.signal.addEventListener('abort',abort,{once:true})
        this.removeAbort=()=>this.signal.removeEventListener('abort',abort)
        if(this.signal.aborted){abort();return}
        socket.onopen=()=>{
          try { if(!this.closed) socket.send(noise.writeHandshake().buffer as ArrayBuffer) }
          catch { this.fail(new LanUploadUnavailable('LAN upload connection failed')) }
        }
        socket.onerror=()=>this.fail(new LanUploadUnavailable('LAN upload socket failed'))
        socket.onclose=()=>this.fail(new LanUploadUnavailable('LAN upload socket closed'))
        socket.onmessage=event=>{
          if(this.closed) return
          try {
            if(!(event.data instanceof ArrayBuffer) || event.data.byteLength>65535) throw new Error('Invalid LAN upload frame')
            const frame=new Uint8Array(event.data)
            if(!noise.complete){
              noise.readHandshake(frame)
              if(!noise.complete) throw new Error('Incomplete Noise handshake')
              this.ready=true;finish();return
            }
            const data=this.incoming.decode(noise.decrypt(frame))
            this.bytesReceived+=frame.byteLength
            if(data) for(const handler of this.messages) handler(data)
          } catch {
            // Pinning or transcript failures must never trigger a downgrade/retry.
            this.fail(new LanUploadSecurityError('LAN upload authentication or framing failed'))
          }
        }
      })
    } catch(error) {
      await this.close()
      throw error
    }
  }

  async send(data:Uint8Array):Promise<void> {
    return this.sends.run(data.byteLength,async()=>{
      if(this.closed || !this.ready || !this.socket || this.socket.readyState!==1 || !this.noise) throw new Error('LAN upload is closed')
      try {
        for(const frame of this.outgoing.encode(data)) {
          const ciphertext=this.noise.encrypt(frame)
          this.sender(this.socket,ciphertext)
          this.bytesSent+=ciphertext.byteLength
        }
      } catch(error) { this.fail(error instanceof Error ? error : new Error('LAN upload send failed'));throw error }
    })
  }
  onMessage(cb:(data:Uint8Array)=>void){this.messages.add(cb);return()=>{this.messages.delete(cb)}}
  onClose(cb:(error?:Error)=>void){this.closes.add(cb);return()=>{this.closes.delete(cb)}}
  getStats():TransportStats { return {mode:this.ready && !this.closed?'LAN':'Disconnected',connected:this.ready && !this.closed,bytesSent:this.bytesSent,bytesReceived:this.bytesReceived} }
  async close():Promise<void> { this.fail(new Error('LAN upload closed')) }
  private fail(error:Error) {
    if(this.closed) return
    this.closed=true;this.ready=false
    this.settleConnect?.(error)
    this.removeAbort?.();this.removeAbort=undefined
    const socket=this.socket;this.socket=undefined
    if(socket){socket.onopen=null;socket.onmessage=null;socket.onerror=null;socket.onclose=null;try{socket.close()}catch{}}
    this.noise?.destroy();this.noise=undefined
    this.incoming.reset();this.outgoing.reset()
    for(const handler of this.closes) handler(error)
    this.closes.clear();this.messages.clear()
  }
}
