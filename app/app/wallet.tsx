// cosquest://wallet   The Wallet (components/waleui/WalletScreen.tsx), and the way back
// from the payments website: cosquest://wallet?from=payments&order=...&result=...
// The link only makes the app ask the server again; it is never proof of payment.
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import WalletScreen from "@/components/waleui/WalletScreen";
import { handleWalletReturn } from "@/components/waleui/walletModel";

export default function WalletRoute() {
  const params = useLocalSearchParams();
  const key = `${params.from ?? ""}|${params.order ?? ""}|${params.result ?? ""}`;
  useEffect(() => {
    if (params.from === "payments") void handleWalletReturn(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <WalletScreen />;
}
