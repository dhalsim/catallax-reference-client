# Nutzaps – Open todos

## 1. Task Conclusion event: add nutzap support (NIP)

**Ref:** `NIP.md` lines 98–99 (Task Conclusion kind 3402).

The protocol already defines the payout-receipt `e` tag with a fourth element `<zap|nutzap>`. The client does not yet implement this.

**Todo:**

- **Publishing:** When publishing a Task Conclusion (kind 3402), the payout-receipt `e` tag must include the fourth element:
  - `"zap"` when the payout was a Lightning zap (receipt is a zap receipt event).
  - `"nutzap"` when the payout was a nutzap (receipt is the nutzap event, kind 9321).
- **Where:** `TaskConclusionForm` currently pushes `['e', formData.payoutZapReceiptId]` with no fourth element. The form (or its caller) must know whether the receipt is zap or nutzap and add the appropriate marker. Callers that set `conclusionZapReceiptId` from `NutzapDialog` (e.g. `handlePayWorker(nutzapEventId)`, `handleRefundPatron(nutzapEventId)`) should pass a “receipt type” so the form can emit `["e", id, "", "nutzap"]`; when the receipt comes from Lightning flow, emit `["e", id, "", "zap"]`.
- **Parsing (optional):** `parseTaskConclusion` in `src/lib/catallax.ts` may be extended to read the fourth element of the payout `e` tag (zap vs nutzap) for display or validation, if desired.

---

## 2. NIP.md Nutzap section: remove syncing sentence, use kind constants ✅

**Ref:** `NIP.md` lines 156–158; kinds in `src/lib/nutzap.ts` (lines 15–28).

**Done:** NIP.md Nutzap subsection was updated: syncing sentence removed; kinds 10019, 9321, 17375, 7375, 7376 listed to match `src/lib/nutzap.ts`.

**Todo (completed):**

- **Remove outdated syncing sentence.** The text says the client “also updates the wallet event (17375) so that its mints list is the **union** of the previous wallet mints and the new config mints”. That syncing behavior is no longer used; remove or rewrite that sentence so the docs match current behavior.
- **Use the same kind identifiers as code.** In the Nutzap subsection, refer to the same kinds as in `src/lib/nutzap.ts`:
  - **NUTZAP_CONFIG_KIND** = 10019 (replaceable) – public receive config (relays, mints, P2PK pubkey).
  - **NUTZAP_EVENT_KIND** = 9321 – nutzap payment event (the payment is the receipt).
  - **NUTZAP_WALLET_KIND** = 17375 (replaceable) – encrypted P2PK privkey and mints.
  - **NUTZAP_TOKEN_KIND** = 7375 – token event (encrypted unspent proofs per mint).
  - **NUTZAP_REDEMPTION_KIND** = 7376 – redemption / spending history (optional).

Update the NIP.md Nutzap paragraph so it describes current behavior and uses these kind numbers/names for consistency with the codebase.

---

## 3. `useIncomingNutzaps` – where it’s used and where it’s needed

**Ref:** `src/hooks/useIncomingNutzaps.ts` (e.g. lines 19–20).

**Current usage:**

- **Not used in the app UI.** No component imports or calls `useIncomingNutzaps`. It is only referenced in docs (`NUTZAPS_IMPLEMENTATION_GUIDE.md`, `nutzap_relays_and_mints_0a685a6d.plan.md`).
- **Indirect use:** `useRedeemNutzap` invalidates the `'incoming-nutzaps'` query key after a successful redeem, so when incoming nutzaps are eventually shown, the list will refresh after redemption.

**Where it should be used:**

- **Incoming nutzaps + redeem UI:** A screen or section that:
  1. Calls `useIncomingNutzaps()` to get `nutzaps`, `unredeemedCount`, `totalAmount`, and `refetch`.
  2. Renders the list of incoming (and optionally already-redeemed) nutzaps.
  3. For each unredeemed nutzap, offers a “Redeem” action that calls `useRedeemNutzap`’s redeem function.

**Suggested placement:**

- **Option A:** Extend **NutzapWalletSetup** (or the wallet/settings area that hosts it) with a block like “Incoming nutzaps” that uses `useIncomingNutzaps` and shows unredeemed nutzaps with a Redeem button.
- **Option B:** Add an “Incoming” or “Activity” section on the **Catallax dashboard** (or a dedicated Nutzap/Wallet page) that lists incoming nutzaps and allows redeeming them.

Until one of these is implemented, users have no way in the UI to see or redeem incoming nutzaps, even though the hook and redemption logic exist.

---

## 4. Nutzap event `e` tag (nutzapped event) and query by event

**Ref:** `docs/nutzaps/NIP-61.md` lines 69–70: *`e` is the event that is being nutzapped, if any.*

**Todo:**

1. **Confirm we add the `e` tag when paying for a specific event.**  
   The client already adds `e` (and optional `k`) in `buildNutzapTags` when `eventId` / `eventKind` are passed; `NutzapDialog` and `useNutzap` pass these for task funding, payout, and refund. Verify all flows that should link a nutzap to an event (e.g. task proposal, goal, note) pass `eventId` (and `eventKind` where useful) so the published kind 9321 event includes `["e", "<nutzapped-event-id>", "<relay-hint>"]` and optionally `["k", "<kind>"]` per NIP-61.

2. **Query nutzaps by referenced event.**  
   Add or confirm support for querying “payments for a specific event”: filter kind 9321 by `#e` (the event id that was nutzapped), e.g. `{ kinds: [9321], "#e": [eventId] }`. This allows listing “nutzaps received (or sent) for this task/note” and reusing the same pattern as zap receipts (e.g. `useZapGoal` uses `#e` for goal id). Implement a small hook or query helper (e.g. “nutzaps for event X”) if missing, and use it where the UI should show nutzap payments for a single event.

---

## 5. Restore wallet from mnemonic (cashu-ts)

**Ref:** `@cashu/cashu-ts` (used in `src/lib/cashu.ts`, wallet hooks).

**Todo:**

- **Explore** whether and how the **cashu-ts** library supports restoring a Cashu/Nutzap wallet from a **mnemonic** (BIP-39 or similar). If supported, document the flow and consider adding a “Restore wallet” path in the client (e.g. in NutzapWalletSetup or wallet settings) so users can recover their P2PK key and mints from a backup phrase. If cashu-ts does not support mnemonic restore, note alternatives (e.g. export/import encrypted backup, or link to upstream feature requests).
