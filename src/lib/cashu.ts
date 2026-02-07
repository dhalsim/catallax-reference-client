/**
 * Cashu / NIP-61 P2PK proof helpers.
 * Uses @cashu/cashu-ts Proof type for compatibility with mint operations.
 */
import { Wallet, hasValidDleq } from '@cashu/cashu-ts';
import type { Proof } from '@cashu/cashu-ts';

/** P2PK secret format: ["P2PK", { nonce, data: pubkeyHex }] */
export interface P2PKSecret {
  nonce: string;
  data: string; // pubkey prefixed with "02" (compressed)
}

export function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify a proof is P2PK-locked to the expected pubkey (hex, with or without 02 prefix). */
export function verifyP2PKLock(proof: Proof, expectedPubkey: string): boolean {
  try {
    const secret = JSON.parse(proof.secret) as unknown;
    if (!Array.isArray(secret) || secret[0] !== 'P2PK') {
      return false;
    }
    const p2pkData = secret[1] as P2PKSecret;
    const expectedWithPrefix = expectedPubkey.startsWith('02')
      ? expectedPubkey
      : `02${expectedPubkey}`;
    return p2pkData.data === expectedWithPrefix;
  } catch {
    return false;
  }
}

export function calculateProofsAmount(proofs: Proof[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

/** Parse a proof from a NIP-61 "proof" tag value (JSON string). */
export function parseProofTag(proofJson: string): Proof | null {
  try {
    return JSON.parse(proofJson) as Proof;
  } catch {
    return null;
  }
}

/**
 * Verify DLEQ proofs (NUT-12) for proofs from a given mint.
 * Fetches mint keys and validates each proof's DLEQ.
 * Returns true only if all proofs have valid DLEQ; false if any lacks DLEQ, verification fails, or keys cannot be fetched.
 */
export async function verifyProofsDleq(
  proofs: Proof[],
  mintUrl: string,
  unit = 'sat'
): Promise<boolean> {
  if (proofs.length === 0) return true;

  try {
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();

    for (const proof of proofs) {
      if (!proof.dleq) return false;

      try {
        const keyset = wallet.getKeyset(proof.id);
        if (!hasValidDleq(proof, keyset)) return false;
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
