import { useNostr } from "@nostrify/react";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { useCurrentUser } from "./useCurrentUser";
import { CATALLAX_KINDS } from "@/lib/catallax";

import type { NostrEvent } from "@nostrify/nostrify";

export type PublishEventInput = Pick<NostrEvent, 'kind'> & {
  content?: string;
  tags?: string[][];
  created_at?: number;
  relays?: string[];
};

export function useNostrPublish(): UseMutationResult<NostrEvent, Error, PublishEventInput> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (t: PublishEventInput) => {
      if (user) {
        const { relays, ...eventInput } = t;
        const tags = eventInput.tags ?? [];

        // Add the client tag if it doesn't exist
        if (location.protocol === "https:" && !tags.some(([name]) => name === "client")) {
          tags.push(["client", location.hostname]);
        }

        const event = await user.signer.signEvent({
          kind: eventInput.kind,
          content: eventInput.content ?? "",
          tags,
          created_at: eventInput.created_at ?? Math.floor(Date.now() / 1000),
        });

        const opts = { signal: AbortSignal.timeout(5000) as AbortSignal };
        if (relays && relays.length > 0) {
          await nostr.event(event, { ...opts, relays });
        } else {
          await nostr.event(event, opts);
        }
        return event;
      } else {
        throw new Error("User is not logged in");
      }
    },
    onError: (error) => {
      console.error("Failed to publish event:", error);
    },
    onSuccess: (data) => {
      console.log("Event published successfully:", data);

      // Invalidate relevant queries based on event kind
      if (data.kind === CATALLAX_KINDS.TASK_PROPOSAL) {
        console.log('Invalidating task-related queries after publishing task proposal');
        // Invalidate all task-related queries with more aggressive patterns
        queryClient.invalidateQueries({ queryKey: ['catallax'] });
        // Also try to refetch immediately
        queryClient.refetchQueries({ queryKey: ['catallax', 'tasks'] });
        queryClient.refetchQueries({ queryKey: ['catallax', 'my-tasks'] });
        queryClient.refetchQueries({ queryKey: ['catallax', 'worker-tasks'] });
        queryClient.refetchQueries({ queryKey: ['catallax', 'arbiter-tasks'] });
      } else if (data.kind === CATALLAX_KINDS.ARBITER_ANNOUNCEMENT) {
        console.log('Invalidating arbiter-related queries after publishing arbiter announcement');
        // Invalidate arbiter-related queries
        queryClient.invalidateQueries({ queryKey: ['catallax', 'arbiters'] });
        queryClient.invalidateQueries({ queryKey: ['catallax', 'my-services'] });
      } else if (data.kind === CATALLAX_KINDS.TASK_CONCLUSION) {
        console.log('Invalidating conclusion-related queries after publishing task conclusion');
        // Invalidate conclusion-related queries
        queryClient.invalidateQueries({ queryKey: ['catallax', 'conclusions'] });
      } else if (data.kind === 9041) {
        console.log('Invalidating zap-goal queries after publishing goal event');
        queryClient.invalidateQueries({ queryKey: ['zap-goal'] });
      }
    },
  });
}