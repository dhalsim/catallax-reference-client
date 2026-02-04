import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Zap, Wallet } from 'lucide-react';

export interface PaymentMethodSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Call when user chooses Lightning; caller should open LightningPaymentDialog */
  onSelectLightning: () => void;
  /** Call when user chooses Nutzap; caller should open NutzapDialog */
  onSelectNutzap: () => void;
  /** If false, only Lightning is shown (no choice). */
  canReceiveNutzap: boolean;
  /** Optional short label, e.g. "Fund escrow" */
  purpose?: string;
}

/**
 * Small dialog to choose between Lightning and Nutzap.
 * When the recipient cannot receive nutzaps, only Lightning is offered (caller may skip this and open Lightning directly).
 */
export function PaymentMethodSelector({
  open,
  onOpenChange,
  onSelectLightning,
  onSelectNutzap,
  canReceiveNutzap,
  purpose,
}: PaymentMethodSelectorProps) {
  const handleLightning = () => {
    onOpenChange(false);
    onSelectLightning();
  };

  const handleNutzap = () => {
    onOpenChange(false);
    onSelectNutzap();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payment method</DialogTitle>
          <DialogDescription>
            {purpose
              ? `Choose how to pay: ${purpose}`
              : 'Choose payment method'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button onClick={handleLightning} className="w-full" variant="default">
            <Zap className="mr-2 h-4 w-4" />
            Lightning
          </Button>
          {canReceiveNutzap && (
            <Button
              onClick={handleNutzap}
              className="w-full"
              variant="outline"
            >
              <Wallet className="mr-2 h-4 w-4" />
              Nutzap (Cashu)
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
