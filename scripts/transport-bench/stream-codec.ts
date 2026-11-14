/** Experimental benchmark-only bulk frame; never accepted by production routers. */
const MAGIC = new Uint8Array([0x44, 0x53, 0x48, 0x42, 1, 0, 0, 0])
export const BULK_HEADER_BYTES = 32
export const BULK_DATA_BYTES = 48 * 1024 - BULK_HEADER_BYTES
export function encodeBulkFrame(uploadId: string, offset: number, data: Uint8Array): Uint8Array {
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uploadId)
  || !Number.isSafeInteger(offset) || offset < 0 || offset > 0xffffffff
  || data.length < 1 || data.length > BULK_DATA_BYTES) throw new Error('Invalid bulk frame')
 const frame = new Uint8Array(BULK_HEADER_BYTES + data.length)
 frame.set(MAGIC)
 const hex = uploadId.replaceAll('-', '')
 for (let i=0; i<16; i++) frame[8+i] = parseInt(hex.slice(i*2,i*2+2),16)
 new DataView(frame.buffer).setUint32(28,offset)
 frame.set(data,BULK_HEADER_BYTES)
 return frame
}
export function decodeBulkFrame(frame: Uint8Array): {uploadId:string;offset:number;data:Uint8Array} | undefined {
 if (!MAGIC.subarray(0,4).every((byte,index)=>frame[index]===byte)) return undefined
 if(frame.length <= BULK_HEADER_BYTES || frame.length > BULK_HEADER_BYTES+BULK_DATA_BYTES
  || !MAGIC.every((byte,index)=>frame[index]===byte)) throw new Error('Invalid bulk frame')
 const view=new DataView(frame.buffer,frame.byteOffset,frame.byteLength)
 if(view.getUint32(24)!==0) throw new Error('Invalid bulk offset')
 const hex=Array.from(frame.subarray(8,24),b=>b.toString(16).padStart(2,'0')).join('')
 return {uploadId:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`,offset:view.getUint32(28),data:frame.subarray(BULK_HEADER_BYTES)}
}
