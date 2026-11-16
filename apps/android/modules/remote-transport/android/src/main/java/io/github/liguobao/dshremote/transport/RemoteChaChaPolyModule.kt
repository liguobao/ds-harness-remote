package io.github.liguobao.dshremote.transport

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Stateless byte-array acceleration of the existing Noise AEAD. Never owns a nonce counter. */
class RemoteChaChaPolyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RemoteChaChaPoly")

    Function("isAvailable") {
      Build.VERSION.SDK_INT >= 28 && runCatching { Cipher.getInstance(TRANSFORMATION); true }.getOrDefault(false)
    }

    // Expo maps Uint8Array directly to ByteArray and back through JSI, without base64.
    Function("encrypt") { key: ByteArray, nonce: ByteArray, ad: ByteArray, plaintext: ByteArray ->
      try {
        require(Build.VERSION.SDK_INT >= 28) { "Native ChaChaPoly unavailable" }
        require(key.size == 32 && nonce.size == 12 && ad.size <= 65535 && plaintext.size <= 65519)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "ChaCha20"), IvParameterSpec(nonce))
        if (ad.isNotEmpty()) cipher.updateAAD(ad)
        cipher.doFinal(plaintext)
      } finally {
        // These are native copies, not the caller's JS buffers. No key/plaintext cache.
        key.fill(0)
        plaintext.fill(0)
        ad.fill(0)
      }
    }
  }

  companion object {
    private const val TRANSFORMATION = "ChaCha20/Poly1305/NoPadding"
  }
}
