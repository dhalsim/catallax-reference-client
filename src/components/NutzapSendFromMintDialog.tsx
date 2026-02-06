import { useState } from 'react';
import { nip19 } from 'nostr-tools';
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
import { useNutzap } from '@/hooks/useNutzap';
import { useToast } from '@/hooks/useToast';
import { formatSats } from '@/lib/catallax';
import { Loader2, Wallet } from 'lucide-react';

interface NutzapSendFromMintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mintUrl: string;
  mintName: string;
  balance: number;
}

export function NutzapSendFromMintDialog({
  open,
  onOpenChange,
  mintUrl,
  mintName,
  balance,
}: NutzapSendFromMintDialogProps) {
  const { sendNutzap, isSending } = useNutzap();
  const { toast } = useToast();
  const [recipientNpub, setRecipientNpub] = useState('');
  const [amount, setAmount] = useState('');

  const handleSend = async () => {
    const amountNum = parseInt(amount, 10);
    if (Number.isNaN(amountNum) || amountNum <= 0) return;

    let recipientPubkey: string;
    try {
      const decoded = nip19.decode(recipientNpub.trim());
      if (decoded.type !== 'npub') {
        toast({
          title: 'Invalid recipient',
          description: 'Enter a valid npub (Nostr public key)',
          variant: 'destructive',
        });
        return;
      }
      recipientPubkey = decoded.data;
    } catch {
      toast({
        title: 'Invalid recipient',
        description: 'Enter a valid npub (Nostr public key)',
        variant: 'destructive',
      });
      return;
    }

    if (amountNum > balance) {
      toast({
        title: 'Insufficient balance',
        description: `You have ${formatSats(balance)} at ${mintName}`,
        variant: 'destructive',
      });
      return;
    }

    try {
      await sendNutzap({
        recipientPubkey,
        amount: amountNum,
        preferredMintUrl: mintUrl,
      });
      onOpenChange(false);
      setRecipientNpub('');
      setAmount('');
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
            Send from {mintName}
          </DialogTitle>
          <DialogDescription>
            Send Cashu ecash via Nostr. Recipient must accept {mintName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recipient-npub">Recipient (npub)</Label>
            <Input
              id="recipient-npub"
              value={recipientNpub}
              onChange={(e) => setRecipientNpub(e.target.value)}
              placeholder="npub1..."
              disabled={isSending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="send-amount">Amount (sats)</Label>
            <Input
              id="send-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              disabled={isSending}
            />
            <p className="text-xs text-muted-foreground">
              Available: {formatSats(balance)}
            </p>
          </div>

          <Button
            onClick={handleSend}
            disabled={
              isSending ||
              !recipientNpub.trim() ||
              !amount ||
              parseInt(amount, 10) <= 0 ||
              parseInt(amount, 10) > balance
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
