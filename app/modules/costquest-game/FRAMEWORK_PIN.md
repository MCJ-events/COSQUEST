# UnityFramework pin

`Frameworks/UnityFramework.framework` is build output (gitignored, ~95 MB), so
git alone cannot say which Unity build an app links. This file can. Change it
whenever the framework is re-exported, in the same commit as any Swift change
that needs the new export.

## Current pin (10 Oct 2026)

```
UNITY_COMMIT=47560e40567c5a0c92df1e69706a22bab351f463
DUEL_COMMIT=af4aa08efb221dddbaeb83a93bfe7337eb2d3ec9
UNITY_EDITOR=6000.0.84f1
FRAMEWORK_SHA256=2c504d9fe6ce3f9d8ef9257940fd35792ea77aa0ca345836d9c62aa1578b6d99
RELEASE_REPO=ubmids/costquest-ios
RELEASE_TAG=unity-fw-47560e4
```

| | |
|---|---|
| Unity project | ubmids/costquest-unity `street-look` @ 47560e4 (5 Oct 2026). Contains `duel`, `look-pass` and `master`; NOT `movement-wip` (parked WIP, unverified) |
| Combat sim | ubmids/costquest-duel `street-look` @ af4aa08. Unity resolves it as local packages `file:../../costquest-duel/src/CosQuest.{Combat,Duel}`, so this checkout is a build input too |
| Editor | Unity 6000.0.84f1 (78ab6fc243d5), IL2CPP Master, managed stripping High |
| Exported | 10 Oct 2026 01:38 to 01:40 WAT, `scripts/sync-unity.sh` (BuildScript.BuildIOS, then xcodebuild UnityFramework Release iphoneos, Xcode 27.1) |
| Binary | `UnityFramework.framework/UnityFramework` 42,894,976 bytes, sha256 above (unsigned; the copy embedded in a signed .app differs because Xcode re-signs it) |
| Scenes | World, Duel, Hub, Battle |
| Stored | GitHub release `unity-fw-47560e4` on ubmids/costquest-ios (zip); local archive `~/Desktop/costquest-unity-frameworks/unity-47560e4_duel-af4aa08_20261010/` |

Get it: `scripts/fetch-unity-framework.sh` (downloads the release and checks the
sha256), or `scripts/fetch-unity-framework.sh --build` (re-exports from the
pinned commits; a rebuild is not byte-identical, so it prints the new sha256).

Known side effect: every export rewrites `Assets/Settings/CQ_URP.asset`
(`m_PrefilteringModeScreenSpaceOcclusion` 2 to 1; URP computes it at build
time). It was reverted after this export; revert it after yours.

## The bridge contract this pin satisfies

Swift to Unity (`UnitySendMessage`):
- `BattleBridge`: `StartBattle(setupJson)`, `DemoBattle`, `SetPaused("1"|"0")`, `Quit`
- `DuelBridge`: `StartDuel(setupJson)`, `DemoDuel`, `Quit`
- `HubBridge`: `ShowHall(json)`, `PlayEmote(id)`, `Mood(mood)`, `Pause("1"|"0")`, `HideHall`

Unity to Swift (C symbols exported by the framework, from `Assets/Plugins/iOS/CQNativeBridge.m`):
`CQSetAnchorTappedCallback`, `CQSetCheckpointTappedCallback`, `CQSetWorldReadyCallback`,
`CQSetDuelEventCallback`, `CQSetHubEventCallback`, `CQSetBattleEventCallback`
(event kinds `ready`, `sfx`, `finished`, `quit`).

Battle setup JSON may carry `"arena": "street"|"courtyard"`; when it is absent
this export draws the street arena. Battle inputs go to the server as engine
wire v2 (what backend main `app/roam_battle.py` judges).

## Previous framework (28 Sep 2026, provenance recovered 10 Oct)

```
UNITY_COMMIT=37452668d67462bd32908f5d11e67024bdc22730
DUEL_COMMIT=8d2bacd (costquest-duel main)
FRAMEWORK_SHA256=0a39fafa5212673976661711ae3a16b3376eeb05c5e8529800678c76cce02dcd
```

Exported 28 Sep 22:10, built 22:15, 14 minutes after Unity commit 3745266
(21:56). Evidence: the Battle scene is in the build (added to the build list
by 3745266), `PerformanceTestRunInfo` is in resources.assets (added by
3745266), `ShowHall`/`BattleRunner`/`BattleTime` are in the IL2CPP metadata
(28 Sep), and `SetPaused` (d40b72d) and `InputSource` (ddc7b6c), both 30 Sep,
are not. It predates combat wire v2 (costquest-duel c671979, 30 Sep).

It was out of contract with this app: `BattleBridge.SetPaused` did not exist
(the 30 Sep pause page did nothing), the 30 Sep phone fixes (fight never
advancing, missed touches) were missing, and it sent wire v1 inputs the
backend no longer judges. Kept at
`~/Desktop/costquest-unity-frameworks/unity-3745266_duel-8d2bacd_20260928/`.
