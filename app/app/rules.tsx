// ==========================================
// WEBSITE: THE OFFICIAL RULES (cosquest.vercel.app/rules, /rules?v=2)
// ==========================================
// The rules every paid ticket accepts at checkout (the version is saved on the
// order). Published by admins with a second person's approval. Normal look.
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { useInk } from "@/constants/chatTheme";
import { FONTS } from "@/constants/fonts";
import { getRules, type OfficialRules } from "@/services/rules";

const PINK = "#C34D9C";

export default function RulesPage() {
  const ink = useInk();
  const { v } = useLocalSearchParams<{ v?: string }>();
  const [rules, setRules] = useState<OfficialRules | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    getRules(v ? Number(v) : undefined)
      .then(setRules)
      .catch((e) => setError(e?.message || "Couldn't load the rules."));
  }, [v]);

  const text = (light: string) => ink.text(light);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: ink.dark ? "#14151F" : "#F4F8FD" }} contentContainerStyle={{ padding: 20, paddingBottom: 48, width: "100%", maxWidth: 760, alignSelf: "center", gap: 10 }}>
      {error ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: "#D9364F" }}>{error}</Text>
      ) : rules === undefined ? (
        <ActivityIndicator color={PINK} style={{ marginTop: 40 }} />
      ) : !rules ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 15, color: text("#66738A") }}>The official rules haven't been published yet.</Text>
      ) : (
        <View style={{ gap: 10, padding: 20, borderRadius: 20, backgroundColor: ink.dark ? "#1F2130" : "#FFFFFF" }}>
          <Text style={{ fontFamily: FONTS.bold, fontSize: 24, color: text("#24283C") }}>{rules.title}</Text>
          <Text style={{ fontFamily: FONTS.medium, fontSize: 13, color: PINK }}>
            Version {rules.version} · published {new Date(rules.publishedAt).toLocaleDateString()}
          </Text>
          {rules.body.split("\n").map((line, i) => {
            const t = line.trim();
            if (!t) return <View key={i} style={{ height: 4 }} />;
            if (t.startsWith("## ")) return <Text key={i} style={{ marginTop: 8, fontFamily: FONTS.semibold, fontSize: 16.5, color: text("#24283C") }}>{t.slice(3)}</Text>;
            if (t.startsWith("# ")) return <Text key={i} style={{ marginTop: 10, fontFamily: FONTS.bold, fontSize: 19, color: text("#24283C") }}>{t.slice(2)}</Text>;
            if (t.startsWith("- ")) return <Text key={i} style={{ fontFamily: FONTS.regular, fontSize: 14.5, lineHeight: 22, color: text("#3D4256") }}>{"  •  "}{t.slice(2)}</Text>;
            return <Text key={i} style={{ fontFamily: FONTS.regular, fontSize: 14.5, lineHeight: 22, color: text("#3D4256") }}>{t}</Text>;
          })}
        </View>
      )}
    </ScrollView>
  );
}
