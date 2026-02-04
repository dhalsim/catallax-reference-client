import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNutzapConfig } from '@/hooks/useNutzapConfig';
import { useQuery } from '@tanstack/react-query';
import {
  NUTZAP_EVENT_KIND,
  NUTZAP_REDEMPTION_KIND,
  parseNutzap,
  verifyNutzap,
  type ParsedNutzap,
} from '@/lib/nutzap';

export interface IncomingNutzapWithVerification extends ParsedNutzap {
  verified: boolean;
  error?: string;
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
            since: lastRedemptionQuery.data ?? 0,
            limit: 50,
          },
        ],
        { signal }
      );

      const nutzaps: IncomingNutzapWithVerification[] = [];

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
