import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMintHistory } from '@/hooks/useMintHistory';
import { usePendingTokens } from '@/hooks/usePendingTokens';
import { useToast } from '@/hooks/useToast';
import { formatSats } from '@/lib/catallax';
import { ArrowDownLeft, ArrowUpRight, History, Loader2 } from 'lucide-react';

interface NutzapMintHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_MINT_DISPLAY = 40;

function formatMintDisplay(mintUrl: string | undefined): string {
  if (!mintUrl) return '';
  
  let label: string;
  
  try {
    label = new URL(mintUrl).hostname;
  } catch {
    label = mintUrl;
  }
  
  if (label.length <= MAX_MINT_DISPLAY) return label;
  
  return label.slice(0, MAX_MINT_DISPLAY - 3) + '...';
}

function formatTimeAgo(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

export function NutzapMintHistoryDialog({
  open,
  onOpenChange,
}: NutzapMintHistoryDialogProps) {
  const { data: history = [], isLoading } = useMintHistory();
  const { pendingTokens } = usePendingTokens();
  const { toast } = useToast();

  const pendingByHistoryId = new Map(
    pendingTokens
      .filter((t) => t.historyEventId)
      .map((t) => [t.historyEventId!, t])
  );

  const handleCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      toast({ title: 'Copied', description: 'Token copied to clipboard' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            History
          </DialogTitle>
          <DialogDescription>
            Received and sent tokens. Click PENDING to copy the token.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-auto -mx-1 px-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No history yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {history.map((e) => {
                const pending = pendingByHistoryId.get(e.id);
                const isIn = e.direction === 'in';
                
                return (
                  <li
                    key={e.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                      pending ? 'cursor-pointer hover:bg-muted/50' : ''
                    }`}
                    role={pending ? 'button' : undefined}
                    onClick={
                      pending
                        ? () => handleCopy(pending.encodedToken)
                        : undefined
                    }
                  >
                    <span className="shrink-0" aria-hidden>
                      {isIn ? (
                        <ArrowDownLeft className="h-4 w-4 text-green-600" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-amber-600" />
                      )}
                    </span>
                    <span className="text-muted-foreground shrink-0 min-w-[4.5rem]">
                      {formatTimeAgo(e.createdAt)}
                    </span>
                    <span
                      className="text-muted-foreground shrink-0 w-[10rem] truncate"
                      title={e.mintUrl}
                    >
                      {formatMintDisplay(e.mintUrl) || '—'}
                    </span>
                    <span
                      className={
                        isIn ? 'text-green-700 dark:text-green-400' : ''
                      }
                    >
                      {isIn ? '+' : '−'}
                      {formatSats(e.amount)} sats
                    </span>
                    {pending && (
                      <span className="ml-auto text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">
                        PENDING
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
