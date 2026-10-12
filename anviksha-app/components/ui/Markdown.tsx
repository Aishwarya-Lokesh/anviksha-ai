"use client";

import React from "react";

// A small Markdown renderer for assistant replies: headings, bold, italic,
// inline code, links, bullet and numbered lists, tables, code blocks and
// paragraphs. Everything is built as React elements — no HTML string is ever
// injected — so nothing in a reply can run as markup.

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**")) out.push(<strong key={key} className="font-semibold">{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key} className="px-1 py-0.5 rounded bg-gray-100 text-[0.85em] font-mono">{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      out.push(<a key={key} href={match[2]} target="_blank" rel="noreferrer noopener" className="text-brand underline">{label}</a>);
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i += 1;
      blocks.push(<pre key={key++} className="bg-gray-900 text-gray-100 text-xs rounded-xl p-3 overflow-x-auto"><code>{code.join("\n")}</code></pre>);
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key++} className="overflow-x-auto -mx-1 px-1">
          <table className="text-sm border-collapse min-w-full">
            <thead>
              <tr>{head.map((h, c) => <th key={c} scope="col" className="text-left font-semibold text-ink border-b-2 border-gray-200 px-2.5 py-1.5 whitespace-nowrap">{inline(h, `th${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => <tr key={ri} className="border-b border-gray-100">{r.map((c, ci) => <td key={ci} className="px-2.5 py-1.5 align-top">{inline(c, `td${ri}-${ci}`)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const size = heading[1].length <= 2 ? "text-base" : "text-sm";
      blocks.push(<p key={key++} className={`${size} font-bold text-ink`}>{inline(heading[2], `h${key}`)}</p>);
      i += 1;
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const test = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && test.test(lines[i])) items.push(test.exec(lines[i++])![1]);
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={key++} className={`${ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}>{items.map((it, n) => <li key={n}>{inline(it, `li${n}`)}</li>)}</List>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("```") && !/^(#{1,4})\s+/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i]) &&
           !(isTableRow(lines[i]) && i + 1 < lines.length && isDivider(lines[i + 1]))) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={key++}>{para.map((p, n) => <React.Fragment key={n}>{n > 0 && <br />}{inline(p, `p${key}-${n}`)}</React.Fragment>)}</p>);
  }
  return <div className="space-y-2.5 leading-relaxed break-words">{blocks}</div>;
}
