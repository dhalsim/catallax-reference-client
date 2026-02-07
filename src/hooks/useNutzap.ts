import { useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useActiveRelayUrls } from '@/hooks/useActiveRelayUrls';
import { useToast } from '@/hooks/useToast';
import { Wallet } from '@cashu/cashu-ts';
import { parseNutzapConfig, buildNutzapTags, NUTZAP_EVENT_KIND } from '@/lib/nutzap';
import { parseReadRelaysFromNip65, mergeAndDeduplicateRelays } from '@/lib/relays';

export interface NutzapRequest {
  recipientPubkey: string;
  amount: number;
  comment?: string;
  eventId: string;
  eventKind: number;
  mintUrl: string;
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
  const activeRelayUrls = useActiveRelayUrls();
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

      const signal = AbortSignal.timeout(5000);
      const [configEvents, nip65Events] = await Promise.all([
        nostr.query(
          [{ kinds: [10019], authors: [request.recipientPubkey], limit: 1 }],
          { signal }
        ),
        nostr.query(
          [{ kinds: [10002], authors: [request.recipientPubkey], limit: 1 }],
          { signal }
        ),
      ]);

      if (configEvents.length === 0) {
        throw new Error(
          'Recipient has not configured nutzaps (no kind:10019 event)'
        );
      }

      const config = parseNutzapConfig(configEvents[0]);
      if (!config) {
        throw new Error('Invalid nutzap configuration');
      }

      const candidateMints = config.mints.filter(
        (m) => mints.includes(m.url) && m.units.includes('sat')
      );

      const commonMint = candidateMints.find(
        (m) => m.url === request.mintUrl
      );
      
      if (!commonMint) {
        throw new Error(
          `Recipient does not accept mint ${request.mintUrl}. Recipient accepts: ${config.mints.map((m) => m.url).join(', ')}`
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
        request.eventKind.toString()
      );

      const configRelays = config.relays ?? [];
      const nip65ReadRelays =
        nip65Events.length > 0 ? parseReadRelaysFromNip65(nip65Events[0]) : [];
      const targetRelays = mergeAndDeduplicateRelays(configRelays, nip65ReadRelays);
      const relaysToPublish =
        targetRelays.length > 0 ? targetRelays : activeRelayUrls;

      const event = await createEvent({
        kind: NUTZAP_EVENT_KIND,
        content: request.comment ?? '',
        tags,
        relays: relaysToPublish,
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
