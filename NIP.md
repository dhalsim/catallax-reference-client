NIP-3400
========

Catallax: Contract Work Protocol
----------------------------------------------

`draft` `optional`

This NIP defines a set of event kinds for implementing "Catallax", a decentralized contract work system that facilitates connections between patrons (who need work done), free agents (who perform the work), and arbiters (who ensure work meets requirements and handle payments).

You can read a lot more about this concept here: [https://catallax.network](https://catallax.network)

## Abstract

Catallax enables decentralized contract work through a simple escrow system built on Nostr. It defines two parameterized replaceable event kinds (33400, 33401) and one regular event kind (3402) that allow arbiters to advertise their services, patrons to create task proposals, and arbiters to conclude tasks with payment confirmation. The system keeps communication on Nostr while leveraging Lightning or other payment systems for the actual value transfer.

## Specification

### Overview of the Workflow

1. Arbiters advertise their services with kind 33400 events, specifying fee structure and expertise
2. Patrons create task proposals with kind 33401 events. They coordinate with arbiters out band and find one to accept their task, at which point they replace their event with the update.
3. Patrons fund the escrow by sending payment to the arbiter
4. Patrons update their task proposal to "funded" status and reference the payment
5. Free agents apply for and discuss tasks with patrons out of band
6. Patrons assign a free agent to their task
7. Free agents submit completed work, either to the arbiter or to the patron. This protocol doesn't care.
8. Arbiters (or Patrons) judge the work and the Arbiter either pays the free agent or refunds the patron
9. Arbiters conclude the task with a kind 3402 event, referencing the payment receipt

### Kind 33400: Arbiter Announcement

**Parameterized replaceable event** that advertises arbiter services.

```json
{
  "kind": 33400,
  "content": {
    "name": "String: title of the service",
    "about": "String (optional): additional service details",
    "policy_text": "String (optional): full text of any relevant policies (dispute, terms, etc.)",
    "policy_url": "String (optional): URL to policy document"
  },
  "tags": [
    ["d", "<identifier for this specific arbiter service>"],
    ["p", "<arbiter-pubkey>", "<optional recommended relay URL>"],
    ["r", "<string (optional); arbiter details web URL>"],
    ["t", "<service category; string (optional)>"],
    ["t", "<additional service categories (optional)>"],
    ["fee_type", "<flat|percentage>"],
    ["fee_amount", "<amount in sats if flat or decimal 0.0-1.0 if percentage>"],
    ["min_amount", "<optional minimum task bounty in sats>"],
    ["max_amount", "<optional maximum task bounty in sats>"]
  ]
}
```

### Kind 33401: Task Proposal

**Parameterized replaceable event** that defines a work task with requirements and payment terms.

```json
{
  "kind": 33401,
  "content": {
    "title": "String: concise task title",
    "description": "String: detailed task description",
    "requirements": "String: specific deliverable requirements",
    "deadline": "Unix timestamp in seconds (optional)"
  },
  "tags": [
    ["d", "<unique task identifier>"],
    ["p", "<patron-pubkey>", "<optional recommended relay URL>"],
    ["p", "<arbiter-pubkey>", "<optional recommended relay URL>"],
    ["p", "<worker-pubkey (added when in progress)>", "<optional recommended relay URL>"],
    ["a", "33400:<arbiter-pubkey>:<d-tag-value-of-arbiter-service>", "<relay-url>"],
    ["amount", "<integer in sats>"],
    ["t", "<task category (optional)>"],
    ["t", "<additional task categories (optional)>"],
    ["status", "<proposed|funded|in_progress|submitted|concluded>"],
    ["e", "<event-id of payment receipt when escrow funded>", "<relay-url>", "<zap|nutzap>"],
    ["r", "<string (optional); task details web URL>"]
  ]
}
```

### Kind 3402: Task Conclusion

**Regular event** (not replaceable) that documents the resolution of a task.

```json
{
  "kind": 3402,
  "content": {
    "resolution_details": "String: description of the task outcome and resolution"
  },
  "tags": [
    ["e", "<payout-receipt-event-id>", "<optional recommended relay URL>", "<zap|nutzap>"],
    ["e", "<task-proposal-event-id>", "<optional recommended relay URL>"],
    ["p", "<patron-pubkey>", "<optional recommended relay URL>"],
    ["p", "<arbiter-pubkey>", "<optional recommended relay URL>"],
    ["p", "<worker-pubkey>", "<optional recommended relay URL>"],
    ["resolution", "<successful|rejected|cancelled|abandoned>"],
    ["a", "33401:<patron-pubkey>:<d-tag-value-of-task>", "<relay-url>"]
  ]
}
```

### Kind 9041: Zap Goal (NIP-75)

Used for **crowdfunded tasks**. When a task proposal has `funding_type` set to `crowdfunding`, a linked Kind 9041 event is created to enable multiple contributors to fund the task. Zap goals can only be funded with zaps and not with nutzaps.

```json
{
  "kind": 9041,
  "content": "Crowdfunding goal for: <task title>",
  "tags": [
    ["relays", "<relay-url-1>", "<relay-url-2>"],
    ["amount", "<target amount in millisats>"],
    ["summary", "<brief description>"],
    ["a", "33401:<patron-pubkey>:<task-d-tag>", "<relay-url>"],
    ["zap", "<arbiter-pubkey>", "<relay-url>", "1"],
    ["alt", "Crowdfunding goal for Catallax task: <title>"]
  ]
}
```

### Crowdfunding Extensions to Kind 33401

When a task uses crowdfunding, the following additional tags are added:

- `["funding_type", "single|crowdfunding"]` — Funding mechanism (defaults to `single` for backwards compatibility)
- `["goal", "<kind-9041-event-id>", "<relay-url>"]` — Reference to the linked NIP-75 Zap Goal event

### Crowdfunding Workflow

1. Patron creates a task with `funding_type` set to `crowdfunding`
2. A Kind 9041 Zap Goal event is automatically created and linked via the `goal` tag
3. Multiple contributors zap the goal event to fund the task
4. When the goal amount is reached, the patron or arbiter marks the task as `funded`
5. Work proceeds as normal (worker assignment, submission, conclusion)
6. If the task is cancelled, refunds are calculated proportionally based on each contributor's share

## Implementation Notes

This project implements a complete UI for testing all Catallax protocol features, including:

- Arbiter service management (create, edit, view announcements)
- Task proposal lifecycle (create, fund, assign workers, track progress)
- Task conclusion and payment resolution
- Discovery interfaces for all user types (arbiters, patrons, workers)
- Status tracking and workflow management

All custom event kinds use the `t` tag with "catallax" for efficient relay-level filtering within the Catallax ecosystem.

### Nutzap (NIP-60 / NIP-61)

This client uses **NIP-60** (Cashu Wallets) and **NIP-61** (Nutzaps) for Nutzap payments. Kinds used (see `src/lib/nutzap.ts`):

#### Kind 17375: Cashu wallet (replaceable)

Encrypted P2PK privkey and mints. Content is NIP-44 encrypted.

```json
{
  "kind": 17375,
  "content": "<nip44-encrypted: [[\"privkey\",\"<hex>\"],[\"mint\",\"<url>\"]]>",
  "tags": []
}
```

#### Kind 10019: Nutzap receive config (replaceable)

Public config for receiving nutzaps: relays, mints, P2PK pubkey.

```json
{
  "kind": 10019,
  "content": "",
  "tags": [
    ["relay", "<relay-url-1>"],
    ["relay", "<relay-url-2>"],
    ["mint", "<mint-url>", "<unit>"],
    ["pubkey", "<p2pk-pubkey-hex>"]
  ]
}
```

#### Kind 9321: Nutzap payment event

The payment itself is the receipt. Proofs are P2PK-locked to the recipient's pubkey from their kind 10019.

```json
{
  "kind": 9321,
  "content": "<optional comment>",
  "tags": [
    ["proof", "<cashu-proof-json>"],
    ["unit", "sat"],
    ["u", "<mint-url>"],
    ["e", "<nutzapped-event-id>", "<relay-hint>"],
    ["k", "<nutzapped-kind>"],
    ["p", "<recipient-nostr-pubkey>"]
  ]
}
```

#### Kind 7375: Token event

Encrypted unspent proofs per mint. Content is NIP-44 encrypted.

```json
{
  "kind": 7375,
  "content": "<nip44-encrypted: {\"mint\":\"<url>\",\"unit\":\"sat\",\"proofs\":[...],\"del\":[\"<token-event-id>\"]}>",
  "tags": []
}
```

#### Kind 7376: Redemption / spending history (optional)

Records when nutzaps are claimed. Content is NIP-44 encrypted; `e` tags with `redeemed` marker are typically unencrypted.

```json
{
  "kind": 7376,
  "content": "<nip44-encrypted: [[\"direction\",\"in\"],[\"amount\",\"<n>\"],[\"unit\",\"sat\"]]>",
  "tags": [
    ["e", "<9321-event-id>", "<relay-hint>", "redeemed"],
    ["p", "<sender-pubkey>"]
  ]
}
```
