"use client";

import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { ChatPanel } from "@/components/ui/AskAI";
import { api } from "@/lib/api";

export default function HodAssistantPage() {
  const initialQuestion = useSearchParams().get("q") || undefined;
  return (
    <>
      <Topbar greeting="Ask Anviksha AI" subtitle="Scoped to your authorized department" avatarLetter="H" />
      <div className="p-4 md:p-8">
        <ChatPanel
          suggestions={["What is our department's average CGPA?", "Which students are at risk?", "Show faculty workload by subject."]}
          askReal={api.hodAskAI}
          initialQuestion={initialQuestion}
        />
      </div>
    </>
  );
}
