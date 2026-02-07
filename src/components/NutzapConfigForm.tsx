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
import { Wallet, ArrowUpRight, ArrowDownLeft, History, Plus, Trash2 } from 'lucide-react';
import { CashuReceiveTokenDialog } from '@/components/CashuReceiveTokenDialog';
import { CashuSendTokenDialog } from '@/components/CashuSendTokenDialog';
import { NutzapMintHistoryDialog } from '@/components/NutzapMintHistoryDialog';
import { usePendingTokens } from '@/hooks/usePendingTokens';
import { useAppContext } from '@/hooks/useAppContext';

function normalizeMintUrl(input: string): string {
  const trimmed = input.trim();
  
  if (!trimmed) return trimmed;
  
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  
  return `https://${trimmed}`;
}

function isValidMintUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function NutzapConfigForm() {
  const { user } = useCurrentUser();
  const { config: appConfig, presetRelays = [] } = useAppContext();
  const { data: config } = useNutzapConfig(user?.pubkey);
  const { mutateAsync: createEvent, isPending } = useNostrPublish();
  const { mutateAsync: updateWalletMints, isPending: isUpdatingMints } =
    useUpdateNutzapWalletMints();
  const { p2pkPubkey, hasWallet, balances, mints: walletMints } = useNutzapWallet();
  const { getPendingForMint } = usePendingTokens();
  const { toast } = useToast();
  const seededRef = useRef(false);

  const getMintBalance = (mintUrl: string) => balances.get(mintUrl) ?? 0;

  const [mints, setMints] = useState<string[]>([]);
  const [newMintInput, setNewMintInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [receiveMintUrl, setReceiveMintUrl] = useState<string | null>(null);
  const [sendTokenMintUrl, setSendTokenMintUrl] = useState<string | null>(null);

  useEffect(() => {
    const source = walletMints.length > 0 
      ? walletMints 
      : (config?.mints.map((m) => m.url) ?? []);
    
    if (source.length > 0 && !seededRef.current) {
      setMints(source);
      seededRef.current = true;
    }
  }, [walletMints, config?.mints]);

  function getActiveRelayUrls(): string[] {
    if (appConfig.relayMode === 'custom' && appConfig.customRelay) {
      return [appConfig.customRelay];
    }
    
    if (appConfig.relayMode === 'user' && appConfig.userRelays?.length) {
      return appConfig.userRelays;
    }
    
    const urls = presetRelays.map((r) => r.url);
    
    return urls.length > 0 ? urls : ['wss://relay.nostr.band'];
  }

  const handleAddMint = () => {
    const url = normalizeMintUrl(newMintInput);
    
    if (!url) return;
    
    if (!isValidMintUrl(url)) {
      toast({
        variant: 'destructive',
        title: 'Invalid URL',
        description: 'Enter a valid mint URL (e.g. https://mint.example)',
      });
      
      return;
    }
    
    if (mints.includes(url)) {
      toast({ title: 'Already added', description: 'This mint is already in the list.' });
      
      return;
    }
    
    setMints([...mints, url]);
    setNewMintInput('');
  };

  const handleRemoveMint = (url: string) => {
    setMints(mints.filter((m) => m !== url));
  };

  const handleSubmit = async () => {
    if (!user || !p2pkPubkey) return;

    if (mints.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Add at least one mint',
        description: 'Add a mint URL before publishing configuration.',
      });
      
      return;
    }

    const relayUrls = getActiveRelayUrls();
    
    const tags: string[][] = [];

    for (const relay of relayUrls) {
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
          mergeWithExisting: false,
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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Label>Your P2PK public key</Label>
            <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">
              {p2pkPubkey}
            </code>
            <p className="mt-1 text-xs text-muted-foreground">
              Tokens will be locked to this key. Only you can redeem them.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            className="shrink-0"
          >
            <History className="h-4 w-4 mr-1" />
            History
          </Button>
        </div>

        <div className="space-y-3">
          <Label>Mints</Label>
          <p className="text-xs text-muted-foreground">
            Add mints to receive and send Cashu tokens. Receive, create tokens to send elsewhere.
          </p>
          
          <div className="flex gap-2">
            <Input
              value={newMintInput}
              onChange={(e) => setNewMintInput(e.target.value)}
              placeholder="https://mint.example"
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddMint())}
            />
            <Button type="button" variant="outline" size="icon" onClick={handleAddMint}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {mints.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No mints added yet. Add a mint URL above.
            </p>
          ) : (
            <ul className="space-y-2">
              {mints.map((mintUrl) => {
                const pendingCount = getPendingForMint(mintUrl).length;
                let hostname: string;
                try {
                  hostname = new URL(mintUrl).hostname;
                } catch {
                  hostname = mintUrl;
                }
                return (
                  <li key={mintUrl}>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{hostname}</p>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <span aria-hidden>≐</span>
                              {formatSats(getMintBalance(mintUrl))}
                              {pendingCount > 0 && (
                                <Badge variant="secondary" className="ml-1">
                                  {pendingCount} pending
                                </Badge>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSendTokenMintUrl(mintUrl)}
                              disabled={getMintBalance(mintUrl) <= 0}
                            >
                              <ArrowUpRight className="h-4 w-4 mr-1" />
                              Send
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setReceiveMintUrl(mintUrl)}
                            >
                              <ArrowDownLeft className="h-4 w-4 mr-1" />
                              Receive
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveMint(mintUrl)}
                              aria-label={`Remove ${hostname}`}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {receiveMintUrl && (
          <CashuReceiveTokenDialog
            open={!!receiveMintUrl}
            onOpenChange={(open) => !open && setReceiveMintUrl(null)}
            mintUrl={receiveMintUrl}
            mintName={new URL(receiveMintUrl).hostname}
          />
        )}

        {sendTokenMintUrl && (
          <CashuSendTokenDialog
            open={!!sendTokenMintUrl}
            onOpenChange={(open) => !open && setSendTokenMintUrl(null)}
            mintUrl={sendTokenMintUrl}
            mintName={new URL(sendTokenMintUrl).hostname}
            balance={getMintBalance(sendTokenMintUrl)}
          />
        )}

        <NutzapMintHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />

        <Button
          onClick={handleSubmit}
          disabled={isPending || isUpdatingMints || mints.length === 0}
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
