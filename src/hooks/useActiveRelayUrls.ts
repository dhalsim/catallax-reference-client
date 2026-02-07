import { useAppContext } from '@/hooks/useAppContext';
import { getActiveRelayUrls } from '@/lib/relays';

/** Returns the app's active relay URLs based on current config (custom, user NIP-65, or preset). */
export function useActiveRelayUrls(): string[] {
  const { config, presetRelays = [] } = useAppContext();
  return getActiveRelayUrls(
    config.relayMode ?? 'default',
    config.customRelay,
    config.userRelays,
    presetRelays
  );
}
