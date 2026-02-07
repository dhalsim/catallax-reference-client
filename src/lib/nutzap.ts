/**
 * NIP-61 Nutzap parsing and tag building.
 * NIP-60 Cashu wallet kinds: 17375 (wallet), 7375 (token), 7376 (redemption).
 * NIP-61 Nutzap kinds: 10019 (config), 9321 (nutzap event).
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { Proof } from '@cashu/cashu-ts';
import {
  parseProofTag,
  calculateProofsAmount,
  verifyP2PKLock,
} from './cashu';

/** NIP-61: Nutzap receive config (replaceable). */
export const NUTZAP_CONFIG_KIND = 10019;

/** NIP-61: Nutzap payment event (the payment is the receipt). */
export const NUTZAP_EVENT_KIND = 9321;

/** NIP-60: Cashu wallet event (replaceable). Encrypted privkey + mints. */
export const NUTZAP_WALLET_KIND = 17375;

/** NIP-60: Token event. Encrypted unspent proofs per mint. */
export const NUTZAP_TOKEN_KIND = 7375;

/** NIP-60 / NIP-61: Redemption / spending history (optional). */
export const NUTZAP_REDEMPTION_KIND = 7376;

export interface NutzapConfig {
  relays: string[];
  mints: MintConfig[];
  p2pkPubkey: string;
}

export interface MintConfig {
  url: string;
  units: string[];
}

export interface ParsedNutzap {
  id: string;
  pubkey: string;
  recipientPubkey: string;
  mintUrl: string;
  unit: string;
  proofs: Proof[];
  totalAmount: number;
  comment: string;
  eventId?: string;
  created_at: number;
}

/** Parse kind 10019 nutzap configuration. */
export function parseNutzapConfig(event: NostrEvent): NutzapConfig | null {
  if (event.kind !== NUTZAP_CONFIG_KIND) return null;

  const relays = event.tags
    .filter(([name]) => name === 'relay')
    .map(([, url]) => url);

  const mints = event.tags
    .filter(([name]) => name === 'mint')
    .map(([, url, ...units]) => ({
      url,
      units: units.length > 0 ? (units as string[]) : ['sat'],
    }));

  const p2pkPubkey = event.tags.find(([name]) => name === 'pubkey')?.[1];

  if (relays.length === 0 || mints.length === 0 || !p2pkPubkey) {
    return null;
  }

  return { relays, mints, p2pkPubkey };
}

/** Parse kind 9321 nutzap event. */
export function parseNutzap(event: NostrEvent): ParsedNutzap | null {
  if (event.kind !== NUTZAP_EVENT_KIND) return null;

  const proofTags = event.tags.filter(([name]) => name === 'proof');
  const proofs = proofTags
    .map(([, proofJson]) => parseProofTag(proofJson))
    .filter((p): p is Proof => p !== null);

  if (proofs.length === 0) return null;

  const mintUrl = event.tags.find(([name]) => name === 'u')?.[1];
  const unit = event.tags.find(([name]) => name === 'unit')?.[1] ?? 'sat';
  const recipientPubkey = event.tags.find(([name]) => name === 'p')?.[1];
  const eventId = event.tags.find(([name]) => name === 'e')?.[1];

  if (!mintUrl || !recipientPubkey) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    recipientPubkey,
    mintUrl,
    unit,
    proofs,
    totalAmount: calculateProofsAmount(proofs),
    comment: event.content,
    eventId,
    created_at: event.created_at,
  };
}

/** Verify a nutzap is valid for a recipient (mint trusted, unit supported, proofs locked to recipient). */
export function verifyNutzap(
  nutzap: ParsedNutzap,
  recipientConfig: NutzapConfig
): { valid: boolean; error?: string } {
  const trustedMint = recipientConfig.mints.find((m) => m.url === nutzap.mintUrl);
  if (!trustedMint) {
    return { valid: false, error: `Mint ${nutzap.mintUrl} not in trusted mints` };
  }

  if (!trustedMint.units.includes(nutzap.unit)) {
    return { valid: false, error: `Unit ${nutzap.unit} not supported by mint` };
  }

  for (const proof of nutzap.proofs) {
    if (!verifyP2PKLock(proof, recipientConfig.p2pkPubkey)) {
      return {
        valid: false,
        error: 'Proof not locked to recipient P2PK pubkey',
      };
    }
  }

  return { valid: true };
}

/** Build tags for a kind 9321 nutzap event. */
export function buildNutzapTags(
  recipientPubkey: string,
  mintUrl: string,
  proofs: Proof[],
  unit: string,
  eventId: string,
  eventKind: string
): string[][] {
  if (!eventId || !eventKind) {
    throw new Error('eventId and eventKind are required');
  }

  const tags: string[][] = [];

  for (const proof of proofs) {
    tags.push(['proof', JSON.stringify(proof)]);
  }

  tags.push(['unit', unit]);
  tags.push(['u', mintUrl]);
  tags.push(['p', recipientPubkey]);
  tags.push(['e', eventId, '']);
  tags.push(['k', eventKind]);

  return tags;
}
