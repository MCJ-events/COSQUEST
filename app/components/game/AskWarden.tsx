// "Ask the Warden" (costquest-ios UI/WardenView.swift): asking the game a
// question. Framed as an assistant, never the referee: the server judges the
// game. The rule a question is about shows at once and stays; the on-device
// model (when it is loaded) writes the answer from it, and with no model the
// rule is the answer. Four openers are offered as taps, because typing on a
// phone held at arm's length outdoors is miserable.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "@/components/ui/keyboard";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { askPrompt, type AskContext, OPENERS, plainAnswer, settleAnswer, type Turn } from "@/features/game/askWarden";
import { useGame } from "@/features/game/runtime";
import { askModel, startWardenModel, stopModel, useWardenModel } from "@/features/game/wardenModel";

import { GameButton, GameIconButton, GameTitle, MAX_FONT_SCALE, announce, withAlpha } from "./kit";
import { SheetHost } from "./Sheet";
import { GF, GP } from "./theme";
import { wardenVoice } from "./wardenVoice";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

const OPENER_COLORS = [GP.skyDeep, GP.berry, GP.sunDeep, GP.mint];
const BRASS = "#C9A55C";

export default function AskWarden({ onClose }: { onClose: () => void }) {
  return (
    <SheetHost band="any" scrimLabel="Close Ask the Warden" onClose={onClose}>
      {(close) => <AskBody close={close} />}
    </SheetHost>
  );
}

function AskBody({ close }: { close: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const insets = useSafeAreaInsets();
  const me = useGame((s) => s.me);
  const problem = useGame((s) => s.problem);
  const points = useGame((s) => s.points);
  const model = useWardenModel();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [answering, setAnswering] = useState(false);
  const serial = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const usesModel = model.phase === "ready";

  // Start loading the model while the player reads the openers, not on their first question.
  useEffect(() => {
    void startWardenModel((w) => wardenVoice.setWriter(w));
  }, []);

  const context = (): AskContext => ({
    title: "CostQuest",
    faction: me?.faction_name ?? null,
    nearby: points.slice(0, 3).map((p) => p.name),
    isOnline: problem === null,
  });

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || answering) return;
    setQuestion("");
    const c = context();
    const rule = plainAnswer(q, c);
    const asked: Turn = { id: ++serial.current, fromPlayer: true, text: q };
    if (!usesModel) {
      const answer: Turn = { id: ++serial.current, fromPlayer: false, text: rule };
      setTurns((t) => [...t, asked, answer]);
      announce(rule);
      return;
    }
    // Seeded with the rule, so something true is on screen while the model writes.
    const id = ++serial.current;
    const history = turns;
    setTurns((t) => [...t, asked, { id, fromPlayer: false, text: "", rule }]);
    setAnswering(true);
    const out = await askModel(askPrompt(c, history, q));
    const settled = settleAnswer(out?.text, rule);
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, text: settled.text, rule: settled.rule } : x)));
    setAnswering(false);
    announce(settled.text);
  };

  const canSend = question.trim().length > 0 && !answering;

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <View style={styles.header}>
        <GameIconButton icon="close" color={GP.berry} diameter={40} onPress={close} accessibilityLabel="Close" />
        <View style={{ flex: 1, alignItems: "center" }}>
          <GameTitle text="ASK THE GAME" size={26} />
        </View>
        {answering ? (
          <GameIconButton icon="stop" color={GP.berry} diameter={40} onPress={stopModel} accessibilityLabel="Stop" />
        ) : turns.length ? (
          <GameIconButton icon="refresh" color={GP.skyDeep} diameter={40} onPress={() => setTurns([])} accessibilityLabel="Clear" />
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {turns.length === 0 ? (
        <Animated.View entering={FadeIn} style={styles.intro}>
          <Ionicons name="cloud-offline" size={34} color={GP.sun} />
          <View style={{ gap: 6, alignItems: "center" }}>
            <Text style={styles.introTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {usesModel ? "This runs on your phone" : "Straight from the rulebook"}
            </Text>
            <Text style={styles.introText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {usesModel
                ? "It answers with no network at all, so it still works when the venue's signal does not. The server still judges the game; this only explains it."
                : "Answers come from the game's own rules while the assistant finishes downloading. The server still judges the game; this only explains it."}
            </Text>
          </View>
          <View style={{ gap: 6, alignSelf: "stretch", paddingHorizontal: 24 }}>
            {OPENERS.map((o, i) => (
              <GameButton key={o} title={o} size="medium" color={OPENER_COLORS[i % 4]} onPress={() => void send(o)} />
            ))}
          </View>
        </Animated.View>
      ) : (
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={styles.turns} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
          {turns.map((t) => (
            <Animated.View key={t.id} entering={FadeInDown.duration(200)} style={[styles.turn, t.fromPlayer ? styles.mine : styles.theirs]}>
              {t.rule ? (
                <View style={styles.rule} accessible accessibilityLabel={`Rule: ${t.rule}`}>
                  <Ionicons name="book" size={11} color={BRASS} style={{ marginTop: 2 }} />
                  <Text style={styles.ruleText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {t.rule}
                  </Text>
                </View>
              ) : null}
              {t.text || !t.rule ? (
                <Text style={[styles.bubble, t.fromPlayer ? styles.bubbleMine : styles.bubbleTheirs]} selectable maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {t.text || "…"}
                </Text>
              ) : null}
            </Animated.View>
          ))}
        </ScrollView>
      )}

      <View style={[styles.composer, { paddingBottom: insets.bottom + 16 }]}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask about the game"
          placeholderTextColor="rgba(255,255,255,0.45)"
          multiline
          style={styles.input}
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={() => void send(question)}
          accessibilityLabel="Ask about the game"
        />
        <View pointerEvents={canSend ? "auto" : "none"} accessibilityState={{ disabled: !canSend }}>
          <GameIconButton icon="arrow-up" color={canSend ? GP.mint : "#737373"} diameter={44} onPress={() => void send(question)} accessibilityLabel="Send" />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const STYLE_PAIR = themedStyles({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.navy },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  intro: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  introTitle: { fontFamily: GF.display, fontSize: 24, color: "#FFF" },
  introText: { fontFamily: GF.body, fontSize: 15, color: "rgba(255,255,255,0.7)", textAlign: "center", paddingHorizontal: 34 },
  turns: { padding: 20, gap: 14 },
  turn: { gap: 6 },
  mine: { alignItems: "flex-end", paddingLeft: 40 },
  theirs: { alignItems: "flex-start", paddingRight: 40 },
  rule: { flexDirection: "row", gap: 7, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: withAlpha(BRASS, 0.1) },
  ruleText: { flexShrink: 1, fontFamily: GF.regular, fontSize: 12, color: BRASS },
  bubble: { fontFamily: GF.body, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  bubbleMine: { color: GP.ink, backgroundColor: GP.sun },
  bubbleTheirs: { color: "#FFF", backgroundColor: withAlpha(GP.navy, 0.9) },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  input: { flex: 1, maxHeight: 110, padding: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", color: "#FFF", fontFamily: GF.body, fontSize: 16 },
});
