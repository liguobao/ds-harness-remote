import { expect, it } from 'vitest'
import { createLanUploadPrologue, isLanUploadAddress, validateLanUploadOffer } from '../src/index.js'
const scope={connectionId:'connection-1',sessionId:'session-1',uploadId:'12345678-1234-4567-8901-123456789abc',address:'192.168.31.61'}
const offer={connectionId:scope.connectionId,sessionId:scope.sessionId,uploadId:scope.uploadId,url:`ws://${scope.address}:32123/ds-harness-remote/upload/${'a'.repeat(43)}`,expiresInMs:10000}
it('accepts only literal RFC1918 IPv4 addresses',()=>{
 for(const a of ['10.0.0.1','172.16.0.1','172.31.255.255','192.168.31.61']) expect(isLanUploadAddress(a)).toBe(true)
 for(const a of ['127.0.0.1','0.0.0.0','8.8.8.8','169.254.1.1','172.15.0.1','172.32.0.1','192.168.001.1','192.168.1.256','localhost','0xc0a81f3d','::1','[::1]','192.168.31.61.attacker.test']) expect(isLanUploadAddress(a)).toBe(false)
})
it('pins the ticket endpoint to the actual selected peer address and exact connection/upload scope',()=>{
 expect(validateLanUploadOffer(offer,scope)).toEqual(offer)
 for(const patch of [{connectionId:'other'},{sessionId:'other'},{uploadId:'12345678-1234-4567-8901-123456789abd'},{expiresInMs:10001},{url:offer.url.replace(scope.address,'192.168.31.62')},{url:offer.url.replace('ws:','http:')},{url:offer.url+'?token=x'},{url:offer.url+'#x'},{url:offer.url.replace('ws://','ws://user:pass@')},{url:offer.url.replace('/ds-harness-remote/upload/','/other/')}]) expect(()=>validateLanUploadOffer({...offer,...patch},scope)).toThrow()
})
it('binds Noise to the owning connection, session, upload and single-use ticket',()=>{
 const original=createLanUploadPrologue(offer)
 for(const patch of [{connectionId:'other'},{sessionId:'other'},{uploadId:'other'},{url:offer.url.slice(0,-1)+'b'}]) expect(createLanUploadPrologue({...offer,...patch})).not.toEqual(original)
 expect(new TextDecoder().decode(original)).toContain('ds-harness-remote/lan-upload/v1')
})
