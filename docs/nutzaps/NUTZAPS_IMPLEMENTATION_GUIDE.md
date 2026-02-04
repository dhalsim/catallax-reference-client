# Nutzaps (NIP-61) Implementation Guide

Checkout [NIP-60](NIP-60.md) and [NIP-61](NIP-61.md) for the specification.

This document provides a detailed implementation roadmap for adding NIP-61 Nutzap support to Catallax as an alternative payment rail to Lightning zaps.

## Overview

**Nutzaps** are Cashu ecash payments where the payment event itself serves as the receipt. Unlike Lightning zaps (which require LNURL endpoints, invoices, and waiting for receipts), nutzaps are self-contained Nostr events containing P2PK-locked Cashu tokens.

### Key Advantages for Catallax

1. **No Lightning address required** - Recipients only need a kind:10019 event
2. **Payment IS the receipt** - The kind:9321 event proves payment instantly
3. **Offline verification** - Observers can verify payments without network calls
4. **Lower friction** - No invoice generation, no payment polling
5. **Potentially lower fees** - Cashu mints may have lower fees than Lightning

### Integration Points

Nutzaps can replace or supplement Lightning zaps for:
- **Escrow funding** (Patron → Arbiter)
- **Worker payment** (Arbiter → Worker)
- **Patron refunds** (Arbiter → Patron)
- **Goal contributions** (Contributors → Arbiter via goal)

---

## NIP-61 Event Kinds

### Kind 10019: Nutzap Configuration (Replaceable)

Published by users who want to receive nutzaps:

```json
{
  "kind": 10019,
  "tags": [
    ["relay", "wss://relay1.example"],
    ["relay", "wss://relay2.example"],
    ["mint", "https://mint1.example", "sat"],
    ["mint", "https://mint2.example", "usd", "sat"],
    ["pubkey", "<p2pk-pubkey-hex>"]
  ]
}
```

- `relay`: Where the user reads nutzap events
- `mint`: Trusted mints (with supported units)
- `pubkey`: P2PK pubkey for locking tokens (NOT the user's Nostr pubkey)

### Kind 9321: Nutzap Event (Regular)

The payment itself:

```json
{
  "kind": 9321,
  "content": "Thanks for the great work!",
  "pubkey": "<sender-pubkey>",
  "tags": [
    ["proof", "{\"amount\":1000,\"C\":\"...\",\"id\":\"...\",\"secret\":\"[\\\"P2PK\\\",...]\"}"],
    ["proof", "{\"amount\":500,\"C\":\"...\",\"id\":\"...\",\"secret\":\"[\\\"P2PK\\\",...]\"}"],
    ["unit", "sat"],
    ["u", "https://mint.example"],
    ["e", "<nutzapped-event-id>", "<relay-hint>"],
    ["p", "<recipient-pubkey>"]
  ]
}
```

- `proof`: One or more P2PK-locked Cashu proofs with DLEQ
- `unit`: Base unit (sat, usd, etc.)
- `u`: Mint URL (must match recipient's kind:10019)
- `p`: Recipient's Nostr pubkey

### Kind 7376: Redemption History (Regular)

Published when claiming nutzaps:

```json
{
  "kind": 7376,
  "content": "<nip44-encrypted: [[\"direction\",\"in\"],[\"amount\",\"1500\"],[\"unit\",\"sat\"]]>",
  "tags": [
    ["e", "<9321-event-id>", "<relay>", "redeemed"],
    ["p", "<sender-pubkey>"]
  ]
}
```

### Kind 17375: Wallet Event (Replaceable)

User's Cashu wallet configuration:

```json
{
  "kind": 17375,
  "content": "<nip44-encrypted: [[\"privkey\",\"<p2pk-privkey>\"],[\"mint\",\"https://mint1\"]]>"
}
```

### Kind 7375: Token Event (Regular)

Stores unspent proofs:

```json
{
  "kind": 7375,
  "content": "<nip44-encrypted: {\"mint\":\"...\",\"proofs\":[...],\"unit\":\"sat\"}>"
}
```

---

## Implementation Phases

### Phase 1: Cashu Library Integration

Before any UI work, integrate a Cashu library for token operations.

#### 1.1 Install Dependencies

```bash
npm install @cashu/cashu-ts
```

The `@cashu/cashu-ts` library provides:
- Mint communication
- Token minting/melting
- P2PK locking/unlocking
- DLEQ proof verification
- Proof management

#### 1.2 Create `src/lib/cashu.ts`

```typescript
import { CashuMint, CashuWallet, getEncodedToken, getDecodedToken, type Proof } from '@cashu/cashu-ts';

// P2PK secret format for Cashu
export interface P2PKSecret {
  nonce: string;
  data: string; // pubkey prefixed with "02"
}

export function createP2PKSecret(pubkey: string, nonce?: string): string {
  // Cashu requires pubkey prefixed with "02" for nostr compatibility
  const p2pkPubkey = pubkey.startsWith('02') ? pubkey : `02${pubkey}`;

  const secret: [string, P2PKSecret] = [
    'P2PK',
    {
      nonce: nonce || generateNonce(),
      data: p2pkPubkey,
    }
  ];

  return JSON.stringify(secret);
}

export function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify a proof is locked to the expected pubkey
export function verifyP2PKLock(proof: Proof, expectedPubkey: string): boolean {
  try {
    const secret = JSON.parse(proof.secret);
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

// Calculate total amount from proofs
export function calculateProofsAmount(proofs: Proof[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

// Parse proof from tag value
export function parseProofTag(proofJson: string): Proof | null {
  try {
    return JSON.parse(proofJson) as Proof;
  } catch {
    return null;
  }
}
```

#### 1.3 Create `src/lib/nutzap.ts`

```typescript
import type { NostrEvent } from '@nostrify/nostrify';
import { parseProofTag, calculateProofsAmount, verifyP2PKLock, type Proof } from './cashu';

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
  pubkey: string; // sender
  recipientPubkey: string;
  mintUrl: string;
  unit: string;
  proofs: Proof[];
  totalAmount: number;
  comment: string;
  eventId?: string; // event being nutzapped
  created_at: number;
}

// Parse kind:10019 nutzap configuration
export function parseNutzapConfig(event: NostrEvent): NutzapConfig | null {
  if (event.kind !== 10019) return null;

  const relays = event.tags
    .filter(([name]) => name === 'relay')
    .map(([, url]) => url);

  const mints = event.tags
    .filter(([name]) => name === 'mint')
    .map(([, url, ...units]) => ({
      url,
      units: units.length > 0 ? units : ['sat'],
    }));

  const p2pkPubkey = event.tags.find(([name]) => name === 'pubkey')?.[1];

  if (relays.length === 0 || mints.length === 0 || !p2pkPubkey) {
    return null;
  }

  return { relays, mints, p2pkPubkey };
}

// Parse kind:9321 nutzap event
export function parseNutzap(event: NostrEvent): ParsedNutzap | null {
  if (event.kind !== 9321) return null;

  const proofTags = event.tags.filter(([name]) => name === 'proof');
  const proofs = proofTags
    .map(([, proofJson]) => parseProofTag(proofJson))
    .filter((p): p is Proof => p !== null);

  if (proofs.length === 0) return null;

  const mintUrl = event.tags.find(([name]) => name === 'u')?.[1];
  const unit = event.tags.find(([name]) => name === 'unit')?.[1] || 'sat';
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

// Verify a nutzap is valid for a recipient
export function verifyNutzap(
  nutzap: ParsedNutzap,
  recipientConfig: NutzapConfig
): { valid: boolean; error?: string } {
  // Check mint is trusted
  const trustedMint = recipientConfig.mints.find(m => m.url === nutzap.mintUrl);
  if (!trustedMint) {
    return { valid: false, error: `Mint ${nutzap.mintUrl} not in trusted mints` };
  }

  // Check unit is supported
  if (!trustedMint.units.includes(nutzap.unit)) {
    return { valid: false, error: `Unit ${nutzap.unit} not supported by mint` };
  }

  // Verify all proofs are P2PK-locked to recipient's pubkey
  for (const proof of nutzap.proofs) {
    if (!verifyP2PKLock(proof, recipientConfig.p2pkPubkey)) {
      return { valid: false, error: 'Proof not locked to recipient P2PK pubkey' };
    }
  }

  // TODO: Verify DLEQ proofs (requires mint keyset)

  return { valid: true };
}

// Build nutzap event tags
export function buildNutzapTags(
  recipientPubkey: string,
  mintUrl: string,
  proofs: Proof[],
  unit: string = 'sat',
  eventId?: string,
  eventKind?: number
): string[][] {
  const tags: string[][] = [];

  // Add proof tags
  for (const proof of proofs) {
    tags.push(['proof', JSON.stringify(proof)]);
  }

  tags.push(['unit', unit]);
  tags.push(['u', mintUrl]);
  tags.push(['p', recipientPubkey]);

  if (eventId) {
    tags.push(['e', eventId, '']);
    if (eventKind !== undefined) {
      tags.push(['k', eventKind.toString()]);
    }
  }

  return tags;
}
```

---

### Phase 2: Wallet Management

#### 2.1 Create `src/hooks/useNutzapWallet.ts`

```typescript
import { useState, useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CashuMint, CashuWallet, type Proof } from '@cashu/cashu-ts';

interface WalletState {
  p2pkPrivkey: string | null;
  p2pkPubkey: string | null;
  mints: string[];
  balances: Map<string, number>; // mint -> balance
  proofs: Map<string, Proof[]>; // mint -> proofs
}

export function useNutzapWallet() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  // Fetch wallet event (kind:17375)
  const walletQuery = useQuery({
    queryKey: ['nutzap-wallet', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.signer?.nip44) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query([{
        kinds: [17375],
        authors: [user.pubkey],
        limit: 1,
      }], { signal });

      if (events.length === 0) return null;

      // Decrypt wallet content
      const decrypted = await user.signer.nip44.decrypt(user.pubkey, events[0].content);
      const tags = JSON.parse(decrypted) as string[][];

      const privkey = tags.find(([name]) => name === 'privkey')?.[1];
      const mints = tags.filter(([name]) => name === 'mint').map(([, url]) => url);

      return { privkey, mints, event: events[0] };
    },
    enabled: !!user?.signer?.nip44,
  });

  // Fetch token events (kind:7375)
  const tokensQuery = useQuery({
    queryKey: ['nutzap-tokens', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.signer?.nip44) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query([{
        kinds: [7375],
        authors: [user.pubkey],
        limit: 100,
      }], { signal });

      const tokens: { mint: string; proofs: Proof[]; unit: string; eventId: string }[] = [];

      for (const event of events) {
        try {
          const decrypted = await user.signer.nip44.decrypt(user.pubkey, event.content);
          const data = JSON.parse(decrypted);
          tokens.push({
            mint: data.mint,
            proofs: data.proofs,
            unit: data.unit || 'sat',
            eventId: event.id,
          });
        } catch {
          // Skip malformed tokens
        }
      }

      return tokens;
    },
    enabled: !!user?.signer?.nip44,
  });

  // Calculate balances by mint
  const balances = new Map<string, number>();
  if (tokensQuery.data) {
    for (const token of tokensQuery.data) {
      const current = balances.get(token.mint) || 0;
      const tokenAmount = token.proofs.reduce((sum, p) => sum + p.amount, 0);
      balances.set(token.mint, current + tokenAmount);
    }
  }

  // Get P2PK pubkey from privkey
  const p2pkPubkey = walletQuery.data?.privkey
    ? deriveP2PKPubkey(walletQuery.data.privkey)
    : null;

  return {
    isLoading: walletQuery.isLoading || tokensQuery.isLoading,
    hasWallet: !!walletQuery.data,
    p2pkPubkey,
    mints: walletQuery.data?.mints || [],
    balances,
    tokens: tokensQuery.data || [],
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ['nutzap-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['nutzap-tokens'] });
    },
  };
}

// Derive P2PK pubkey from privkey (secp256k1)
function deriveP2PKPubkey(privkeyHex: string): string {
  // This requires a secp256k1 library
  // For now, placeholder - will need @noble/secp256k1 or similar
  // import { getPublicKey } from '@noble/secp256k1';
  // return getPublicKey(privkeyHex, true).slice(2); // remove '02' prefix for storage
  throw new Error('Implement with @noble/secp256k1');
}
```

#### 2.2 Create `src/hooks/useNutzapConfig.ts`

```typescript
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { parseNutzapConfig, type NutzapConfig } from '@/lib/nutzap';

// Fetch a user's nutzap configuration
export function useNutzapConfig(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['nutzap-config', pubkey],
    queryFn: async (c) => {
      if (!pubkey) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query([{
        kinds: [10019],
        authors: [pubkey],
        limit: 1,
      }], { signal });

      if (events.length === 0) return null;

      return parseNutzapConfig(events[0]);
    },
    enabled: !!pubkey,
    staleTime: 60000, // 1 minute
  });
}

// Check if a user can receive nutzaps
export function useCanReceiveNutzaps(pubkey: string | undefined) {
  const { data: config, isLoading } = useNutzapConfig(pubkey);

  return {
    canReceive: !!config,
    config,
    isLoading,
  };
}
```

---

### Phase 3: Sending Nutzaps

#### 3.1 Create `src/hooks/useNutzap.ts`

```typescript
import { useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNutzapConfig } from './useNutzapConfig';
import { useNutzapWallet } from './useNutzapWallet';
import { useToast } from '@/hooks/useToast';
import { CashuMint, CashuWallet, type Proof } from '@cashu/cashu-ts';
import { buildNutzapTags, createP2PKSecret } from '@/lib/nutzap';

interface NutzapRequest {
  recipientPubkey: string;
  amount: number; // in sats
  comment?: string;
  eventId?: string; // event being nutzapped
  eventKind?: number;
}

interface NutzapResult {
  nutzapEventId: string;
  amount: number;
  mintUrl: string;
}

export function useNutzap() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const { tokens, mints, refetch: refetchWallet } = useNutzapWallet();
  const [isSending, setIsSending] = useState(false);

  const sendNutzap = async (request: NutzapRequest): Promise<NutzapResult> => {
    if (!user?.signer) {
      throw new Error('No signer available');
    }

    setIsSending(true);

    try {
      // 1. Fetch recipient's nutzap config
      toast({ title: 'Preparing nutzap...', description: 'Fetching recipient configuration' });

      const configEvents = await nostr.query([{
        kinds: [10019],
        authors: [request.recipientPubkey],
        limit: 1,
      }], { signal: AbortSignal.timeout(5000) });

      if (configEvents.length === 0) {
        throw new Error('Recipient has not configured nutzaps (no kind:10019 event)');
      }

      const config = parseNutzapConfig(configEvents[0]);
      if (!config) {
        throw new Error('Invalid nutzap configuration');
      }

      // 2. Find a common mint between sender and recipient
      const commonMint = config.mints.find(m =>
        mints.includes(m.url) && m.units.includes('sat')
      );

      if (!commonMint) {
        throw new Error(`No common mint found. Recipient accepts: ${config.mints.map(m => m.url).join(', ')}`);
      }

      toast({ title: 'Minting tokens...', description: `Using mint: ${commonMint.url}` });

      // 3. Get or create tokens at the mint
      const mint = new CashuMint(commonMint.url);
      const wallet = new CashuWallet(mint);

      // Check if we have enough balance at this mint
      const mintTokens = tokens.filter(t => t.mint === commonMint.url);
      const currentBalance = mintTokens.reduce(
        (sum, t) => sum + t.proofs.reduce((s, p) => s + p.amount, 0),
        0
      );

      let proofsToSend: Proof[];

      if (currentBalance >= request.amount) {
        // We have enough - select and swap proofs
        const allProofs = mintTokens.flatMap(t => t.proofs);
        const { send, keep } = await wallet.send(request.amount, allProofs, {
          pubkey: config.p2pkPubkey,
          includeDleq: true,
        });
        proofsToSend = send;

        // TODO: Update token events with remaining proofs (keep)
      } else {
        // Need to mint new tokens - this requires Lightning payment to mint
        // For now, throw an error
        throw new Error(
          `Insufficient balance at ${commonMint.url}. ` +
          `Have: ${currentBalance} sats, Need: ${request.amount} sats. ` +
          `Please add funds to your Cashu wallet first.`
        );
      }

      // 4. Create P2PK-locked proofs for recipient
      // The wallet.send() with pubkey option already handles this

      // 5. Publish nutzap event
      toast({ title: 'Publishing nutzap...', description: 'Sending payment to recipient' });

      const tags = buildNutzapTags(
        request.recipientPubkey,
        commonMint.url,
        proofsToSend,
        'sat',
        request.eventId,
        request.eventKind
      );

      const nutzapEvent = await createEvent({
        kind: 9321,
        content: request.comment || '',
        tags,
      });

      toast({
        title: 'Nutzap sent!',
        description: `Sent ${request.amount} sats via Cashu`,
      });

      // Refresh wallet state
      refetchWallet();

      return {
        nutzapEventId: nutzapEvent.id,
        amount: request.amount,
        mintUrl: commonMint.url,
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send nutzap';
      toast({
        title: 'Nutzap failed',
        description: message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  return {
    sendNutzap,
    isSending,
  };
}
```

---

### Phase 4: Receiving Nutzaps

#### 4.1 Create `src/hooks/useIncomingNutzaps.ts`

```typescript
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNutzapConfig } from './useNutzapConfig';
import { useQuery } from '@tanstack/react-query';
import { parseNutzap, verifyNutzap, type ParsedNutzap } from '@/lib/nutzap';

export function useIncomingNutzaps() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: myConfig } = useNutzapConfig(user?.pubkey);

  // Fetch the latest redemption timestamp to use as 'since'
  const lastRedemptionQuery = useQuery({
    queryKey: ['last-nutzap-redemption', user?.pubkey],
    queryFn: async (c) => {
      if (!user) return 0;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      const events = await nostr.query([{
        kinds: [7376],
        authors: [user.pubkey],
        limit: 1,
      }], { signal });

      return events[0]?.created_at || 0;
    },
    enabled: !!user,
  });

  // Fetch incoming nutzaps
  const nutzapsQuery = useQuery({
    queryKey: ['incoming-nutzaps', user?.pubkey, myConfig?.mints, lastRedemptionQuery.data],
    queryFn: async (c) => {
      if (!user || !myConfig) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      // Query for nutzaps from trusted mints only
      const mintUrls = myConfig.mints.map(m => m.url);

      const events = await nostr.query([{
        kinds: [9321],
        '#p': [user.pubkey],
        '#u': mintUrls,
        since: lastRedemptionQuery.data || 0,
        limit: 50,
      }], { signal });

      const nutzaps: (ParsedNutzap & { verified: boolean; error?: string })[] = [];

      for (const event of events) {
        const parsed = parseNutzap(event);
        if (!parsed) continue;

        const verification = verifyNutzap(parsed, myConfig);
        nutzaps.push({
          ...parsed,
          verified: verification.valid,
          error: verification.error,
        });
      }

      return nutzaps;
    },
    enabled: !!user && !!myConfig && lastRedemptionQuery.data !== undefined,
    refetchInterval: 30000, // Poll every 30 seconds
  });

  // Count unredeemed nutzaps
  const unredeemedCount = nutzapsQuery.data?.filter(n => n.verified).length || 0;
  const totalAmount = nutzapsQuery.data
    ?.filter(n => n.verified)
    .reduce((sum, n) => sum + n.totalAmount, 0) || 0;

  return {
    nutzaps: nutzapsQuery.data || [],
    unredeemedCount,
    totalAmount,
    isLoading: nutzapsQuery.isLoading,
    refetch: nutzapsQuery.refetch,
  };
}
```

#### 4.2 Create `src/hooks/useRedeemNutzap.ts`

```typescript
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNutzapWallet } from './useNutzapWallet';
import { useToast } from '@/hooks/useToast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CashuMint, CashuWallet } from '@cashu/cashu-ts';
import type { ParsedNutzap } from '@/lib/nutzap';

export function useRedeemNutzap() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (nutzap: ParsedNutzap) => {
      if (!user?.signer?.nip44) {
        throw new Error('No signer available');
      }

      toast({ title: 'Redeeming nutzap...', description: 'Swapping tokens to your wallet' });

      // 1. Connect to the mint
      const mint = new CashuMint(nutzap.mintUrl);
      const wallet = new CashuWallet(mint);

      // 2. Get our P2PK privkey from wallet
      const walletEvents = await nostr.query([{
        kinds: [17375],
        authors: [user.pubkey],
        limit: 1,
      }], { signal: AbortSignal.timeout(5000) });

      if (walletEvents.length === 0) {
        throw new Error('No wallet configured. Please set up your Cashu wallet first.');
      }

      const walletContent = await user.signer.nip44.decrypt(user.pubkey, walletEvents[0].content);
      const walletTags = JSON.parse(walletContent) as string[][];
      const privkey = walletTags.find(([name]) => name === 'privkey')?.[1];

      if (!privkey) {
        throw new Error('No P2PK private key in wallet');
      }

      // 3. Swap P2PK-locked proofs to regular proofs we control
      const newProofs = await wallet.receive(nutzap.proofs, {
        privkey,
      });

      // 4. Store new proofs as token event (kind:7375)
      const tokenContent = JSON.stringify({
        mint: nutzap.mintUrl,
        proofs: newProofs,
        unit: nutzap.unit,
      });

      const encryptedTokenContent = await user.signer.nip44.encrypt(user.pubkey, tokenContent);

      await createEvent({
        kind: 7375,
        content: encryptedTokenContent,
        tags: [],
      });

      // 5. Publish redemption history (kind:7376)
      const historyContent = JSON.stringify([
        ['direction', 'in'],
        ['amount', nutzap.totalAmount.toString()],
        ['unit', nutzap.unit],
      ]);

      const encryptedHistoryContent = await user.signer.nip44.encrypt(user.pubkey, historyContent);

      await createEvent({
        kind: 7376,
        content: encryptedHistoryContent,
        tags: [
          ['e', nutzap.id, '', 'redeemed'],
          ['p', nutzap.pubkey], // sender pubkey
        ],
      });

      toast({
        title: 'Nutzap redeemed!',
        description: `Added ${nutzap.totalAmount} sats to your wallet`,
      });

      return { amount: nutzap.totalAmount, newProofs };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutzap-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['incoming-nutzaps'] });
      queryClient.invalidateQueries({ queryKey: ['last-nutzap-redemption'] });
    },
    onError: (error) => {
      toast({
        title: 'Failed to redeem nutzap',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}
```

---

### Phase 5: UI Components

#### 5.1 Create `src/components/NutzapConfigForm.tsx`

For users to set up their nutzap receiving configuration:

```typescript
import { useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

const DEFAULT_MINTS = [
  'https://mint.minibits.cash/Bitcoin',
  'https://mint.coinos.io',
  'https://stablenut.umint.cash',
];

export function NutzapConfigForm() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent, isPending } = useNostrPublish();
  const { p2pkPubkey, hasWallet } = useNutzapWallet();
  const { toast } = useToast();

  const [relays, setRelays] = useState<string[]>(['wss://relay.nostr.band']);
  const [mints, setMints] = useState<string[]>([DEFAULT_MINTS[0]]);
  const [newRelay, setNewRelay] = useState('');
  const [newMint, setNewMint] = useState('');

  const handleAddRelay = () => {
    if (newRelay && !relays.includes(newRelay)) {
      setRelays([...relays, newRelay]);
      setNewRelay('');
    }
  };

  const handleAddMint = () => {
    if (newMint && !mints.includes(newMint)) {
      setMints([...mints, newMint]);
      setNewMint('');
    }
  };

  const handleSubmit = async () => {
    if (!user || !p2pkPubkey) return;

    if (relays.length === 0) {
      toast({ title: 'Error', description: 'Add at least one relay', variant: 'destructive' });
      return;
    }

    if (mints.length === 0) {
      toast({ title: 'Error', description: 'Add at least one mint', variant: 'destructive' });
      return;
    }

    const tags: string[][] = [];

    for (const relay of relays) {
      tags.push(['relay', relay]);
    }

    for (const mint of mints) {
      tags.push(['mint', mint, 'sat']);
    }

    tags.push(['pubkey', p2pkPubkey]);

    try {
      await createEvent({
        kind: 10019,
        content: '',
        tags,
      });

      toast({ title: 'Success', description: 'Nutzap configuration published' });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to publish',
        variant: 'destructive',
      });
    }
  };

  if (!hasWallet) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Set Up Nutzaps</CardTitle>
          <CardDescription>You need to create a Cashu wallet first</CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled>
            <Wallet className="h-4 w-4 mr-2" />
            Create Wallet First
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nutzap Configuration</CardTitle>
        <CardDescription>
          Configure how you receive Cashu payments via Nostr
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* P2PK Pubkey Display */}
        <div>
          <Label>Your P2PK Public Key</Label>
          <code className="block mt-1 p-2 bg-muted rounded text-xs break-all">
            {p2pkPubkey}
          </code>
          <p className="text-xs text-muted-foreground mt-1">
            Tokens will be locked to this key. Only you can redeem them.
          </p>
        </div>

        {/* Relays */}
        <div className="space-y-2">
          <Label>Relays (where you'll receive nutzaps)</Label>
          <div className="flex flex-wrap gap-2">
            {relays.map((relay) => (
              <Badge key={relay} variant="secondary" className="flex items-center gap-1">
                {relay}
                <button onClick={() => setRelays(relays.filter(r => r !== relay))}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newRelay}
              onChange={(e) => setNewRelay(e.target.value)}
              placeholder="wss://relay.example"
            />
            <Button onClick={handleAddRelay} size="icon" variant="outline">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Mints */}
        <div className="space-y-2">
          <Label>Trusted Mints</Label>
          <div className="flex flex-wrap gap-2">
            {mints.map((mint) => (
              <Badge key={mint} variant="secondary" className="flex items-center gap-1">
                {mint}
                <button onClick={() => setMints(mints.filter(m => m !== mint))}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newMint}
              onChange={(e) => setNewMint(e.target.value)}
              placeholder="https://mint.example"
            />
            <Button onClick={handleAddMint} size="icon" variant="outline">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {DEFAULT_MINTS.filter(m => !mints.includes(m)).map((mint) => (
              <Button
                key={mint}
                variant="ghost"
                size="sm"
                onClick={() => setMints([...mints, mint])}
              >
                + {new URL(mint).hostname}
              </Button>
            ))}
          </div>
        </div>

        <Button onClick={handleSubmit} disabled={isPending} className="w-full">
          {isPending ? 'Publishing...' : 'Publish Configuration'}
        </Button>
      </CardContent>
    </Card>
  );
}
```

#### 5.2 Create `src/components/NutzapDialog.tsx`

Dialog for sending nutzaps:

```typescript
import { useState } from 'react';
import { useNutzap } from '@/hooks/useNutzap';
import { useCanReceiveNutzaps } from '@/hooks/useNutzapConfig';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useAuthor } from '@/hooks/useAuthor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Wallet, AlertTriangle } from 'lucide-react';
import { formatSats } from '@/lib/catallax';

interface NutzapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientPubkey: string;
  amount?: number;
  purpose?: string;
  eventId?: string;
  onComplete: (nutzapEventId: string) => void;
}

export function NutzapDialog({
  open,
  onOpenChange,
  recipientPubkey,
  amount: defaultAmount,
  purpose,
  eventId,
  onComplete,
}: NutzapDialogProps) {
  const { sendNutzap, isSending } = useNutzap();
  const { canReceive, config, isLoading: configLoading } = useCanReceiveNutzaps(recipientPubkey);
  const { balances, hasWallet } = useNutzapWallet();
  const author = useAuthor(recipientPubkey);

  const [amount, setAmount] = useState(defaultAmount?.toString() || '');
  const [comment, setComment] = useState('');

  const metadata = author.data?.metadata;
  const displayName = metadata?.name || recipientPubkey.slice(0, 8) + '...';

  // Find common mint balance
  const availableBalance = config?.mints.reduce((max, mint) => {
    const balance = balances.get(mint.url) || 0;
    return Math.max(max, balance);
  }, 0) || 0;

  const handleSend = async () => {
    const amountNum = parseInt(amount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    try {
      const result = await sendNutzap({
        recipientPubkey,
        amount: amountNum,
        comment: comment || undefined,
        eventId,
      });

      onComplete(result.nutzapEventId);
      onOpenChange(false);
    } catch {
      // Error handled in hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Send Nutzap
          </DialogTitle>
          <DialogDescription>
            Send Cashu ecash via Nostr
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipient */}
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <Avatar>
              <AvatarImage src={metadata?.picture} />
              <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{displayName}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {recipientPubkey.slice(0, 16)}...
              </p>
            </div>
          </div>

          {/* Warnings */}
          {!hasWallet && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                You need to set up a Cashu wallet before sending nutzaps.
              </AlertDescription>
            </Alert>
          )}

          {configLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking recipient configuration...
            </div>
          )}

          {!configLoading && !canReceive && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This user has not configured nutzap receiving (no kind:10019 event).
                They cannot receive Cashu payments via Nostr.
              </AlertDescription>
            </Alert>
          )}

          {canReceive && availableBalance === 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                You don't have any Cashu tokens at mints this user trusts.
                Add funds to your wallet at one of: {config?.mints.map(m => m.url).join(', ')}
              </AlertDescription>
            </Alert>
          )}

          {/* Purpose */}
          {purpose && (
            <div className="text-sm text-muted-foreground">
              <strong>Purpose:</strong> {purpose}
            </div>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (sats)</Label>
            <Input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              disabled={!canReceive || !hasWallet}
            />
            {availableBalance > 0 && (
              <p className="text-xs text-muted-foreground">
                Available balance: {formatSats(availableBalance)}
              </p>
            )}
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <Label htmlFor="comment">Comment (optional)</Label>
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Thanks for the great work!"
              rows={2}
              disabled={!canReceive || !hasWallet}
            />
          </div>

          {/* Send Button */}
          <Button
            onClick={handleSend}
            disabled={
              isSending ||
              !canReceive ||
              !hasWallet ||
              !amount ||
              parseInt(amount) <= 0 ||
              parseInt(amount) > availableBalance
            }
            className="w-full"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4 mr-2" />
                Send {amount ? formatSats(parseInt(amount)) : 'Nutzap'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### 5.3 Create `src/components/PaymentMethodSelector.tsx`

Let users choose between Lightning and Nutzap:

```typescript
import { useState } from 'react';
import { useCanReceiveNutzaps } from '@/hooks/useNutzapConfig';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap, Wallet } from 'lucide-react';
import { LightningPaymentDialog } from './catallax/LightningPaymentDialog';
import { NutzapDialog } from './NutzapDialog';

interface PaymentMethodSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientPubkey: string;
  amount: number;
  purpose: string;
  onPaymentComplete: (receiptId: string) => void;
}

export function PaymentMethodSelector({
  open,
  onOpenChange,
  recipientPubkey,
  amount,
  purpose,
  onPaymentComplete,
}: PaymentMethodSelectorProps) {
  const [method, setMethod] = useState<'lightning' | 'nutzap'>('lightning');
  const { canReceive: canReceiveNutzap } = useCanReceiveNutzaps(recipientPubkey);

  if (method === 'lightning') {
    return (
      <LightningPaymentDialog
        open={open}
        onOpenChange={onOpenChange}
        recipientPubkey={recipientPubkey}
        amount={amount}
        purpose={purpose}
        onPaymentComplete={onPaymentComplete}
        // Add a way to switch to nutzap
        extraContent={canReceiveNutzap && (
          <button
            onClick={() => setMethod('nutzap')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            <Wallet className="h-4 w-4 inline mr-1" />
            Pay with Cashu instead
          </button>
        )}
      />
    );
  }

  return (
    <NutzapDialog
      open={open}
      onOpenChange={onOpenChange}
      recipientPubkey={recipientPubkey}
      amount={amount}
      purpose={purpose}
      onComplete={onPaymentComplete}
    />
  );
}
```

---

### Phase 6: Integration with Catallax

#### 6.1 Update TaskManagement.tsx

Add nutzap as a payment option:

```typescript
// In TaskManagement.tsx, add nutzap dialog state
const [showNutzapFundDialog, setShowNutzapFundDialog] = useState(false);
const [paymentMethod, setPaymentMethod] = useState<'lightning' | 'nutzap'>('lightning');

// Add nutzap config check for arbiter
const { canReceive: arbiterAcceptsNutzaps } = useCanReceiveNutzaps(task.arbiterPubkey);

// In the fund escrow section, offer choice:
{task.status === 'proposed' && task.arbiterPubkey && (
  <div className="space-y-3">
    <Alert>
      <Zap className="h-4 w-4" />
      <AlertDescription>
        <strong>Fund Escrow:</strong> Choose your payment method.
      </AlertDescription>
    </Alert>

    <div className="grid grid-cols-2 gap-2">
      <Button
        onClick={() => setShowFundDialog(true)}
        disabled={isPending}
      >
        <Zap className="h-4 w-4 mr-2" />
        Lightning
      </Button>

      {arbiterAcceptsNutzaps && (
        <Button
          onClick={() => setShowNutzapFundDialog(true)}
          disabled={isPending}
          variant="outline"
        >
          <Wallet className="h-4 w-4 mr-2" />
          Nutzap
        </Button>
      )}
    </div>
  </div>
)}

// Add nutzap dialog
{task.arbiterPubkey && (
  <NutzapDialog
    open={showNutzapFundDialog}
    onOpenChange={setShowNutzapFundDialog}
    recipientPubkey={task.arbiterPubkey}
    amount={parseInt(task.amount)}
    purpose={`Escrow funding for task: ${task.content.title}`}
    onComplete={(nutzapEventId) => {
      handleFundEscrow(nutzapEventId);
      setShowNutzapFundDialog(false);
    }}
  />
)}
```

#### 6.2 Update Task Protocol

The task's `e` tag with `zap` marker can reference either:
- A Lightning zap receipt (kind:9735)
- A nutzap event (kind:9321)

Add a marker to distinguish:

```typescript
// In updateTaskStatus function, add payment type:
if (task.zapReceiptId || zapReceiptId) {
  // Determine if it's a nutzap or lightning zap
  const marker = zapReceiptId?.startsWith('nutzap_') ? 'nutzap' : 'zap';
  tags.push(['e', task.zapReceiptId || zapReceiptId || '', '', marker]);
}
```

Or simpler: just use the event kind to distinguish (9735 vs 9321).

---

## Phase 7: Wallet Setup Flow

Users need to create a wallet before sending/receiving nutzaps.

#### 7.1 Create `src/hooks/useCreateNutzapWallet.ts`

```typescript
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { getPublicKey, utils } from '@noble/secp256k1';

export function useCreateNutzapWallet() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mints: string[]) => {
      if (!user?.signer?.nip44) {
        throw new Error('Signer with NIP-44 support required');
      }

      // Generate new P2PK keypair
      const privkeyBytes = utils.randomPrivateKey();
      const privkeyHex = Array.from(privkeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Derive pubkey
      const pubkeyBytes = getPublicKey(privkeyBytes, true); // compressed
      const pubkeyHex = Array.from(pubkeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Build wallet content
      const walletTags: string[][] = [
        ['privkey', privkeyHex],
        ...mints.map(m => ['mint', m]),
      ];

      // Encrypt wallet content
      const encryptedContent = await user.signer.nip44.encrypt(
        user.pubkey,
        JSON.stringify(walletTags)
      );

      // Publish wallet event
      await createEvent({
        kind: 17375,
        content: encryptedContent,
        tags: [],
      });

      toast({
        title: 'Wallet created!',
        description: 'Your Cashu wallet has been set up',
      });

      return { privkeyHex, pubkeyHex };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutzap-wallet'] });
    },
  });
}
```

---

## Testing Checklist

### Wallet Setup
- [ ] Can create new wallet (kind:17375)
- [ ] P2PK keypair generated correctly
- [ ] Wallet content encrypted with NIP-44

### Configuration
- [ ] Can publish nutzap config (kind:10019)
- [ ] Config includes relays, mints, P2PK pubkey
- [ ] Can fetch other users' configs

### Sending Nutzaps
- [ ] Can detect recipient's nutzap config
- [ ] Can find common mint
- [ ] Can create P2PK-locked proofs
- [ ] Can publish nutzap event (kind:9321)
- [ ] Proofs include DLEQ

### Receiving Nutzaps
- [ ] Can query for incoming nutzaps
- [ ] Can verify nutzap validity
- [ ] Can redeem proofs with P2PK privkey
- [ ] Can store new tokens (kind:7375)
- [ ] Can publish redemption history (kind:7376)

### Catallax Integration
- [ ] Nutzap works for escrow funding
- [ ] Nutzap works for worker payment
- [ ] Nutzap works for patron refund
- [ ] Task correctly references nutzap event
- [ ] Conclusion event handles nutzap receipt

### Edge Cases
- [ ] Handle no common mint
- [ ] Handle insufficient balance
- [ ] Handle invalid proofs
- [ ] Handle mint offline
- [ ] Handle already-redeemed proofs

---

## File Summary

### New Files to Create

**Library:**
- `src/lib/cashu.ts` - Cashu utilities
- `src/lib/nutzap.ts` - Nutzap parsing/building

**Hooks:**
- `src/hooks/useNutzapWallet.ts` - Wallet state management
- `src/hooks/useNutzapConfig.ts` - Fetch user configs
- `src/hooks/useNutzap.ts` - Send nutzaps
- `src/hooks/useIncomingNutzaps.ts` - Receive nutzaps
- `src/hooks/useRedeemNutzap.ts` - Redeem nutzaps
- `src/hooks/useCreateNutzapWallet.ts` - Create wallet

**Components:**
- `src/components/NutzapConfigForm.tsx` - Setup receiving
- `src/components/NutzapDialog.tsx` - Send dialog
- `src/components/NutzapWalletSetup.tsx` - Create wallet
- `src/components/IncomingNutzaps.tsx` - List/redeem
- `src/components/PaymentMethodSelector.tsx` - Choose method

### Files to Modify

- `src/components/catallax/TaskManagement.tsx` - Add nutzap option
- `src/lib/catallax.ts` - Add nutzap receipt handling
- `NIP.md` - Document nutzap integration

### Dependencies to Add

```bash
npm install @cashu/cashu-ts @noble/secp256k1
```