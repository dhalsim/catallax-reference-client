import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface PendingToken {
  id: string;
  encodedToken: string;
  amount: number;
  unit: string;
  mintUrl: string;
  createdAt: number;
  /** Kind 7376 event id for this send (links to history). */
  historyEventId?: string;
}

const STORAGE_KEY = 'nutzap-pending-tokens';
const QUERY_KEY = ['nutzap-pending-tokens'];

function loadFromStorage(): PendingToken[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    
    if (!raw) return [];
    
    const parsed = JSON.parse(raw) as PendingToken[];
    
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(tokens: PendingToken[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function usePendingTokens() {
  const queryClient = useQueryClient();

  const { data: tokens = [] } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: loadFromStorage,
    staleTime: 0,
  });

  const addPending = (
    token: Omit<PendingToken, 'id' | 'createdAt'> & {
      historyEventId?: string;
    }
  ) => {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const full: PendingToken = { ...token, id, createdAt };
    const next = [full, ...loadFromStorage()];
    saveToStorage(next);
    queryClient.setQueryData(QUERY_KEY, next);
  };

  const removePending = (id: string) => {
    const next = loadFromStorage().filter((t) => t.id !== id);
    saveToStorage(next);
    queryClient.setQueryData(QUERY_KEY, next);
  };

  const getPendingForMint = (mintUrl: string) =>
    tokens.filter((t) => t.mintUrl === mintUrl);

  return {
    pendingTokens: tokens,
    getPendingForMint,
    addPending,
    removePending,
  };
}
