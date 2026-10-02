# Crypto v1 Golden Vectors

These files define stable cryptographic outputs for protocol v1 implementations.

All binary fields use base64url without padding. Counter fields use decimal strings.

`noise-ik.json` fixes these inputs:

- The Noise protocol name.
- Both static X25519 key pairs.
- Both ephemeral X25519 private keys.
- The DSH Remote prologue fields and bytes.
- Both handshake payloads.
- Transport plaintext in both directions.

The file records both handshake messages. It also records transport ciphertext and counters.

All keys and identifiers are synthetic. Never use these keys outside tests.

An implementation can inject each ephemeral private key directly.
It can also adapt the key to its deterministic entropy interface.

The recorded outputs are the protocol v1 compatibility baseline.
Do not regenerate a vector after a dependency update without interoperability review.
An output change indicates a wire compatibility change or a cryptographic implementation change.
An intentional wire output change requires a new protocol version and new vectors.
