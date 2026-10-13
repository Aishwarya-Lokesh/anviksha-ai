"use client";

import { Topbar } from "@/components/layout/Topbar";
import { ProjectFormats } from "@/components/projects/ProjectFormats";

export default function Page() {
  return (
    <>
      <Topbar greeting="Project Formats" subtitle="Dashboard > Project Formats" avatarLetter="H" />
      <ProjectFormats role="hod" />
    </>
  );
}
