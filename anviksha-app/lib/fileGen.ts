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

export function downloadQuestionPaperPDF(subject: string, marks: number, bloom: string) {
  const doc = new jsPDF();
  let y = 20;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("GSSSIETW", 105, y, { align: "center" });
  y += 6;
  doc.text("Question Paper", 105, y, { align: "center" });
  y += 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Subject Code: ${subject} | Max Marks: ${marks} | Time: 3 Hours | Bloom's Level: ${bloom}`, 105, y, { align: "center" });
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.text("Part A — Short Answer Questions", 15, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  const partA = [
    `1. Define the core concepts covered in ${subject} and list two examples. [5 Marks]`,
    "2. Explain the different types of keys used in relational schemas. [5 Marks]",
    "3. What is normalization? Explain up to 3NF. [5 Marks]",
  ];
  partA.forEach((line) => { const l = doc.splitTextToSize(line, 180); doc.text(l, 15, y); y += l.length * 6 + 2; });

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("Part B — Long Answer Questions", 15, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  const partB = [
    "4. Explain the ER model with a neat diagram. [10 Marks]",
    "5. Discuss functional dependencies with examples. [10 Marks]",
  ];
  partB.forEach((line) => { const l = doc.splitTextToSize(line, 180); doc.text(l, 15, y); y += l.length * 6 + 2; });

  doc.save(`${subject}_Question_Paper.pdf`);
}

export function downloadGeneratedQuestionPaperPDF(details: any, parts: any[], set: string) {
  const doc = new jsPDF(); let y = 18;
  const heading = (text: string, size = 11) => { doc.setFontSize(size); doc.setFont("helvetica", "bold"); doc.text(text, 105, y, { align: "center" }); y += size === 11 ? 6 : 7; };
  if (details.custom_header_image) {
    try { doc.addImage(details.custom_header_image, "JPEG", 15, y, 180, 28); y += 33; } catch { /* invalid image data is omitted rather than breaking the export */ }
  }
  heading((details.college_name || "COLLEGE NAME").toUpperCase(), 14); heading((details.department || "DEPARTMENT").toUpperCase()); heading(`${details.exam_type || "EXAMINATION"} — ${details.academic_year || ""}`.toUpperCase()); heading(`QUESTION PAPER — SET ${set}`);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.text(`SEM: ${details.semester || ""}    SUBJECT: ${details.subject_name || ""}    CODE: ${details.subject_code || ""}`, 15, y); y += 5; doc.text(`TIME: ${details.time || ""}    DATE: ${details.date || ""}    MAX MARKS: ${details.total_marks || ""}`, 15, y); y += 8;
  doc.setFont("helvetica", "bold"); doc.text(`Instructions: ${details.instructions || ""}`, 15, y); y += 8;
  parts.forEach((part) => { if (y > 265) { doc.addPage(); y = 18; } doc.setFont("helvetica", "bold"); doc.text(part.name, 105, y, { align: "center" }); y += 6; doc.setFont("helvetica", "normal"); part.questions.forEach((q: any, i: number) => { const text = `${i + 1}. ${q.question} (${q.co}) [${q.marks} Marks]`; const lines = doc.splitTextToSize(text, 175); if (y + lines.length * 5 > 275) { doc.addPage(); y = 18; } doc.text(lines, 17, y); y += lines.length * 5 + 3; }); y += 3; });
  doc.setFontSize(8); doc.text("End of Question Paper", 105, 287, { align: "center" }); doc.save(`${(details.subject_code || "question_paper").replace(/\s+/g, "_")}_Set_${set}.pdf`);
}

export async function downloadGeneratedQuestionPaperDOCX(details: any, parts: any[], set: string) {
  const children: Paragraph[] = [new Paragraph({ text: (details.college_name || "COLLEGE NAME").toUpperCase(), heading: HeadingLevel.HEADING_1, alignment: "center" }), new Paragraph({ text: details.department || "DEPARTMENT", alignment: "center" }), new Paragraph({ text: `${details.exam_type || "EXAMINATION"} — ${details.academic_year || ""} | SET ${set}`, alignment: "center" }), new Paragraph({ text: `SEM: ${details.semester || ""} | SUBJECT: ${details.subject_name || ""} | CODE: ${details.subject_code || ""}` }), new Paragraph({ text: `TIME: ${details.time || ""} | DATE: ${details.date || ""} | MAX MARKS: ${details.total_marks || ""}` }), new Paragraph({ text: `Instructions: ${details.instructions || ""}` })];
  parts.forEach((part) => { children.push(new Paragraph({ text: part.name, heading: HeadingLevel.HEADING_2, alignment: "center" })); part.questions.forEach((q: any, i: number) => children.push(new Paragraph({ text: `${i + 1}. ${q.question} (${q.co}) [${q.marks} Marks]` }))); });
  const blob = await Packer.toBlob(new Document({ sections: [{ children }] })); saveAs(blob, `${(details.subject_code || "question_paper").replace(/\s+/g, "_")}_Set_${set}.docx`);
}

export async function downloadPresentationPPTX(topic: string, slides: { title: string; subtitle: string }[]) {
  // NOTE: pptxgenjs was attempted here but its packaging conflicts with this
  // Next.js build setup (blocks Node-only fs/https imports even in browser bundles).
  // Reverted rather than ship a broken build — real .pptx generation needs a
  // different approach (e.g. a server-side endpoint using python-pptx) in a later pass.
  throw new Error("PPTX generation not yet available in this build — see fileGen.ts note");
}
