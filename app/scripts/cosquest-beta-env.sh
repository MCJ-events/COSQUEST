#!/usr/bin/env bash
# The environment for a "CosQuest Beta" build of the merged app (App Store
# Connect app 6824541255, bundle/package com.subomi.cosquest.chat, team
# P8M65P9522). Source it, then prebuild/build as usual:
#
#   source scripts/cosquest-beta-env.sh
#   npx expo prebuild --platform ios --clean      # (or android)
#
# Chat: the team's live chat API on Render (their eas.json preview/production).
# Game: the STAGING game server. Build 14 (31 Oct 2026) was the last upload;
# set COSQUEST_BUILD_NUMBER to the next free number before every upload.
export COSQUEST_TESTFLIGHT=1
export COSQUEST_BUILD_NUMBER="${COSQUEST_BUILD_NUMBER:-15}"
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://cosquest-1.onrender.com}"
export EXPO_PUBLIC_WEB_URL="${EXPO_PUBLIC_WEB_URL:-https://cosquest.vercel.app}"
export EXPO_PUBLIC_SPARKS_ENGINE="${EXPO_PUBLIC_SPARKS_ENGINE:-module}"
export EXPO_PUBLIC_GAME_SERVER="${EXPO_PUBLIC_GAME_SERVER:-staging}"
export EXPO_PUBLIC_GAME3D="${EXPO_PUBLIC_GAME3D:-1}"
