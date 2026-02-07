import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { NUTZAP_EVENT_KIND, parseNutzap, type ParsedNutzap } from '@/lib/nutzap';

/** Nutzaps (kind 9321) that reference a specific event. */
export function useNutzapsForEvent(eventId: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['nutzaps-for-event', eventId],
    queryFn: async (c): Promise<ParsedNutzap[]> => {
      if (!eventId) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query(
        [
          {
            kinds: [NUTZAP_EVENT_KIND],
            '#e': [eventId],
            limit: 50,
          },
        ],
        { signal }
      );

      const nutzaps: ParsedNutzap[] = [];
      for (const event of events) {
        const parsed = parseNutzap(event);
        if (parsed) nutzaps.push(parsed);
      }
      return nutzaps;
    },
    enabled: !!eventId,
  });
}
