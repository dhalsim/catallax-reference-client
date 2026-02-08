import type { NostrEvent } from '@nostrify/nostrify';

// Catallax Event Kinds
export const CATALLAX_KINDS = {
  ARBITER_ANNOUNCEMENT: 33400,
  TASK_PROPOSAL: 33401,
  TASK_CONCLUSION: 3402,
} as const;

// Status Types
export type TaskStatus = 'proposed' | 'funded' | 'in_progress' | 'submitted' | 'concluded';
export type ResolutionType = 'successful' | 'rejected' | 'cancelled' | 'abandoned';
export type FeeType = 'flat' | 'percentage';
export type FundingType = 'single' | 'crowdfunding';

// Content Interfaces
export interface ArbiterAnnouncementContent {
  name: string;
  about?: string;
  policy_text?: string;
  policy_url?: string;
}

export interface TaskProposalContent {
  title: string;
  description: string;
  requirements: string;
  deadline?: number; // Unix timestamp
}

export interface TaskConclusionContent {
  resolution_details: string;
}

// Parsed Event Interfaces
export interface ArbiterAnnouncement {
  id: string;
  pubkey: string;
  created_at: number;
  content: ArbiterAnnouncementContent;
  d: string;
  arbiterPubkey: string;
  detailsUrl?: string;
  categories: string[];
  feeType: FeeType;
  feeAmount: string;
  minAmount?: string;
  maxAmount?: string;
}

export interface TaskProposal {
  id: string;
  pubkey: string;
  created_at: number;
  content: TaskProposalContent;
  d: string;
  patronPubkey: string;
  arbiterPubkey?: string;
  workerPubkey?: string;
  arbiterService?: string;
  amount: string;
  categories: string[];
  status: TaskStatus;
  zapReceiptId?: string;
  receiptType?: 'zap' | 'nutzap';
  detailsUrl?: string;
  fundingType: FundingType;
  goalId?: string;
}

// NIP-75 Zap Goal Types
export interface GoalContributor {
  pubkey: string;
  zapReceiptId: string;
  amountSats: number;
  percentage: number;
  timestamp: number;
}

export interface GoalProgress {
  goalId: string;
  targetSats: number;
  raisedSats: number;
  percentComplete: number;
  isGoalMet: boolean;
  contributors: GoalContributor[];
}

export interface RefundSplit {
  recipientPubkey: string;
  amountSats: number;
  originalContribution: number;
  proportion: number;
}

export interface TaskConclusion {
  id: string;
  pubkey: string;
  created_at: number;
  content: TaskConclusionContent;
  payoutZapReceiptId?: string;
  taskProposalId?: string;
  patronPubkey?: string;
  arbiterPubkey?: string;
  workerPubkey?: string;
  resolution: ResolutionType;
  taskReference?: string;
}

// Utility Functions
export function parseArbiterAnnouncement(event: NostrEvent): ArbiterAnnouncement | null {
  try {
    const content = JSON.parse(event.content) as ArbiterAnnouncementContent;

    const d = event.tags.find(([name]) => name === 'd')?.[1];
    const arbiterPubkey = event.tags.find(([name]) => name === 'p')?.[1];
    const detailsUrl = event.tags.find(([name]) => name === 'r')?.[1];
    const categories = event.tags.filter(([name]) => name === 't').map(([, value]) => value);
    const feeType = event.tags.find(([name]) => name === 'fee_type')?.[1] as FeeType;
    const feeAmount = event.tags.find(([name]) => name === 'fee_amount')?.[1];
    const minAmount = event.tags.find(([name]) => name === 'min_amount')?.[1];
    const maxAmount = event.tags.find(([name]) => name === 'max_amount')?.[1];

    if (!d || !arbiterPubkey || !feeType || !feeAmount) {
      return null;
    }

    return {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      content,
      d,
      arbiterPubkey,
      detailsUrl,
      categories,
      feeType,
      feeAmount,
      minAmount,
      maxAmount,
    };
  } catch {
    return null;
  }
}

export function parseTaskProposal(event: NostrEvent): TaskProposal | null {
  try {
    const content = JSON.parse(event.content) as TaskProposalContent;

    const d = event.tags.find(([name]) => name === 'd')?.[1];
    const pTags = event.tags.filter(([name]) => name === 'p');
    const patronPubkey = pTags[0]?.[1];
    const arbiterPubkey = pTags[1]?.[1];
    const workerPubkey = pTags[2]?.[1];

    const arbiterService = event.tags.find(([name]) => name === 'a')?.[1];
    const amount = event.tags.find(([name]) => name === 'amount')?.[1];
    const categories = event.tags.filter(([name]) => name === 't').map(([, value]) => value);
    const status = event.tags.find(([name]) => name === 'status')?.[1] as TaskStatus;
    const receiptETag = event.tags.find(([name, , , marker]) => name === 'e' && (marker === 'zap' || marker === 'nutzap'));
    const zapReceiptId = receiptETag?.[1];
    const receiptType = receiptETag?.[3] === 'nutzap' ? 'nutzap' : (receiptETag?.[3] === 'zap' ? 'zap' : undefined);
    const detailsUrl = event.tags.find(([name]) => name === 'r')?.[1];

    // NIP-75 crowdfunding fields
    const fundingType = (event.tags.find(([name]) => name === 'funding_type')?.[1] as FundingType) || 'single';
    const goalTag = event.tags.find(([name]) => name === 'goal');
    const goalId = goalTag?.[1];

    if (!d || !patronPubkey || !amount || !status) {
      return null;
    }

    return {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      content,
      d,
      patronPubkey,
      arbiterPubkey,
      workerPubkey,
      arbiterService,
      amount,
      categories,
      status,
      zapReceiptId,
      receiptType,
      detailsUrl,
      fundingType,
      goalId,
    };
  } catch {
    return null;
  }
}

export function parseTaskConclusion(event: NostrEvent): TaskConclusion | null {
  try {
    const content = JSON.parse(event.content) as TaskConclusionContent;

    const eTags = event.tags.filter(([name]) => name === 'e');
    const payoutZapReceiptId = eTags[0]?.[1];
    const taskProposalId = eTags[1]?.[1];

    const pTags = event.tags.filter(([name]) => name === 'p');
    const patronPubkey = pTags[0]?.[1];
    const arbiterPubkey = pTags[1]?.[1];
    const workerPubkey = pTags[2]?.[1];

    const resolution = event.tags.find(([name]) => name === 'resolution')?.[1] as ResolutionType;
    const taskReference = event.tags.find(([name]) => name === 'a')?.[1];

    if (!resolution) {
      return null;
    }

    return {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      content,
      payoutZapReceiptId,
      taskProposalId,
      patronPubkey,
      arbiterPubkey,
      workerPubkey,
      resolution,
      taskReference,
    };
  } catch {
    return null;
  }
}

export function formatSats(sats: string | number): string {
  const amount = typeof sats === 'string' ? parseInt(sats) : sats;
  if (amount >= 100000000) {
    return `${(amount / 100000000).toFixed(2)} BTC`;
  }
  return `${amount.toLocaleString()} sats`;
}

export function formatFee(feeType: FeeType, feeAmount: string): string {
  if (feeType === 'flat') {
    return `${formatSats(feeAmount)} fee`;
  }
  const percentage = parseFloat(feeAmount) * 100;
  return `${percentage}% fee`;
}

export function generateTaskId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  const timestamp = Date.now().toString().slice(-6);
  return `${slug}-${timestamp}`;
}

export function generateServiceId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  return `${slug}-service`;
}

export function getStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'proposed': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    case 'funded': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    case 'in_progress': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
    case 'submitted': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
    case 'concluded': return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
  }
}

export function getResolutionColor(resolution: ResolutionType): string {
  switch (resolution) {
    case 'successful': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    case 'rejected': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
    case 'cancelled': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
    case 'abandoned': return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
  }
}

export interface PaymentSplit {
  recipientPubkey: string;
  amount: number; // in sats
  weight: number; // for zap split
  purpose: string;
}

export function calculateArbiterFee(taskAmount: number, feeType: FeeType, feeAmount: string): number {
  if (feeType === 'flat') {
    return parseInt(feeAmount);
  } else {
    // Percentage fee
    const percentage = parseFloat(feeAmount);
    return Math.floor(taskAmount * percentage);
  }
}

// NIP-75 Zap Goal Utilities

export function buildGoalEventTags(
  task: { title: string; description: string; amount: string; d: string },
  patronPubkey: string,
  arbiterPubkey: string,
  relays: string[],
): string[][] {
  const targetMsats = (parseInt(task.amount) * 1000).toString();

  return [
    ['relays', ...relays],
    ['amount', targetMsats],
    ['summary', task.description.slice(0, 200)],
    ['a', `33401:${patronPubkey}:${task.d}`, relays[0] || ''],
    ['zap', arbiterPubkey, relays[0] || '', '1'],
    ['alt', `Crowdfunding goal for Catallax task: ${task.title}`],
  ];
}

export function parseZapReceiptAmount(receipt: NostrEvent): number {
  // Per NIP-57, the amount is in the zap request inside the description tag
  const descTag = receipt.tags.find(([name]) => name === 'description');
  if (descTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descTag[1]) as NostrEvent;
      const amountTag = zapRequest.tags.find(([name]) => name === 'amount');
      if (amountTag?.[1]) {
        return parseInt(amountTag[1]);
      }
    } catch {
      // Fall through to return 0
    }
  }
  return 0;
}

export function parseZapReceiptSender(receipt: NostrEvent): string | null {
  // The zap receipt contains the original zap request in the 'description' tag
  const descTag = receipt.tags.find(([name]) => name === 'description');
  if (!descTag?.[1]) return null;

  try {
    const zapRequest = JSON.parse(descTag[1]) as NostrEvent;
    return zapRequest.pubkey;
  } catch {
    return null;
  }
}

export function calculateGoalProgress(
  goal: NostrEvent,
  receipts: NostrEvent[],
): GoalProgress {
  // Parse target from goal
  const amountTag = goal.tags.find(([name]) => name === 'amount');
  const targetMsats = parseInt(amountTag?.[1] || '0');
  const targetSats = Math.floor(targetMsats / 1000);

  // Parse contributors from receipts
  const contributors: GoalContributor[] = [];
  let totalRaisedMsats = 0;

  for (const receipt of receipts) {
    const amountMsats = parseZapReceiptAmount(receipt);
    if (amountMsats <= 0) continue;

    const senderPubkey = parseZapReceiptSender(receipt);
    if (!senderPubkey) continue;

    totalRaisedMsats += amountMsats;

    // Aggregate multiple zaps from the same sender
    const existing = contributors.find((c) => c.pubkey === senderPubkey);
    if (existing) {
      existing.amountSats += Math.floor(amountMsats / 1000);
    } else {
      contributors.push({
        pubkey: senderPubkey,
        zapReceiptId: receipt.id,
        amountSats: Math.floor(amountMsats / 1000),
        percentage: 0,
        timestamp: receipt.created_at,
      });
    }
  }

  const raisedSats = Math.floor(totalRaisedMsats / 1000);

  // Calculate percentages
  for (const contributor of contributors) {
    contributor.percentage = raisedSats > 0 ? contributor.amountSats / raisedSats : 0;
  }

  // Sort by amount descending
  contributors.sort((a, b) => b.amountSats - a.amountSats);

  return {
    goalId: goal.id,
    targetSats,
    raisedSats,
    percentComplete: targetSats > 0 ? Math.min((raisedSats / targetSats) * 100, 100) : 0,
    isGoalMet: raisedSats >= targetSats,
    contributors,
  };
}

export function calculateCrowdfundingRefunds(
  contributors: GoalContributor[],
  arbiter: ArbiterAnnouncement,
  taskAmount: number,
  refundType: 'rejected' | 'cancelled',
): RefundSplit[] {
  const totalRaised = contributors.reduce((sum, c) => sum + c.amountSats, 0);

  // For cancellation: full refunds, no arbiter fee
  // For rejection: arbiter keeps their fee
  const arbiterFee =
    refundType === 'cancelled'
      ? 0
      : calculateArbiterFee(taskAmount, arbiter.feeType, arbiter.feeAmount);

  const refundPool = totalRaised - arbiterFee;

  return contributors.map((c) => {
    const proportion = c.amountSats / totalRaised;
    const refundAmount = Math.floor(refundPool * proportion);

    return {
      recipientPubkey: c.pubkey,
      amountSats: refundAmount,
      originalContribution: c.amountSats,
      proportion,
    };
  });
}

export function calculatePaymentSplit(
  task: TaskProposal,
  arbiter: ArbiterAnnouncement,
  recipientPubkey: string,
  paymentType: 'worker' | 'patron'
): PaymentSplit[] {
  const taskAmount = parseInt(task.amount);
  const arbiterFee = calculateArbiterFee(taskAmount, arbiter.feeType, arbiter.feeAmount);

  const splits: PaymentSplit[] = [];

  if (paymentType === 'worker') {
    // Worker gets the full task amount
    splits.push({
      recipientPubkey,
      amount: taskAmount,
      weight: taskAmount,
      purpose: `Payment for completed work: ${task.content.title}`,
    });

    // Arbiter gets their fee as additional amount
    if (arbiterFee > 0) {
      splits.push({
        recipientPubkey: task.arbiterPubkey!,
        amount: arbiterFee,
        weight: arbiterFee,
        purpose: `Arbiter fee for task: ${task.content.title}`,
      });
    }
  } else {
    // For refunds, patron gets the full task amount back
    splits.push({
      recipientPubkey,
      amount: taskAmount,
      weight: taskAmount,
      purpose: `Refund for task: ${task.content.title}`,
    });

    // Arbiter still gets their fee for arbitration service
    if (arbiterFee > 0) {
      splits.push({
        recipientPubkey: task.arbiterPubkey!,
        amount: arbiterFee,
        weight: arbiterFee,
        purpose: `Arbiter fee for task: ${task.content.title}`,
      });
    }
  }

  return splits;
}