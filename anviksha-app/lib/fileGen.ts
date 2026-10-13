"use client";

import jsPDF from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";

type ResumeSection = { title: string; content: string };

// The three resume designs. They differ in layout, not only in colour:
// Classic is centred with a coloured rule, Minimal is left-aligned and airy,
// ATS Friendly is plain black text that résumé-screening software reads cleanly.
const RESUME_STYLES: Record<string, {
  align: "center" | "left"; accent: [number, number, number]; body: [number, number, number];
  nameSize: number; upperName: boolean; headingSize: number; headingRule: boolean; headerRule: "thick" | "thin" | "none";
  lineHeight: number; sectionGap: number; margin: number; headingSpacing: number;
}> = {
  Classic: { align: "center", accent: [91, 63, 217], body: [40, 42, 54], nameSize: 20, upperName: true, headingSize: 11.5, headingRule: true, headerRule: "thick", lineHeight: 5, sectionGap: 6, margin: 16, headingSpacing: 0 },
  Minimal: { align: "left", accent: [120, 124, 138], body: [55, 58, 70], nameSize: 22, upperName: false, headingSize: 8.5, headingRule: false, headerRule: "none", lineHeight: 5.4, sectionGap: 8, margin: 22, headingSpacing: 1.2 },
  "ATS Friendly": { align: "left", accent: [0, 0, 0], body: [0, 0, 0], nameSize: 16, upperName: true, headingSize: 11, headingRule: true, headerRule: "thin", lineHeight: 5, sectionGap: 5, margin: 18, headingSpacing: 0 },
};

export function downloadResumePDF(profile: any, sections: ResumeSection[], template: string = "Classic") {
  const style = RESUME_STYLES[template] || RESUME_STYLES.Classic;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = style.margin;
  const right = pageWidth - style.margin;
  const width = right - left;
  const anchor = style.align === "center" ? pageWidth / 2 : left;
  const bottom = pageHeight - 16;
  let y = 22;

  // Starts a new page when the next block would run off the bottom.
  const room = (needed: number) => {
    if (y + needed > bottom) {
      doc.addPage();
      y = 20;
    }
  };

  const name = String(profile.name || "Student");
  doc.setFont("helvetica", template === "Minimal" ? "normal" : "bold");
  doc.setFontSize(style.nameSize);
  doc.setTextColor(...(template === "Minimal" ? style.body : style.accent));
  doc.text(style.upperName ? name.toUpperCase() : name, anchor, y, { align: style.align });
  y += template === "Minimal" ? 8 : 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...style.body);
  const separator = template === "ATS Friendly" ? " | " : "  ·  ";
  const identity = [profile.usn, profile.dept].filter(Boolean).join(separator);
  if (identity) {
    doc.text(identity, anchor, y, { align: style.align });
    y += 5;
  }
  const contact = [profile.contactEmail, profile.contactPhone, profile.contactLocation].filter(Boolean).join(separator);
  if (contact) {
    doc.text(contact, anchor, y, { align: style.align });
    y += 5;
  }
  if (style.headerRule !== "none") {
    doc.setDrawColor(...style.accent);
    doc.setLineWidth(style.headerRule === "thick" ? 0.8 : 0.3);
    doc.line(left, y, right, y);
  }
  y += style.headerRule === "none" ? 6 : 8;

  for (const section of sections) {
    room(style.lineHeight * 3 + 8); // never leave a heading alone at the foot of a page
    doc.setFont("helvetica", "bold");
    doc.setFontSize(style.headingSize);
    doc.setTextColor(...style.accent);
    doc.text(section.title.toUpperCase(), left, y, { charSpace: style.headingSpacing });
    if (style.headingRule) {
      doc.setDrawColor(...style.accent);
      doc.setLineWidth(0.2);
      doc.line(left, y + 1.6, right, y + 1.6);
    }
    y += style.headingRule ? 7 : 5.5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...style.body);
    const paragraphs = String(section.content || "Not specified").split(/\r?\n/);
    for (const paragraph of paragraphs) {
      const text = paragraph.trim();
      if (!text) {
        y += 2;
        continue;
      }
      const bullet = /^[-•*]\s+/.test(text);
      const lines: string[] = doc.splitTextToSize(bullet ? text.replace(/^[-•*]\s+/, "") : text, width - (bullet ? 5 : 0));
      lines.forEach((line, index) => {
        room(style.lineHeight);
        if (bullet && index === 0) doc.text(template === "ATS Friendly" ? "-" : "•", left, y);
        doc.text(line, left + (bullet ? 5 : 0), y);
        y += style.lineHeight;
      });
    }
    y += style.sectionGap;
  }

  doc.save(`${name.replace(/\s+/g, "_")}_Resume_${template.replace(/\s+/g, "_")}.pdf`);
}

export async function downloadResumeDOCX(profile: any, sections: { title: string; content: string }[]) {
  const children: Paragraph[] = [
    new Paragraph({ text: profile.name?.toUpperCase() || "STUDENT", heading: HeadingLevel.HEADING_1, alignment: "center" }),
    new Paragraph({ text: [profile.usn, profile.dept].filter(Boolean).join(" | "), alignment: "center" }),
    new Paragraph({ text: [profile.contactEmail || profile.email, profile.contactPhone, profile.contactLocation].filter(Boolean).join(" | "), alignment: "center" }),
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
  lines.push([profile.usn, profile.dept].filter(Boolean).join(" | "));
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
