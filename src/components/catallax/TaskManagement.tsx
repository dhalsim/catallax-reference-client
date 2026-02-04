import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';

import { useCatallaxInvalidation } from '@/hooks/useCatallax';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Zap, Bitcoin, RefreshCw, Bug, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { CATALLAX_KINDS, formatSats, getStatusColor, calculatePaymentSplit, calculateCrowdfundingRefunds, calculateArbiterFee, parseArbiterAnnouncement, type TaskProposal, type TaskStatus, type ArbiterAnnouncement, type PaymentSplit } from '@/lib/catallax';
import { TaskConclusionForm } from './TaskConclusionForm';
import { LightningPaymentDialog } from './LightningPaymentDialog';
import { PaymentMethodSelector } from '@/components/PaymentMethodSelector';
import { NutzapDialog } from '@/components/NutzapDialog';
import { useCanReceiveNutzaps } from '@/hooks/useNutzapConfig';
import { LightningSplitPaymentDialog } from './LightningSplitPaymentDialog';
import { GoalProgressBar } from './GoalProgressBar';
import { ContributorsList } from './ContributorsList';
import { useZapGoal } from '@/hooks/useZapGoal';

interface TaskManagementProps {
  task: TaskProposal;
  onUpdate?: () => void;
  /** @deprecated Real zaps are always enabled */
  realZapsEnabled?: boolean;
}

export function TaskManagement({ task, onUpdate }: TaskManagementProps) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutate: createEvent, isPending } = useNostrPublish();
  const { toast } = useToast();
  const { invalidateAllCatallaxQueries } = useCatallaxInvalidation();

  // Fetch arbiter announcement to get fee information
  const { data: arbiterAnnouncement } = useQuery({
    queryKey: ['arbiter-announcement', task.arbiterService],
    queryFn: async (c) => {
      if (!task.arbiterService) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const [kind, pubkey, identifier] = task.arbiterService.split(':');

      const events = await nostr.query([{
        kinds: [parseInt(kind)],
        authors: [pubkey],
        '#d': [identifier],
        limit: 20, // Get multiple versions to find the latest
      }], { signal });

      if (events.length === 0) return null;

      // Parse all events and find the latest version
      const parsedAnnouncements = events
        .map(parseArbiterAnnouncement)
        .filter((announcement): announcement is ArbiterAnnouncement => announcement !== null);

      if (parsedAnnouncements.length === 0) return null;

      // For replaceable events, return the one with the latest created_at
      const latestAnnouncement = parsedAnnouncements.reduce((latest, current) =>
        current.created_at > latest.created_at ? current : latest
      );

      return latestAnnouncement;
    },
    enabled: !!task.arbiterService,
    staleTime: 0, // Always consider data stale to ensure fresh queries
    refetchOnWindowFocus: true,
  });


  // Fetch crowdfunding goal data if applicable
  const { data: goalData } = useZapGoal(task.fundingType === 'crowdfunding' ? task.goalId : undefined);

  const [workerPubkey, setWorkerPubkey] = useState('');
  const [showConclusionForm, setShowConclusionForm] = useState(false);
  const [showDebugConclusionForm, setShowDebugConclusionForm] = useState(false);
  const [showFundDialog, setShowFundDialog] = useState(false);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [showPayoutDialog, setShowPayoutDialog] = useState(false);
  const [showRefundSplitDialog, setShowRefundSplitDialog] = useState(false);
  const [showPayoutSplitDialog, setShowPayoutSplitDialog] = useState(false);
  const [conclusionZapReceiptId, setConclusionZapReceiptId] = useState('');
  const [showPaymentMethodForFund, setShowPaymentMethodForFund] = useState(false);
  const [showPaymentMethodForPayout, setShowPaymentMethodForPayout] = useState(false);
  const [showPaymentMethodForRefund, setShowPaymentMethodForRefund] = useState(false);
  const [showNutzapFundDialog, setShowNutzapFundDialog] = useState(false);
  const [showNutzapPayoutDialog, setShowNutzapPayoutDialog] = useState(false);
  const [showNutzapRefundDialog, setShowNutzapRefundDialog] = useState(false);

  const { canReceive: arbiterAcceptsNutzaps } = useCanReceiveNutzaps(task.arbiterPubkey);
  const { canReceive: workerAcceptsNutzaps } = useCanReceiveNutzaps(task.workerPubkey);
  const { canReceive: patronAcceptsNutzaps } = useCanReceiveNutzaps(task.patronPubkey);
  const [cancelState, setCancelState] = useState<'idle' | 'syncing' | 'complete'>('idle');

  // Generic operation state for funding, worker assignment, etc.
  type OperationType = 'funding' | 'assigning' | 'removing' | 'submitting' | 'crowdfund-marking';
  const [operationState, setOperationState] = useState<{
    type: OperationType | null;
    status: 'idle' | 'syncing' | 'complete';
  }>({ type: null, status: 'idle' });

  if (!user) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Please log in to manage tasks.</p>
        </CardContent>
      </Card>
    );
  }

  const isPatron = user.pubkey === task.patronPubkey;
  const isArbiter = user.pubkey === task.arbiterPubkey;
  const isWorker = user.pubkey === task.workerPubkey;

  // Calculate refund splits - different logic for crowdfunded vs regular tasks
  const refundSplits: PaymentSplit[] = (() => {
    if (!arbiterAnnouncement) return [];

    // For crowdfunded tasks, refund goes to all contributors proportionally
    if (task.fundingType === 'crowdfunding' && goalData?.progress.contributors.length) {
      const contributors = goalData.progress.contributors;
      const refunds = calculateCrowdfundingRefunds(
        contributors,
        arbiterAnnouncement,
        parseInt(task.amount),
        'cancelled' // Use 'cancelled' to skip arbiter fee for now
      );

      // Convert RefundSplit[] to PaymentSplit[]
      return refunds.map(refund => ({
        recipientPubkey: refund.recipientPubkey,
        amount: refund.amountSats,
        weight: refund.amountSats, // Weight proportional to refund amount
        purpose: `Refund for task: ${task.content.title}`,
      }));
    }

    // For regular tasks, refund goes to patron only
    return calculatePaymentSplit(task, arbiterAnnouncement, task.patronPubkey, 'patron');
  })();

  if (!isPatron && !isArbiter && !isWorker) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">
            You are not authorized to manage this task.
          </p>
        </CardContent>
      </Card>
    );
  }

  const updateTaskStatus = (newStatus: TaskStatus, zapReceiptId?: string, workerPubkeyOverride?: string, operation?: OperationType) => {
    // Set operation state to syncing if an operation type is provided
    if (operation) {
      setOperationState({ type: operation, status: 'syncing' });
    }

    const content = task.content;

    const tags: string[][] = [
      ['d', task.d],
      ['p', task.patronPubkey],
      ['amount', task.amount],
      ['t', 'catallax'],
      ['status', newStatus],
    ];

    if (task.arbiterPubkey) {
      tags.push(['p', task.arbiterPubkey]);
    }

    if (workerPubkeyOverride || task.workerPubkey) {
      tags.push(['p', workerPubkeyOverride || task.workerPubkey || '']);
    }

    if (task.arbiterService) {
      tags.push(['a', task.arbiterService]);
    }

    if (task.detailsUrl) {
      tags.push(['r', task.detailsUrl]);
    }

    if (task.zapReceiptId || zapReceiptId) {
      tags.push(['e', task.zapReceiptId || zapReceiptId || '', '', 'zap']);
    }

    // Add task categories
    task.categories.forEach(category => {
      if (category !== 'catallax') {
        tags.push(['t', category]);
      }
    });

    // Preserve NIP-75 crowdfunding fields across status transitions
    if (task.fundingType === 'crowdfunding') {
      tags.push(['funding_type', 'crowdfunding']);
      if (task.goalId) {
        tags.push(['goal', task.goalId]);
      }
    }

    console.log('Publishing task update with tags:', tags);

    createEvent({
      kind: CATALLAX_KINDS.TASK_PROPOSAL,
      content: JSON.stringify(content),
      tags,
      created_at: Math.floor(Date.now() / 1000), // Ensure we use current timestamp
    }, {
      onSuccess: (event) => {
        console.log('Task update published successfully:', event);
        setWorkerPubkey('');

        // Force immediate refetch of all task queries
        invalidateAllCatallaxQueries();

        // If tracking an operation, show complete state after delay
        if (operation) {
          setTimeout(() => {
            setOperationState({ type: operation, status: 'complete' });
          }, 2000);
        } else {
          // Show appropriate toast based on the status update
          const toastMessages: Record<TaskStatus, { title: string; description: string }> = {
            proposed: { title: 'Task Updated', description: 'Task status updated to "proposed".' },
            funded: { title: 'Task Funded!', description: 'Task has been marked as funded.' },
            in_progress: { title: 'Worker Assigned!', description: 'Worker has been assigned and task status updated to "in progress".' },
            submitted: { title: 'Work Submitted', description: 'Task status updated to "submitted".' },
            concluded: { title: 'Task Concluded', description: 'Task has been concluded.' },
          };
          const message = toastMessages[newStatus] || { title: 'Task Updated', description: `Task status updated to "${newStatus}".` };
          toast(message);

          // Add a small delay to allow queries to refetch, then call onUpdate
          setTimeout(() => {
            onUpdate?.();
          }, 1500);
        }
      },
      onError: (error) => {
        console.error('Failed to publish task update:', error);
        if (operation) {
          setOperationState({ type: null, status: 'idle' });
        }
        toast({
          title: 'Error',
          description: 'Failed to update task. Please try again.',
          variant: 'destructive',
        });
      },
    });
  };

  const updateTaskStatusWithoutWorker = (newStatus: TaskStatus, zapReceiptId?: string, operation?: OperationType) => {
    // Set operation state to syncing if an operation type is provided
    if (operation) {
      setOperationState({ type: operation, status: 'syncing' });
    }

    const content = task.content;

    const tags: string[][] = [
      ['d', task.d],
      ['p', task.patronPubkey],
      ['amount', task.amount],
      ['t', 'catallax'],
      ['status', newStatus],
    ];

    if (task.arbiterPubkey) {
      tags.push(['p', task.arbiterPubkey]);
    }

    // Explicitly do NOT add worker pubkey - this removes the worker

    if (task.arbiterService) {
      tags.push(['a', task.arbiterService]);
    }

    if (task.detailsUrl) {
      tags.push(['r', task.detailsUrl]);
    }

    if (task.zapReceiptId || zapReceiptId) {
      tags.push(['e', task.zapReceiptId || zapReceiptId || '', '', 'zap']);
    }

    // Add task categories
    task.categories.forEach(category => {
      if (category !== 'catallax') {
        tags.push(['t', category]);
      }
    });

    // Preserve NIP-75 crowdfunding fields across status transitions
    if (task.fundingType === 'crowdfunding') {
      tags.push(['funding_type', 'crowdfunding']);
      if (task.goalId) {
        tags.push(['goal', task.goalId]);
      }
    }

    console.log('Publishing task update without worker, tags:', tags);

    createEvent({
      kind: CATALLAX_KINDS.TASK_PROPOSAL,
      content: JSON.stringify(content),
      tags,
      created_at: Math.floor(Date.now() / 1000), // Ensure we use current timestamp
    }, {
      onSuccess: (event) => {
        console.log('Task update (worker removed) published successfully:', event);
        setWorkerPubkey('');

        // Force immediate refetch of all task queries
        invalidateAllCatallaxQueries();

        // If tracking an operation, show complete state after delay
        if (operation) {
          setTimeout(() => {
            setOperationState({ type: operation, status: 'complete' });
          }, 2000);
        } else {
          toast({
            title: 'Worker Removed!',
            description: `Worker has been removed and task status updated to "funded".`,
          });

          // Add a small delay to allow queries to refetch, then call onUpdate
          setTimeout(() => {
            onUpdate?.();
          }, 1500);
        }
      },
      onError: (error) => {
        console.error('Failed to publish task update:', error);
        if (operation) {
          setOperationState({ type: null, status: 'idle' });
        }
        toast({
          title: 'Error',
          description: 'Failed to remove worker. Please try again.',
          variant: 'destructive',
        });
      },
    });
  };

  const handleFundEscrow = (zapReceiptId: string) => {
    // Automatically update task status to "funded" after successful Lightning payment
    setShowFundDialog(false);
    updateTaskStatus('funded', zapReceiptId, undefined, 'funding');
  };

  const handleAssignWorker = () => {
    if (!workerPubkey) return;

    let hexPubkey = workerPubkey.trim();

    // Check if it's an npub and decode it
    if (hexPubkey.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(hexPubkey);
        if (decoded.type !== 'npub') {
          toast({
            title: 'Invalid npub',
            description: 'The provided npub could not be decoded.',
            variant: 'destructive',
          });
          return;
        }
        hexPubkey = decoded.data;
      } catch {
        toast({
          title: 'Invalid npub',
          description: 'The provided npub is malformed.',
          variant: 'destructive',
        });
        return;
      }
    }

    // Validate pubkey format (basic hex check)
    if (!/^[0-9a-fA-F]{64}$/.test(hexPubkey)) {
      toast({
        title: 'Invalid Public Key',
        description: 'Please enter a valid 64-character hex public key or npub.',
        variant: 'destructive',
      });
      return;
    }

    // Determine the appropriate status based on current status
    let newStatus: TaskStatus;
    if (task.status === 'funded') {
      newStatus = 'in_progress';
    } else {
      // Keep current status if already in progress or submitted
      newStatus = task.status;
    }

    updateTaskStatus(newStatus, undefined, hexPubkey, 'assigning');
  };

  const handleRemoveWorker = () => {
    // Remove worker and set status back to funded
    updateTaskStatusWithoutWorker('funded', undefined, 'removing');
  };

  const handleMarkSubmitted = () => {
    updateTaskStatus('submitted', undefined, undefined, 'submitting');
  };

  const handleRefundPatron = (zapReceiptId: string) => {
    setConclusionZapReceiptId(zapReceiptId);
    setShowRefundDialog(false);
    setShowRefundSplitDialog(false);
    setShowConclusionForm(true);
  };

  const handlePayWorker = (zapReceiptId: string) => {
    setConclusionZapReceiptId(zapReceiptId);
    setShowPayoutDialog(false);
    setShowPayoutSplitDialog(false);
    setShowConclusionForm(true);
  };

  const handlePayWorkerWithSplit = () => {
    if (arbiterAnnouncement) {
      setShowPayoutSplitDialog(true);
    } else {
      setShowPayoutDialog(true);
    }
  };

  const handleRefundPatronWithSplit = () => {
    if (arbiterAnnouncement) {
      setShowRefundSplitDialog(true);
    } else {
      setShowRefundDialog(true);
    }
  };

  const handleDebugCreateConclusion = () => {
    // For debug purposes, allow creating a conclusion without a zap receipt
    setConclusionZapReceiptId('');
    setShowDebugConclusionForm(true);
  };

  const handleCancelTask = () => {
    setCancelState('syncing');

    const content = task.content;
    const tags: string[][] = [
      ['d', task.d],
      ['p', task.patronPubkey],
      ['amount', task.amount],
      ['t', 'catallax'],
      ['status', 'concluded'],
    ];

    if (task.arbiterPubkey) {
      tags.push(['p', task.arbiterPubkey]);
    }

    if (task.arbiterService) {
      tags.push(['a', task.arbiterService]);
    }

    if (task.detailsUrl) {
      tags.push(['r', task.detailsUrl]);
    }

    // Add task categories
    task.categories.forEach(category => {
      if (category !== 'catallax') {
        tags.push(['t', category]);
      }
    });

    // Preserve NIP-75 crowdfunding fields
    if (task.fundingType === 'crowdfunding') {
      tags.push(['funding_type', 'crowdfunding']);
      if (task.goalId) {
        tags.push(['goal', task.goalId]);
      }
    }

    createEvent({
      kind: CATALLAX_KINDS.TASK_PROPOSAL,
      content: JSON.stringify(content),
      tags,
      created_at: Math.floor(Date.now() / 1000),
    }, {
      onSuccess: () => {
        toast({
          title: 'Task Cancelled',
          description: 'Task has been cancelled successfully.',
        });

        invalidateAllCatallaxQueries();

        // Show complete state after a delay
        setTimeout(() => {
          setCancelState('complete');
        }, 2000);
      },
      onError: (error) => {
        console.error('Failed to cancel task:', error);
        setCancelState('idle');
        toast({
          title: 'Error',
          description: 'Failed to cancel task. Please try again.',
          variant: 'destructive',
        });
      },
    });
  };

  // Show cancel syncing/complete state
  if (cancelState !== 'idle') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {cancelState === 'syncing' ? (
              <Loader2 className="h-5 w-5 animate-spin text-yellow-600" />
            ) : (
              <CheckCircle className="h-5 w-5 text-green-600" />
            )}
            {cancelState === 'syncing' ? 'Cancelling...' : 'Task Cancelled'}
          </CardTitle>
          <CardDescription>
            {task.content.title}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className={cancelState === 'syncing'
            ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950"
            : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
          }>
            {cancelState === 'syncing' ? (
              <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
            ) : (
              <CheckCircle className="h-4 w-4 text-green-600" />
            )}
            <AlertDescription className={cancelState === 'syncing'
              ? "text-yellow-800 dark:text-yellow-200"
              : "text-green-800 dark:text-green-200"
            }>
              {cancelState === 'syncing' ? (
                <>
                  <strong>Publishing to relays...</strong>
                  <br />
                  Task cancellation is syncing to Nostr relays. This may take a few moments.
                </>
              ) : (
                <>
                  <strong>Success!</strong>
                  <br />
                  Task has been cancelled. No funds were escrowed.
                </>
              )}
            </AlertDescription>
          </Alert>

          <div className="bg-muted p-4 rounded-lg">
            <h4 className="font-medium mb-2">Cancellation Summary</h4>
            <div className="space-y-1 text-sm">
              <p><strong>Task:</strong> {task.content.title}</p>
              <p><strong>Status:</strong> Cancelled (no funds escrowed)</p>
            </div>
          </div>

          {cancelState === 'complete' && (
            <Button onClick={() => {
              invalidateAllCatallaxQueries();
              window.location.reload();
            }} className="w-full">
              Done
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // Show operation state UI (funding, assigning, removing, submitting)
  if (operationState.type && operationState.status !== 'idle') {
    const operationLabels: Record<OperationType, { syncing: string; complete: string; summary: string }> = {
      funding: {
        syncing: 'Funding Task...',
        complete: 'Task Funded!',
        summary: 'Task has been funded. You can now assign a worker.',
      },
      assigning: {
        syncing: 'Assigning Worker...',
        complete: 'Worker Assigned!',
        summary: 'Worker has been assigned and task is now in progress.',
      },
      removing: {
        syncing: 'Removing Worker...',
        complete: 'Worker Removed!',
        summary: 'Worker has been removed. Task is back to funded status.',
      },
      submitting: {
        syncing: 'Submitting Work...',
        complete: 'Work Submitted!',
        summary: 'Work has been submitted for review.',
      },
      'crowdfund-marking': {
        syncing: 'Marking as Funded...',
        complete: 'Crowdfunding Complete!',
        summary: 'Goal reached! Task is now funded and ready for worker assignment.',
      },
    };

    const labels = operationLabels[operationState.type];

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {operationState.status === 'syncing' ? (
              <Loader2 className="h-5 w-5 animate-spin text-yellow-600" />
            ) : (
              <CheckCircle className="h-5 w-5 text-green-600" />
            )}
            {operationState.status === 'syncing' ? labels.syncing : labels.complete}
          </CardTitle>
          <CardDescription>
            {task.content.title}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className={operationState.status === 'syncing'
            ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950"
            : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
          }>
            {operationState.status === 'syncing' ? (
              <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
            ) : (
              <CheckCircle className="h-4 w-4 text-green-600" />
            )}
            <AlertDescription className={operationState.status === 'syncing'
              ? "text-yellow-800 dark:text-yellow-200"
              : "text-green-800 dark:text-green-200"
            }>
              {operationState.status === 'syncing' ? (
                <>
                  <strong>Publishing to relays...</strong>
                  <br />
                  Update is syncing to Nostr relays. This may take a few moments.
                </>
              ) : (
                <>
                  <strong>Success!</strong>
                  <br />
                  {labels.summary}
                </>
              )}
            </AlertDescription>
          </Alert>

          <div className="bg-muted p-4 rounded-lg">
            <h4 className="font-medium mb-2">Task Summary</h4>
            <div className="space-y-1 text-sm">
              <p><strong>Task:</strong> {task.content.title}</p>
              <p><strong>Amount:</strong> {formatSats(task.amount)}</p>
            </div>
          </div>

          {operationState.status === 'complete' && (
            <Button onClick={() => {
              invalidateAllCatallaxQueries();
              window.location.reload();
            }} className="w-full">
              Done
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (showConclusionForm || showDebugConclusionForm) {
    return (
      <div className="space-y-4">
        <Button
          variant="outline"
          onClick={() => {
            setShowConclusionForm(false);
            setShowDebugConclusionForm(false);
          }}
        >
          ← Back to Management
        </Button>
        {showDebugConclusionForm && (
          <Alert>
            <Bug className="h-4 w-4" />
            <AlertDescription>
              <strong>Debug Mode:</strong> Creating a conclusion event for a task that is already marked as "concluded".
              This is for fixing tasks that have status updates but missing conclusion events.
            </AlertDescription>
          </Alert>
        )}
        <TaskConclusionForm
          task={task}
          payoutZapReceiptId={conclusionZapReceiptId}
          onSuccess={() => {
            setShowConclusionForm(false);
            setShowDebugConclusionForm(false);
            setConclusionZapReceiptId('');
            onUpdate?.();
          }}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Manage Task</CardTitle>
            <CardDescription>{task.content.title}</CardDescription>
          </div>
          <Badge className={getStatusColor(task.status)}>
            {task.status.replace('_', ' ')}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium">Amount:</span>
            <p>{formatSats(task.amount)}</p>
          </div>
          <div>
            <span className="font-medium">Status:</span>
            <p className="capitalize">{task.status.replace('_', ' ')}</p>
          </div>
          {task.workerPubkey && (
            <div className="md:col-span-2">
              <span className="font-medium">Worker:</span>
              <p className="font-mono text-xs">{task.workerPubkey}</p>
            </div>
          )}
        </div>

        <Separator />

        {/* Patron Actions */}
        {isPatron && (
          <div className="space-y-4">
            <h4 className="font-medium">Patron Actions</h4>

            {/* Crowdfunding progress section */}
            {task.fundingType === 'crowdfunding' && task.goalId && task.status === 'proposed' && (
              <div className="space-y-3">
                <Alert>
                  <Zap className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Crowdfunding:</strong> This task is being funded by multiple contributors via a NIP-75 Zap Goal.
                    {goalData?.progress.isGoalMet
                      ? ' The goal has been reached! You can now mark this task as funded.'
                      : ' Share the task to attract more contributors.'}
                  </AlertDescription>
                </Alert>
                <GoalProgressBar goalId={task.goalId} />
                <ContributorsList goalId={task.goalId} />
                {goalData?.progress.isGoalMet && (
                  <Button
                    onClick={() => updateTaskStatus('funded', undefined, undefined, 'crowdfund-marking')}
                    disabled={isPending}
                    className="w-full"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Mark as Funded (Goal Reached)
                  </Button>
                )}
              </div>
            )}

            {task.status === 'proposed' && task.arbiterPubkey && task.fundingType !== 'crowdfunding' && (
              <div className="space-y-3">
                <Alert>
                  <Zap className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Fund Escrow:</strong> Click to send Lightning payment to the arbiter.
                    Task status will automatically update to "funded" when payment completes.
                  </AlertDescription>
                </Alert>
                <Button
                  onClick={() => {
                    if (arbiterAcceptsNutzaps) {
                      setShowPaymentMethodForFund(true);
                    } else {
                      setShowFundDialog(true);
                    }
                  }}
                  disabled={isPending}
                  className="w-full"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Fund Escrow ({formatSats(task.amount)})
                </Button>

                {/* Debug: Mark as funded if payment was already made */}
                <div className="pt-2 border-t border-dashed border-orange-200">
                  <Alert className="border-orange-200 bg-orange-50">
                    <Bug className="h-4 w-4 text-orange-600" />
                    <AlertDescription className="text-orange-800">
                      <strong>Already paid?</strong> If you already sent payment but the status didn't update,
                      enter the zap receipt ID below to mark this task as funded with proof of payment.
                    </AlertDescription>
                  </Alert>
                  <div className="mt-2 space-y-2">
                    <Input
                      id="manualZapReceipt"
                      placeholder="Zap receipt event ID (64 hex chars)"
                      className="font-mono text-xs"
                    />
                    <Button
                      onClick={() => {
                        const input = document.getElementById('manualZapReceipt') as HTMLInputElement;
                        const zapId = input?.value?.trim();
                        if (zapId && /^[0-9a-fA-F]{64}$/.test(zapId)) {
                          updateTaskStatus('funded', zapId);
                        } else if (!zapId) {
                          updateTaskStatus('funded');
                        } else {
                          toast({
                            title: 'Invalid ID',
                            description: 'Please enter a valid 64-character hex event ID, or leave empty.',
                            variant: 'destructive',
                          });
                        }
                      }}
                      disabled={isPending}
                      variant="outline"
                      className="w-full border-orange-200 text-orange-700 hover:bg-orange-50"
                    >
                      <Bug className="h-4 w-4 mr-2" />
                      Debug: Mark as Funded
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Worker Assignment - Available for funded, in_progress, and submitted statuses */}
            {(task.status === 'funded' || task.status === 'in_progress' || task.status === 'submitted' || task.zapReceiptId) && (
              <div className="space-y-3">
                <Alert>
                  <Bitcoin className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Assign Worker:</strong> Enter the public key of the worker who will complete this task.
                    {task.status === 'funded' && ' This will update the task status to "in progress".'}
                  </AlertDescription>
                </Alert>
                <div>
                  <Label htmlFor="workerPubkey">
                    {task.workerPubkey ? 'Reassign Worker (Public Key)' : 'Assign Worker (Public Key)'}
                  </Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="workerPubkey"
                      value={workerPubkey}
                      onChange={(e) => setWorkerPubkey(e.target.value)}
                      placeholder={task.workerPubkey || "Worker's public key (hex or npub)"}
                    />
                    <Button
                      onClick={handleAssignWorker}
                      disabled={isPending || !workerPubkey}
                    >
                      {task.workerPubkey ? 'Reassign' : 'Assign'}
                    </Button>
                  </div>
                  {task.workerPubkey && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Current worker: {task.workerPubkey.slice(0, 16)}...
                    </p>
                  )}
                </div>

                {/* Add/Update Zap Receipt - Show if no zap receipt is linked (not needed for crowdfunded tasks) */}
                {!task.zapReceiptId && task.fundingType !== 'crowdfunding' && (
                  <div className="pt-2 border-t border-dashed border-orange-200">
                    <Alert className="border-orange-200 bg-orange-50">
                      <Bug className="h-4 w-4 text-orange-600" />
                      <AlertDescription className="text-orange-800">
                        <strong>Missing zap receipt:</strong> Add the zap receipt ID to link proof of payment.
                      </AlertDescription>
                    </Alert>
                    <div className="mt-2 space-y-2">
                      <Input
                        id="addZapReceipt"
                        placeholder="Zap receipt event ID (64 hex chars)"
                        className="font-mono text-xs"
                      />
                      <Button
                        onClick={() => {
                          const input = document.getElementById('addZapReceipt') as HTMLInputElement;
                          const zapId = input?.value?.trim();
                          if (zapId && /^[0-9a-fA-F]{64}$/.test(zapId)) {
                            updateTaskStatus(task.status, zapId);
                            toast({
                              title: 'Zap Receipt Added',
                              description: 'Task updated with zap receipt reference.',
                            });
                          } else {
                            toast({
                              title: 'Invalid ID',
                              description: 'Please enter a valid 64-character hex event ID.',
                              variant: 'destructive',
                            });
                          }
                        }}
                        disabled={isPending}
                        variant="outline"
                        className="w-full border-orange-200 text-orange-700 hover:bg-orange-50"
                      >
                        <Bug className="h-4 w-4 mr-2" />
                        Add Zap Receipt
                      </Button>
                    </div>
                  </div>
                )}

                {/* Remove Worker - Only show if there's a worker assigned */}
                {task.workerPubkey && (
                  <div className="space-y-2">
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Remove Worker:</strong> This will remove the current worker and set the task status back to "funded".
                      </AlertDescription>
                    </Alert>
                    <Button
                      onClick={handleRemoveWorker}
                      disabled={isPending}
                      variant="destructive"
                      className="w-full"
                    >
                      Remove Worker
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Show message if task is proposed but no arbiter */}
            {task.status === 'proposed' && !task.arbiterPubkey && (
              <Alert>
                <AlertDescription>
                  <strong>No Arbiter:</strong> You need to select an arbiter before you can fund the escrow and assign workers.
                </AlertDescription>
              </Alert>
            )}

            {/* Cancel Task - proposed status (no funds escrowed, patron can cancel directly) */}
            {task.status === 'proposed' && (
              <div className="space-y-3 pt-4 border-t">
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Cancel Task:</strong> If you no longer need this task, you can cancel it. No funds have been escrowed yet.
                  </AlertDescription>
                </Alert>
                <Button
                  onClick={handleCancelTask}
                  disabled={isPending}
                  variant="outline"
                  className="w-full"
                >
                  Cancel Task
                </Button>
              </div>
            )}

            {/* Cancel Task - funded status (funds escrowed, need arbiter to refund) */}
            {task.status === 'funded' && !task.workerPubkey && (
              <div className="space-y-3 pt-4 border-t">
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Need to Cancel?</strong> Since funds are already escrowed with the arbiter, you'll need to contact them to request a cancellation and refund.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>
        )}

        {/* Worker Actions */}
        {isWorker && (
          <div className="space-y-4">
            <h4 className="font-medium">Worker Actions</h4>

            {task.status === 'in_progress' && (
              <Button
                onClick={handleMarkSubmitted}
                disabled={isPending}
              >
                Mark Work as Submitted
              </Button>
            )}
          </div>
        )}

        {/* Arbiter Actions */}
        {isArbiter && ['funded', 'in_progress', 'submitted'].includes(task.status) && (
          <div className="space-y-4">
            <Separator />
            <h4 className="font-medium">Arbiter Actions</h4>

            <Alert>
              <Bitcoin className="h-4 w-4" />
              <AlertDescription>
                As the arbiter, you can either pay the worker (if work is satisfactory)
                or refund {task.fundingType === 'crowdfunding' ? 'the contributors' : 'the patron'} (if work is unsatisfactory or task is cancelled).
                {arbiterAnnouncement && task.fundingType !== 'crowdfunding' && (
                  <>
                    <br /><br />
                    <strong>Fee Structure:</strong> Your {arbiterAnnouncement.feeType === 'flat' ? 'flat' : 'percentage'} fee of{' '}
                    {arbiterAnnouncement.feeType === 'flat'
                      ? formatSats(arbiterAnnouncement.feeAmount)
                      : `${(parseFloat(arbiterAnnouncement.feeAmount) * 100).toFixed(1)}%`
                    } will be paid in addition to the task amount.
                  </>
                )}
                {task.fundingType === 'crowdfunding' && (
                  <>
                    <br /><br />
                    <strong>Crowdfunded Task:</strong> Refunds will be distributed proportionally to all contributors.
                  </>
                )}
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {task.workerPubkey && (
                <Button
                  onClick={() => {
                    if (workerAcceptsNutzaps) {
                      setShowPaymentMethodForPayout(true);
                    } else {
                      handlePayWorkerWithSplit();
                    }
                  }}
                  disabled={isPending}
                  className="w-full"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Pay Worker
                  {arbiterAnnouncement && (
                    <span className="ml-1 text-xs opacity-75">
                      ({formatSats(parseInt(task.amount) + calculateArbiterFee(parseInt(task.amount), arbiterAnnouncement.feeType, arbiterAnnouncement.feeAmount))})
                    </span>
                  )}
                </Button>
              )}

              <Button
                onClick={() => {
                  if (patronAcceptsNutzaps) {
                    setShowPaymentMethodForRefund(true);
                  } else {
                    handleRefundPatronWithSplit();
                  }
                }}
                disabled={isPending}
                variant="outline"
                className="w-full"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {task.fundingType === 'crowdfunding' ? 'Refund Contributors' : 'Refund Patron'}
                {arbiterAnnouncement && task.fundingType !== 'crowdfunding' && (
                  <span className="ml-1 text-xs opacity-75">
                    ({formatSats(parseInt(task.amount) + calculateArbiterFee(parseInt(task.amount), arbiterAnnouncement.feeType, arbiterAnnouncement.feeAmount))})
                  </span>
                )}
                {task.fundingType === 'crowdfunding' && goalData && (
                  <span className="ml-1 text-xs opacity-75">
                    ({formatSats(goalData.progress.raisedSats)})
                  </span>
                )}
              </Button>
            </div>

            {/* Remove Worker - Available to Arbiters */}
            {task.workerPubkey && (
              <div className="space-y-2">
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Remove Worker:</strong> As the arbiter, you can remove the current worker and set the task status back to "funded".
                  </AlertDescription>
                </Alert>
                <Button
                  onClick={handleRemoveWorker}
                  disabled={isPending}
                  variant="destructive"
                  className="w-full"
                >
                  Remove Worker
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Arbiter/Patron Conclusion Actions */}
        {(isArbiter || isPatron) && ['proposed', 'funded', 'submitted', 'in_progress'].includes(task.status) && (
          <div className="space-y-4">
            <Separator />
            <div>
              <h4 className="font-medium mb-2">Conclude Task</h4>
              <Button
                onClick={() => setShowConclusionForm(true)}
                variant="outline"
              >
                Create Task Conclusion
              </Button>
            </div>
          </div>
        )}

        {/* Debug: Create Conclusion for Already Concluded Tasks */}
        {(isArbiter || isPatron) && task.status === 'concluded' && (
          <div className="space-y-4">
            <Separator />
            <div>
              <h4 className="font-medium mb-2 text-orange-600">Debug Actions</h4>
              <Alert className="mb-3">
                <Bug className="h-4 w-4" />
                <AlertDescription>
                  This task is marked as "concluded" but may be missing a conclusion event.
                  Use this debug function to create the missing conclusion event.
                </AlertDescription>
              </Alert>
              <Button
                onClick={handleDebugCreateConclusion}
                variant="outline"
                className="border-orange-200 text-orange-700 hover:bg-orange-50"
              >
                <Bug className="h-4 w-4 mr-2" />
                Debug: Create Additional Conclusion
              </Button>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          <p><strong>Note:</strong> Lightning payments will automatically update task status when confirmed.</p>
        </div>
      </CardContent>

      {/* Split Payment Dialogs */}
      {task.workerPubkey && arbiterAnnouncement && (
        <LightningSplitPaymentDialog
          open={showPayoutSplitDialog}
          onOpenChange={setShowPayoutSplitDialog}
          splits={calculatePaymentSplit(task, arbiterAnnouncement, task.workerPubkey, 'worker')}
          purpose={`Payment for completed work: ${task.content.title}`}
          onPaymentComplete={handlePayWorker}
        />
      )}

      {arbiterAnnouncement && refundSplits.length > 0 && (
        <LightningSplitPaymentDialog
          open={showRefundSplitDialog}
          onOpenChange={setShowRefundSplitDialog}
          splits={refundSplits}
          purpose={`Refund for task: ${task.content.title}`}
          onPaymentComplete={handleRefundPatron}
        />
      )}

      {/* Payment Dialogs */}
      {task.arbiterPubkey && (
        <LightningPaymentDialog
          open={showFundDialog}
          onOpenChange={setShowFundDialog}
          recipientPubkey={task.arbiterPubkey}
          amount={parseInt(task.amount)}
          purpose={`Escrow funding for task: ${task.content.title}`}
          onPaymentComplete={handleFundEscrow}
          eventReference={`${CATALLAX_KINDS.TASK_PROPOSAL}:${task.patronPubkey}:${task.d}`}
        />
      )}

      {task.workerPubkey && (
        <LightningPaymentDialog
          open={showPayoutDialog}
          onOpenChange={setShowPayoutDialog}
          recipientPubkey={task.workerPubkey}
          amount={parseInt(task.amount)}
          purpose={`Payment for completed work: ${task.content.title}`}
          onPaymentComplete={handlePayWorker}
          eventReference={`${CATALLAX_KINDS.TASK_PROPOSAL}:${task.patronPubkey}:${task.d}`}
        />
      )}

      <LightningPaymentDialog
        open={showRefundDialog}
        onOpenChange={setShowRefundDialog}
        recipientPubkey={task.patronPubkey}
        amount={parseInt(task.amount)}
        purpose={`Refund for task: ${task.content.title}`}
        onPaymentComplete={handleRefundPatron}
        eventReference={`${CATALLAX_KINDS.TASK_PROPOSAL}:${task.patronPubkey}:${task.d}`}
      />

      {/* Payment method selector (Lightning vs Nutzap) for fund escrow */}
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

      {task.arbiterPubkey && (
        <NutzapDialog
          open={showNutzapFundDialog}
          onOpenChange={setShowNutzapFundDialog}
          recipientPubkey={task.arbiterPubkey}
          amount={parseInt(task.amount)}
          purpose={`Escrow funding for task: ${task.content.title}`}
          onComplete={(nutzapEventId) => {
            handleFundEscrow(nutzapEventId);
            setShowNutzapFundDialog(false);
          }}
        />
      )}

      {task.workerPubkey && (
        <PaymentMethodSelector
          open={showPaymentMethodForPayout}
          onOpenChange={setShowPaymentMethodForPayout}
          canReceiveNutzap={workerAcceptsNutzaps}
          purpose={`Pay worker for: ${task.content.title}`}
          onSelectLightning={() => {
            setShowPaymentMethodForPayout(false);
            handlePayWorkerWithSplit();
          }}
          onSelectNutzap={() => {
            setShowPaymentMethodForPayout(false);
            setShowNutzapPayoutDialog(true);
          }}
        />
      )}

      {task.workerPubkey && (
        <NutzapDialog
          open={showNutzapPayoutDialog}
          onOpenChange={setShowNutzapPayoutDialog}
          recipientPubkey={task.workerPubkey}
          amount={parseInt(task.amount)}
          purpose={`Payment for completed work: ${task.content.title}`}
          onComplete={(nutzapEventId) => {
            handlePayWorker(nutzapEventId);
            setShowNutzapPayoutDialog(false);
          }}
        />
      )}

      <PaymentMethodSelector
        open={showPaymentMethodForRefund}
        onOpenChange={setShowPaymentMethodForRefund}
        canReceiveNutzap={patronAcceptsNutzaps}
        purpose={`Refund for task: ${task.content.title}`}
        onSelectLightning={() => {
          setShowPaymentMethodForRefund(false);
          handleRefundPatronWithSplit();
        }}
        onSelectNutzap={() => {
          setShowPaymentMethodForRefund(false);
          setShowNutzapRefundDialog(true);
        }}
      />

      <NutzapDialog
        open={showNutzapRefundDialog}
        onOpenChange={setShowNutzapRefundDialog}
        recipientPubkey={task.patronPubkey}
        amount={parseInt(task.amount)}
        purpose={`Refund for task: ${task.content.title}`}
        onComplete={(nutzapEventId) => {
          handleRefundPatron(nutzapEventId);
          setShowNutzapRefundDialog(false);
        }}
      />
    </Card>
  );
}
