# Nutzaps – Open todos

**Workflow ref:** `NIP.md` – "Funding with ecash/cashu workflow" (Setup → Sending → Receiving → Pending cleared).

---

## 1. Task Conclusion event: add nutzap support (NIP) ✅

**Ref:** `NIP.md` lines 98–99 (Task Conclusion kind 3402).

The protocol already defines the payout-receipt `e` tag with a fourth element `<zap|nutzap>`. The client does not yet implement this.

**Todo:**

- **Publishing:** When publishing a Task Conclusion (kind 3402), the payout-receipt `e` tag must include the fourth element:
  - `"zap"` when the payout was a Lightning zap (receipt is a zap receipt event).
  - `"nutzap"` when the payout was a nutzap (receipt is the nutzap event, kind 9321).
- **Where:** `TaskConclusionForm` currently pushes `['e', formData.payoutZapReceiptId]` with no fourth element. The form (or its caller) must know whether the receipt is zap or nutzap and add the appropriate marker. Callers that set `conclusionZapReceiptId` from `NutzapDialog` (e.g. `handlePayWorker(nutzapEventId)`, `handleRefundPatron(nutzapEventId)`) should pass a "receipt type" so the form can emit `["e", id, "", "nutzap"]`; when the receipt comes from Lightning flow, emit `["e", id, "", "zap"]`.
- **Parsing (optional):** `parseTaskConclusion` in `src/lib/catallax.ts` may be extended to read the fourth element of the payout `e` tag (zap vs nutzap) for display or validation, if desired.

## 3. Nutzap event `e` tag, query by event, and require event ✅

**Ref:** `docs/nutzaps/NIP-61.md` lines 69–70; `src/hooks/useNutzap.ts`, `src/lib/nutzap.ts`, `buildNutzapTags`.

**Done:**

1. All flows pass `eventId` and `eventKind`; `buildNutzapTags` includes `["e", eventId, relayHint]` and `["k", eventKind]`. Relay hint from target relays.
2. `useNutzapsForEvent(eventId)` queries kind 9321 by `#e`.
3. `eventId` and `eventKind` required in `NutzapRequest`; `buildNutzapTags` throws if missing; `sendNutzap` validates early.

---

## 4. Sender 7375 update when sending (NIP-60) ✅

**Ref:** `NIP.md` "Sending a nutzap" step 5; `docs/nutzaps/NIP-60.md` "Spending token"; `src/hooks/useNutzap.ts`.

**Done:**

- After publishing 9321, `useNutzap` updates the sender's 7375:
  - NIP-09 deletes the token event(s) that held the spent proofs.
  - If the Cashu SDK returns change (`keep`), creates a new 7375 with those proofs and `del: [destroyed-event-id]`.
  - Creates kind 7376 (direction: out) for the sender's spending history.

---

## 5. DLEQ proof verification ✅

**Ref:** NIP-61 "Verifying a Cashu Zap"; `docs/nutzaps/nuts/12.md`; `docs/nutzaps/DLEQ_VERIFICATION.md`.

**Done:**

- Documented requirements in `docs/nutzaps/DLEQ_VERIFICATION.md`.
- Implemented `verifyProofsDleq(proofs, mintUrl, unit)` in `src/lib/cashu.ts` using cashu-ts `hasValidDleq`.
- Integrated DLEQ verification into `useIncomingNutzaps`: nutzaps are only marked verified when both P2PK and DLEQ pass.
- Added `requireDleq: true` to `useRedeemNutzap` so redemption rejects proofs without valid DLEQ.

---

## 6. Incoming nutzaps and redemption UX ✅

**Ref:** `NIP.md` "Receiving a nutzap", "Sender: pending cleared"; `docs/nutzaps/NIP-61.md` lines 77–78; `src/hooks/useIncomingNutzaps.ts`, `src/hooks/useRedeemNutzap.ts`.

**Done:**

- `IncomingNutzapsSection` shows incoming nutzaps with Redeem button; placed in NutzapWalletSetup (Settings tab of Catallax dashboard).
- Users with a wallet see incoming nutzaps and can redeem them.

**Deferred:**

- For senders: when a 7376 is seen, treat the nutzap as no longer pending (would require a "sent nutzaps" list and 7376 subscription).

---

## 7. Kind 7376 content – add "created" tag and relay hint ✅

**Ref:** `NIP.md` "Receiving a nutzap" step 4; `docs/nutzaps/NIP-61.md` lines 96–107; `src/hooks/useRedeemNutzap.ts`.

**Done:**

- Added **"created"** tag in kind 7376 encrypted content: `["e", "<7375-event-id>", "<relay-hint>", "created"]` for the new token event.
- Added **relay hint** to the `e` tag in kind 7376 tags: `["e", "<9321-event-id>", "<relay-hint>", "redeemed"]` using `redemptionRelays[0] ?? ''`.
- Publish 7376 to sender's NIP-65 read relays (single query). Relay hint uses `nutzap.relayHint` from the parsed 9321 event.
