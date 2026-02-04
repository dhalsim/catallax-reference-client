---
name: Nutzap relays and mints
overview: Add two relay sets (receiving vs wallet) with clear UI and data structures, remove wallet/config mint sync if not needed, and ensure all Nutzap kind query/publish sites use the correct relays and mints.
todos: []
isProject: false
---

# Nutzap relay sets, data structures, sync removal, and correct usage

## 1. Two relay sets in UI and clarity for the user

**Current state:** [NutzapConfigForm.tsx](src/components/NutzapConfigForm.tsx) has a single relay list labeled "Relays (where you receive nutzaps)" (line 181). There is no "wallet relays" set. So we do **not** currently have two sets defined in the form.

**Recommendation:**

- **Receiving relays** (for kinds 10019, 9321): Keep and clarify. Label and help text should state that these are where you receive nutzaps and where senders publish payments (per NIP-61). Optional short description: "Senders will publish nutzaps to these relays; you subscribe here for incoming payments."
- **Wallet relays** (for kinds 17375, 7375, 7376): Use the **app's active relay set** (no separate UI or storage). Same relays the user has already chosen in [RelaySelector](src/components/RelaySelector.tsx): either preset relays ([App.tsx](src/App.tsx) / [AppProvider](src/components/AppProvider.tsx)), NIP-65 user relays (kind 10002), or custom relay. Wallet hooks get this list via a small hook (e.g. `useActiveRelayUrls()`) and pass it as `relays` for wallet-kind operations.

Receiving relays are stored in kind 10019 (already). Wallet relays are not stored anywhere new — they are derived from app config at runtime.

---

## 2. Data structure for both relay sets

**Current state:**

- **NutzapConfig** in [nutzap.ts](src/lib/nutzap.ts) has `relays`, `mints`, `p2pkPubkey` — this is the 10019 payload. Only "receiving" relays are stored.
- Kind 17375 (NIP-60) does not define a relay list. Wallet relays are client policy.

**Wallet relays — use app relays (no new data structure):**

- **Wallet relays = app's active relay set.** Use the same relay list the app already uses for global Nostr traffic: the user's choice in [RelaySelector](src/components/RelaySelector.tsx) — preset relays from [App.tsx](src/App.tsx) (e.g. Ditto, Nostr.Band, Damus, Primal), or NIP-65 user relays (kind 10002), or a single custom relay. This lives in [AppContext](src/contexts/AppContext.ts) (`relayMode`, `customRelay`, `userRelays`) and `presetRelays` from [AppProvider](src/components/AppProvider.tsx). No new storage or Nutzap-specific relay list.
- **Implementation:** Add a hook (e.g. `useActiveRelayUrls(): string[]`) that reads from `useAppContext()` and returns the same URL list that [NostrProvider](src/components/NostrProvider.tsx) uses in its `getActiveRelays()` (custom → `[config.customRelay]`, user → `config.userRelays`, default → `presetRelays.map(r => r.url)`). Nutzap wallet hooks call this and pass `relays` to `nostr.query` / `nostr.event`.

**Data structure changes:**

- **Receiving relays:** Remain in 10019 only. No change to `NutzapConfig` for relays; it already has `relays` for receiving.
- **Wallet relays:** No new field. Use `useActiveRelayUrls()` (or equivalent) wherever wallet kinds (17375, 7375, 7376) are queried or published.

---

## 3. Sync wallet and config mints: remove sync and separate UI/data

**Current behavior:** On "Publish configuration" in [NutzapConfigForm.tsx](src/components/NutzapConfigForm.tsx), if the user has a wallet, the app calls `useUpdateNutzapWalletMints` to merge the form’s mints into the kind 17375 mints, then publishes 10019. So config mints and wallet mints are kept in sync.

**Conclusion:** Sync is not strictly required by NIP-60/61. Receiving (10019) mints = "mints I accept nutzaps on." Wallet (17375) mints = "mints my wallet knows about" (for storing tokens). They can differ; e.g. you might add a mint to receiving before ever having a balance there. So we can **remove sync** and separate the two concepts.

**Planned changes:**

- **Remove:** [useUpdateNutzapWalletMints.ts](src/hooks/useUpdateNutzapWalletMints.ts) — delete this hook (or keep the file but stop using it for "sync on config publish").
- **NutzapConfigForm:** Remove `useUpdateNutzapWalletMints` and the call that runs before publishing 10019. Form only publishes kind 10019 with receiving relays and receiving mints. Remove any "wallet mints updated" copy.
- **UI/data separation:**
  - **Receiving (10019):** One section: "Relays (where you receive nutzaps)", "Trusted mints (mints you accept nutzaps on)". Stored in 10019.
  - **Wallet (17375):** Wallet mints are only updated when creating a wallet or via a dedicated "Edit wallet mints" flow (if you add one). [NutzapWalletSetup](src/components/NutzapWalletSetup.tsx) currently seeds wallet creation from config mints (lines 62–64); that can stay as a one-time initial seed when creating the wallet, but publishing 10019 no longer updates 17375.
- **Use correct mints per context:**
  - **Incoming 9321, verification:** Use **config (10019) mints** only — already done in [useIncomingNutzaps.ts](src/hooks/useIncomingNutzaps.ts) (`myConfig.mints`).
  - **Sending nutzap:** Recipient’s **config mints** for which mints they accept; our **wallet mints + tokens** for balance — already the case in [useNutzap.ts](src/hooks/useNutzap.ts).
  - **17375 / 7375 / 7376:** Use **wallet mints** only (from 17375 content); no reference to 10019 mints for wallet operations.
- **Docs:** Update [NIP.md](NIP.md) to drop the sentence that says the client updates 17375 when publishing 10019; state that receiving config (10019) and wallet (17375) mints are independent.

---

## 4. Use correct relays (and mints) at each query/publish site

The Nostr pool in this app supports passing `relays` in options: `nostr.query(filters, { signal, relays })` and `nostr.event(event, { signal, relays })` (see [NPool](node_modules/@nostrify/nostrify/NPool.ts) `query` and `event`). So we can pass the appropriate relay set per call without changing NostrProvider.

**Mapping:**


| Kind(s)           | Role                         | Relays to use    | Mints to use                                                     |
| ----------------- | ---------------------------- | ---------------- | ---------------------------------------------------------------- |
| 10019             | Receive config               | Receiving relays | N/A (config stores mints)                                        |
| 9321              | Nutzap payment               | Receiving relays | Config mints for #u (recipient); wallet mints for sender balance |
| 17375, 7375, 7376 | Wallet / tokens / redemption | Wallet relays    | Wallet mints (from 17375)                                        |


**Sites to update:**

1. **[useNutzapConfig.ts](src/hooks/useNutzapConfig.ts)** — Query 10019: pass `relays: receivingRelays`. Receiving relays must come from somewhere: for "my config" use the same default or app preset used in the form; for "other’s config" we don’t have their relays yet, so either use app default relays or a shared default list (e.g. `DEFAULT_RECEIVING_RELAYS` in nutzap.ts).
2. **[useNutzap.ts](src/hooks/useNutzap.ts)** — Query 10019 for recipient: use a default receiving relay set (or later, a discovered set). Publish 9321: use **recipient’s** receiving relays from the fetched 10019 (`config.relays`).
3. **[useIncomingNutzaps.ts](src/hooks/useIncomingNutzaps.ts)** — Query 7376 and 9321: use **my** receiving relays (from my config, or default). Mints: already uses `myConfig.mints` for `#u` — correct.
4. **[useNutzapWallet.ts](src/hooks/useNutzapWallet.ts)** — Query 17375 and 7375: pass **wallet relays** from `useActiveRelayUrls()` (app active relay set).
5. **[useRedeemNutzap.ts](src/hooks/useRedeemNutzap.ts)** — Query 17375 and publish 7375/7376: wallet relays from `useActiveRelayUrls()`.
6. **[useUpdateNutzapWalletMints.ts](src/hooks/useUpdateNutzapWalletMints.ts)** — Remove (sync removed). If you keep a "wallet mints only" update flow later, it would use `useActiveRelayUrls()` for query + publish 17375.
7. **[useCreateNutzapWallet.ts](src/hooks/useCreateNutzapWallet.ts)** — Publish 17375: wallet relays from `useActiveRelayUrls()`.
8. **NutzapConfigForm** — Publish 10019: use the form’s receiving relay list only. No wallet relay section, no `wallet_relay` tags. No wallet mint update.

**Relay source of truth:**

- **Receiving:** In [nutzap.ts](src/lib/nutzap.ts): `DEFAULT_RECEIVING_RELAYS` (e.g. `['wss://relay.nostr.band']`) and `getReceivingRelays(config?: NutzapConfig | null): string[]` — `config?.relays?.length ? config.relays : DEFAULT_RECEIVING_RELAYS`. Used when we have a config (my or recipient's) or when querying 10019 for an unknown pubkey (use default).
- **Wallet:** New hook `useActiveRelayUrls(): string[]` that returns the app's active relay URLs (same logic as NostrProvider / RelaySelector: preset, NIP-65 user, or custom). Used for all 17375, 7375, 7376 operations. No `DEFAULT_WALLET_RELAYS` constant; wallet relays are always the app choice.



---

## Summary of file-level changes


| File                                                                               | Action                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/nutzap.ts](src/lib/nutzap.ts)                                             | Add `DEFAULT_RECEIVING_RELAYS` and `getReceivingRelays(config?)`. No `walletRelays` on NutzapConfig.                                                                                                                          |
| [src/components/NutzapConfigForm.tsx](src/components/NutzapConfigForm.tsx)         | Remove `useUpdateNutzapWalletMints` and sync call; clarify label/description for "Relays (where you receive nutzaps)" only. No wallet relay section.                                                                   |
| [src/hooks/useNutzapConfig.ts](src/hooks/useNutzapConfig.ts)                       | Pass `relays: getReceivingRelays()` or default when querying 10019.                                                                                                                                                                                  |
| [src/hooks/useNutzap.ts](src/hooks/useNutzap.ts)                                   | Query 10019 with default receiving relays; publish 9321 with `config.relays`.                                                                                                                                                                        |
| [src/hooks/useIncomingNutzaps.ts](src/hooks/useIncomingNutzaps.ts)                 | Query 7376 and 9321 with receiving relays from my config (or default).                                                                                                                                                                               |
| [src/hooks/useNutzapWallet.ts](src/hooks/useNutzapWallet.ts)                       | Query 17375 and 7375 with wallet relays from `useActiveRelayUrls()`.                                                                                                                                                                                 |
| [src/hooks/useRedeemNutzap.ts](src/hooks/useRedeemNutzap.ts)                       | Query 17375 and publish 7375/7376 with wallet relays from `useActiveRelayUrls()`.                                                                                                                                                                    |
| [src/hooks/useCreateNutzapWallet.ts](src/hooks/useCreateNutzapWallet.ts)           | Publish 17375 with wallet relays from `useActiveRelayUrls()`.                                                                                                                                                                                        |
| [src/hooks/useUpdateNutzapWalletMints.ts](src/hooks/useUpdateNutzapWalletMints.ts) | Remove (or repurpose later for "edit wallet mints only" with wallet relays).                                                                                                                                                                         |
| [src/hooks/useNostrPublish.ts](src/hooks/useNostrPublish.ts)                       | Either extend to accept optional `relays` and pass to `nostr.event(..., { relays })`, or add a Nutzap-specific publish path that passes relays (preferred: extend useNostrPublish or have Nutzap hooks call `nostr.event` with relays where needed). |
| [NIP.md](NIP.md)                                                                   | Update to describe two relay sets and that 10019/17375 mints are not synced.                                                                                                                                                                         |


**Note:** If `useNostrPublish` does not currently accept `relays`, it must be extended so that Nutzap publish callers (NutzapConfigForm, useNutzap, useRedeemNutzap, useCreateNutzapWallet) can pass the correct relay set. The mutation would pass `relays` through to `nostr.event(event, { signal, relays })` when provided (e.g. by event kind or an optional argument).

---

## Optional: Kind-to-relay-set map

In [nutzap.ts](src/lib/nutzap.ts) you can export a small map or helpers so call sites stay consistent:

```ts
export const NUTZAP_RECEIVING_KINDS = [NUTZAP_CONFIG_KIND, NUTZAP_EVENT_KIND] as const;
export const NUTZAP_WALLET_KINDS = [NUTZAP_WALLET_KIND, NUTZAP_TOKEN_KIND, NUTZAP_REDEMPTION_KIND] as const;
```

Then each hook chooses receiving vs wallet relays based on the kind it’s querying/publishing.