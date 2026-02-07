import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, getDecodedToken } from '@cashu/cashu-ts';
import {
  NUTZAP_WALLET_KIND,
  NUTZAP_TOKEN_KIND,
  NUTZAP_REDEMPTION_KIND,
} from '@/lib/nutzap';

/**
 * Receive a Cashu token (encoded string from getEncodedTokenV4) into the
 * NIP-60 wallet. Persists received proofs as a new kind 7375 event.
 */
export function useReceiveCashuToken() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (encodedToken: string) => {
      if (!user?.signer?.nip44) {
        throw new Error('No signer with NIP-44 support');
      }

      const trimmed = encodedToken.trim();
      
      if (!trimmed) {
        throw new Error('Paste a Cashu token');
      }

      let decoded: { mint: string; proofs: unknown[]; unit?: string };
      
      try {
        decoded = getDecodedToken(trimmed);
      } catch {
        throw new Error('Invalid Cashu token. Paste a token from another wallet or mint.');
      }

      if (!decoded.mint || !decoded.proofs?.length) {
        throw new Error('Invalid token: missing mint or proofs');
      }

      const mintUrl = decoded.mint;
      const unit = decoded.unit ?? 'sat';

      if (unit !== 'sat') {
        toast({
          variant: 'destructive',
          title: 'Invalid unit',
          description: 'This client only accepts tokens in sats.',
        });

        throw new Error(`Invalid unit: ${unit}`);
      }

      toast({
        title: 'Receiving token...',
        description: 'Adding to your wallet',
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
        throw new Error('No wallet configured. Set up your Cashu wallet first.');
      }

      const walletContent = await user.signer.nip44.decrypt(
        user.pubkey,
        walletEvents[0].content
      );
      
      const walletTags = JSON.parse(walletContent) as string[][];
      const privkey = walletTags.find(([name]) => name === 'privkey')?.[1];

      const wallet = new Wallet(mintUrl, { unit });
      await wallet.loadMint();

      const newProofs = await wallet.receive(trimmed, privkey ? { privkey } : undefined);

      const tokenContent = JSON.stringify({
        mint: mintUrl,
        proofs: newProofs,
        unit,
      });

      const encryptedTokenContent = await user.signer.nip44.encrypt(
        user.pubkey,
        tokenContent
      );

      const newTokenEvent = await createEvent({
        kind: NUTZAP_TOKEN_KIND,
        content: encryptedTokenContent,
        tags: [],
      });

      const total = newProofs.reduce((s, p) => s + p.amount, 0);

      const historyContent = JSON.stringify([
        ['direction', 'in'],
        ['amount', total.toString()],
        ['unit', unit],
      ]);
      
      const encryptedHistory = await user.signer.nip44.encrypt(
        user.pubkey,
        historyContent
      );
      
      await createEvent({
        kind: NUTZAP_REDEMPTION_KIND,
        content: encryptedHistory,
        tags: [['e', newTokenEvent.id, '', 'created']],
      });
      
      toast({
        title: 'Token received',
        description: `Added ${total} ${unit} to your wallet`,
      });

      return { amount: total, unit, mintUrl };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutzap-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['nutzap-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['nutzap-mint-history'] });
    },
    onError: (error) => {
      toast({
        title: 'Receive failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}
