import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNutzapConfig } from '@/hooks/useNutzapConfig';
import { useQuery } from '@tanstack/react-query';
import { verifyProofsDleq } from '@/lib/cashu';
import {
  NUTZAP_EVENT_KIND,
  NUTZAP_REDEMPTION_KIND,
  parseNutzap,
  verifyNutzap,
  type ParsedNutzap,
} from '@/lib/nutzap';

/** Address of the nutzapped event (kind, pubkey, d) for matching to tasks. */
export interface ReferencedEventAddress {
  kind: number;
  pubkey: string;
  d: string | undefined;
}

export interface IncomingNutzapWithVerification extends ParsedNutzap {
  verified: boolean;
  error?: string;
  /** Address of the event this nutzap targets (when eventId resolved). */
  referencedEventAddress?: ReferencedEventAddress;
}

/** Incoming nutzaps (kind 9321) to current user, verified against their config. */
export function useIncomingNutzaps() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: myConfig } = useNutzapConfig(user?.pubkey);

  const lastRedemptionQuery = useQuery({
    queryKey: ['last-nutzap-redemption', user?.pubkey],
    queryFn: async (c) => {
      if (!user) return 0;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      const events = await nostr.query(
        [
          {
            kinds: [NUTZAP_REDEMPTION_KIND],
            authors: [user.pubkey],
            limit: 1,
          },
        ],
        { signal }
      );

      return events[0]?.created_at ?? 0;
    },
    enabled: !!user,
  });

  const nutzapsQuery = useQuery({
    queryKey: [
      'incoming-nutzaps',
      user?.pubkey,
      myConfig?.mints.map((m) => m.url),
      lastRedemptionQuery.data,
    ],
    queryFn: async (c): Promise<IncomingNutzapWithVerification[]> => {
      if (!user || !myConfig) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const mintUrls = myConfig.mints.map((m) => m.url);

      const events = await nostr.query(
        [
          {
            kinds: [NUTZAP_EVENT_KIND],
            '#p': [user.pubkey],
            '#u': mintUrls,
            since: lastRedemptionQuery.data,
            limit: 50,
          },
        ],
        { signal }
      );

      const nutzaps: IncomingNutzapWithVerification[] = [];
      const eventIdsToFetch = new Set<{ eventId: string; eventKind: number; relayHint: string }>();

      for (const event of events) {
        const parsed = parseNutzap(event);
        
        if (!parsed) continue;
        
        const verification = verifyNutzap(parsed, myConfig);
        
        eventIdsToFetch.add({
          eventId: parsed.eventId,
          eventKind: parsed.eventKind,
          relayHint: parsed.relayHint,
        });
        
        let dleqValid = false;
        
        if (verification.valid) {
          dleqValid = await verifyProofsDleq(
            parsed.proofs,
            parsed.mintUrl,
            parsed.unit
          );
        }

        const error = verification.error ?? (verification.valid && !dleqValid 
          ? 'DLEQ verification failed' 
          : undefined);
        
        nutzaps.push({
          ...parsed,
          verified: verification.valid && dleqValid,
          error,
        });
      }

      const eventIds = [...eventIdsToFetch.values()].map((e) => e.eventId);
      const eventKinds = [...eventIdsToFetch.values()].map((e) => e.eventKind);

      const referencedEvents = await nostr.query(
        [
          {
            ids: eventIds,
            kinds: eventKinds,
          },
        ],
        { signal: AbortSignal.timeout(5000) }
      );

      // Attach referenced event address to each nutzap
      return nutzaps.map((n) => {
        const refEvent = referencedEvents.find((e) => e.id === n.eventId && e.kind === n.eventKind);

        const refEventAddress = refEvent ? {
          kind: refEvent.kind,
          pubkey: refEvent.pubkey,
          d: refEvent.tags.find(([name]) => name === 'd')?.[1],
        } : undefined;

        return {
          ...n,
          referencedEventAddress: refEventAddress,
        };
      });
    },
    enabled:
      !!user &&
      !!myConfig &&
      lastRedemptionQuery.data !== undefined &&
      !lastRedemptionQuery.isLoading,
    refetchInterval: 30_000,
  });

  const unredeemedCount =
    nutzapsQuery.data?.filter((n) => n.verified).length ?? 0;
  const totalAmount =
    nutzapsQuery.data
      ?.filter((n) => n.verified)
      .reduce((sum, n) => sum + n.totalAmount, 0) ?? 0;

  return {
    nutzaps: nutzapsQuery.data ?? [],
    unredeemedCount,
    totalAmount,
    isLoading: nutzapsQuery.isLoading,
    refetch: nutzapsQuery.refetch,
  };
}
