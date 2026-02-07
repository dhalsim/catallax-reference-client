import { useIncomingNutzaps } from '@/hooks/useIncomingNutzaps';
import { useRedeemNutzap } from '@/hooks/useRedeemNutzap';
import { useAuthor } from '@/hooks/useAuthor';
import { formatSats } from '@/lib/catallax';
import { genUserName } from '@/lib/genUserName';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowDownLeft, Loader2 } from 'lucide-react';
import type { IncomingNutzapWithVerification } from '@/hooks/useIncomingNutzaps';

function NutzapRow({
  nutzap,
  onRedeem,
  isRedeeming,
}: {
  nutzap: IncomingNutzapWithVerification;
  onRedeem: () => void;
  isRedeeming: boolean;
}) {
  const author = useAuthor(nutzap.pubkey);
  const displayName =
    author.data?.metadata?.name ?? genUserName(nutzap.pubkey);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={author.data?.metadata?.picture} />
          <AvatarFallback>
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{displayName}</p>
          <p className="text-sm text-muted-foreground">
            {formatSats(nutzap.totalAmount)} {nutzap.unit}
          </p>
          {nutzap.comment && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {nutzap.comment}
            </p>
          )}
          {nutzap.error && (
            <Badge variant="destructive" className="mt-1">
              {nutzap.error}
            </Badge>
          )}
        </div>
      </div>
      <Button
        size="sm"
        onClick={onRedeem}
        disabled={!nutzap.verified || isRedeeming}
        className="shrink-0"
      >
        {isRedeeming ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <ArrowDownLeft className="mr-1 h-4 w-4" />
            Redeem
          </>
        )}
      </Button>
    </div>
  );
}

export function IncomingNutzapsSection() {
  const { nutzaps, unredeemedCount, totalAmount, isLoading, refetch } =
    useIncomingNutzaps();
  const { mutateAsync: redeem, isPending: isRedeeming } = useRedeemNutzap();

  const handleRedeem = async (nutzap: IncomingNutzapWithVerification) => {
    if (!nutzap.verified) return;
    try {
      await redeem(nutzap);
      refetch();
    } catch {
      // Error handled in hook
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Incoming nutzaps
          </CardTitle>
          <CardDescription>
            Checking for Cashu payments sent to you
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="mt-2 h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowDownLeft className="h-5 w-5" />
          Incoming nutzaps
          {unredeemedCount > 0 && (
            <Badge variant="secondary">{unredeemedCount} waiting</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Cashu payments sent to you via Nostr. Redeem to add to your wallet.
          {totalAmount > 0 && (
            <span className="block mt-1 font-medium text-foreground">
              {formatSats(totalAmount)} sats available
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {nutzaps.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No incoming nutzaps. Others can send you Cashu by nutzapping your
            tasks or profile.
          </p>
        ) : (
          nutzaps.map((nutzap) => (
            <NutzapRow
              key={nutzap.id}
              nutzap={nutzap}
              onRedeem={() => handleRedeem(nutzap)}
              isRedeeming={isRedeeming}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
