import { useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useToast } from '@/hooks/useToast';
import { Wallet } from '@cashu/cashu-ts';
import { parseNutzapConfig, buildNutzapTags } from '@/lib/nutzap';

export interface NutzapRequest {
  recipientPubkey: string;
  amount: number;
  comment?: string;
  eventId?: string;
  eventKind?: number;
}

export interface NutzapResult {
  nutzapEventId: string;
  amount: number;
  mintUrl: string;
}

export function useNutzap() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const { tokens, mints, refetch } = useNutzapWallet();
  const [isSending, setIsSending] = useState(false);

  const sendNutzap = async (
    request: NutzapRequest
  ): Promise<NutzapResult> => {
    if (!user?.signer) {
      throw new Error('No signer available');
    }

    setIsSending(true);

    try {
      toast({
        title: 'Preparing nutzap...',
        description: 'Fetching recipient configuration',
      });

      const configEvents = await nostr.query(
        [
          {
            kinds: [10019],
            authors: [request.recipientPubkey],
            limit: 1,
          },
        ],
        { signal: AbortSignal.timeout(5000) }
      );

      if (configEvents.length === 0) {
        throw new Error(
          'Recipient has not configured nutzaps (no kind:10019 event)'
        );
      }

      const config = parseNutzapConfig(configEvents[0]);
      if (!config) {
        throw new Error('Invalid nutzap configuration');
      }

      const commonMint = config.mints.find(
        (m) => mints.includes(m.url) && m.units.includes('sat')
      );

      if (!commonMint) {
        throw new Error(
          `No common mint found. Recipient accepts: ${config.mints.map((m) => m.url).join(', ')}`
        );
      }

      toast({
        title: 'Preparing payment...',
        description: `Using mint: ${new URL(commonMint.url).hostname}`,
      });

      const mintTokens = tokens.filter((t) => t.mint === commonMint.url);
      const allProofs = mintTokens.flatMap((t) => t.proofs);
      const balance = allProofs.reduce((s, p) => s + p.amount, 0);

      if (balance < request.amount) {
        throw new Error(
          `Insufficient balance at ${commonMint.url}. Have: ${balance} sats, need: ${request.amount} sats. Add funds to your Cashu wallet first.`
        );
      }

      const wallet = new Wallet(commonMint.url, { unit: 'sat' });
      await wallet.loadMint();

      const p2pkPubkey = config.p2pkPubkey.startsWith('02')
        ? config.p2pkPubkey
        : `02${config.p2pkPubkey}`;

      const { send } = await wallet.ops
        .send(request.amount, allProofs)
        .asP2PK({ pubkey: p2pkPubkey })
        .run();

      toast({
        title: 'Publishing nutzap...',
        description: 'Sending payment to recipient',
      });

      const tags = buildNutzapTags(
        request.recipientPubkey,
        commonMint.url,
        send,
        'sat',
        request.eventId,
        request.eventKind
      );

      const event = await createEvent({
        kind: 9321,
        content: request.comment ?? '',
        tags,
      });

      toast({
        title: 'Nutzap sent!',
        description: `Sent ${request.amount} sats via Cashu`,
      });

      refetch();

      return {
        nutzapEventId: event.id,
        amount: request.amount,
        mintUrl: commonMint.url,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to send nutzap';
      toast({
        title: 'Nutzap failed',
        description: message,
        variant: 'destructive',
      });
      throw err;
    } finally {
      setIsSending(false);
    }
  };

  return { sendNutzap, isSending };
}
