# Crypto package

This package is for all the utility functions, interfaces and implementations for cryptographic operations utilized in the project.

In theory, to understand what "features" algorithms are used, understanding this package should suffice.

This package is not intended to have much understanding of the matrix protocol or federation. It is a pure utility package.

For example, `signatures` to be a json field, is a matrix concept, and hence not part of this package.

`signJson` as an utility function takes a json object and returns an unpadded base64 signature. It does not know or care about where this signature is to be used.

# File/directory structure

- `contracts` contains the interfaces and types for this package.
- `der` utilities for encoding PEM keys.
- `rfc` utilities for actually converting to PEM from a binary key set.
- `utils` contains utility functions for signing, verifying, and loading keys.

# Interfaces

## Signer

A `Signer` is an abstraction of a cryptographic signing operation. It can both sign and verify signatures since if we have a private key to sign, we should also have the public key to verify. Although, practically speaking shouldn't need to.

Other details include

- `id` accessor that is just a combination of `algorithm` and `version`. Technically version and key id both are matrix concepts, but since not much overhead, and does leak into the purity of this package, it is part of the interface.
- `algorithm` accessor that returns the algorithm used for signing.
- Has accessors for `privateKey` and `publicKey` in both pem and non pem format.

## VerifierKey

A `VerifierKey` is an abstraction of a cryptographic verification key. It can only verify signatures and requires a public key.

Other details include the same ones as the `Signer` interface.

# Utilities

- `signJson` takes a json object and a `Signer` instance, and returns an unpadded base64 signature of the canonical json representation of the object. Canonical json representation makes sure that the same object always generates in the same signature.
- `verifyJsonSignature` takes a json object, a signature and a `VerifierKey` instance, and verifies the signature against the canonical json representation of the object. It throws if the signature is invalid.
- `loadEd25519SignerFromSeed` takes a base64 seed and returns a `Signer` instance for ed25519 algorithm.
- `loadEd25519VerifierFromPublicKey` takes a base64 public key and returns a `VerifierKey` instance for ed25519 algorithm.
- `toUnpaddedBase64` takes a `Uint8Array` and returns an unpadded base64 string.
- `fromBase64ToBytes` takes an unpadded base64 string and returns a `Uint8Array`.
- `encodeCanonicalJson` takes a json object and returns its canonical json representation.
- `computeHashBuffer` takes a JSON object, encodes as canonical json and returns a `Uint8Array` of its sha256 hash.
- `computeHashString` converts the output of `computeHashBuffer` to an unpadded base64 string.
