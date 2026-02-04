import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPublicKey } from '@noble/secp256k1';
import type { Proof } from '@cashu/cashu-ts';
import {
  NUTZAP_WALLET_KIND,
  NUTZAP_TOKEN_KIND,
} from '@/lib/nutzap';

interface WalletData {
  privkeyHex: string;
  pubkeyHex: string;
  mints: string[];
}

interface TokenData {
  mint: string;
  proofs: Proof[];
  unit: string;
  eventId: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function deriveP2PKPubkey(privkeyHex: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(privkeyHex.slice(i * 2, i * 2 + 2), 16);
  }
  const pubkeyBytes = getPublicKey(bytes, true);
  return bytesToHex(pubkeyBytes);
}

/** Wallet state: P2PK keypair, mints, and balances from kind 17375 + 7375. */
export function useNutzapWallet() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const walletQuery = useQuery({
    queryKey: ['nutzap-wallet', user?.pubkey],
    queryFn: async (c): Promise<WalletData | null> => {
      if (!user?.signer?.nip44) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query(
        [
          {
            kinds: [NUTZAP_WALLET_KIND],
            authors: [user.pubkey],
            limit: 1,
          },
        ],
        { signal }
      );

      if (events.length === 0) return null;

      const decrypted = await user.signer.nip44.decrypt(
        user.pubkey,
        events[0].content
      );
      const tags = JSON.parse(decrypted) as string[][];

      const privkey = tags.find(([name]) => name === 'privkey')?.[1];
      const mints = tags.filter(([name]) => name === 'mint').map(([, url]) => url);

      if (!privkey) return null;

      const pubkeyHex = deriveP2PKPubkey(privkey);
      return { privkeyHex: privkey, pubkeyHex, mints };
    },
    enabled: !!user?.signer?.nip44,
  });

  const tokensQuery = useQuery({
    queryKey: ['nutzap-tokens', user?.pubkey],
    queryFn: async (c): Promise<TokenData[]> => {
      if (!user?.signer?.nip44) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query(
        [
          {
            kinds: [NUTZAP_TOKEN_KIND],
            authors: [user.pubkey],
            limit: 100,
          },
        ],
        { signal }
      );

      const tokens: TokenData[] = [];

      for (const event of events) {
        try {
          const decrypted = await user.signer.nip44.decrypt(
            user.pubkey,
            event.content
          );
          const data = JSON.parse(decrypted) as {
            mint: string;
            proofs: Proof[];
            unit?: string;
          };
          tokens.push({
            mint: data.mint,
            proofs: data.proofs,
            unit: data.unit ?? 'sat',
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

  const balances = new Map<string, number>();
  if (tokensQuery.data) {
    for (const token of tokensQuery.data) {
      const current = balances.get(token.mint) ?? 0;
      const sum = token.proofs.reduce((s, p) => s + p.amount, 0);
      balances.set(token.mint, current + sum);
    }
  }

  const wallet = walletQuery.data;

  console.log('wallet', wallet);
  console.log('tokens', tokensQuery.data);

  const p2pkPubkey = wallet?.pubkeyHex ?? null;

  return {
    isLoading: walletQuery.isLoading || tokensQuery.isLoading,
    hasWallet: !!wallet,
    p2pkPubkey,
    mints: wallet?.mints ?? [],
    balances,
    tokens: tokensQuery.data ?? [],
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ['nutzap-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['nutzap-tokens'] });
    },
  };
}
