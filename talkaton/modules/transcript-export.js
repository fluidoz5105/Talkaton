const MIME_TYPES = Object.freeze({
  md: "text/markdown;charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf"
});
const ROLE_LABELS = Object.freeze({
  assistant: "Talkaton",
  user: "You",
  system: "System",
  tool: "Tool"
});

export class TranscriptExportError extends Error {
  constructor(message, code = "TRANSCRIPT_EXPORT_ERROR", cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "TranscriptExportError";
    this.code = code;
  }
}

export function normalizeTranscript(input, options = {}) {
  const source = Array.isArray(input) ? { messages: input } : (input || {});
  const messages = Array.isArray(source.messages) ? source.messages : [];
  const title = cleanText(options.title || source.title || "Talkaton conversation").slice(0, 180);
  const exportedAt = validDate(options.exportedAt || new Date());

  return {
    title: title || "Talkaton conversation",
    exportedAt,
    model: cleanText(options.model || source.model || ""),
    messages: messages.map((message, index) => ({
      id: String(message?.id || index + 1),
      role: normalizeRole(message?.role),
      label: cleanText(message?.name || ROLE_LABELS[normalizeRole(message?.role)] || "Message"),
      content: extractMessageText(message),
      createdAt: optionalDate(message?.createdAt || message?.created_at || message?.timestamp),
      attachments: extractAttachments(message)
    }))
  };
}

export function transcriptToMarkdown(input, options = {}) {
  const transcript = normalizeTranscript(input, options);
  const lines = [
    `# ${escapeMarkdownHeading(transcript.title)}`,
    "",
    `Exported from Talkaton on ${formatDate(transcript.exportedAt)}.`,
    transcript.model ? `Model: ${transcript.model}` : "",
    ""
  ].filter((line, index, values) => line || index === values.length - 1 || values[index - 1] !== "");

  for (const message of transcript.messages) {
    lines.push(`## ${escapeMarkdownHeading(message.label)}`);
    if (message.createdAt) lines.push("", `_${formatDate(message.createdAt)}_`);
    lines.push("", message.content || "_(Empty message)_");
    if (message.attachments.length) {
      lines.push("", "Attachments:");
      for (const attachment of message.attachments) {
        lines.push(`- ${escapeMarkdownInline(attachment.name)}${attachment.type ? ` (${escapeMarkdownInline(attachment.type)})` : ""}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function transcriptToMarkdownBlob(input, options = {}) {
  return new Blob([transcriptToMarkdown(input, options)], { type: MIME_TYPES.md });
}

export function transcriptToDocxBlob(input, options = {}) {
  const transcript = normalizeTranscript(input, options);
  const created = transcript.exportedAt.toISOString();
  const body = [];
  body.push(docxParagraph(transcript.title, "Title"));
  body.push(docxParagraph(`Exported from Talkaton on ${formatDate(transcript.exportedAt)}.`, "Subtitle"));
  if (transcript.model) body.push(docxParagraph(`Model: ${transcript.model}`, "Subtitle"));

  for (const message of transcript.messages) {
    body.push(docxParagraph(message.label, "TalkatonRole"));
    if (message.createdAt) body.push(docxParagraph(formatDate(message.createdAt), "TalkatonMeta"));
    const lines = (message.content || "(Empty message)").replaceAll("\r\n", "\n").split("\n");
    let inCode = false;
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        continue;
      }
      body.push(docxParagraph(line || " ", inCode ? "TalkatonCode" : "Normal"));
    }
    if (message.attachments.length) {
      body.push(docxParagraph("Attachments", "TalkatonMeta"));
      for (const attachment of message.attachments) {
        body.push(docxParagraph(`• ${attachment.name}${attachment.type ? ` (${attachment.type})` : ""}`, "Normal"));
      }
    }
  }

  const documentXml = xmlDocument(`
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`);
  const files = [
    ["[Content_Types].xml", DOCX_CONTENT_TYPES],
    ["_rels/.rels", DOCX_ROOT_RELS],
    ["docProps/app.xml", DOCX_APP_PROPERTIES],
    ["docProps/core.xml", xmlDocument(`
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(transcript.title)}</dc:title>
  <dc:creator>Talkaton</dc:creator>
  <cp:lastModifiedBy>Talkaton</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`)],
    ["word/document.xml", documentXml],
    ["word/styles.xml", DOCX_STYLES],
    ["word/_rels/document.xml.rels", DOCX_DOCUMENT_RELS]
  ];
  return new Blob([createStoredZip(files)], { type: MIME_TYPES.docx });
}

export function transcriptToPdfBlob(input, options = {}) {
  const transcript = normalizeTranscript(input, options);
  const printable = [];
  printable.push({ text: transcript.title, bold: true, size: 18, gapAfter: 1 });
  printable.push({ text: `Exported from Talkaton on ${formatDate(transcript.exportedAt)}.`, size: 9, gapAfter: 1 });
  if (transcript.model) printable.push({ text: `Model: ${transcript.model}`, size: 9, gapAfter: 1 });
  printable.push({ text: "", size: 11 });

  for (const message of transcript.messages) {
    printable.push({ text: message.label, bold: true, size: 13 });
    if (message.createdAt) printable.push({ text: formatDate(message.createdAt), size: 8 });
    const text = markdownToReadableText(message.content || "(Empty message)");
    for (const line of text.split("\n")) printable.push({ text: line, size: 10 });
    if (message.attachments.length) {
      printable.push({ text: "Attachments:", bold: true, size: 9 });
      for (const attachment of message.attachments) printable.push({ text: `- ${attachment.name}`, size: 9 });
    }
    printable.push({ text: "", size: 10 });
  }

  return new Blob([buildPdf(printable)], { type: MIME_TYPES.pdf });
}

export function createTranscriptBlob(input, format, options = {}) {
  switch (String(format || "").toLowerCase()) {
    case "md":
    case "markdown":
      return transcriptToMarkdownBlob(input, options);
    case "docx":
      return transcriptToDocxBlob(input, options);
    case "pdf":
      return transcriptToPdfBlob(input, options);
    default:
      throw new TranscriptExportError("Choose Markdown, DOCX, or PDF.", "UNSUPPORTED_FORMAT");
  }
}

export function downloadTranscript(input, format, options = {}) {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
    throw new TranscriptExportError("Downloads are not available in this environment.", "DOWNLOAD_UNAVAILABLE");
  }
  const extension = String(format).toLowerCase() === "markdown" ? "md" : String(format).toLowerCase();
  const blob = createTranscriptBlob(input, extension, options);
  const transcript = normalizeTranscript(input, options);
  const fileName = `${safeFileName(options.fileName || transcript.title)}.${extension}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { blob, fileName };
}

function extractMessageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (typeof message?.text === "string") return message.text;
  if (Array.isArray(message?.content)) {
    return message.content.map(part => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (part?.type === "image_url" || part?.type === "image") return "[Image]";
      return "";
    }).filter(Boolean).join("\n");
  }
  if (message?.generatedImage) return "[Generated image]";
  return "";
}

function extractAttachments(message) {
  const values = Array.isArray(message?.attachments) ? message.attachments : [];
  return values.map(attachment => ({
    name: cleanText(attachment?.name || "Attachment"),
    type: cleanText(attachment?.type || attachment?.kind || "")
  }));
}

function normalizeRole(value) {
  const role = String(value || "assistant").toLowerCase();
  return Object.hasOwn(ROLE_LABELS, role) ? role : "assistant";
}

function cleanText(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function optionalDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function escapeMarkdownHeading(value) {
  return String(value).replace(/([\\`*_[\]<>#])/g, "\\$1").replaceAll("\n", " ");
}

function escapeMarkdownInline(value) {
  return String(value).replace(/([\\`*_[\]<>])/g, "\\$1").replaceAll("\n", " ");
}

function safeFileName(value) {
  return String(value || "talkaton-conversation")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 100) || "talkaton-conversation";
}

function xmlDocument(content) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content.trim()}`;
}

function escapeXml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&apos;",
    '"': "&quot;"
  })[character]);
}

function docxParagraph(text, style) {
  const value = String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`;
}

function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const [name, text] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    writeUint(localView, 0, 0x04034b50, 4);
    writeUint(localView, 4, 20, 2);
    writeUint(localView, 6, 0x0800, 2);
    writeUint(localView, 8, 0, 2);
    writeUint(localView, 10, time, 2);
    writeUint(localView, 12, date, 2);
    writeUint(localView, 14, crc, 4);
    writeUint(localView, 18, data.length, 4);
    writeUint(localView, 22, data.length, 4);
    writeUint(localView, 26, nameBytes.length, 2);
    writeUint(localView, 28, 0, 2);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    writeUint(centralView, 0, 0x02014b50, 4);
    writeUint(centralView, 4, 20, 2);
    writeUint(centralView, 6, 20, 2);
    writeUint(centralView, 8, 0x0800, 2);
    writeUint(centralView, 10, 0, 2);
    writeUint(centralView, 12, time, 2);
    writeUint(centralView, 14, date, 2);
    writeUint(centralView, 16, crc, 4);
    writeUint(centralView, 20, data.length, 4);
    writeUint(centralView, 24, data.length, 4);
    writeUint(centralView, 28, nameBytes.length, 2);
    writeUint(centralView, 30, 0, 2);
    writeUint(centralView, 32, 0, 2);
    writeUint(centralView, 34, 0, 2);
    writeUint(centralView, 36, 0, 2);
    writeUint(centralView, 38, 0, 4);
    writeUint(centralView, 42, localOffset, 4);
    central.set(nameBytes, 46);
    centrals.push(central);
    localOffset += local.length;
  }

  const centralSize = centrals.reduce((total, value) => total + value.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint(endView, 0, 0x06054b50, 4);
  writeUint(endView, 4, 0, 2);
  writeUint(endView, 6, 0, 2);
  writeUint(endView, 8, entries.length, 2);
  writeUint(endView, 10, entries.length, 2);
  writeUint(endView, 12, centralSize, 4);
  writeUint(endView, 16, localOffset, 4);
  writeUint(endView, 20, 0, 2);
  return concatenateBytes([...locals, ...centrals, end]);
}

function writeUint(view, offset, value, bytes) {
  if (bytes === 2) view.setUint16(offset, value, true);
  else view.setUint32(offset, value >>> 0, true);
}

function concatenateBytes(parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function dosDateTime(value) {
  const year = Math.max(1980, value.getFullYear());
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate()
  };
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function markdownToReadableText(value) {
  return String(value || "")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function buildPdf(lines) {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const maxWidth = pageWidth - margin * 2;
  const pages = [[]];
  let y = pageHeight - margin;

  for (const item of lines) {
    const size = item.size || 10;
    const lineHeight = Math.ceil(size * 1.45);
    const maxCharacters = Math.max(20, Math.floor(maxWidth / (size * 0.53)));
    const wrapped = wrapText(toPdfAscii(item.text), maxCharacters);
    for (const text of wrapped) {
      if (y - lineHeight < margin) {
        pages.push([]);
        y = pageHeight - margin;
      }
      pages.at(-1).push({ text, y, size, bold: Boolean(item.bold) });
      y -= lineHeight;
    }
    if (item.gapAfter) y -= item.gapAfter * lineHeight;
  }

  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const pageReferences = [];

  pages.forEach((page, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    pageReferences.push(`${pageId} 0 R`);
    const content = page.map(line => [
      "BT",
      `/${line.bold ? "F2" : "F1"} ${line.size} Tf`,
      `1 0 0 1 ${margin} ${line.y} Tm`,
      `(${escapePdfLiteral(line.text)}) Tj`,
      "ET"
    ].join("\n")).join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageReferences.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n%Talkaton\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function wrapText(value, maxCharacters) {
  if (!value) return [""];
  const output = [];
  const sourceLines = value.split("\n");
  for (const sourceLine of sourceLines) {
    if (!sourceLine) {
      output.push("");
      continue;
    }
    let current = "";
    for (const word of sourceLine.split(/\s+/)) {
      if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= maxCharacters) {
        current += ` ${word}`;
      } else {
        output.push(current);
        current = word;
      }
      while (current.length > maxCharacters) {
        output.push(current.slice(0, maxCharacters));
        current = current.slice(maxCharacters);
      }
    }
    output.push(current);
  }
  return output;
}

function toPdfAscii(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdfLiteral(value) {
  return value.replace(/([\\()])/g, "\\$1");
}

const DOCX_CONTENT_TYPES = xmlDocument(`
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);

const DOCX_ROOT_RELS = xmlDocument(`
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);

const DOCX_DOCUMENT_RELS = xmlDocument(`
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);

const DOCX_APP_PROPERTIES = xmlDocument(`
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Talkaton</Application>
  <AppVersion>1.0</AppVersion>
</Properties>`);

const DOCX_STYLES = xmlDocument(`
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:spacing w:after="100"/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TalkatonRole"><w:name w:val="Talkaton Role"/><w:pPr><w:spacing w:before="260" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="D92D36"/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TalkatonMeta"><w:name w:val="Talkaton Meta"/><w:pPr><w:spacing w:after="100"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="17"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TalkatonCode"><w:name w:val="Talkaton Code"/><w:pPr><w:shd w:fill="F2F2F2"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`);
