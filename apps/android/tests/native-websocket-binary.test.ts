vi.mock('expo',()=>({requireOptionalNativeModule:()=>undefined}))
import { expect, it, vi } from 'vitest'
import { createNativeWebSocketSender } from '../src/services/native-websocket-binary'
it('sends byte views on the existing RN socket with no Base64 conversion or retries',()=>{
 const send=vi.fn(),sender=createNativeWebSocketSender({isAvailable:()=>true,send})!
 const bytes=new Uint8Array([0,1,2,255]).subarray(1,3)
 sender({_socketId:7},bytes)
 expect(send).toHaveBeenCalledTimes(1)
 expect(send).toHaveBeenCalledWith(7,bytes)
 send.mockImplementationOnce(()=>{throw new Error('closed')})
 expect(()=>sender({_socketId:7},bytes)).toThrow('closed')
 expect(send).toHaveBeenCalledTimes(2)
})
it('requires supported native code and valid bounded socket handles and messages',()=>{
 expect(createNativeWebSocketSender(undefined)).toBeUndefined()
 expect(createNativeWebSocketSender({isAvailable:()=>false,send:vi.fn()})).toBeUndefined()
 const send=vi.fn(),sender=createNativeWebSocketSender({isAvailable:()=>true,send})!
 for(const socket of [null,{}, {_socketId:-1},{_socketId:2**32},{_socketId:1.2}])expect(()=>sender(socket,new Uint8Array(1))).toThrow()
 for(const size of [0,65536])expect(()=>sender({_socketId:1},new Uint8Array(size))).toThrow()
 expect(send).not.toHaveBeenCalled()
})
