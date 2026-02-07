import type { NostrEvent } from '@nostrify/nostrify';
import type { RelayMode } from '@/contexts/AppContext';

/** Returns active relay URLs based on relay mode. */
export function getActiveRelayUrls(
  relayMode: RelayMode,
  customRelay?: string,
  userRelays?: string[],
  presetRelays?: { name: string; url: string }[]
): string[] {
  if (relayMode === 'custom' && customRelay) {
    return [customRelay];
  }

  if (relayMode === 'user' && userRelays && userRelays.length > 0) {
    return userRelays;
  }

  const urls = (presetRelays ?? []).map((r) => r.url);
  return urls.length > 0 ? urls : ['wss://relay.nostr.band'];
}

/** Parse NIP-65 kind 10002 and return relays where the user READS (read marker or no marker). */
export function parseReadRelaysFromNip65(event: NostrEvent): string[] {
  if (event.kind !== 10002) return [];

  const relays: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'r') continue;
    const url = tag[1];
    const marker = tag[2];

    // read = explicit read; no marker = read+write
    if (!marker || marker === 'read') {
      relays.push(url);
    }
  }
  return relays;
}

/** Normalize relay URL for deduplication: wss:, lowercase host, no trailing slash. */
export function normalizeRelayUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = 'wss:';
    u.hostname = u.hostname.toLowerCase();
    let normalized = u.toString();
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return '';
  }
}

/** Merge relay arrays and deduplicate by normalized URL. Preserves first occurrence order. */
export function mergeAndDeduplicateRelays(...relayArrays: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const arr of relayArrays) {
    for (const url of arr) {
      const normalized = normalizeRelayUrl(url);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        result.push(url);
      }
    }
  }
  return result;
}
