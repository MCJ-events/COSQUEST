import { router } from "expo-router";
import { Fragment } from "react";
import { FONTS } from "@/constants/fonts";
import { Text } from "react-native";
import { C } from "@/theme/tokens";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";
import { appConfig } from "@/services/appConfig";
import { legalRoute } from "@/services/legal";
import { signupLegalLinks } from "@/services/releaseGates";

// The line under the sign-up buttons. It links the Terms of Service, the
// Community Guidelines and the Privacy Policy, each only once the build names
// its URL (services/appConfig.ts). The documents are the company's to publish;
// until one exists it is left out, and with none the line is not drawn.
export function Terms() {
  const styles = useThemedStyles(STYLE_PAIR);
  const { agree, privacy } = signupLegalLinks({
    terms: appConfig.termsUrl,
    privacy: appConfig.privacyUrl,
    guidelines: appConfig.guidelinesUrl,
  });
  if (agree.length === 0 && !privacy) return null;
  const link = (doc: "terms" | "privacy" | "guidelines", label: string) => (
    <Text
      style={{ color: C.brand }}
      onPress={() => router.push(legalRoute(doc))}
      accessibilityRole="link"
      testID={`signup-legal-${doc}`}
    >
      {label}
    </Text>
  );
  return (
    <Text style={styles.terms} testID="signup-legal">
      {agree.length > 0 ? (
        <>
          By continuing you agree to the CosQuest{" "}
          {agree.map((l, i) => (
            <Fragment key={l.doc}>
              {i > 0 ? " and the " : null}
              {link(l.doc, l.label)}
            </Fragment>
          ))}
          .
        </>
      ) : null}
      {privacy ? (
        <>
          {agree.length > 0 ? " " : null}
          {"Read how we use your data in our "}
          {link(privacy.doc, privacy.label)}.
        </>
      ) : null}
    </Text>
  );
}

const STYLE_PAIR = themedStyles({
  terms: { fontFamily: FONTS.regular, fontSize: 12, color: "#707072", textAlign: "center", marginTop: 80 },
});
