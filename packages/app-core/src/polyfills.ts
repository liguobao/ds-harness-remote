import * as ExpoCrypto from 'expo-crypto'

// Noble's browser builds resolve the Web Crypto random source while their
// modules are being evaluated. Install the native Expo implementation before
// importing App (and therefore before importing @dsh-remote/crypto).
const currentCrypto = globalThis.crypto

if (currentCrypto?.getRandomValues === undefined) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...currentCrypto,
      getRandomValues: ExpoCrypto.getRandomValues,
      randomUUID: ExpoCrypto.randomUUID,
    },
    configurable: true,
  })
}
