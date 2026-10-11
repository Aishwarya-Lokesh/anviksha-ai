"use client";

import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { ChatPanel } from "@/components/ui/AskAI";
import { api } from "@/lib/api";

export default function AdminAssistantPage() {
  const initialQuestion = useSearchParams().get("q") || undefined;
  return (
    <>
      <Topbar greeting="Ask Anviksha AI" subtitle="Institute-wide aggregate queries" avatarLetter="A" />
      <div className="p-4 md:p-8">
        <ChatPanel
          suggestions={["How many students are in each department?", "Who is the top performer in the 2023 batch?", "How many pending document requests?", "What is our overall placement rate?"]}
          askReal={api.adminAskAI}
          initialQuestion={initialQuestion}
        />
      </div>
    </>
  );
}
