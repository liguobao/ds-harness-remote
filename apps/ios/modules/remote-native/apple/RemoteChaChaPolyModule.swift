import CryptoKit
import ExpoModulesCore

public final class RemoteChaChaPolyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RemoteChaChaPoly")
    Function("isAvailable") { true }

    Function("encrypt") { (key: Data, nonce: Data, ad: Data, plaintext: Data) throws -> Data in
      guard key.count == 32, nonce.count == 12, ad.count <= 65535, plaintext.count <= 65519 else {
        throw CryptoKitError.incorrectParameterSize
      }
      let box = try ChaChaPoly.seal(plaintext, using: SymmetricKey(data: key),
                                    nonce: ChaChaPoly.Nonce(data: nonce), authenticating: ad)
      return box.ciphertext + box.tag
    }

    Function("decrypt") { (key: Data, nonce: Data, ad: Data, ciphertext: Data) throws -> Data in
      guard key.count == 32, nonce.count == 12, ad.count <= 65535, (16...65535).contains(ciphertext.count) else {
        throw CryptoKitError.incorrectParameterSize
      }
      let box = try ChaChaPoly.SealedBox(nonce: ChaChaPoly.Nonce(data: nonce),
                                         ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
      return try ChaChaPoly.open(box, using: SymmetricKey(data: key), authenticating: ad)
    }
  }
}
