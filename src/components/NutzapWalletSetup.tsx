import { useState } from 'react';
import { Wallet, Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNutzapConfig } from '@/hooks/useNutzapConfig';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useCreateNutzapWallet } from '@/hooks/useCreateNutzapWallet';
import { NutzapConfigForm } from '@/components/NutzapConfigForm';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const DEFAULT_MINTS = [
  'https://mint.minibits.cash/Bitcoin',
  'https://mint.coinos.io',
];

export function NutzapWalletSetup() {
  const { user } = useCurrentUser();
  const { data: config, isLoading: configLoading } = useNutzapConfig(user?.pubkey);
  const { hasWallet, isLoading: walletLoading } = useNutzapWallet();
  const { mutateAsync: createWallet, isPending } = useCreateNutzapWallet();

  const [creating, setCreating] = useState(false);

  const loading = !!user && (configLoading || walletLoading);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const mints = config?.mints?.map((m) => m.url) ?? DEFAULT_MINTS;
      const mintsToUse = mints.length > 0 ? mints : DEFAULT_MINTS;
      await createWallet(mintsToUse);
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-muted-foreground text-sm">
            Log in to set up Nutzap and create a Cashu wallet.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading Nutzap configuration…
          </CardTitle>
          <CardDescription>
            Checking for wallet and published config
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full mt-3" />
        </CardContent>
      </Card>
    );
  }

  if (hasWallet) {
    return (
      <NutzapConfigForm />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Cashu wallet
        </CardTitle>
        <CardDescription>
          Create a wallet to send and receive nutzaps (Cashu ecash over Nostr).
          Your key is stored encrypted in a kind 17375 event.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={handleCreate}
          disabled={isPending || creating}
        >
          <Wallet className="mr-2 h-4 w-4" />
          {isPending || creating ? 'Creating…' : 'Create wallet'}
        </Button>
      </CardContent>
    </Card>
  );
}
