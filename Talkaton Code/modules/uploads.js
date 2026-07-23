import { createId } from "./storage.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json"]);
const WORD_EXTENSIONS = new Set(["doc", "docx"]);
const SHEET_EXTENSIONS = new Set(["xls", "xlsx"]);
const MAX_FILE_SIZE = 18 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 240_000;

export const ACCEPTED_FILE_LABEL = "PDF, Word, TXT, Markdown, CSV, Excel, or JSON";

export async function prepareFiles(fileList, onProgress = () => {}) {
  const files = [...fileList];
  const prepared = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    onProgress(file, 5, index);
    const attachment = await prepareFile(file, progress => onProgress(file, progress, index));
    prepared.push(attachment);
  }

  return prepared;
}

async function prepareFile(file, onProgress) {
  if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} is larger than 18 MB.`);

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const base = {
    id: createId("attachment"),
    name: file.name,
    size: file.size,
    type: file.type || typeFromExtension(extension),
    extension,
    progress: 0,
    status: "processing"
  };

  if (IMAGE_TYPES.has(file.type) || ["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) {
    const compressed = await compressImage(file, onProgress);
    return { ...base, ...compressed, kind: "image", status: "ready", progress: 100 };
  }

  onProgress(25);

  if (extension === "pdf" || file.type === "application/pdf") {
    const dataUrl = await readAsDataUrl(file);
    onProgress(100);
    return { ...base, kind: "pdf", dataUrl, status: "ready", progress: 100 };
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    const extractedText = (await file.text()).slice(0, MAX_EXTRACTED_CHARS);
    onProgress(100);
    return { ...base, kind: "text", extractedText, status: "ready", progress: 100 };
  }

  if (WORD_EXTENSIONS.has(extension)) {
    const result = await extractWord(file, extension);
    onProgress(100);
    return { ...base, kind: "document", ...result, status: "ready", progress: 100 };
  }

  if (SHEET_EXTENSIONS.has(extension)) {
    const extractedText = await extractWorkbook(file);
    onProgress(100);
    return { ...base, kind: "spreadsheet", extractedText, status: "ready", progress: 100 };
  }

  throw new Error(`${file.name} is not a supported file type.`);
}

async function compressImage(file, onProgress) {
  onProgress(20);
  const sourceUrl = URL.createObjectURL(file);

  try {
    if (file.type === "image/gif") {
      const dataUrl = await readAsDataUrl(file);
      onProgress(100);
      return { dataUrl, previewUrl: dataUrl, originalSize: file.size };
    }

    const image = await loadImage(sourceUrl);
    const maxDimension = 1800;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    onProgress(50);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.84);
    const output = blob.size < file.size ? blob : file;
    const dataUrl = await readAsDataUrl(output);
    onProgress(100);

    return {
      dataUrl,
      previewUrl: dataUrl,
      size: output.size,
      type: output.type,
      originalSize: file.size
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function extractWord(file, extension) {
  const arrayBuffer = await file.arrayBuffer();

  if (extension === "docx") {
    try {
      const module = await import("https://esm.sh/mammoth@1.9.1/mammoth.browser?bundle");
      const mammoth = module.default || module;
      const result = await mammoth.extractRawText({ arrayBuffer });
      return { extractedText: result.value.slice(0, MAX_EXTRACTED_CHARS) };
    } catch (error) {
      console.warn("Word extraction fallback:", error);
    }
  }

  return {
    dataUrl: arrayBufferToDataUrl(arrayBuffer, file.type || "application/msword"),
    extractedText: `[Attached Word document: ${file.name}. Read and summarize the attached file.]`
  };
}

async function extractWorkbook(file) {
  const module = await import("https://esm.sh/xlsx@0.18.5?bundle");
  const XLSX = module.default || module;
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", dense: true });
  const sections = workbook.SheetNames.slice(0, 20).map(name => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `## Sheet: ${name}\n${csv}`;
  });
  return sections.join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This image could not be decoded."));
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image compression failed.")), type, quality);
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function arrayBufferToDataUrl(arrayBuffer, type) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function typeFromExtension(extension) {
  return {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    csv: "text/csv",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    json: "application/json"
  }[extension] || "application/octet-stream";
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function attachmentGlyph(attachment) {
  if (attachment.kind === "pdf") return "PDF";
  if (attachment.kind === "spreadsheet") return "XLS";
  if (attachment.kind === "document") return "DOC";
  if (attachment.extension === "json") return "{}";
  if (attachment.extension === "csv") return "CSV";
  if (attachment.kind === "text") return "TXT";
  return "FILE";
}
