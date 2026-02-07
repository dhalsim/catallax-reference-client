import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNutzap } from '@/hooks/useNutzap';
import { useCanReceiveNutzaps } from '@/hooks/useNutzapConfig';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useAuthor } from '@/hooks/useAuthor';
import { formatSats } from '@/lib/catallax';
import { genUserName } from '@/lib/genUserName';
import { Loader2, Wallet, AlertTriangle } from 'lucide-react';

function getMintHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export interface NutzapSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientPubkey: string;
  amount: number;
  purpose: string;
  onComplete: (nutzapEventId: string) => void;
  eventId: string;
  eventKind: number;
}

export function NutzapSendDialog({
  open,
  onOpenChange,
  recipientPubkey,
  amount: defaultAmount,
  purpose,
  onComplete,
  eventId,
  eventKind,
}: NutzapSendDialogProps) {
  const { sendNutzap, isSending } = useNutzap();
  const { canReceive, config, isLoading: configLoading } =
    useCanReceiveNutzaps(recipientPubkey);
  const { balances, hasWallet, mints: walletMints } = useNutzapWallet();
  const author = useAuthor(recipientPubkey);

  const recipientMintUrls = new Set(
    config?.mints.map((m) => m.url) ?? []
  );
  const allUserMints = Array.from(
    new Set([...walletMints, ...balances.keys()])
  ).filter((url) => (balances.get(url) ?? 0) > 0);
  const selectableMints = allUserMints.filter(
    (url) => recipientMintUrls.has(url) && (balances.get(url) ?? 0) > 0
  );

  const [selectedMintUrl, setSelectedMintUrl] = useState<string>('');

  const selectedBalance = selectedMintUrl
    ? balances.get(selectedMintUrl) ?? 0
    : 0;

  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(recipientPubkey);

  const showInsufficientAlert =
    hasWallet &&
    canReceive &&
    !!selectedMintUrl &&
    defaultAmount > selectedBalance;

  const handleSend = async () => {
    if (!selectedMintUrl) return;

    if (defaultAmount > selectedBalance) return;

    try {
      const result = await sendNutzap({
        recipientPubkey,
        amount: defaultAmount,
        mintUrl: selectedMintUrl,
        eventId,
        eventKind,
      });
      onComplete(result.nutzapEventId);
      onOpenChange(false);
      setSelectedMintUrl('');
    } catch {
      // Error handled in hook
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedMintUrl('');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>🥜</span>
            Cashu Payment to Arbiter
          </DialogTitle>
          <DialogDescription>
            {purpose}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
            <Avatar>
              <AvatarImage src={metadata?.picture} />
              <AvatarFallback>
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{displayName}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {recipientPubkey.slice(0, 16)}…
              </p>
            </div>
          </div>

          {!hasWallet && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Set up a Cashu wallet before sending nutzaps.
              </AlertDescription>
            </Alert>
          )}

          {configLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking recipient configuration…
            </div>
          )}

          {!configLoading && !canReceive && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This user has not set up nutzap receiving (no kind 10019). They
                cannot receive Cashu payments via Nostr.
              </AlertDescription>
            </Alert>
          )}

          {canReceive && selectableMints.length === 0 && allUserMints.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                You have no Cashu balance at mints this user trusts. Add funds
                at one of:{' '}
                {config?.mints.map((m) => new URL(m.url).hostname).join(', ')}
              </AlertDescription>
            </Alert>
          )}

          {canReceive && hasWallet && (
            <div className="space-y-2">
              <Label>Mint</Label>
              <Select
                value={selectedMintUrl}
                onValueChange={setSelectedMintUrl}
                disabled={selectableMints.length === 0 || isSending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a mint to send from" />
                </SelectTrigger>
                <SelectContent>
                  {allUserMints.map((url) => {
                    const balance = balances.get(url) ?? 0;
                    const isSelectable = selectableMints.includes(url);
                    const suffix = !recipientMintUrls.has(url)
                      ? ' — recipient does not accept'
                      : '';
                    const label = `${getMintHostname(url)} (${formatSats(balance)})${suffix}`;
                    return (
                      <SelectItem
                        key={url}
                        value={url}
                        disabled={!isSelectable}
                      >
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Amount (sats)</Label>
            <p className="text-sm font-medium">
              {formatSats(defaultAmount)}
            </p>
            {selectedMintUrl && selectedBalance > 0 && (
              <p className="text-xs text-muted-foreground">
                Available: {formatSats(selectedBalance)}
              </p>
            )}
            {showInsufficientAlert && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Insufficient balance. You have{' '}
                  {formatSats(selectedBalance)} available; you need to send{' '}
                  {formatSats(defaultAmount)}.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <Button
            onClick={handleSend}
            disabled={
              isSending ||
              !selectedMintUrl ||
              !canReceive ||
              !hasWallet ||
              defaultAmount > selectedBalance
            }
            className="w-full"
          >
            {isSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Wallet className="mr-2 h-4 w-4" />
                Send {formatSats(defaultAmount)}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
