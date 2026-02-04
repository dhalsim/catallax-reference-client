import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { getPublicKey, utils } from '@noble/secp256k1';
import { NUTZAP_WALLET_KIND } from '@/lib/nutzap';

/** Create a new Cashu P2PK wallet (kind 17375) with encrypted privkey + mints. */
export function useCreateNutzapWallet() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mints: string[]) => {
      if (!user?.signer?.nip44) {
        throw new Error('Signer with NIP-44 support required');
      }

      const privkeyBytes = utils.randomSecretKey();
      const privkeyHex = Array.from(privkeyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const pubkeyBytes = getPublicKey(privkeyBytes, true);
      const pubkeyHex = Array.from(pubkeyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const walletTags: string[][] = [
        ['privkey', privkeyHex],
        ...mints.map((m) => ['mint', m]),
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
        title: 'Wallet created',
        description: 'Your Cashu wallet has been set up.',
      });

      return { privkeyHex, pubkeyHex };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutzap-wallet'] });
    },
  });
}
