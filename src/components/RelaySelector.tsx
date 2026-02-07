import { Check, ChevronsUpDown, Wifi, Plus, RotateCcw, User, Globe, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUserRelays } from "@/hooks/useUserRelays";
import { useActiveRelayUrls } from "@/hooks/useActiveRelayUrls";

interface RelaySelectorProps {
  className?: string;
}

export function RelaySelector(props: RelaySelectorProps) {
  const { className } = props;
  const { config, updateConfig, presetRelays = [] } = useAppContext();
  const { user } = useCurrentUser();
  const { data: fetchedUserRelays, isLoading: isLoadingUserRelays } = useUserRelays(user?.pubkey);

  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");

  const relayMode = config.relayMode ?? 'default';
  const activeRelayUrls = useActiveRelayUrls();

  // Derive { name, url }[] for display from activeRelayUrls
  const activeRelays: { name: string; url: string }[] =
    relayMode === 'custom'
      ? [{ name: 'Custom', url: activeRelayUrls[0] ?? '' }]
      : relayMode === 'user'
        ? activeRelayUrls.map((url) => ({
            name: url.replace(/^wss?:\/\//, '').split('/')[0],
            url,
          }))
        : presetRelays;

  // Normalize relay URL
  const normalizeRelayUrl = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return trimmed;
    if (trimmed.includes('://')) return trimmed;
    return `wss://${trimmed}`;
  };

  // Validate relay URL
  const isValidRelayUrl = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    try {
      new URL(normalizeRelayUrl(trimmed));
      return true;
    } catch {
      return false;
    }
  };

  // Switch to user's relays
  const handleUseMyRelays = () => {
    if (!fetchedUserRelays || fetchedUserRelays.length === 0) return;

    updateConfig((current) => ({
      ...current,
      relayMode: 'user',
      userRelays: fetchedUserRelays,
    }));
  };

  // Switch to default relays
  const handleUseDefaultRelays = () => {
    updateConfig((current) => ({
      ...current,
      relayMode: 'default',
    }));
  };

  // Set custom single relay
  const handleSetCustomRelay = () => {
    if (!isValidRelayUrl(customInput)) return;

    updateConfig((current) => ({
      ...current,
      relayMode: 'custom',
      customRelay: normalizeRelayUrl(customInput),
    }));
    setCustomInput("");
  };

  // Get label for the button
  const getButtonLabel = (): string => {
    if (relayMode === 'custom') {
      return config.customRelay?.replace(/^wss?:\/\//, '') ?? 'Custom relay';
    }
    if (relayMode === 'user') {
      return `My relays (${activeRelays.length})`;
    }
    return `${activeRelays.length} ${activeRelays.length === 1 ? 'relay' : 'relays'}`;
  };

  // Get mode description
  const getModeDescription = (): string => {
    if (relayMode === 'custom') {
      return 'Using single custom relay:';
    }
    if (relayMode === 'user') {
      return 'Using your NIP-65 relays:';
    }
    return 'Using default relays:';
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
        >
          <div className="flex items-center gap-2">
            {relayMode === 'user' ? (
              <User className="h-4 w-4" />
            ) : relayMode === 'custom' ? (
              <Globe className="h-4 w-4" />
            ) : (
              <Wifi className="h-4 w-4" />
            )}
            <span className="truncate">{getButtonLabel()}</span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0">
        <div className="p-3 space-y-3">
          {/* Mode description and relay list */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              {getModeDescription()}
            </p>
            {activeRelays.length > 8 && (
              <div className="flex items-center gap-2 px-2 py-1.5 mb-2 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                <span className="text-xs text-yellow-600 dark:text-yellow-400">
                  Many relays may slow down queries
                </span>
              </div>
            )}
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {activeRelays.map((relay) => (
                <div
                  key={relay.url}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50"
                >
                  <Check className="h-4 w-4 text-green-500 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-sm truncate">{relay.name}</span>
                    <span className="text-xs text-muted-foreground truncate">{relay.url}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Mode switching buttons */}
          <div className="space-y-2">
            {/* Show "Use my relays" when logged in and NOT in user mode */}
            {user && relayMode !== 'user' && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleUseMyRelays}
                disabled={isLoadingUserRelays || !fetchedUserRelays || fetchedUserRelays.length === 0}
              >
                <User className="h-4 w-4 mr-2" />
                {isLoadingUserRelays ? 'Loading relays...' :
                 (!fetchedUserRelays || fetchedUserRelays.length === 0) ? 'No relays found' :
                 `Use my relays (${fetchedUserRelays.length})`}
              </Button>
            )}

            {/* Show "Use default relays" when in user or custom mode */}
            {relayMode !== 'default' && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleUseDefaultRelays}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Use default relays
              </Button>
            )}
          </div>

          <Separator />

          {/* Custom relay input */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Connect to a single relay:
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="wss://relay.example.com"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSetCustomRelay();
                  }
                }}
                className="flex-1 text-sm"
              />
              <Button
                size="sm"
                onClick={handleSetCustomRelay}
                disabled={!isValidRelayUrl(customInput)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
