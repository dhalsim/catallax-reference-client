import React, { useEffect, useRef } from 'react';
import { NostrEvent, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';
import { getActiveRelayUrls } from '@/lib/relays';
import { RelayMode } from '@/contexts/AppContext';

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config, presetRelays } = useAppContext();

  const queryClient = useQueryClient();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Use refs so the pool always has the latest data
  const relayModeRef = useRef<RelayMode>(config.relayMode ?? 'default');
  const customRelayRef = useRef<string | undefined>(config.customRelay);
  const userRelaysRef = useRef<string[] | undefined>(config.userRelays);
  const presetRelaysRef = useRef(presetRelays);

  // Update refs when config changes
  useEffect(() => {
    relayModeRef.current = config.relayMode ?? 'default';
    customRelayRef.current = config.customRelay;
    userRelaysRef.current = config.userRelays;
    presetRelaysRef.current = presetRelays;
    queryClient.resetQueries();
  }, [config.relayMode, config.customRelay, config.userRelays, presetRelays, queryClient]);

  // Initialize NPool only once
  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url);
      },
      reqRouter(filters) {
        const relays = getActiveRelayUrls(
          relayModeRef.current,
          customRelayRef.current,
          userRelaysRef.current,
          presetRelaysRef.current
        );
        return new Map(relays.map(url => [url, filters]));
      },
      eventRouter(_event: NostrEvent) {
        return getActiveRelayUrls(
          relayModeRef.current,
          customRelayRef.current,
          userRelaysRef.current,
          presetRelaysRef.current
        );
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;
