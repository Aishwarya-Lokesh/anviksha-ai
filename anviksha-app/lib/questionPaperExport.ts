// Question paper export in the layout an internal-assessment paper is set in:
// institution header, exam details, then a ruled table of
// Q.No | Question | Marks | CO | RBT level, with OR rows and part headings.
// The PDF and the Word file are built from the same rows, so they always agree.
import jsPDF from "jspdf";

export type PaperQuestion = { question: string; marks: number; co?: string; bloom_level?: string; or_after?: boolean };
export type PaperPart = { name: string; questions: PaperQuestion[] };
export type PaperDetails = {
  college_name: string; department: string; exam_name: string; academic_year: string;
  semester: string; subject_name: string; subject_code: string; exam_date: string; duration: string;
  total_marks: string | number; faculty_name: string; instructions: string; custom_header_image?: string;
};

const RBT: Record<string, string> = { Remember: "L1", Understand: "L2", Apply: "L3", Analyze: "L4", Evaluate: "L5", Create: "L6" };
export const rbtLevel = (bloom?: string) => RBT[bloom || ""] || "—";

type Row =
  | { kind: "part"; text: string }
  | { kind: "or" }
  | { kind: "question"; no: string; text: string; marks: string; co: string; rbt: string };

export function paperRows(parts: PaperPart[]): Row[] {
  const rows: Row[] = [];
  let n = 0;
  for (const part of parts) {
    rows.push({ kind: "part", text: part.name });
    for (const q of part.questions) {
      n += 1;
      rows.push({ kind: "question", no: String(n), text: q.question || "", marks: String(q.marks ?? ""), co: q.co || "—", rbt: rbtLevel(q.bloom_level) });
      if (q.or_after) rows.push({ kind: "or" });
    }
  }
  return rows;
}

const fileBase = (d: PaperDetails, set: string) =>
  `${(d.subject_code || d.subject_name || "Question_Paper").replace(/[^A-Za-z0-9]+/g, "_")}_${(d.exam_name || "Paper").replace(/[^A-Za-z0-9]+/g, "_")}_Set_${set}`;

const formatDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso || "";
};

export function downloadQuestionPaperPDF(details: PaperDetails, parts: PaperPart[], set: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 15, right = 195, width = right - left;
  // column edges: Q.No | Question | Marks | CO | RBT
  const cols = [left, left + 13, right - 45, right - 30, right - 15, right];
  // The set label sits on its own line above the heading, so a long
  // institution name can never run into it.
  doc.setFont("times", "bold");
  doc.setFontSize(10);
  doc.text(`SET ${set}`, right, 11, { align: "right" });
  let y = 19;

  if (details.custom_header_image) {
    try {
      const type = details.custom_header_image.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(details.custom_header_image, type, left, y, width, 26);
      y += 30;
    } catch {
      // an unreadable image is left out rather than failing the export
    }
  }
  const center = (text: string, size: number, bold = true, gap = 6) => {
    if (!text) return;
    doc.setFont("times", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, width);
    doc.text(lines, 105, y, { align: "center" });
    y += gap * lines.length;
  };
  center(details.college_name.toUpperCase(), 13, true, 6);
  center(details.department ? `Department of ${details.department.replace(/^department of\s+/i, "")}` : "", 11.5, true, 5.5);
  center([details.exam_name, details.academic_year].filter(Boolean).join(" — "), 11, true, 5.5);
  y += 1;
  doc.setLineWidth(0.4);
  doc.line(left, y, right, y);
  y += 6;

  const meta = (l: string, r: string) => {
    doc.setFont("times", "normal");
    doc.setFontSize(10.5);
    doc.text(l, left, y);
    doc.text(r, right, y, { align: "right" });
    y += 5.5;
  };
  meta(`Subject: ${details.subject_name}${details.subject_code ? ` (${details.subject_code})` : ""}`, details.semester ? `Semester: ${details.semester}` : "");
  meta(`Date: ${formatDate(details.exam_date)}`, `Duration: ${details.duration}`);
  meta(details.faculty_name ? `Faculty: ${details.faculty_name}` : "", `Max. Marks: ${details.total_marks}`);
  if (details.instructions) {
    doc.setFont("times", "italic");
    const lines = doc.splitTextToSize(`Note: ${details.instructions}`, width);
    doc.text(lines, left, y);
    y += 5 * lines.length;
  }
  y += 2;

  const headerRow = () => {
    doc.setFont("times", "bold");
    doc.setFontSize(10);
    doc.setLineWidth(0.25);
    doc.rect(left, y, width, 8);
    for (const x of cols.slice(1, -1)) doc.line(x, y, x, y + 8);
    const mid = (i: number) => (cols[i] + cols[i + 1]) / 2;
    doc.text("Q.No", mid(0), y + 5.3, { align: "center" });
    doc.text("Questions", mid(1), y + 5.3, { align: "center" });
    doc.text("Marks", mid(2), y + 5.3, { align: "center" });
    doc.text("CO", mid(3), y + 5.3, { align: "center" });
    doc.text("RBT", mid(4), y + 5.3, { align: "center" });
    y += 8;
  };
  headerRow();

  const newPageIfNeeded = (height: number) => {
    if (y + height > 282) {
      doc.addPage();
      y = 16;
      headerRow();
    }
  };

  for (const row of paperRows(parts)) {
    if (row.kind !== "question") {
      newPageIfNeeded(7);
      doc.setFont("times", "bold");
      doc.setFontSize(10.5);
      doc.rect(left, y, width, 7);
      doc.text(row.kind === "or" ? "OR" : row.text.toUpperCase(), 105, y + 4.8, { align: "center" });
      y += 7;
      continue;
    }
    doc.setFont("times", "normal");
    doc.setFontSize(10.5);
    const lines: string[] = doc.splitTextToSize(row.text || " ", cols[2] - cols[1] - 4);
    const height = Math.max(8, lines.length * 4.8 + 3.4);
    newPageIfNeeded(height);
    doc.rect(left, y, width, height);
    for (const x of cols.slice(1, -1)) doc.line(x, y, x, y + height);
    const mid = (i: number) => (cols[i] + cols[i + 1]) / 2;
    doc.text(row.no, mid(0), y + 5.3, { align: "center" });
    doc.text(lines, cols[1] + 2, y + 5.3);
    doc.text(row.marks, mid(2), y + 5.3, { align: "center" });
    doc.text(row.co, mid(3), y + 5.3, { align: "center" });
    doc.text(row.rbt, mid(4), y + 5.3, { align: "center" });
    y += height;
  }
  y += 8;
  if (y > 285) { doc.addPage(); y = 20; }
  doc.setFont("times", "bold");
  doc.text("* * * * *", 105, y, { align: "center" });
  doc.save(`${fileBase(details, set)}.pdf`);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadQuestionPaperDOCX(details: PaperDetails, parts: PaperPart[], set: string) {
  // loaded only when a Word file is actually requested: it is a large library
  const { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = await import("docx");
  const font = "Times New Roman";
  const text = (t: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
    new TextRun({ text: t, font, bold: opts.bold, italics: opts.italics, size: opts.size ?? 22 });
  const centered = (t: string, size = 24) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [text(t, { bold: true, size })] });
  const cell = (t: string, width: number, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; span?: number } = {}) =>
    new TableCell({
      width: { size: width, type: WidthType.PERCENTAGE },
      columnSpan: opts.span,
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      children: [new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, children: [text(t, { bold: opts.bold })] })],
    });
  const W = [8, 68, 8, 8, 8];

  const metaLine = (l: string, r: string) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.NONE, size: 0 }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 }, insideHorizontal: { style: BorderStyle.NONE, size: 0 }, insideVertical: { style: BorderStyle.NONE, size: 0 } },
      rows: [new TableRow({ children: [
        new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [text(l)] })] }),
        new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [text(r)] })] }),
      ] })],
    });

  const tableRows = [
    new TableRow({ tableHeader: true, children: ["Q.No", "Questions", "Marks", "CO", "RBT"].map((h, i) => cell(h, W[i], { bold: true, align: AlignmentType.CENTER })) }),
    ...paperRows(parts).map((row) =>
      row.kind === "question"
        ? new TableRow({ children: [
            cell(row.no, W[0], { align: AlignmentType.CENTER }), cell(row.text, W[1]),
            cell(row.marks, W[2], { align: AlignmentType.CENTER }), cell(row.co, W[3], { align: AlignmentType.CENTER }), cell(row.rbt, W[4], { align: AlignmentType.CENTER }),
          ] })
        : new TableRow({ children: [cell(row.kind === "or" ? "OR" : row.text.toUpperCase(), 100, { bold: true, align: AlignmentType.CENTER, span: 5 })] })
    ),
  ];

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 850, right: 850 } } },
      children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [text(`SET ${set}`, { bold: true, size: 20 })] }),
        centered(details.college_name.toUpperCase(), 26),
        ...(details.department ? [centered(`Department of ${details.department.replace(/^department of\s+/i, "")}`, 23)] : []),
        centered([details.exam_name, details.academic_year].filter(Boolean).join(" — "), 22),
        new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000" } }, spacing: { after: 120 }, children: [] }),
        metaLine(`Subject: ${details.subject_name}${details.subject_code ? ` (${details.subject_code})` : ""}`, details.semester ? `Semester: ${details.semester}` : ""),
        metaLine(`Date: ${formatDate(details.exam_date)}`, `Duration: ${details.duration}`),
        metaLine(details.faculty_name ? `Faculty: ${details.faculty_name}` : "", `Max. Marks: ${details.total_marks}`),
        ...(details.instructions ? [new Paragraph({ spacing: { before: 80, after: 120 }, children: [text(`Note: ${details.instructions}`, { italics: true })] })] : [new Paragraph({ spacing: { after: 120 }, children: [] })]),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 }, children: [text("* * * * *", { bold: true })] }),
      ],
    }],
  });
  saveBlob(await Packer.toBlob(doc), `${fileBase(details, set)}.docx`);
}
