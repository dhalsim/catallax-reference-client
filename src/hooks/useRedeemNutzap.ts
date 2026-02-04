import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet } from '@cashu/cashu-ts';
import {
  NUTZAP_WALLET_KIND,
  NUTZAP_TOKEN_KIND,
  NUTZAP_REDEMPTION_KIND,
  type ParsedNutzap,
} from '@/lib/nutzap';

export function useRedeemNutzap() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (nutzap: ParsedNutzap) => {
      if (!user?.signer?.nip44) {
        throw new Error('No signer with NIP-44 support');
      }

      toast({
        title: 'Redeeming nutzap...',
        description: 'Swapping tokens to your wallet',
      });

      const walletEvents = await nostr.query(
        [
          {
            kinds: [NUTZAP_WALLET_KIND],
            authors: [user.pubkey],
            limit: 1,
          },
        ],
        { signal: AbortSignal.timeout(5000) }
      );

      if (walletEvents.length === 0) {
        throw new Error(
          'No wallet configured. Set up your Cashu wallet first.'
        );
      }

      const walletContent = await user.signer.nip44.decrypt(
        user.pubkey,
        walletEvents[0].content
      );
      const walletTags = JSON.parse(walletContent) as string[][];
      const privkey = walletTags.find(([name]) => name === 'privkey')?.[1];

      if (!privkey) {
        throw new Error('No P2PK private key in wallet');
      }

      const wallet = new Wallet(nutzap.mintUrl, { unit: nutzap.unit });
      await wallet.loadMint();

      const newProofs = await wallet.receive(
        { mint: nutzap.mintUrl, proofs: nutzap.proofs },
        { privkey }
      );

      const tokenContent = JSON.stringify({
        mint: nutzap.mintUrl,
        proofs: newProofs,
        unit: nutzap.unit,
      });

      const encryptedTokenContent = await user.signer.nip44.encrypt(
        user.pubkey,
        tokenContent
      );

      await createEvent({
        kind: NUTZAP_TOKEN_KIND,
        content: encryptedTokenContent,
        tags: [],
      });

      const historyContent = JSON.stringify([
        ['direction', 'in'],
        ['amount', nutzap.totalAmount.toString()],
        ['unit', nutzap.unit],
      ]);

      const encryptedHistoryContent = await user.signer.nip44.encrypt(
        user.pubkey,
        historyContent
      );

      await createEvent({
        kind: NUTZAP_REDEMPTION_KIND,
        content: encryptedHistoryContent,
        tags: [
          ['e', nutzap.id, '', 'redeemed'],
          ['p', nutzap.pubkey],
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
      queryClient.invalidateQueries({
        queryKey: ['last-nutzap-redemption'],
      });
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
