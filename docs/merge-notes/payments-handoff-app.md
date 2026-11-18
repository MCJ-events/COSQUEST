# Payments hand-off: merge notes for the build 25 lane

13 Nov 2026. Subomi's part of the payment brief (12 Nov), game side: the app-to-web hand-off, the deep link back,
server-driven checks before any paid action, and a Wallet with no cash in it. No real money, no keys, no accounts.

## Branches and commits

| Repo | Branch | Head | Base |
|---|---|---|---|
| ubmids/cosquest-merged (app) | `payments-handoff-app` | 1f23e7f (+ this notes commit) | build 23, 84eeb3e |
| ubmids/costquest-backend | `payments-handoff-20261113` | a188509 | `prod-release-20261112-build22`, fffc459 |
| ubmids/costquest-backend | `staging-payments-20261113` | 16a2ad6 (tag `staging-payments-20261113-deployed`) | what staging ran: 0d7ec42 (faction names + Warden announcer) |

## What changed in the app (6 files, nothing else touched)

- `app/features/game/payLink.ts` (new, pure) and `__tests__/payLink.test.ts` (17 tests).
- `app/components/waleui/walletModel.ts` (new, glue: expo-location, expo-web-browser, the game store).
- `app/components/waleui/WalletScreen.tsx` (new) and the route `app/app/wallet.tsx` (`cosquest://wallet`).
- `app/components/waleui/HomeScreen.tsx`: one added button, the CosCoin pill now opens the Wallet. Nothing moved.

No new native module, no new dependency, no `app.json` or `app.config.js` change, so no prebuild change: expo-location and
expo-web-browser were already in the build. The `cosquest` scheme already exists.

Checks: `tsc --noEmit` clean, eslint clean on the changed files, `npm test` 1094 of 1094 (1077 before + 17).

## How it behaves in build 25

Everything is driven by the server, so build 25 can ship this safely before the web team is ready:

- Production backend does not have the change yet: `/v1/pay/config` is 404, so the Wallet shows the CosCoin count the game
  already has (labelled "CosCoins in game") and the XP, and no Manage purchases button. History, quest entries and payouts say
  "Not available right now". Nothing is invented.
- Staging has the change with `pay_link` off: the same as above.
- With `pay_link` on and no payments website set: the Wallet says "Purchases aren't connected yet", still no button.
- With `pay_link` on, `CQ_PAY_WEB_URL` and `CQ_PAY_HANDOFF_SECRET` set: the MANAGE PURCHASES button appears. Tapping it runs the
  paid action check (location permission, precise or approximate, accuracy, age, mocked, simulated, the phone's region), and only
  on an allowed answer gets the one-time link and opens it in the in-app browser. With no Eligibility Service configured the check
  is always refused ("Purchases and paid quests aren't available right now."), which is the brief's fail-closed rule.
- Coming back: `cosquest://wallet?from=payments&order=...&result=...` opens the Wallet, closes the browser, asks the server for the
  purchase status and the wallet again, and refreshes the Home pill. Closing the browser by hand also refreshes.

The three kinds of value look different on the Wallet: CosCoin in gold with Wale's coin ("In-game only. No cash value."), XP in
purple with his XP coin ("Earned by playing. Can't be bought."), real money only as a quest entry receipt in plain ink with the
currency code and a card icon. Payouts show a status, never an amount. There is no cash balance anywhere.

## Backend switches (all off or unset by default)

| Setting | Effect |
|---|---|
| `CQ_FEATURES_ON` += `pay_link` | the `/v1/pay/*` routes (404 without it) |
| `CQ_PAY_WEB_URL` | the payments website (https only); unset hides Manage purchases |
| `CQ_PAY_HANDOFF_SECRET` | 32+ characters, signs hand-off tokens; unset means no hand-off |
| `CQ_PAY_SERVICE_KEY_SHA256` | sha256 of the key the website presents to verify; unset means verify answers 503 |
| `CQ_PAY_WEB_AUDIENCE` | default `cosquest-payments-web` |
| `CQ_PAY_HANDOFF_TTL_S` | 120 to 300, default 180 |
| `CQ_PAY_HANDOFF_NEEDS_CHECK` | default 1: a hand-off needs an allowed purchase check from the last 5 minutes |
| `CQ_ELIGIBILITY_URL`, `CQ_ELIGIBILITY_KEY` | the Eligibility Service; unset means every check is refused |
| `CQ_PAYMENTS_SERVICE_URL`, `CQ_PAYMENTS_SERVICE_KEY` | the Payments Service; unset means the wallet parts are "not available" |

Schema: two new tables, `pay_link_checks` (decisions with the fix's quality, never the coordinates) and `pay_link_handoffs`
(token ids, for single use). Created on startup, empty while the feature is off.

Backend suite: 1351 pass on `payments-handoff-20261113`, 1398 pass on the merged staging branch; the same known 8 fail on both
and on the untouched base (test_forge_bridge x7, test_seed: they need a writable /srv). 40 new tests in `tests/test_pay_link.py`;
the pay routes were added to the route sweep and the IDOR checks.

## Staging proof

Deployed 13 Nov ~01:47Z (box clock), 0d7ec42 to 16a2ad6. Evidence in
`~/Desktop/cosquest-review/realism-20261111/experiments/payments/`: `staging_before.txt`, `staging_after.txt` (25 of 25),
`pay_smoke.py`, `deploy-staging.sh`, `rollback-20261113-payments.sh`.

- Rollback on hetzner-prod: `/opt/costquest-staging/rollback-20261113-payments.sh` (code only, retags git-0d7ec42; `WITH_DB=1`
  restores `/root/backups/costquest-staging-20261113-014719-pre-payments.dump`; `DROP_TABLES=1` drops the two tables).
- Production: untouched. Shipping the backend to production is a separate step; until then build 25 behaves as "production
  backend does not have the change yet" above.

## For whoever merges

- App: merges onto build 23 or later cleanly unless HomeScreen.tsx's top bar moved (one `<Tap>` added after the coin icon).
- Backend: the only shared files are `app/main.py` (two small blocks), `tests/test_route_sweep.py` and
  `tests/test_security_idor.py` (lists). Against the Warden announcer branch those lists conflict trivially: keep both entries
  (`staging-payments-20261113` shows the resolution).
- The existing CosCoin shop (`coins_web`, `/v1/coins/checkout`, the SHOP sheet) is untouched. It is off in production
  (`CQ_FEATURES_OFF=run,coins_web`). It is the older "server makes the Stripe session" design; the brief's design is the website.
  When the website is live, `coins_web` should stay off and SHOP can point at the Wallet.
- No paid quest entry screen exists in the app yet. `checkPaidAction({ action: "paid_quest_entry", questId, moment })` in
  `walletModel.ts` is ready for it: it asks for location, takes a fresh fix and returns the server's verdict; the brief wants it
  at three moments (viewing the quest, before checkout, at quest start).

## Decisions and open points for Subomi

1. Spelling: the brief says "Costcoin", the app says "CosCoin". Left as the app has it, as asked. The server's field names say
   `costcoin`. A rename in the app is a wording change in many screens; say if you want it.
2. The Wallet's CosCoin number when no Payments Service is connected: it shows the game server's own count (the Home pill's
   number) labelled "CosCoins in game". It is the server's number, not worked out by the app. If you would rather show nothing
   until the Payments Service is live, it is one line in `WalletScreen.tsx`.
3. Mark has not yet confirmed the wallet reading in section 11 (Costcoin only, no cash). The screen follows that reading.
4. The token is passed to the website in the URL (`?handoff=`). That is safe here because redeeming it needs the website's own
   service key and it dies after one use or 3 minutes; the website should still remove it from the address bar after reading it.
5. Apple and Google rules on linking out to a payment website (brief, risk 3) are not checked by code; Peter's check should
   happen before `CQ_PAY_WEB_URL` is set on production. The Eligibility Service can also refuse by region.
6. Wale has no Wallet frame. The screen uses his Settings frame's style; when he draws one, it replaces the layout.
