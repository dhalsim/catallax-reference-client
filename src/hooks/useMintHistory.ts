import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useQuery } from '@tanstack/react-query';
import { NUTZAP_REDEMPTION_KIND, NUTZAP_TOKEN_KIND } from '@/lib/nutzap';

export interface MintHistoryEntry {
  id: string;
  direction: 'in' | 'out';
  amount: number;
  unit: string;
  createdAt: number;
  /** Mint URL resolved from the token event (7375) referenced by this 7376's e tags. */
  mintUrl?: string;
  /** For nutzap redemptions: sender pubkey. */
  senderPubkey?: string;
}

/** Collect token event IDs from 7376 e tags (created/destroyed). */
function getTokenEventIdsFrom7376(event: { tags: string[][] }): string[] {
  const ids: string[] = [];
  
  for (const tag of event.tags) {
    if (tag[0] !== 'e' || !tag[1]) continue;
    const marker = tag[3];
    if (marker === 'created' || marker === 'destroyed') {
      ids.push(tag[1]);
    }
  }
  
  return ids;
}

/** Pick one token event ID from 7376 for mint lookup (prefer created). */
function getTokenEventIdForMint(event: { tags: string[][] }): string | undefined {
  const created = event.tags.find((t) => t[0] === 'e' && t[3] === 'created');
  
  if (created?.[1]) return created[1];
  
  const destroyed = event.tags.find((t) => t[0] === 'e' && t[3] === 'destroyed');
  
  return destroyed?.[1];
}

export function useMintHistory() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['nutzap-mint-history', user?.pubkey],
    queryFn: async (c): Promise<MintHistoryEntry[]> => {
      if (!user?.signer?.nip44) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query(
        [
          {
            kinds: [NUTZAP_REDEMPTION_KIND],
            authors: [user.pubkey],
            limit: 100,
          },
        ],
        { signal }
      );

      const allTokenIds = new Set<string>();
      
      let earliest7376 = Infinity;
      
      for (const ev of events) {
        if (ev.created_at < earliest7376) earliest7376 = ev.created_at;
        
        for (const id of getTokenEventIdsFrom7376(ev)) {
          allTokenIds.add(id);
        }
      }

      const tokenIdToMint = new Map<string, string>();
      
      if (allTokenIds.size > 0 && user.pubkey) {
        const signal2 = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
        const tokenEvents = await nostr.query(
          [
            {
              kinds: [NUTZAP_TOKEN_KIND],
              authors: [user.pubkey],
              ids: Array.from(allTokenIds),
            },
          ],
          { signal: signal2 }
        );
        
        for (const tokenEvent of tokenEvents) {
          if (!allTokenIds.has(tokenEvent.id)) continue;
          
          try {
            const decrypted = await user.signer.nip44.decrypt(
              user.pubkey,
              tokenEvent.content
            );
            
            const data = JSON.parse(decrypted) as { mint?: string };
            
            if (data.mint) {
              tokenIdToMint.set(tokenEvent.id, data.mint);
            }
          } catch {
            // Skip malformed token content
          }
        }
      }

      const entries: MintHistoryEntry[] = [];

      for (const event of events) {
        try {
          const decrypted = await user.signer.nip44.decrypt(
            user.pubkey,
            event.content
          );
          
          const pairs = JSON.parse(decrypted) as string[][];

          const direction = pairs.find(([k]) => k === 'direction')?.[1] as
            | 'in'
            | 'out'
            | undefined;

          const amountStr = pairs.find(([k]) => k === 'amount')?.[1];
          const unit = pairs.find(([k]) => k === 'unit')?.[1] ?? 'sat';

          if (!direction || !amountStr) continue;

          if (direction !== 'in' && direction !== 'out') continue;

          const amount = parseInt(amountStr, 10);

          if (Number.isNaN(amount)) continue;

          const tokenEventId = getTokenEventIdForMint(event);
          const mintUrl = tokenEventId
            ? tokenIdToMint.get(tokenEventId)
            : undefined;

          const senderTag = event.tags.find(([name]) => name === 'p');

          entries.push({
            id: event.id,
            direction,
            amount,
            unit,
            createdAt: event.created_at,
            mintUrl,
            senderPubkey: senderTag?.[1],
          });
        } catch {
          // Skip malformed events
        }
      }

      entries.sort((a, b) => b.createdAt - a.createdAt);

      return entries;
    },
    enabled: !!user?.signer?.nip44,
  });
}
