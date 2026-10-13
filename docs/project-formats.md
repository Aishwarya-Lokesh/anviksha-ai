# Project report and presentation formats

Status on 13 Oct 2026: **the college's official format files have not been supplied yet.** Everything below was built and checked against stand-in formats made for testing (`anviksha-backend/tests/project_samples.py`). They are laid out like a typical engineering-college format, but they are not the official ones. When the official `.docx` and `.pptx` are uploaded (HOD or Admin → Project Formats), the app shows this same read-out for them on the format's "What was read" tab, and that is the summary to confirm.

## How a format is used

The uploaded file is the base document. Nothing in it is re-created.

**Report (.docx).** Page size, margins, section breaks, headers, footers, page-number formats, the cover, certificate and declaration pages stay exactly as they are in the file. Two things change:

1. *Fill-in fields.* Wording such as `TITLE OF THE PROJECT`, `NAME OF THE STUDENT (USN)`, `<<Name of Guide>>` or `20XX-20XX` is replaced with the project's details, wherever it appears: body, tables, headers and footers. A line that holds one student is repeated for each student; a table row with name and USN cells is repeated per student; inside a sentence the students are joined ("A, B and C"). Replacement text takes the letter case of the wording it replaces.
2. *Sample content.* The sample text under Abstract, Acknowledgement, Table of Contents, List of Figures, List of Tables, the chapters and References is removed and the student's content is written in its place, each new paragraph being a copy of one of the format's own paragraphs (chapter heading, section heading, sub-section heading, body, bullet, figure caption, table caption, reference, contents line). Page breaks and section breaks inside those parts are kept.

**Presentation (.pptx).** The slide master, layouts, header band, logo, colours and fonts are untouched. The format's title slide and closing slide are kept and filled in. Its sample content slide is the pattern for every new slide; the sample slides are then removed. If the sample slide uses layout placeholders, new slides are made from that layout; if it uses plain text boxes, new slides are copies of it. Text is never shrunk: a slide with more than its text box holds continues on a "(contd.)" slide.

**PDF.** Made from the finished .docx / .pptx by LibreOffice, so it is the same document. The table of contents, list of figures and list of tables get their page numbers from a first rendering: every heading and caption carries an invisible marker, the rendered PDF shows which page each landed on, and the page label is worked out from each section's number format and start.

## What is read from a report format

| Item | How it is found |
|---|---|
| Page size and margins | From the first section |
| Page numbering | Each section's number format (i, ii, iii / 1, 2, 3) and start value |
| Header and footer | Text of each section's header and footer, noting where a page-number field sits |
| Parts | Headings that are exactly `CERTIFICATE`, `DECLARATION`, `ACKNOWLEDGEMENT`, `ABSTRACT`, `TABLE OF CONTENTS` / `CONTENTS`, `LIST OF FIGURES`, `LIST OF TABLES`, `REFERENCES` / `BIBLIOGRAPHY`, `APPENDIX`; everything before the first is the cover |
| Chapters | A line starting `CHAPTER 1` (the title on the same or the next line), or paragraphs in the Heading 1 style |
| Styles | Font, size, bold/italic, alignment and line spacing of the sample chapter heading, section heading (`1.1 …`), sub-section heading (`1.1.1 …`), body paragraph, captions and reference, following the style chain |
| Caption style | From sample captions: the word (`Fig` / `Figure` / `Table`), the separator in `4.1`, the punctuation after it, and whether a table's caption is above or below it |
| Contents page | Either lines with a leader tab, or a table (number, title, page) |
| Fill-in fields | Tokens in `<<…>>`, `{{…}}`, `[…]`, `<…>` and common sample wording; listed for the uploader to correct |

## What is read from a presentation format

| Item | How it is found |
|---|---|
| Slide size | Width, height, 16:9 or 4:3 |
| On every slide | Shapes on the slide master that are not placeholders: header band, logo, college name, footer |
| Slide sequence | The headings of the slides in the file |
| Pattern for new slides | The first slide after the title slide that has a heading and a text area |
| Text sizes | From the sample slide, else its layout, else the master |
| Closing slide | The last slide, if it says "Thank you" / "Queries" / "Questions" |

## The stand-in formats used for testing

**Report:** A4 (8.27 × 11.69 in); margins top 1, bottom 1, left 1.25, right 1 in. Section 1 (front matter) numbered i, ii, iii from 1, centred in the footer, no number on the cover. Section 2 (chapters) numbered 1, 2, 3 from 1; header = project title in italics; footer = "Dept. of ISE, GSSSIETW", academic year, "Page n". Times New Roman throughout: chapter headings 16 pt bold centred (`CHAPTER 1` then the title), section headings 14 pt bold, sub-section headings 12 pt bold, body 12 pt justified at 1.5 line spacing with a first-line indent, captions 11 pt bold centred (`Fig 1.1: …`, `Table 1.1: …`, table caption above the table), references 12 pt. Parts: cover, certificate (with a signature table), declaration (with a name/USN table), acknowledgement, abstract, table of contents, list of figures, list of tables, chapters, references.

**Presentation:** 13.33 × 7.5 in (16:9). On every slide: a dark blue header band, a logo at the top left, the college name in the band, the department name at the bottom left. Slides: title slide (title; "Presented by", "Under the guidance of", year), two sample content slides, "Thank You".

## Checked against the stand-in formats

Run on 13 Oct 2026 with the real writing model and real LibreOffice, using test material for a made-up project (a synopsis, a results CSV, a code file and two screenshots).

| Check | Result |
|---|---|
| Report: page size, margins, sections and number formats identical to the format | Yes (automated test) |
| Cover, certificate, declaration filled, three students, no format wording left | Yes |
| Header and footer carry the title and year; front matter numbered ii–ix, chapters from 1 | Yes (read from the rendered PDF) |
| Body, headings and captions in the format's font, size, alignment and spacing | Yes (automated test, and by eye against the format's own pages) |
| Contents page numbers match where the headings are | 32 of 32 entries checked |
| Figure and table numbers in order | Fig 3.1, 4.1, 4.2; Table 6.1 |
| Deck: slide size, master artwork and layouts identical to the format | Yes (automated test) |
| No slide's text overflows; text at the format's own size | Yes; 2 slides continued on a second slide |
| All four files open | .docx and .pptx open in python-docx / python-pptx and LibreOffice; both PDFs render. **Not opened in Microsoft Word, PowerPoint, Google Docs or Google Slides** — neither is installed here |
| Incomplete material | A chapter with nothing behind it (Literature Survey) was reported and left out, not written |
| Invented figures | A calculated "91.4 %" and "ninety-two percent" were removed, because the student's material gives only the counts |

## Limits to know about

- A format whose fields are plain sample text that the app does not recognise needs its fill-in fields added by the uploader (Project Formats → the format → Fill-in fields). This is expected for some official formats.
- Text boxes (floating shapes) on a report's cover are filled in, but content inside them is not reflowed.
- LibreOffice lays text out almost, not exactly, as Word does. Where the college's fonts are not on the converter, a metric-compatible font is used (Liberation for Times New Roman and Arial, Carlito for Calibri), so page breaks should match, but this must be checked on the official format.
- How much text a slide holds is estimated from the text box size and font size, not measured from a rendering.
