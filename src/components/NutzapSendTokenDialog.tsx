import { useState } from 'react';
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
import { useSendCashuToken } from '@/hooks/useSendCashuToken';
import { useNutzapWallet } from '@/hooks/useNutzapWallet';
import { useToast } from '@/hooks/useToast';
import { formatSats } from '@/lib/catallax';
import { Copy, Loader2, Wallet } from 'lucide-react';

interface NutzapSendTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mintUrl: string;
  mintName: string;
  balance: number;
}

export function NutzapSendTokenDialog({
  open,
  onOpenChange,
  mintUrl,
  mintName,
  balance,
}: NutzapSendTokenDialogProps) {
  const [amount, setAmount] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const { tokens } = useNutzapWallet();
  const sendToken = useSendCashuToken();
  const { toast } = useToast();

  const tokensForMint = tokens
    .filter((t) => t.mint === mintUrl)
    .map((t) => ({ eventId: t.eventId, proofs: t.proofs }));

  const handleCreateToken = async () => {
    const amountNum = parseInt(amount, 10);
    if (Number.isNaN(amountNum) || amountNum <= 0) return;
    if (amountNum > balance) {
      toast({
        title: 'Insufficient balance',
        description: `You have ${formatSats(balance)} at ${mintName}`,
        variant: 'destructive',
      });
      return;
    }
    try {
      const result = await sendToken.mutateAsync({
        mintUrl,
        amount: amountNum,
        tokensForMint,
        unit: 'sat',
      });
      setCreatedToken(result.encodedToken);
    } catch {
      // Error handled in hook
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      toast({ title: 'Copied', description: 'Token copied to clipboard' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setAmount('');
      setCreatedToken(null);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Create token from {mintName}
          </DialogTitle>
          <DialogDescription>
            Create a Cashu token to use in another wallet or send to someone.
            Available: {formatSats(balance)}.
          </DialogDescription>
        </DialogHeader>

        {createdToken ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Token created. Copy it and paste it in another Cashu wallet to
              receive the sats.
            </p>
            <div className="flex gap-2">
              <Button onClick={handleCopy} variant="outline" className="flex-1">
                <Copy className="mr-2 h-4 w-4" />
                Copy token
              </Button>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </div>
            <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs break-all font-mono">
              {createdToken}
            </pre>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token-amount">Amount (sats)</Label>
              <Input
                id="token-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1000"
                disabled={sendToken.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Available: {formatSats(balance)}
              </p>
            </div>

            <Button
              onClick={handleCreateToken}
              disabled={
                sendToken.isPending ||
                !amount ||
                parseInt(amount, 10) <= 0 ||
                parseInt(amount, 10) > balance
              }
              className="w-full"
            >
              {sendToken.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                'Create token'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
