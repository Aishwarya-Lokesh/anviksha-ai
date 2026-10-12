"use client";

import jsPDF from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";

export function downloadResumePDF(profile: any, sections: { title: string; content: string }[], template: string = "Classic") {
  const doc = new jsPDF();
  let y = 20;
  const isATS = template === "ATS Friendly";
  const isMinimal = template === "Minimal";
  const accentColor: [number, number, number] = isATS ? [0, 0, 0] : isMinimal ? [80, 80, 80] : [91, 63, 217];

  doc.setFontSize(isMinimal ? 14 : 18);
  doc.setFont("helvetica", "bold");
  if (!isMinimal) doc.setTextColor(...accentColor);
  doc.text(profile.name?.toUpperCase() || "STUDENT", 105, y, { align: "center" });
  doc.setTextColor(0, 0, 0);
  y += isMinimal ? 6 : 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${profile.usn || ""} | ${profile.dept || ""}`, 105, y, { align: "center" });
  y += 5;
  doc.text(`${profile.contactEmail || ""} ${profile.contactPhone ? "· " + profile.contactPhone : ""} ${profile.contactLocation ? "· " + profile.contactLocation : ""}`, 105, y, { align: "center" });
  y += 6;
  if (!isATS) {
    doc.setDrawColor(...accentColor);
    doc.line(15, y, 195, y);
    y += 6;
  } else {
    y += 4;
  }

  for (const section of sections) {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.setFontSize(isMinimal ? 10 : 12);
    doc.setFont("helvetica", "bold");
    if (!isMinimal) doc.setTextColor(...accentColor);
    doc.text(section.title.toUpperCase(), 15, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(section.content || "Not specified", 180);
    doc.text(lines, 15, y);
    y += lines.length * 5 + (isMinimal ? 4 : 6);
  }

  doc.save(`${(profile.name || "resume").replace(/\s+/g, "_")}_Resume_${template.replace(/\s+/g, "_")}.pdf`);
}

export async function downloadResumeDOCX(profile: any, sections: { title: string; content: string }[]) {
  const children: Paragraph[] = [
    new Paragraph({ text: profile.name?.toUpperCase() || "STUDENT", heading: HeadingLevel.HEADING_1, alignment: "center" }),
    new Paragraph({ text: `${profile.usn || ""} | ${profile.dept || ""}`, alignment: "center" }),
    new Paragraph({ text: `${profile.email || ""}`, alignment: "center" }),
    new Paragraph({ text: "" }),
  ];

  for (const section of sections) {
    children.push(new Paragraph({ text: section.title.toUpperCase(), heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ text: section.content || "Not specified" }));
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${(profile.name || "resume").replace(/\s+/g, "_")}_Resume.docx`);
}

export function downloadResumePlainText(profile: any, sections: { title: string; content: string }[]) {
  const lines: string[] = [];
  lines.push((profile.name || "STUDENT").toUpperCase());
  lines.push(`${profile.usn || ""} | ${profile.dept || ""}`);
  lines.push("");

  for (const section of sections) {
    lines.push(section.title.toUpperCase());
    lines.push(section.content || "Not specified");
    lines.push("");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  saveAs(blob, `${(profile.name || "resume").replace(/\s+/g, "_")}_ATS_Plain.txt`);
}

export function downloadExcel(rows: any[], filename: string, sheetName = "Sheet1") {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
