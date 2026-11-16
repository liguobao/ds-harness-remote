import cryptoTest from './Crypto.test'
import secureStoreTest from './SecureStore.test'

export default function testsuite() {
  cryptoTest()
  secureStoreTest()
}
