import { useState } from 'react';
import { useNutzap } from '@/hooks/useNutzap';
import { useCanReceiveNutzaps } from '@/hooks/useNutzapConfig';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useAuthor } from '@/hooks/useAuthor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Wallet, AlertTriangle } from 'lucide-react';
import { formatSats } from '@/lib/catallax';
import { genUserName } from '@/lib/genUserName';

export interface NutzapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientPubkey: string;
  amount?: number;
  purpose?: string;
  eventId?: string;
  eventKind?: number;
  onComplete: (nutzapEventId: string) => void;
}

export function NutzapDialog({
  open,
  onOpenChange,
  recipientPubkey,
  amount: defaultAmount,
  purpose,
  eventId,
  eventKind,
  onComplete,
}: NutzapDialogProps) {
  const { sendNutzap, isSending } = useNutzap();
  const { canReceive, config, isLoading: configLoading } =
    useCanReceiveNutzaps(recipientPubkey);
  const { balances, hasWallet } = useNutzapWallet();
  const author = useAuthor(recipientPubkey);

  const [amount, setAmount] = useState(defaultAmount?.toString() ?? '');
  const [comment, setComment] = useState('');

  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(recipientPubkey);

  const availableBalance =
    config?.mints.reduce((max, mint) => {
      const balance = balances.get(mint.url) ?? 0;
      return Math.max(max, balance);
    }, 0) ?? 0;

  const amountNum = parseInt(amount, 10);
  const showInsufficientAlert =
    hasWallet &&
    canReceive &&
    !Number.isNaN(amountNum) &&
    amountNum > 0 &&
    amountNum > availableBalance;

  const handleSend = async () => {
    const amountNum = parseInt(amount, 10);
    if (Number.isNaN(amountNum) || amountNum <= 0) return;

    try {
      const result = await sendNutzap({
        recipientPubkey,
        amount: amountNum,
        comment: comment || undefined,
        eventId,
        eventKind,
      });

      onComplete(result.nutzapEventId);
      onOpenChange(false);
    } catch {
      // Error handled in hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Send Nutzap
          </DialogTitle>
          <DialogDescription>
            Send Cashu ecash via Nostr
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

          {canReceive && availableBalance === 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                You have no Cashu balance at mints this user trusts. Add funds
                at one of: {config?.mints.map((m) => new URL(m.url).hostname).join(', ')}
              </AlertDescription>
            </Alert>
          )}

          {purpose && (
            <p className="text-sm text-muted-foreground">
              <strong>Purpose:</strong> {purpose}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="nutzap-amount">Amount (sats)</Label>
            <Input
              id="nutzap-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              disabled={!canReceive || !hasWallet}
            />
            {availableBalance > 0 && (
              <p className="text-xs text-muted-foreground">
                Available: {formatSats(availableBalance)}
              </p>
            )}
            {showInsufficientAlert && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Insufficient balance. You have{' '}
                  {formatSats(availableBalance)} available; you are trying to
                  send {formatSats(amountNum)}.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nutzap-comment">Comment (optional)</Label>
            <Textarea
              id="nutzap-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Thanks!"
              rows={2}
              disabled={!canReceive || !hasWallet}
            />
          </div>

          <Button
            onClick={handleSend}
            disabled={
              isSending ||
              !amount ||
              parseInt(amount, 10) <= 0 ||
              (!canReceive ||
                !hasWallet ||
                parseInt(amount, 10) > availableBalance)
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
                Send {amount ? formatSats(parseInt(amount, 10)) : 'Nutzap'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
