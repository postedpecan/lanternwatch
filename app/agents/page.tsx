import type { Metadata } from "next";
import { AgentsView } from "@/components/guild/AgentsView";

export const metadata: Metadata = {
  title: "Agents",
  description: "Manage your global and workspace Codex agent definitions.",
};

export default function Agents() {
  return <AgentsView />;
}
