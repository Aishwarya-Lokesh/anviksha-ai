"use client";

import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { ChatPanel } from "@/components/ui/AskAI";
import { api } from "@/lib/api";

export default function TeacherAssistantPage() {
  const initialQuestion = useSearchParams().get("q") || undefined;
  return (
    <>
      <Topbar greeting="Ask Anviksha AI" subtitle="Scoped to your own students and subjects" avatarLetter="R" />
      <div className="p-8">
        <ChatPanel
          suggestions={["Which students are below 75% attendance?", "Give me a list of my students with backlogs", "Who is my top performer?", "Do any of my students have internships or achievements?"]}
          askReal={api.teacherAskAI}
          initialQuestion={initialQuestion}
        />
      </div>
    </>
  );
}
