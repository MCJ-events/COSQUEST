// The Wallet (payment brief, section 11): CosCoin balance, CosCoin purchase
// and spend history, quest entry receipts and payout status, all from the
// server. Never a cash balance. In Wale's style (his Settings frame: 430 wide,
// the same frosted panels, Poppins, his coin and XP art), laid out top to
// bottom because the lists vary in length. Wale has not drawn a wallet; when
// he does, his frame replaces this layout.
//
// The three kinds of value are told apart at a glance (VALUE_STYLE):
//   CosCoin  gold, his coin, "In-game only. No cash value."
//   XP       purple, his XP coin, "Earned by playing. Can't be bought."
//   money    plain ink with the currency code and a card icon, receipts only.
//
// Manage purchases shows only when the server says the payments website is set
// (GET /v1/pay/config manage_purchases); otherwise it is not drawn at all.
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { useGame } from "@/features/game/runtime";
import {
  NO_CASH_NOTE,
  NOT_CONNECTED,
  VALUE_STYLE,
  type Part,
  coinsText,
  entryStatusText,
  historyLabel,
  payoutStatusText,
  receiptText,
  relativeDay,
  signedCoins,
  unavailableText,
  xpText,
} from "@/features/game/payLink";

import { back } from "./go";
import { Art, At, DesignCanvas, LineIcon, T, Tap, W, WaleFooter, glass } from "./kit";
import { manageNow, refreshWallet, useWallet } from "./walletModel";

const FW = 430;
const X = 24;
const CW = 382;
const ROW = 46;
const MAX_ROWS = 20;

const COIN = require("@/assets/images/waleui/coin.png");
const XP_COIN = require("@/assets/images/waleui/xp_coin.png");

type Block = { h: number; draw: (y: number) => ReactNode };

function heading(text: string, testID: string): Block {
  return {
    h: 34,
    draw: (y) => (
      <At key={testID} x={X} y={y + 8}>
        <T size={13} weight={700} style={{ lineHeight: 20 }} testID={testID}>
          {text}
        </T>
      </At>
    ),
  };
}

function line(text: string, testID: string, color: string = W.inkSoft): Block {
  return {
    h: 30,
    draw: (y) => (
      <At key={testID} x={X} y={y + 4} w={CW}>
        <T size={11} weight={400} color={color} lines={2} testID={testID}>
          {text}
        </T>
      </At>
    ),
  };
}

function rows<T>(p: Part<T[]>, id: string, empty: string, draw: (row: T, y: number, i: number) => ReactNode): Block[] {
  if (!p.available) return [line(unavailableText(p.reason), `${id}-unavailable`)];
  if (p.value.length === 0) return [line(empty, `${id}-empty`)];
  return p.value.slice(0, MAX_ROWS).map((r, i) => ({ h: ROW, draw: (y: number) => draw(r, y, i) }));
}

function RowBox({ y, testID, children }: { y: number; testID: string; children: ReactNode }) {
  return (
    <At x={X} y={y} w={CW} h={ROW - 6} style={[glass(10, "rgba(255,255,255,0.32)"), { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 10 }]} testID={testID}>
      {children}
    </At>
  );
}

function Chip({ text, tone }: { text: string; tone: "ok" | "wait" | "bad" | "plain" }) {
  const bg = tone === "ok" ? "#E3F0CC" : tone === "wait" ? "#FFF1CC" : tone === "bad" ? "#F8DADA" : "rgba(255,255,255,0.6)";
  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
      <T size={9} weight={700} color={W.ink}>
        {text}
      </T>
    </View>
  );
}

const tone = (s: string): "ok" | "wait" | "bad" | "plain" =>
  s === "paid" || s === "approved" ? "ok" : s === "pending" || s === "pending_review" || s === "queued" || s === "held" ? "wait" : s === "failed" || s === "cancelled" ? "bad" : "plain";

export default function WalletScreen() {
  const w = useWallet();
  const meCoins = useGame((s) => s.me?.coins ?? null);
  const totalXp = useGame((s) => s.me?.standing?.xp ?? null);
  useEffect(() => {
    void refreshWallet();
  }, []);

  const bal = w.wallet?.balance ?? null;
  const connected = !!bal?.available;
  // The CosCoin number: the payments service's when it is connected; until then the game
  // server's own count (the same one the Home pill shows), labelled as such. Never worked out here.
  const coins = bal && bal.available ? bal.value.coins : meCoins;
  const coinLabel = connected ? "CosCoin balance" : "CosCoins in game";
  const coinSub = connected ? VALUE_STYLE.coin.note : `${VALUE_STYLE.coin.note} ${w.config ? NOT_CONNECTED : ""}`.trim();

  const blocks: Block[] = [];
  // balance card
  blocks.push({
    h: 116,
    draw: (y) => (
      <At key="bal" x={X} y={y} w={CW} h={104} style={[glass(14, VALUE_STYLE.coin.tint), { borderColor: "#E8C66A" }]} testID="wallet-coins">
        <Art x={16} y={18} w={34} h={29} source={COIN} />
        <At x={60} y={14}>
          <T size={11} weight={600} color={VALUE_STYLE.coin.color} testID="wallet-coins-label">
            {coinLabel}
          </T>
        </At>
        <At x={60} y={32} w={CW - 76}>
          <T size={26} weight={800} color={VALUE_STYLE.coin.color} style={{ lineHeight: 34 }} testID="wallet-coins-value">
            {coins === null ? "–" : coinsText(coins)}
          </T>
        </At>
        <At x={16} y={72} w={CW - 32}>
          <T size={10} weight={400} color={W.inkSoft} lines={2} testID="wallet-coins-note">
            {bal?.available && bal.value.frozen ? "Paused on this account. Contact support." : coinSub}
          </T>
        </At>
      </At>
    ),
  });
  // XP card: earned only, its own colour
  blocks.push({
    h: 74,
    draw: (y) => (
      <At key="xp" x={X} y={y} w={CW} h={62} style={[glass(14, VALUE_STYLE.xp.tint), { borderColor: "#C9B8F2", flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 }]} testID="wallet-xp">
        <View style={{ width: 24, height: 24 }}>
          <Art x={0} y={0} w={24} h={24} source={XP_COIN} />
        </View>
        <View style={{ flex: 1 }}>
          <T size={16} weight={800} color={VALUE_STYLE.xp.color} testID="wallet-xp-value">
            {totalXp === null ? "– XP" : xpText(totalXp)}
          </T>
          <T size={10} weight={400} color={W.inkSoft}>
            {VALUE_STYLE.xp.note}
          </T>
        </View>
      </At>
    ),
  });
  // Manage purchases: only when the server has the website
  if (w.config?.manage_purchases) {
    blocks.push({
      h: 66,
      draw: (y) => (
        <Tap key="manage" x={X} y={y} w={CW} h={54} label="Manage purchases" onPress={() => void manageNow()} disabled={w.busy} style={{ backgroundColor: W.pink, borderRadius: 14, flexDirection: "row", gap: 9 }} testID="wallet-manage">
          {w.busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="card-outline" size={18} color="#FFFFFF" />}
          <T size={16} weight={800} color="#FFFFFF" spacing={0.4} style={{ lineHeight: 22 }}>
            MANAGE PURCHASES
          </T>
        </Tap>
      ),
    });
  }
  if (w.notice) blocks.push(line(w.notice, "wallet-notice", W.ink));
  if (w.error) blocks.push(line(w.error, "wallet-error", W.ink));

  const wallet = w.wallet;
  const off = { available: false as const, reason: w.config ? "unreachable" : "not_configured" };

  blocks.push(heading("CosCoin history", "wallet-history-title"));
  blocks.push(
    ...rows(wallet?.history ?? off, "wallet-history", "No CosCoin purchases or spends yet.", (r, y, i) => (
      <RowBox key={`h${r.id}`} y={y} testID={`wallet-history-${i}`}>
        <View style={{ flex: 1 }}>
          <T size={11.5} weight={700}>
            {historyLabel(r)}
          </T>
          <T size={9} weight={400} color={W.slate}>
            {relativeDay(r.at)}
          </T>
        </View>
        <T size={13} weight={800} color={VALUE_STYLE.coin.color}>
          {signedCoins(r.delta)}
        </T>
        <View style={{ width: 16, height: 14 }}>
          <Art x={0} y={0} w={16} h={14} source={COIN} />
        </View>
      </RowBox>
    )),
  );

  blocks.push(heading("Quest entries", "wallet-entries-title"));
  blocks.push(
    ...rows(wallet?.entries ?? off, "wallet-entries", "No paid quest entries yet.", (r, y, i) => (
      <RowBox key={`e${r.id}`} y={y} testID={`wallet-entry-${i}`}>
        <Ionicons name="card-outline" size={16} color={VALUE_STYLE.money.color} />
        <View style={{ flex: 1 }}>
          <T size={11.5} weight={700}>
            {r.quest_name ?? "Paid quest"}
          </T>
          <T size={9} weight={400} color={W.slate}>
            {`${VALUE_STYLE.money.label} · ${relativeDay(r.at)}`}
          </T>
        </View>
        <T size={12} weight={700} color={VALUE_STYLE.money.color}>
          {receiptText(r.amount_minor, r.currency)}
        </T>
        <Chip text={entryStatusText(r.status)} tone={tone(r.status)} />
      </RowBox>
    )),
  );

  blocks.push(heading("Payouts", "wallet-payouts-title"));
  blocks.push(
    ...rows(wallet?.payouts ?? off, "wallet-payouts", "No payouts.", (r, y, i) => (
      <RowBox key={`p${r.id}`} y={y} testID={`wallet-payout-${i}`}>
        <Ionicons name="trophy-outline" size={16} color={W.ink} />
        <View style={{ flex: 1 }}>
          <T size={11.5} weight={700}>
            {r.quest_name ?? "Quest prize"}
          </T>
          <T size={9} weight={400} color={W.slate}>
            {relativeDay(r.at)}
          </T>
        </View>
        <Chip text={payoutStatusText(r.status)} tone={tone(r.status)} />
      </RowBox>
    )),
  );
  blocks.push({ h: 56, draw: (y) => <At key="note" x={X} y={y + 10} w={CW}><T size={10} weight={400} color={W.inkSoft} lines={3} testID="wallet-note">{NO_CASH_NOTE}</T></At> });

  const TOP = 92;
  let y = TOP;
  const drawn = blocks.map((b) => {
    const node = b.draw(y);
    y += b.h;
    return node;
  });
  const height = Math.max(700, y + 50);

  return (
    <DesignCanvas width={FW} height={height} colors={["#B5D9E6", "#E6F2F8", "#D2E8F2"]} horizontal testID="wallet">
      <At x={X} y={30}>
        <T size={22} weight={700} style={{ lineHeight: 34 }} testID="wallet-title">
          Wallet
        </T>
      </At>
      {w.loading ? (
        <At x={120} y={38}>
          <ActivityIndicator color={W.inkSoft} />
        </At>
      ) : null}
      <Tap x={362} y={26} w={43.6} h={43} label="Close" onPress={() => back()} style={glass(10, "rgba(255,255,255,0.3)")} testID="wallet-close">
        <LineIcon name="x" size={25} stroke={2.7} />
      </Tap>
      {drawn}
      <WaleFooter y={height - 22} w={FW} path="COSQUEST / WALLET" testID="wallet-footer" />
    </DesignCanvas>
  );
}
