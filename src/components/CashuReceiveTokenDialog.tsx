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
import { Textarea } from '@/components/ui/textarea';
import { useReceiveCashuToken } from '@/hooks/useReceiveCashuToken';
import { ArrowDownLeft, Loader2 } from 'lucide-react';

interface CashuReceiveTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mintUrl?: string;
  mintName?: string;
}

export function CashuReceiveTokenDialog({
  open,
  onOpenChange,
  mintName,
}: CashuReceiveTokenDialogProps) {
  const [tokenInput, setTokenInput] = useState('');
  const receive = useReceiveCashuToken();

  const handleReceive = async () => {
    try {
      await receive.mutateAsync(tokenInput.trim());
      setTokenInput('');
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
            <ArrowDownLeft className="h-5 w-5" />
            Receive token from {mintName}
          </DialogTitle>
          <DialogDescription>
            Paste a Cashu token from another wallet of {mintName} to add it to this wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token-paste">Token</Label>
            <Textarea
              id="token-paste"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="cashuAeyJ..."
              rows={4}
              className="font-mono text-xs"
              disabled={receive.isPending}
            />
          </div>

          <Button
            onClick={handleReceive}
            disabled={!tokenInput.trim() || receive.isPending}
            className="w-full"
          >
            {receive.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Receiving…
              </>
            ) : (
              <>
                <ArrowDownLeft className="mr-2 h-4 w-4" />
                Receive into wallet
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
