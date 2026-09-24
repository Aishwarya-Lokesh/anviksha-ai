"use client";

import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { ChatPanel } from "@/components/ui/AskAI";
import { api } from "@/lib/api";

export default function StudentAssistantPage() {
  const initialQuestion = useSearchParams().get("q") || undefined;
  return (
    <>
      <Topbar greeting="Ask Anviksha AI" subtitle="Scoped to your own academic data" avatarLetter="S" />
      <div className="p-8">
        <ChatPanel
          suggestions={["What's my CGPA and rank?", "Am I placed?", "Did I get any certificates or internships?", "How has my SGPA changed across semesters?"]}
          askReal={api.askAI}
          initialQuestion={initialQuestion}
        />
      </div>
    </>
  );
}
