import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ExternalLink, Calendar, User, Zap, Copy, MoreVertical, Eye } from 'lucide-react';
import { useCanReceiveNutzaps } from '@/hooks/useNutzapConfig';
import { genUserName } from '@/lib/genUserName';
import { formatSats, getStatusColor, type TaskProposal, CATALLAX_KINDS } from '@/lib/catallax';
import { LightningPaymentDialog } from './LightningPaymentDialog';
import { GoalProgressBar } from './GoalProgressBar';
import { CrowdfundButton } from './CrowdfundButton';
import { NutzapSendDialog } from '@/components/NutzapSendDialog';
import { PaymentMethodSelector } from '@/components/PaymentMethodSelector';
import { CopyNpubButton } from '@/components/CopyNpubButton';
import { format } from 'date-fns';

interface TaskCardProps {
  task: TaskProposal;
  onApply?: (task: TaskProposal) => void;
  onManage?: (task: TaskProposal) => void;
  onFund?: (task: TaskProposal, zapReceiptId: string) => void;
  showApplyButton?: boolean;
  showManageButton?: boolean;
  showFundButton?: boolean;
  /** @deprecated Real zaps are always enabled */
  realZapsEnabled?: boolean;
}

export function TaskCard({ task, onApply, onManage, onFund, showApplyButton, showManageButton, showFundButton }: TaskCardProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { canReceive: arbiterAcceptsNutzaps } = useCanReceiveNutzaps(task.arbiterPubkey ?? undefined);
  const [showFundDialog, setShowFundDialog] = useState(false);
  const [waitingForPayment, setWaitingForPayment] = useState(false);
  const [showPaymentMethodForFund, setShowPaymentMethodForFund] = useState(false);
  const [showNutzapFundDialog, setShowNutzapFundDialog] = useState(false);
  const patronAuthor = useAuthor(task.patronPubkey);
  const arbiterAuthor = useAuthor(task.arbiterPubkey || '');
  const workerAuthor = useAuthor(task.workerPubkey || '');

  const patronMetadata = patronAuthor.data?.metadata;
  const arbiterMetadata = arbiterAuthor.data?.metadata;
  const workerMetadata = workerAuthor.data?.metadata;

  const patronName = patronMetadata?.name ?? genUserName(task.patronPubkey);
  const arbiterName = arbiterMetadata?.name ?? genUserName(task.arbiterPubkey || '');
  const workerName = workerMetadata?.name ?? genUserName(task.workerPubkey || '');

  const deadline = task.content.deadline ? new Date(task.content.deadline * 1000) : null;

  // Generate naddr for this task
  const taskNaddr = nip19.naddrEncode({
    identifier: task.d,
    pubkey: task.patronPubkey,
    kind: CATALLAX_KINDS.TASK_PROPOSAL,
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied!',
      description: `${label} copied to clipboard`,
    });
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <CardTitle className="text-lg hover:text-primary">
                  <Link to={`/task/${taskNaddr}`} className="block">
                    {task.content.title}
                  </Link>
                </CardTitle>
                <CardDescription className="flex items-center gap-1 mt-1">
                  <User className="h-3 w-3" />
                  by {patronName}
                  <CopyNpubButton pubkey={task.patronPubkey} size="sm" className="h-5 w-5 p-0" />
                </CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/task/${taskNaddr}`}>
                      <Eye className="h-4 w-4 mr-2" />
                      View Details
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyToClipboard(taskNaddr, 'Task address (naddr)')}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy naddr
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyToClipboard(task.id, 'Note ID')}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Note ID
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyToClipboard(`${window.location.origin}/task/${taskNaddr}`, 'Task link')}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Copy Link
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1">
              {task.fundingType === 'crowdfunding' && (
                <Badge variant="secondary" className="text-xs">
                  👥 Crowdfunded
                </Badge>
              )}
              <Badge className={getStatusColor(task.status)}>
                {task.status.replace('_', ' ')}
              </Badge>
            </div>
            <Badge variant="outline" className="font-mono">
              {formatSats(task.amount)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground line-clamp-3">
          {task.content.description}
        </p>

        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium">Requirements:</span>
            <p className="text-muted-foreground mt-1 line-clamp-2">
              {task.content.requirements}
            </p>
          </div>
        </div>

        {task.categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.categories.map((category) => (
              <Badge key={category} variant="secondary" className="text-xs">
                {category}
              </Badge>
            ))}
          </div>
        )}

        <div className="space-y-2 text-sm">
          {deadline && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Deadline: {format(deadline, 'PPP')}</span>
            </div>
          )}

          {task.arbiterPubkey && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" />
              <span>Arbiter: {arbiterName}</span>
              <CopyNpubButton pubkey={task.arbiterPubkey} size="sm" className="h-5 w-5 p-0" />
            </div>
          )}

          {task.workerPubkey && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" />
              <span>Worker: {workerName}</span>
              <CopyNpubButton pubkey={task.workerPubkey} size="sm" className="h-5 w-5 p-0" />
            </div>
          )}
        </div>

        {/* Crowdfunding progress */}
        {task.fundingType === 'crowdfunding' && task.goalId && (
          <GoalProgressBar
            goalId={task.goalId}
            className="pt-2"
            waitingForPayment={waitingForPayment}
            onWaitingComplete={() => setWaitingForPayment(false)}
          />
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/task/${taskNaddr}`}>
              <Eye className="h-4 w-4 mr-1" />
              View
            </Link>
          </Button>

          {task.detailsUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={task.detailsUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" />
                External
              </a>
            </Button>
          )}

          {showApplyButton && onApply && task.status === 'funded' && (
            <Button size="sm" onClick={() => onApply(task)} className="ml-auto">
              Apply
            </Button>
          )}

          {showFundButton && onFund && task.status === 'proposed' && task.arbiterPubkey && user && user.pubkey === task.patronPubkey && task.fundingType !== 'crowdfunding' && (
            <Button
              size="sm"
              onClick={() => {
                if (arbiterAcceptsNutzaps) {
                  setShowPaymentMethodForFund(true);
                } else {
                  setShowFundDialog(true);
                }
              }}
              className="ml-auto"
            >
              <Zap className="h-4 w-4 mr-1" />
              Fund
            </Button>
          )}

          {task.fundingType === 'crowdfunding' && task.status === 'proposed' && (
            <CrowdfundButton
              task={task}
              className="ml-auto"
              onPaymentComplete={() => setWaitingForPayment(true)}
            />
          )}

          {showManageButton && onManage && (
            <Button size="sm" onClick={() => onManage(task)} className="ml-auto">
              Manage
            </Button>
          )}
        </div>

        {/* Payment method selector for fund */}
        {task.arbiterPubkey && (
          <PaymentMethodSelector
            open={showPaymentMethodForFund}
            onOpenChange={setShowPaymentMethodForFund}
            canReceiveNutzap={arbiterAcceptsNutzaps}
            purpose={`Escrow for task: ${task.content.title}`}
            onSelectLightning={() => {
              setShowPaymentMethodForFund(false);
              setShowFundDialog(true);
            }}
            onSelectNutzap={() => {
              setShowPaymentMethodForFund(false);
              setShowNutzapFundDialog(true);
            }}
          />
        )}

        {/* Fund Dialogs */}
        {task.arbiterPubkey && (
          <LightningPaymentDialog
            open={showFundDialog}
            onOpenChange={setShowFundDialog}
            recipientPubkey={task.arbiterPubkey}
            amount={parseInt(task.amount)}
            purpose={`Escrow funding for task: ${task.content.title}`}
            onPaymentComplete={(zapReceiptId: string) => {
              onFund?.(task, zapReceiptId);
              setShowFundDialog(false);
            }}
          />
        )}

        {task.arbiterPubkey && (
          <NutzapSendDialog
            open={showNutzapFundDialog}
            onOpenChange={setShowNutzapFundDialog}
            recipientPubkey={task.arbiterPubkey}
            amount={parseInt(task.amount)}
            purpose={`Escrow funding for task: ${task.content.title}`}
            onComplete={(nutzapEventId) => {
              onFund?.(task, nutzapEventId);
              setShowNutzapFundDialog(false);
            }}
            eventId={task.id}
            eventKind={CATALLAX_KINDS.TASK_PROPOSAL}
          />
        )}

        <div className="text-xs text-muted-foreground">
          Created {format(new Date(task.created_at * 1000), 'PPp')}
        </div>
      </CardContent>
    </Card>
  );
}