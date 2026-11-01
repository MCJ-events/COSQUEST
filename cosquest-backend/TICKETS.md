# Tickets & Stripe (Quests & Events, Phase 2)

Builds on the admin dashboard (6 zips) and Quests Phase 1. Needs `npm install stripe@17`.

## Render environment (sandbox now, live later)
`STRIPE_SECRET_KEY` (sk_test_...), `STRIPE_WEBHOOK_SECRET` (whsec_...), `APP_WEB_URL` (https://cosquest.vercel.app). Optional: `REFUND_CUTOFF_HOURS` (default 24), `TICKETS_WORKER=0` on all but one instance if there are several, `QUEST_CURRENCY` (USD).

## How it stays safe
- **Card details never reach us**: Stripe Checkout (Stripe's page).
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
