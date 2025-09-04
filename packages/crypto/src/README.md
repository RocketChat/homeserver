# Crypto package

This package is for all the utility functions, interfaces and implementations for cryptographic operations utilized in the project.

In theory, to understand what "features" algorithms are used, understanding this package should suffice.

# File/directory structure

- `constants.ts`: Contains constants and types used across the crypto package.
- `signing-key.ts`: Defines the `SigningKey` interface and related types. [Read more here](#signingkey-interface).

# Interfaces

## SigningKey interface

An abstraction of cryptographic signing keys. It only defines two methods, `sign` and `verify`.

The most important distinction between different `SigningKey` implementations is the storage implementation. `/examples` contains one implementation that utilizes `ssh-keygen` to generate and manage the keys. Production uses `nacl` or libsodium for the actual signing and verification, but the keys are managed in memory with seeds read from different sources (depends on the consumer).
