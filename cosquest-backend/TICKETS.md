# Tickets & Stripe (Quests & Events, Phase 2)

Builds on the admin dashboard (6 zips) and Quests Phase 1. Needs `npm install stripe@17`.

## Paid only
Every ticket is paid: an entry fee or ticket type below $0.50 is refused in the admin dashboard, and a quest without a price answers `409 not_on_sale` at checkout (its ticket type shows `onSale: false`). `ALLOW_FREE_TICKETS=1` turns free tickets back on.

## Be at the venue
A quest with `requireAtVenue` checks the phone's position at checkout **while the quest is live** (`position: { lat, lng, accuracy }` in the body): within `venueRadiusMeters` plus up to 100 m of GPS accuracy, otherwise `403 not_at_venue` (with `distanceMeters`) or `403 location_required`. Tickets for later can be bought from anywhere. A phone's GPS can be faked; the QR check-in at the door is the real proof.

## Quests near you
`GET /api/quests?lat&lng&radiusMiles` asks the database only for quests in a box around the point, measures each, and keeps the nearest (`limit`, default 20). Before, it took the first 20 worldwide by start time and then filtered by distance, so nearby quests were cut off. Without lat/lng: the soonest, as before.

## Paying on the CosQuest website (how the app pays)
No payment screens in the app (payment brief, decision 2). The app opens the website; the member pays on Stripe's page; the app updates by itself.

1. **App:** `POST /api/payments/handoff { questId, ticketTypeId? }` (logged in), after the eligibility check, returns `{ url: APP_WEB_URL/checkout?h=<link>, expiresAt }`.
2. **Website:** `POST /api/payments/handoff/redeem { h }` swaps the link, once, for `{ checkoutToken, expiresAt, member, quest, ticketTypes, eligibility }`.
3. **Website:** `POST /api/payments/checkout` (Bearer checkoutToken) `{ ticketTypeId?, position? }` opens Stripe's page, which returns to `/checkout/return` (`Order.returnTo: 'web'`).
4. **Paid:** still only Stripe's signed webhook, or the server asking Stripe. `fulfil` also sends `ticket:issued { orderId, ticketId, questId }` to the member's sockets.
5. **Return page:** `GET /api/payments/orders/:orderId` (Bearer checkoutToken).

The app can also ask first: `GET /api/payments/eligibility?questId=`.

**The link and the pass** (`src/utils/checkoutPass.js`) have `purpose: 'checkout'`, so login checks refuse them. They are signed with their own key (an HMAC of `JWT_SECRET`, HS256), tied to the member and the quest, and cancelled by logging out (`tokenVersion`). Both end `CHECKOUT_LINK_MINUTES` after the link was made (default 20). A link works once (Redis `SET NX`).

**Eligibility** (`src/utils/eligibility.js`, brief 6.4) applies to anything that costs money. It is checked in `tickets.startCheckout`, so no way of paying skips it: the website, the app's checkout and the payment sheet.
- **Age:** 18+ (`PAID_MIN_AGE`), from `account.dateOfBirth` or `profile.age`. None saved means blocked (`age_unknown`).
- **Region:** live mode only (`PAYMENTS_ELIGIBILITY=live`, or by default with an `sk_live_` key). It needs `resolveRegion()` to be connected to a location service, checked against `PAYMENTS_ALLOWED_REGIONS`. Until then live mode blocks every paid purchase (`location_unconfirmed`).
- **Answer:** `403 { code, reason }`.

Older app versions keep using `POST /api/quests/:id/checkout`, which returns to the app.

## Ledger, regions and two-person approvals (payment brief 6.1, 6.4, 6.6)
- **Ledger** (`src/models/LedgerTransaction.js`, `src/utils/ledger.js`): double-entry and append-only. The model refuses every update and delete; corrections are reversals. Amounts are in cents, as Stripe charges them, with two books (`money`, `costcoin`) and a unique key per event.
- **Ticket money:** a paid ticket is a debit to `processor_clearing` and a credit to `quest_pool:<questId>`; a refund is the reverse. It is recorded from `tickets.js` without ever holding up a payment, and the 2-minute job fills in anything missed. The platform share comes at settlement (prize formula, not approved yet). Stripe fees, partial refunds and reconciliation against Stripe's balance are not in it yet.
- **Balance check:** debits = credits per book and currency, every hour (a log `ALERT` if not) and on the admin page.
- **Regions** (`RegionRule`): `allowed`, `blocked` or `needs_license`. Live-mode eligibility reads the table; while it is empty, `PAYMENTS_ALLOWED_REGIONS` applies. Once it has rows, a region with no row is blocked.
- **Approvals** (`ApprovalRequest`): a region change is a request that another admin approves (and it is applied) or rejects, never the requester, decided once. Each step is in the audit log (area `payments`).
- **Admin:** `GET /api/admin/ledger/transactions | balances | check | export` (CSV, safe to open in a spreadsheet), `POST /api/admin/ledger/transactions/:txId/reverse { reason }`, `GET /api/admin/regions`, `POST /api/admin/regions/requests { changes, reason }`, `GET /api/admin/approvals?status`, `POST /api/admin/approvals/:id/approve | reject | withdraw`.

## Paying inside the app (payment sheet): off
Answers `410 pay_on_website` unless `PAYMENT_SHEET=1`.

`POST /api/quests/:id/payment-sheet { ticketTypeId?, position? }` (members): the same rules as checkout, but a Stripe **PaymentIntent** for the app's payment sheet (card, Google Pay): `{ order, paymentIntentClientSecret }` (free: `{ ticket }`). One open order per person per quest: a retry returns the same client secret. Paid only by the webhook `payment_intent.succeeded` (amount and currency checked) or by the server asking Stripe (`GET /api/orders/:id`, reconciler). An abandoned one is **cancelled** in Stripe after the 31-minute hold and the seat released. Orders have `method: checkout | sheet`.

**Stripe dashboard:** add `payment_intent.succeeded` and `payment_intent.canceled` to the webhook endpoint, and turn on **Google Pay** in Settings > Payment methods.

## Deleting quests
`DELETE /api/admin/quests/:questId { reason }` deletes a quest for good, with its ticket types: only when nobody is registered and no order was ever paid, refunded, free or in checkout (otherwise 409 `has_registrations` / `has_orders`: cancel it instead). It is unpublished while it is checked, so no checkout can start meanwhile, and a refused delete leaves it as it was. Recorded as `quest.delete` with a snapshot.

## Render environment (sandbox now, live later)
`STRIPE_SECRET_KEY` (sk_test_...), `STRIPE_WEBHOOK_SECRET` (whsec_...), `APP_WEB_URL` (https://cosquest.vercel.app). Optional: `REFUND_CUTOFF_HOURS` (default 24), `TICKETS_WORKER=0` on all but one instance if there are several, `QUEST_CURRENCY` (USD), `CHECKOUT_LINK_MINUTES` (20), `PAID_MIN_AGE` (18), `PAYMENTS_ELIGIBILITY` (`test` | `live`), `PAYMENTS_ALLOWED_REGIONS` (e.g. `US-CA,US-NY`), `PAYMENT_SHEET` (`1` turns the in-app payment sheet back on).

## How it stays safe
- **Card details never reach us**: Stripe Checkout (Stripe's page) on the website, Stripe's payment sheet in the app.
- **Prices from our database**, never the app; the webhook **checks amount and currency** (a mismatch is refunded, never ticketed).
- **Only a signed webhook** (raw body, `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance) or the reconciler asking Stripe can mark an order paid. The app's return page proves nothing.
- **Seats held atomically** (`sold + held < quantity`, one `findOneAndUpdate`) for 31 minutes; then released.
- **Every transition is conditional** (expected status in the filter), so repeats never double anything. Stripe calls use **idempotency keys** (`checkout-<order>`, `refund-<order>`).
- **One event once**: `StripeEvent` (event id as `_id`, kept 90 days). A failure deletes it and answers 500 so **Stripe retries** (3 days).
- **Network drops**: a retry returns the **same** pending order and Stripe page (unique open order per person per quest). Stripe unreachable when starting: the seat is released and nothing is charged (502).
- **Missed / late webhooks**: `GET /api/orders/:id` (the app's return page) asks Stripe for a pending order; the **reconciler** (`src/utils/tickets.js` start/stop, every 2 minutes) checks pending orders past their hold or quiet for 5 minutes.
- **Paid after the hold expired**: the seat is taken again if free; otherwise (sold out, cancelled, ended) an **automatic refund**.
- **Tickets**: `CQT-` + 128 random bits; **check-in is one atomic step** (a copied code only gets in once).
- **Limits**: 8 checkouts per person per 10 minutes; Stripe's minimum 0.50; supported currencies USD/EUR/GBP/CAD/AUD.

## Notifications
- **"Your ticket is ready 🎟️"**: an in-app notification and a phone push (`data: { type: 'ticket', ticketId }`, opens the ticket) when a ticket is issued.
- **"Starts in about an hour"**: once per valid ticket, for quests starting in 50-70 minutes (`remindersDue`, run with the reconciler every 2 minutes; `Ticket.reminderSentAt` is claimed atomically). Times in the push use `REMINDER_TIME_ZONE` (default America/Los_Angeles). The ready push follows the person's "Quest updates" switch and the reminder their "Event reminders" switch (`questUpdates` / `eventReminders` in src/utils/push.js).

## Files
| | |
|---|---|
| `src/models/TicketType.js`, `Order.js`, `Ticket.js`, `StripeEvent.js` **new** | |
| `src/utils/stripe.js` **new** | client (retries, timeout), signature check, cents, a test fake (NODE_ENV=test without a key) |
| `src/utils/tickets.js` **new** | holds, checkout, fulfil, refunds, reconcile, start/stop |
| `src/controllers/stripeWebhookController.js`, `ticketController.js`, `adminPaymentsController.js` **new** | |
| `src/controllers/adminQuestsController.js` **replaces Quests Phase 1's** | cancelling a quest now refunds every paid ticket |
| `src/routes/ticketRoutes.js`, `src/validators/tickets.js` **new** | |
| `src/routes/adminRoutes.js`, `src/validators/admin.js` **replace Quests Phase 1's** | |
| `test/tickets.js` **new** | 34 checks (register it like the others) |
| `test/ticketReminders.js` **new** | 4 checks: `require('./ticketReminders').run()` (no server needed) |
| `apply-tickets.js` | `server.js` (webhook before `express.json()`, reconciler start/stop), `src/routes/index.js` (ticket routes), `questController.js` (register/unregister through tickets) |

## Member API
| Method | Path | |
|---|---|---|
| GET | `/api/quests/:id/ticket-types` | public: types, price, remaining, onSale |
| POST | `/api/quests/:id/checkout` `{ ticketTypeId? }` | free: 201 `{ order, ticket }`; paid: 201 `{ order, checkoutUrl }`; a retry: 200 `reused`. 409 `has_ticket` / `sold_out`, 502 `payment_service_unreachable`, 503 `payments_unavailable`, 429 `too_many_checkouts` |
| GET | `/api/orders/:id` | the order (asks Stripe while pending) |
| GET | `/api/me/tickets?scope=upcoming\|past` · `/api/me/tickets/:id` | the ticket (with `code` for the QR while valid) |
| POST | `/api/me/tickets/:id/cancel` | refund (paid) or cancel (free), until `REFUND_CUTOFF_HOURS` before the start |
| POST | `/api/quests/:id/registrations` | free: now a free ticket (same answers); paid: 402 `checkout_required` |
| DELETE | `/api/quests/:id/registrations` | free ticket given back (paid: 409 `use_my_tickets`) |

## Admin API
Ticket types (`GET/POST /api/admin/quests/:id/ticket-types`, `PATCH /api/admin/ticket-types/:id`; quantity never below sold + held), `GET /api/admin/payments/stats`, `GET /api/admin/orders`, `GET /api/admin/orders/:id` (history, Stripe ids, dashboard link), `POST /api/admin/orders/:id/refund { reason }`, `POST /api/admin/checkin { code, questId? }`, `GET /api/admin/quests/:id/checkins`.

## Stripe webhook events
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed` (logged; the person can try another card), `charge.refunded` (refunds made in the Stripe dashboard are mirrored). Please add the two `async_payment_*` events to the endpoint too.
