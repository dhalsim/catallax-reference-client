/**
 * Cashu / NIP-61 P2PK proof helpers.
 * Uses @cashu/cashu-ts Proof type for compatibility with mint operations.
 */
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
