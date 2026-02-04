import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { parseNutzapConfig } from '@/lib/nutzap';

/** Fetch a user's nutzap configuration (kind 10019). */
export function useNutzapConfig(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['nutzap-config', pubkey],
    queryFn: async (c) => {
      if (!pubkey) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query(
        [
          {
            kinds: [10019],
            authors: [pubkey],
            limit: 1,
          },
        ],
        { signal }
      );

      if (events.length === 0) return null;

      return parseNutzapConfig(events[0]);
    },
    enabled: !!pubkey,
    staleTime: 60_000,
  });
}

/** Whether the user can receive nutzaps (has valid kind 10019). */
export function useCanReceiveNutzaps(pubkey: string | undefined) {
  const { data: config, isLoading } = useNutzapConfig(pubkey);

  return {
    canReceive: !!config,
    config,
    isLoading,
  };
}
