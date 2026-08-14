import type { Metadata } from "next";
import { HistoryView } from "@/components/guild/HistoryView";

export const metadata: Metadata = {
  title: "History",
  description: "Review saved Lanternwatch project runs and team statistics.",
};

export default function History() {
  return <HistoryView />;
}
