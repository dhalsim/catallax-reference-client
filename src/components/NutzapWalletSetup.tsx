import { useState } from 'react';
import { Wallet, Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNutzapConfig } from '@/hooks/useNutzapConfig';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useCreateNutzapWallet } from '@/hooks/useCreateNutzapWallet';
import { NutzapConfigForm } from '@/components/NutzapConfigForm';
import { IncomingNutzapsSection } from '@/components/IncomingNutzapsSection';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
export function NutzapWalletSetup() {
  const { user } = useCurrentUser();
  const { isLoading: configLoading } = useNutzapConfig(user?.pubkey);
  const { hasWallet, isLoading: walletLoading } = useNutzapWallet();
  const { mutateAsync: createWallet, isPending } = useCreateNutzapWallet();

  const [creating, setCreating] = useState(false);

  const loading = !!user && (configLoading || walletLoading);

  const handleCreate = async () => {
    setCreating(true);
    
    try {
      await createWallet([]);
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
      <div className="space-y-6">
        <IncomingNutzapsSection />
        <NutzapConfigForm />
      </div>
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
      <CardContent className="space-y-3">
        <Button
          onClick={handleCreate}
          disabled={isPending || creating}
          className="w-full"
        >
          <Wallet className="mr-2 h-4 w-4" />
          {isPending || creating ? 'Creating…' : 'Create wallet'}
        </Button>
      </CardContent>
    </Card>
  );
}
