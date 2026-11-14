import { expect, it } from 'vitest'
import { BULK_DATA_BYTES, decodeBulkFrame, encodeBulkFrame } from '../../../scripts/transport-bench/stream-codec'
const id='12345678-1234-4567-8901-123456789abc'
it('preserves scope, offset and raw bytes including nonzero input views',()=>{
 const data=new Uint8Array(BULK_DATA_BYTES).map((_,i)=>i%251)
 const frame=encodeBulkFrame(id,200*1024*1024-data.length,data)
 const outer=new Uint8Array(frame.length+11);outer.set(frame,7)
 expect(decodeBulkFrame(outer.subarray(7,7+frame.length))).toEqual({uploadId:id,offset:200*1024*1024-data.length,data})
})
it('rejects malformed frames without consuming ordinary RPC data',()=>{
 expect(decodeBulkFrame(new TextEncoder().encode('{"v":1}'))).toBeUndefined()
 for(const length of [0,BULK_DATA_BYTES+1]) expect(()=>encodeBulkFrame(id,0,new Uint8Array(length))).toThrow()
 for(const offset of [-1,0.5,2**32]) expect(()=>encodeBulkFrame(id,offset,new Uint8Array(1))).toThrow()
 const frame=encodeBulkFrame(id,0,new Uint8Array(1));frame[4]=2
 expect(()=>decodeBulkFrame(frame)).toThrow()
 frame[4]=1;frame[24]=1
 expect(()=>decodeBulkFrame(frame)).toThrow()
 expect(()=>decodeBulkFrame(frame.subarray(0,20))).toThrow()
})
it('existing RTC decoder accepts a complete 48 KiB Noise ciphertext without extra RTC fragments', async()=>{
 const { RtcChunkCodec }=await import('../../../packages/webrtc/src/rtc-chunking')
 const ciphertext=new Uint8Array(BULK_DATA_BYTES+32+16).fill(7)
 expect(new RtcChunkCodec().decode(ciphertext)).toBe(ciphertext)
 expect(ciphertext.length).toBeLessThanOrEqual(65535)
})
