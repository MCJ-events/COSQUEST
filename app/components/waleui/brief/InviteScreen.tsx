// Invite a friend (13 Nov 2026, the brief's "Faction recruitment referral"; feature `referrals`).
// Your code, big, with Share and Copy; the reward when the team has set one (nothing is said about a
// reward while it is none); "Got a code?" for a new player; who joined with yours.
// The reward is Costcoin or a cosmetic, never XP (XP is earned by playing). The server pays it when
// the friend finishes their first quest, and decides every rule (one code per player and per phone).
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import { Share, View } from "react-native";

import { fetchReferralMe, normaliseReferralCode, redeemErrorText, redeemReferral, type ReferralMe, referralStatusText, rewardLine, showReferrals } from "@/features/game/briefFeatures";
import { gameStore } from "@/features/game/runtime";

import { ArtIcon, LineIcon, T, W } from "../kit";
import { BigCode, BriefScreen, Card, Chip, Field, GhostButton, Label, Loading, NotOpen, P, PinkButton, Say, installId, useBriefFlags } from "./briefKit";

const ICON = require("@/assets/images/waleui/icon_team_up.png");
const FRIEND = require("@/assets/images/waleui/icon_add_friend.png");

export default function InviteScreen({ initialCode }: { initialCode?: string | null }) {
  const flags = useBriefFlags();
  const [me, setMe] = useState<ReferralMe | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState(normaliseReferralCode(initialCode));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; good: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setMe(await fetchReferralMe(gameStore.client));
      setErr(null);
    } catch (e) {
      setErr(redeemErrorText(e));
    }
  }, []);

  const on = showReferrals(flags);
  useEffect(() => {
    if (on) void load();
  }, [on, load]);

  const share = async () => {
    if (!me) return;
    try {
      await Share.share({ message: me.share_text.includes(me.link) ? me.share_text : `${me.share_text} ${me.link}`, url: me.link });
    } catch {
      // the share sheet was closed
    }
  };

  const copy = async () => {
    if (!me) return;
    await Clipboard.setStringAsync(me.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const redeem = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await redeemReferral(gameStore.client, code, await installId());
      const who = r.referrer_handle ? `${r.referrer_handle}'s` : "Your friend's";
      setSaid({ text: `${who} code is in. ${r.qualify || "Finish your first quest to complete it."}`, good: true });
      void load();
    } catch (e) {
      setSaid({ text: redeemErrorText(e), good: false });
    } finally {
      setBusy(false);
    }
  };

  const line = rewardLine(me);
  const recruits = me?.recruits ?? [];
  return (
    <BriefScreen title="Invite a friend" kicker="Bring your crew" icon={ICON} testID="brief-invite">
      {flags === null ? (
        <Loading />
      ) : !on ? (
        <NotOpen what="Invites" testID="brief-invite-off" />
      ) : !me ? (
        err ? (
          <Card>
            <Say text={err} />
            <GhostButton label="Try again" onPress={() => void load()} />
          </Card>
        ) : (
          <Loading />
        )
      ) : (
        <>
          <Card tone="solid" testID="brief-invite-code-card">
            <Label>Your code</Label>
            <BigCode code={me.code} testID="brief-invite-code" />
            <P color={W.inkSoft} align="center">
              Friends type it in CosQuest, or open your link.
            </P>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <PinkButton label="Share" onPress={() => void share()} testID="brief-invite-share" />
              </View>
              <View style={{ flex: 1, justifyContent: "center" }}>
                <GhostButton label={copied ? "Copied" : "Copy code"} onPress={() => void copy()} testID="brief-invite-copy" icon={copied ? <LineIcon name="check" size={14} /> : null} />
              </View>
            </View>
            {line ? (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }} testID="brief-invite-reward">
                <ArtIcon w={20} h={17} source={require("@/assets/images/waleui/coin.png")} />
                <View style={{ flex: 1 }}>
                  <P size={12}>{line}</P>
                </View>
              </View>
            ) : null}
          </Card>

          {me.referred_by ? (
            <Card testID="brief-invite-referred">
              <Label>You joined with</Label>
              <P weight={600}>{`${me.referred_by.handle || "A friend"} (${me.referred_by.code})`}</P>
              <P color={W.inkSoft}>{me.referred_by.status === "pending" ? "Finish your first quest to complete it." : referralStatusText(me.referred_by.status)}</P>
            </Card>
          ) : me.can_redeem ? (
            <Card testID="brief-invite-redeem">
              <Label>Got a code?</Label>
              <P color={W.inkSoft}>If a friend invited you, put their code in. It counts once you finish your first quest.</P>
              <Field value={code} onChangeText={(s) => setCode(normaliseReferralCode(s))} placeholder="FRIEND'S CODE" big maxLength={12} testID="brief-invite-redeem-field" />
              <PinkButton label="Use code" onPress={() => void redeem()} disabled={code.length < 4} busy={busy} testID="brief-invite-redeem-go" />
              <Say text={said?.text ?? null} good={said?.good} testID="brief-invite-redeem-said" />
            </Card>
          ) : said ? (
            <Card>
              <Say text={said.text} good={said.good} />
            </Card>
          ) : null}

          <Card testID="brief-invite-recruits">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ArtIcon w={14} h={16} source={FRIEND} />
              <Label>{`Joined with your code (${recruits.length})`}</Label>
            </View>
            {recruits.length === 0 ? (
              <P color={W.inkSoft}>Nobody yet. Share your code at your next CosQuest.</P>
            ) : (
              recruits.map((r, i) => (
                <View key={`${r.handle}-${i}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
                  <T size={13} weight={600}>
                    {r.handle}
                  </T>
                  <Chip text={referralStatusText(r.status)} tone={r.status === "pending" ? "slate" : r.status === "void" ? "purple" : "green"} />
                </View>
              ))
            )}
          </Card>
        </>
      )}
    </BriefScreen>
  );
}
