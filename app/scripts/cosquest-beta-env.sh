#!/usr/bin/env bash
# The environment for a "CosQuest Beta" build of the merged app (App Store
# Connect app 6824541255, bundle/package com.subomi.cosquest.chat, team
# P8M65P9522). Source it, then prebuild/build as usual:
#
#   source scripts/cosquest-beta-env.sh
#   npx expo prebuild --platform ios --clean      # (or android)
#
# Chat: the team's live chat API on Render (their eas.json preview/production).
# Game: PRODUCTION from build 19 (9 Nov 2026; builds 15 to 18 played on
# STAGING). Two settings name the game server and BOTH must agree, or the JS
# game talks to one server while the native map/3D fight talks to the other:
#   EXPO_PUBLIC_GAME_SERVER   JS side (features/game/config.ts)
#   COSQUEST_GAME_SERVER_URL  native game module (app.config.js serverUrl)
# Set EXPO_PUBLIC_GAME_SERVER=staging for a test build on staging; the URL
# follows it unless set. The check below refuses a mismatch.
# Build 23 is this upload (22 was the one before; 20 and 21 were never uploaded).
# Set COSQUEST_BUILD_NUMBER to the next free number before every upload.
export COSQUEST_TESTFLIGHT=1
export COSQUEST_BUILD_NUMBER="${COSQUEST_BUILD_NUMBER:-31}"
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://cosquest-1.onrender.com}"
export EXPO_PUBLIC_WEB_URL="${EXPO_PUBLIC_WEB_URL:-https://cosquest.vercel.app}"
export EXPO_PUBLIC_SPARKS_ENGINE="${EXPO_PUBLIC_SPARKS_ENGINE:-module}"
export EXPO_PUBLIC_GAME_SERVER="${EXPO_PUBLIC_GAME_SERVER:-production}"
case "$EXPO_PUBLIC_GAME_SERVER" in
  production) _cq_game_url=https://costquest.204.168.162.79.sslip.io ;;
  staging) _cq_game_url=https://costquest-staging.204.168.162.79.sslip.io ;;
  https://*) _cq_game_url="$EXPO_PUBLIC_GAME_SERVER" ;;
  *) echo "cosquest-beta-env: EXPO_PUBLIC_GAME_SERVER must be production, staging or an https URL (got $EXPO_PUBLIC_GAME_SERVER)" >&2; return 2 2>/dev/null || exit 2 ;;
esac
export COSQUEST_GAME_SERVER_URL="${COSQUEST_GAME_SERVER_URL:-$_cq_game_url}"
if [ "${COSQUEST_GAME_SERVER_URL%/}" != "$_cq_game_url" ]; then
  echo "cosquest-beta-env: the two game server settings disagree: EXPO_PUBLIC_GAME_SERVER=$EXPO_PUBLIC_GAME_SERVER ($_cq_game_url) but COSQUEST_GAME_SERVER_URL=$COSQUEST_GAME_SERVER_URL" >&2
  return 2 2>/dev/null || exit 2
fi
unset _cq_game_url
export EXPO_PUBLIC_GAME3D="${EXPO_PUBLIC_GAME3D:-1}"
# The hero holds the Forge weapon the player equipped (with the server's forge_world on).
# Missing from builds 15 to 17, so they showed the starter weapon in the fight.
export EXPO_PUBLIC_FORGE_CATALOGUE="${EXPO_PUBLIC_FORGE_CATALOGUE:-1}"
# Wale's Figma screens are the app's look from build 23 (app/app/wale/*, the Home tab,
# trivia; features/waleui/flag.ts). Set EXPO_PUBLIC_WALE_UI=0 before sourcing this to
# build the app with the old screens, as build 22 was.
export EXPO_PUBLIC_WALE_UI="${EXPO_PUBLIC_WALE_UI:-1}"

# ---- Store release (build 30, release checklist 19 Nov 2026) ----
# Legal pages. NOT written by us: Mark's company and its lawyer publish them on the company's
# domain, then the URLs go here. Empty = the page is linked nowhere (sign-up, Settings, Help) and
# its route says "not published yet" (services/appConfig.ts, components/Terms.tsx).
export EXPO_PUBLIC_PRIVACY_URL="${EXPO_PUBLIC_PRIVACY_URL:-}"      # TODO(Mark + lawyer): privacy policy URL
export EXPO_PUBLIC_TERMS_URL="${EXPO_PUBLIC_TERMS_URL:-}"          # TODO(Mark + lawyer): terms of service (with EULA) URL
export EXPO_PUBLIC_GUIDELINES_URL="${EXPO_PUBLIC_GUIDELINES_URL:-}" # TODO(Mark + lawyer): community guidelines URL
# Crash reporting (Sentry). Empty = the SDK is never started and nothing is sent (services/monitoring.ts).
# SENTRY_ORG + SENTRY_PROJECT (+ SENTRY_AUTH_TOKEN, never committed) add the source-map upload plugin.
export EXPO_PUBLIC_SENTRY_DSN="${EXPO_PUBLIC_SENTRY_DSN:-}"        # TODO(team account): the project's DSN
# Store switches (services/releaseGates.ts). Unset = the store build. For a TestFlight build that
# keeps today's behaviour, set before sourcing:
#   EXPO_PUBLIC_COIN_PURCHASE=1      CosCoin packs, the web hand-off and "Manage purchases" on the phone
#   EXPO_PUBLIC_SHOW_PLACEHOLDERS=1  the "not in the app yet" buttons and the Lobby mock-up
#   EXPO_PUBLIC_DEV_SCREENS=1        /gps-demo and the Notifications check
# Signing (plugins/withStoreRelease.js): the archive signs with this App Store profile so the push
# entitlement reaches the IPA. A company account names its own profile here.
export COSQUEST_IOS_PROFILE="${COSQUEST_IOS_PROFILE:-CosQuest Chat App Store}"
