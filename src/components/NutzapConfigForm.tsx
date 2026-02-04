import { useState, useEffect, useRef } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNutzapConfig } from '@/hooks/useNutzapConfig';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useUpdateNutzapWalletMints } from '@/hooks/useUpdateNutzapWalletMints';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatSats } from '@/lib/catallax';
import { Plus, Trash2, Wallet } from 'lucide-react';

const DEFAULT_RELAYS = ['wss://relay.nostr.band'];
const DEFAULT_MINTS = [
  'https://mint.minibits.cash/Bitcoin',
  'https://mint.coinos.io',
  'https://stablenut.umint.cash'
];

export function NutzapConfigForm() {
  const { user } = useCurrentUser();
  const { data: config } = useNutzapConfig(user?.pubkey);
  const { mutateAsync: createEvent, isPending } = useNostrPublish();
  const { mutateAsync: updateWalletMints, isPending: isUpdatingMints } =
    useUpdateNutzapWalletMints();
  const { p2pkPubkey, hasWallet, balances } = useNutzapWallet();
  const { toast } = useToast();

  const totalSpendable =
    Array.from(balances.values()).reduce((s, n) => s + n, 0) ?? 0;
  const seededFromConfig = useRef(false);

  const [relays, setRelays] = useState<string[]>(DEFAULT_RELAYS);
  const [mints, setMints] = useState<string[]>([DEFAULT_MINTS[0]]);
  const [newRelay, setNewRelay] = useState('');
  const [newMint, setNewMint] = useState('');

  useEffect(() => {
    if (config && !seededFromConfig.current) {
      setRelays(config.relays.length > 0 ? config.relays : DEFAULT_RELAYS);
      setMints(
        config.mints.length > 0
          ? config.mints.map((m) => m.url)
          : [DEFAULT_MINTS[0]]
      );
      seededFromConfig.current = true;
    }
  }, [config]);

  const handleAddRelay = () => {
    if (newRelay && !relays.includes(newRelay)) {
      setRelays([...relays, newRelay]);
      setNewRelay('');
    }
  };

  const handleAddMint = () => {
    if (newMint && !mints.includes(newMint)) {
      setMints([...mints, newMint]);
      setNewMint('');
    }
  };

  const handleSubmit = async () => {
    if (!user || !p2pkPubkey) return;

    if (relays.length === 0) {
      toast({
        title: 'Error',
        description: 'Add at least one relay',
        variant: 'destructive',
      });
      return;
    }

    if (mints.length === 0) {
      toast({
        title: 'Error',
        description: 'Add at least one mint',
        variant: 'destructive',
      });
      return;
    }

    const tags: string[][] = [];

    for (const relay of relays) {
      tags.push(['relay', relay]);
    }

    for (const mint of mints) {
      tags.push(['mint', mint, 'sat']);
    }

    tags.push(['pubkey', p2pkPubkey]);

    try {
      if (hasWallet) {
        await updateWalletMints({
          newMints: mints,
          mergeWithExisting: true,
        });
      }

      await createEvent({
        kind: 10019,
        content: '',
        tags,
      });

      toast({
        title: 'Success',
        description: hasWallet
          ? 'Configuration and wallet mints updated'
          : 'Nutzap configuration published',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to publish',
        variant: 'destructive',
      });
    }
  };

  if (!hasWallet) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Set up Nutzaps</CardTitle>
          <CardDescription>
            Create a Cashu wallet first to receive nutzaps
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled>
            <Wallet className="mr-2 h-4 w-4" />
            Create wallet first
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nutzap configuration</CardTitle>
        <CardDescription>
          Configure how you receive Cashu payments via Nostr
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label>Spendable balance</Label>
          <p className="mt-1 text-lg font-medium">
            {formatSats(totalSpendable)}
          </p>
          <p className="text-xs text-muted-foreground">
            Total across all mints in your wallet
          </p>
        </div>

        <div>
          <Label>Your P2PK public key</Label>
          <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">
            {p2pkPubkey}
          </code>
          <p className="mt-1 text-xs text-muted-foreground">
            Tokens will be locked to this key. Only you can redeem them.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Relays (where you receive nutzaps)</Label>
          <div className="flex flex-wrap gap-2">
            {relays.map((relay) => (
              <Badge
                key={relay}
                variant="secondary"
                className="flex items-center gap-1"
              >
                {relay}
                <button
                  type="button"
                  onClick={() => setRelays(relays.filter((r) => r !== relay))}
                  aria-label={`Remove ${relay}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newRelay}
              onChange={(e) => setNewRelay(e.target.value)}
              placeholder="wss://relay.example"
            />
            <Button onClick={handleAddRelay} size="icon" variant="outline">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Trusted mints</Label>
          <div className="flex flex-wrap gap-2">
            {mints.map((mint) => (
              <Badge
                key={mint}
                variant="secondary"
                className="flex items-center gap-1"
              >
                {new URL(mint).hostname}
                <button
                  type="button"
                  onClick={() => setMints(mints.filter((m) => m !== mint))}
                  aria-label={`Remove ${mint}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newMint}
              onChange={(e) => setNewMint(e.target.value)}
              placeholder="https://mint.example"
            />
            <Button onClick={handleAddMint} size="icon" variant="outline">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {DEFAULT_MINTS.filter((m) => !mints.includes(m)).map((mint) => (
              <Button
                key={mint}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMints([...mints, mint])}
              >
                + {new URL(mint).hostname}
              </Button>
            ))}
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={isPending || isUpdatingMints}
          className="w-full"
        >
          {isPending || isUpdatingMints
            ? 'Publishing…'
            : 'Publish configuration'}
        </Button>
      </CardContent>
    </Card>
  );
}
