import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@nostrify/react';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { NUTZAP_WALLET_KIND } from '@/lib/nutzap';

/**
 * Update the kind 17375 wallet event (NIP-60) with a new mints list.
 * Kind 17375 is replaceable, so publishing a new event replaces the previous one.
 * When mergeWithExisting is true, mints are the union of existing and new (dedupe by URL).
 */
export function useUpdateNutzapWalletMints() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      newMints,
      mergeWithExisting = true,
    }: {
      newMints: string[];
      mergeWithExisting?: boolean;
    }) => {
      if (!user?.signer?.nip44) {
        throw new Error('Signer with NIP-44 support required');
      }

      const signal = AbortSignal.timeout(5000);
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

      if (events.length === 0) {
        throw new Error('No wallet found. Create a wallet first.');
      }

      const decrypted = await user.signer.nip44.decrypt(
        user.pubkey,
        events[0].content
      );
      const tags = JSON.parse(decrypted) as string[][];

      const privkey = tags.find(([name]) => name === 'privkey')?.[1];
      if (!privkey) {
        throw new Error('Invalid wallet: missing privkey');
      }

      const existingMints = tags
        .filter(([name]) => name === 'mint')
        .map(([, url]) => url);

      const mintsToStore = mergeWithExisting
        ? Array.from(new Set([...existingMints, ...newMints]))
        : newMints;

      if (mintsToStore.length === 0) {
        throw new Error('At least one mint is required');
      }

      const walletTags: string[][] = [
        ['privkey', privkey],
        ...mintsToStore.map((m) => ['mint', m]),
      ];

      const encryptedContent = await user.signer.nip44.encrypt(
        user.pubkey,
        JSON.stringify(walletTags)
      );

      await createEvent({
        kind: NUTZAP_WALLET_KIND,
        content: encryptedContent,
        tags: [],
      });

      toast({
        title: 'Wallet mints updated',
        description: 'Your Cashu wallet mints have been synced.',
      });

      return { mints: mintsToStore };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutzap-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['nutzap-tokens'] });
    },
  });
}
