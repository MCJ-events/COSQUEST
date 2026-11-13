# CosQuest app to payments website: what the game side does, and what your side calls

For Sammy and Timmy (web and backend). From Subomi, 13 Nov 2026. Follows the payment brief of 12 Nov (sections 5, 6 and 9).
The game server never touches money. Your Payments Service owns the Costcoin ledger; the game just asks it.
Game server: production `https://costquest.204.168.162.79.sslip.io`, staging `https://costquest-staging.204.168.162.79.sslip.io`.
Everything below is built and on staging, switched off until we turn it on together.

## 1. The player arrives with a token

The player taps **Manage purchases** in the app. The app first runs an eligibility check (section 4); only if that passes does
the game server give it a one-time link, which opens your website like this:

`https://<your website>/<path you choose>?handoff=<token>`

The token only says who the player is. It carries no balance, price or permission to buy. It lasts 3 minutes (we can set 2 to 5),
works once, and is made for your website only. It looks like a JWT, but **do not trust it by reading it**: send it to us.
Read it from the address, then remove it from the address bar (`history.replaceState`).

## 2. Your backend redeems it once: the verify endpoint

`POST {game server}/v1/pay/handoff/verify`
Headers: `Authorization: Bearer <your service key>`, `Content-Type: application/json`. Body: `{"token": "<token>"}`

Call this from your server, never from the browser (the key must stay secret). We store only the key's SHA-256.

Success, `200`:

```json
{"valid": true,
 "player": {"id": "<64 hex: the game's player id>", "handle": "kofi", "faction": "anime"},
 "account": {"provider": "cosquest-live", "subject": "<the chat app's user id>"},
 "purpose": "manage_purchases",
 "issued_at": "...", "expires_at": "...",
 "eligibility": {"check_id": "...", "action": "buy_costcoin", "decision": "allow", "jurisdiction": "US-NY",
                 "rule_version": "...", "checked_at": "..."},
 "return_url": "cosquest://wallet?from=payments"}
```

`player.id` is the id to key your ledger on; every call we make to you uses it. `account` is the same person in the chat app
(the one login we already share); it is `null` for a player who never signed in through the chat.

Refused, `401` with `{"detail": {"code": ..., "reason": ...}}`. Codes: `used` (already redeemed), `expired`, `unknown`,
`bad_signature`, `wrong_audience`, `malformed`, `unauthorized` (your key). `503` means it is not switched on yet.
Then start your own session for the player. The token is spent; a page refresh must not need it again.

## 3. Sending the player back to the app

When they are done, send the browser to `cosquest://wallet?from=payments&order=<your order id>&result=success|cancel|done`.
If your hosted checkout needs an https return address (Stripe's success and cancel URLs must be https), use
`{game server}/v1/pay/return?order=<order id>&result=success` and we redirect to the app link. The app then asks the game server
for the purchase status and the wallet again, which asks you (section 5). The link is never proof of payment: only your verified
Stripe webhook credits Costcoin.

## 4. The Eligibility Service you build: what we send

Before any paid action (opening your website, entering a paid quest) we call
`POST {CQ_ELIGIBILITY_URL}/v1/eligibility/check` with `Authorization: Bearer <eligibility key>`:

```json
{"player": "<player id>", "account": {"provider": "...", "subject": "..."} ,
 "action": "buy_costcoin | paid_quest_entry", "moment": "view | checkout | quest_start",
 "quest_id": "...", "pay_with": "card",
 "signals": {"device_location": {"permission": "granted|denied|unknown", "precision": "precise|approximate|unknown",
                                 "lat": 6.52, "lng": 3.38, "accuracy_m": 11, "fix_age_s": 1.5,
                                 "mocked": false, "simulated": false, "has_fix": true, "device_region": "NG"},
             "ip": "203.0.113.7"},
 "requested_at": "..."}
```

Answer `200` with `{"decision": "allow" | "block" | "unsure", "jurisdiction": "US-NY", "check_id": "...", "rule_version": "...",
"message": "optional words for the player"}`. **Only `"decision": "allow"` lets the player through.** Anything else (another word,
an error, a timeout over 4 seconds, no service at all) is a block. A paid quest without the phone's location is blocked before
we ask you, and quest entry paid with Costcoin is always refused. Please check again yourself before checkout and at quest start.

## 5. The Payments Service you build: what we ask

`Authorization: Bearer <payments service key>`, plain JSON, 4 second timeout. `{player}` is `player.id` from section 2.

| We call | You answer |
|---|---|
| `GET /v1/players/{player}/costcoin` | `{"balance": 380, "as_of": "...", "frozen": false}` (whole Costcoin) |
| `GET /v1/players/{player}/costcoin/history?limit=50` | `{"items": [{"id", "kind": "purchase|spend|refund|chargeback|grant|reversal", "delta": 500, "label", "at", "order_id", "receipt_url"}]}` |
| `GET /v1/players/{player}/quest-entries?limit=50` | `{"items": [{"id", "quest_id", "quest_name", "amount_minor": 500, "currency": "USD", "status": "pending|paid|refunded|cancelled|failed", "at", "receipt_url"}]}` |
| `GET /v1/players/{player}/payouts?limit=50` | `{"items": [{"id", "quest_id", "quest_name", "status": "pending_review|approved|queued|paid|held|failed|cancelled", "at", "updated_at"}]}` |
| `GET /v1/players/{player}/purchases/{order_id}` | `{"order_id", "status": "created|pending|paid|failed|expired|refunded|disputed", "costcoin": 500, "receipt_url"}` |

A 404 on a list means "nothing yet". Dates are ISO 8601, receipt links https. We drop anything else: there is no cash balance in
the app, and we show a payout's status, never its amount.

## 6. What we need from you, and what you get from Subomi

From you: your website's https address, your Eligibility and Payments Service addresses, and a key for each (sent privately,
never in a group chat). From Subomi: the key your backend uses for verify (we keep only its hash). Then we switch it on on
staging, try it end to end with Stripe test mode, and only then talk about production.
