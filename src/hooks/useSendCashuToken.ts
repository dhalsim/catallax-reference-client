import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { Proof } from '@cashu/cashu-ts';
import { NUTZAP_TOKEN_KIND } from '@/lib/nutzap';

/** NIP-09 delete event kind. */
const DELETE_KIND = 5;

export interface SendCashuTokenResult {
  /** Encoded token string to copy and use in another wallet. */
  encodedToken: string;
  /** Amount sent (in the token). */
  amount: number;
  /** Mint URL. */
  mintUrl: string;
  /** Unit (e.g. sat). */
  unit: string;
}

/**
 * Create a Cashu token for a given amount from a mint, persist change (keep)
 * to NIP-60 (delete old 7375 events for this mint, create new with keep),
 * and return the encoded token for the user to copy.
 */
export function useSendCashuToken() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      mintUrl,
      amount,
      tokensForMint,
      unit = 'sat',
    }: {
      mintUrl: string;
      amount: number;
      tokensForMint: { eventId: string; proofs: Proof[] }[];
      unit?: string;
    }): Promise<SendCashuTokenResult> => {
      if (!user?.signer?.nip44) {
        throw new Error('No signer with NIP-44 support');
      }

      const allProofs = tokensForMint.flatMap((t) => t.proofs);
      const balance = allProofs.reduce((s, p) => s + p.amount, 0);
      if (balance < amount) {
        throw new Error(
          `Insufficient balance at mint. Have ${balance} ${unit}, need ${amount} ${unit}.`
        );
      }

      toast({
        title: 'Creating token...',
        description: 'Splitting proofs',
      });

      const wallet = new Wallet(mintUrl, { unit });
      await wallet.loadMint();

      const { keep, send } = await wallet.send(amount, allProofs);

      const encodedToken = getEncodedTokenV4({ mint: mintUrl, proofs: send });

      const eventIdsToReplace = tokensForMint.map((t) => t.eventId);

      if (eventIdsToReplace.length > 0) {
        const deleteTags: string[][] = eventIdsToReplace.map((id) => ['e', id]);
        deleteTags.push(['k', String(NUTZAP_TOKEN_KIND)]);

        await createEvent({
          kind: DELETE_KIND,
          content: '',
          tags: deleteTags,
        });
      }

      if (keep.length > 0) {
        const tokenContent = JSON.stringify({
          mint: mintUrl,
          proofs: keep,
          unit,
        });
        const encrypted = await user.signer.nip44.encrypt(
          user.pubkey,
          tokenContent
        );
        await createEvent({
          kind: NUTZAP_TOKEN_KIND,
          content: encrypted,
          tags: [],
        });
      }

      const sentAmount = send.reduce((s, p) => s + p.amount, 0);
      toast({
        title: 'Token created',
        description: `Copy the token to use ${sentAmount} ${unit} in another wallet`,
      });

      return {
        encodedToken,
        amount: sentAmount,
        mintUrl,
        unit,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutzap-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['nutzap-wallet'] });
    },
    onError: (error) => {
      toast({
        title: 'Create token failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}
