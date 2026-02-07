# DLEQ Proof Verification (NUT-12)

## Overview

NIP-61 requires that nutzap proofs include DLEQ (Discrete Log Equality) proofs per NUT-12. Observer clients (including recipients) SHOULD locally verify DLEQ proofs before displaying or accepting nutzaps.

## Why

- **P2PK** (`verifyP2PKLock`) only checks that proofs are locked to the recipient's pubkey.
- **DLEQ** (`hasValidDleq`) proves the mint correctly signed the proofs—that the same private key was used for the mint's public key and the blind signature.
- Without DLEQ verification, a malicious mint could issue proofs that appear P2PK-locked but are spendable by anyone.

## Implementation

### Cashu-ts support

The `@cashu/cashu-ts` library provides:

- `hasValidDleq(proof: Proof, keyset: HasKeysetKeys): boolean` — verifies a proof's DLEQ using the mint's keyset
- `HasKeysetKeys` = `{ id: string; keys: { [amount: string]: string } }`
- Keyset is obtained by loading the mint (`Wallet.loadMint()`) and calling `getKeyset(proof.id)`

### Requirements

1. **Mint keys**: Fetch from the mint's `/v1/keys` or `/v1/keysets` endpoint (via `Wallet.loadMint()`).
2. **Keyset match**: Each proof has `id` (keyset id); the keyset must have a key for `proof.amount`.
3. **Proof structure**: Proofs must include `dleq: { e, s, r }` for user-to-user verification (Carol verifying Alice's proofs).

### When to verify

- **Displaying incoming nutzaps**: Verify DLEQ before showing as "verified" so users don't trust invalid proofs.
- **Redeeming**: Use `wallet.receive(token, { privkey, requireDleq: true })` so the Wallet rejects proofs without valid DLEQ.

### Edge cases

- **Proofs without DLEQ**: NUT-12 says wallets MUST verify when DLEQ is included. If no DLEQ, treat as unverified (don't display as verified).
- **Keyset not found**: If the mint doesn't return keys for the proof's keyset id, DLEQ verification is impossible—treat as unverified.
- **Network failure**: If fetching mint keys fails, skip DLEQ verification for that nutzap (fall back to P2PK-only).
