# Nutzaps – Open todos

**Workflow ref:** `NIP.md` – "Funding with ecash/cashu workflow" (Setup → Sending → Receiving → Pending cleared).

---

## 1. Task Conclusion event: add nutzap support (NIP)

**Ref:** `NIP.md` lines 98–99 (Task Conclusion kind 3402).

The protocol already defines the payout-receipt `e` tag with a fourth element `<zap|nutzap>`. The client does not yet implement this.

**Todo:**

- **Publishing:** When publishing a Task Conclusion (kind 3402), the payout-receipt `e` tag must include the fourth element:
  - `"zap"` when the payout was a Lightning zap (receipt is a zap receipt event).
  - `"nutzap"` when the payout was a nutzap (receipt is the nutzap event, kind 9321).
- **Where:** `TaskConclusionForm` currently pushes `['e', formData.payoutZapReceiptId]` with no fourth element. The form (or its caller) must know whether the receipt is zap or nutzap and add the appropriate marker. Callers that set `conclusionZapReceiptId` from `NutzapDialog` (e.g. `handlePayWorker(nutzapEventId)`, `handleRefundPatron(nutzapEventId)`) should pass a "receipt type" so the form can emit `["e", id, "", "nutzap"]`; when the receipt comes from Lightning flow, emit `["e", id, "", "zap"]`.
- **Parsing (optional):** `parseTaskConclusion` in `src/lib/catallax.ts` may be extended to read the fourth element of the payout `e` tag (zap vs nutzap) for display or validation, if desired.

## 3. Nutzap event `e` tag, query by event, and require event

**Ref:** `docs/nutzaps/NIP-61.md` lines 69–70; `src/hooks/useNutzap.ts`, `src/lib/nutzap.ts`, `buildNutzapTags`.

**Todo:**

1. **Confirm we add the `e` tag when paying for a specific event.**  
   Verify all flows that should link a nutzap to an event (task proposal, goal, note) pass `eventId` and `eventKind` so the published kind 9321 event includes `["e", "<nutzapped-event-id>", "<relay-hint>"]` and optionally `["k", "<kind>"]` per NIP-61.

2. **Query nutzaps by referenced event.**  
   Add or confirm support for querying "payments for a specific event": filter kind 9321 by `#e`, e.g. `{ kinds: [9321], "#e": [eventId] }`. Implement a hook or query helper (e.g. `useNutzapsForEvent`) if missing.

3. **Require `e` tag – no nutzap without event.**  
   This client should not have a nutzap flow without a task event attached. Make `eventId` and `eventKind` required in `NutzapRequest` and `buildNutzapTags` (if not already). Fail early if not present.

---

## 4. Sender 7375 update when sending (NIP-60)

**Ref:** `NIP.md` "Sending a nutzap" step 5; `docs/nutzaps/NIP-60.md` "Spending token"; `src/hooks/useNutzap.ts`.

**Current state:** `useNutzap` publishes kind 9321 and calls `refetch()`, but does not update the sender's token events. Per NIP-60, when spending proofs, the client MUST delete/roll the old 7375 and create a new one with remaining proofs.

**Todo:**

- After publishing 9321, **update the sender's 7375**:
  - Identify which token event(s) held the proofs that were spent.
  - If the Cashu SDK returns change proofs, create a new 7375 with those proofs and `del: [destroyed-event-id]`.
  - NIP-09 delete the old token event(s).
- Optionally create kind 7376 (direction: out) for the sender's spending history.

---

## 5. DLEQ proof verification

**Ref:** NIP-61 "Verifying a Cashu Zap"; `docs/nutzaps/nuts/12.md`.

**Todo:**

- Research what is needed for **local DLEQ proof verification** of nutzap tokens before displaying or accepting.
- `verifyP2PKLock` checks P2PK locking but not DLEQ; the NIP says observer clients SHOULD locally verify DLEQ proofs.
- Document what we need to do and implement if feasible.

---

## 6. Incoming nutzaps and redemption UX

**Ref:** `NIP.md` "Receiving a nutzap", "Sender: pending cleared"; `docs/nutzaps/NIP-61.md` lines 77–78; `src/hooks/useIncomingNutzaps.ts`, `src/hooks/useRedeemNutzap.ts`.

**Current state:**

- `useIncomingNutzaps` exists and fetches incoming nutzaps; `useRedeemNutzap` handles redemption.
- Neither is surfaced in the app UI. Users have no way to see or redeem incoming nutzaps.

**Todo:**

- Surface **receiving and redeeming nutzaps** in the UX (at least at a basic level).
- Add a screen or section that uses `useIncomingNutzaps` and allows users to see and redeem incoming nutzaps.
- Suggested placements: NutzapWalletSetup, Catallax dashboard, or a dedicated Nutzap/Wallet page.
- For senders: when a 7376 is seen, treat the nutzap as no longer pending.

---

## 7. Kind 7376 content – add "created" tag and relay hint

**Ref:** `NIP.md` "Receiving a nutzap" step 4; `docs/nutzaps/NIP-61.md` lines 96–107; `src/hooks/useRedeemNutzap.ts`.

**Todo:**

- Fix missing **"created"** tag in kind 7376 encrypted content: the NIP example includes `["e", "<7375-event-id>", "<relay-hint>", "created"]` for the new token event that was created. Add this when creating the token event (kind 7375) and record it in the redemption event content.
- Add **relay hint** to the `e` tag in kind 7376 tags: `["e", "<9321-event-id>", "<relay-hint>", "redeemed"]` – use a non-empty relay hint when available.
- **Optionally** publish 7376 to both sender's and recipient's relays so both parties can see the history (NIP-61 only requires sender's relays).
