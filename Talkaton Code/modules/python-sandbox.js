const DEFAULT_PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 60 * 1024 * 1024;
const SUPPORTED_FILE_EXTENSIONS = new Set(["csv", "tsv", "xlsx"]);

export class PythonSandboxError extends Error {
  constructor(message, code = "PYTHON_SANDBOX_ERROR", cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "PythonSandboxError";
    this.code = code;
  }
}

/**
 * Lazy, browser-only Python execution in a dedicated Web Worker.
 *
 * The worker has no access to the DOM, cookies, application state, or Talkaton
 * credentials. A timed-out or cancelled execution is stopped by terminating the
 * complete worker (the only reliable way to interrupt arbitrary WebAssembly).
 */
export class PythonSandbox extends EventTarget {
  constructor({ workerUrl, pyodideUrl = DEFAULT_PYODIDE_URL } = {}) {
    super();
    this.workerUrl = workerUrl || new URL("./python-worker.js", import.meta.url);
    this.pyodideUrl = pyodideUrl;
    this.worker = null;
    this.readyPromise = null;
    this.pending = new Map();
    this.sequence = 0;
  }

  static isSupported() {
    return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
  }

  async warmup({ signal } = {}) {
    await this.#ensureWorker(signal);
  }

  async run({ code, files = [], packages = [], timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    if (!String(code || "").trim()) {
      throw new PythonSandboxError("Python code is required.", "INVALID_CODE");
    }
    if (!PythonSandbox.isSupported()) {
      throw new PythonSandboxError(
        "This browser cannot run the local Python analysis engine.",
        "UNSUPPORTED_BROWSER"
      );
    }
    if (globalThis.navigator && navigator.onLine === false && !this.worker) {
      throw new PythonSandboxError(
        "Python analysis needs an internet connection the first time it loads.",
        "OFFLINE"
      );
    }
    if (signal?.aborted) throw abortError(signal.reason);

    const preparedFiles = await prepareAnalysisFiles(files, signal);
    const transfer = preparedFiles.map(file => file.data);
    const duration = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    try {
      await this.#ensureWorker(signal);
    } catch (error) {
      if (error?.code === "CANCELLED") this.#terminateAll(error);
      throw error;
    }

    const id = `python-${Date.now()}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#terminateAll(
          new PythonSandboxError(`Python execution exceeded ${Math.round(duration / 1000)} seconds.`, "TIMEOUT")
        );
      }, duration);
      const onAbort = () => this.#terminateAll(abortError(signal.reason));
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
        }
      });
      this.worker.postMessage({
        type: "run",
        id,
        code: String(code),
        files: preparedFiles,
        packages: [...new Set(packages.map(value => String(value).trim()).filter(Boolean))]
      }, transfer);
    });
  }

  cancel(reason = "Python execution was cancelled.") {
    if (!this.worker) return;
    this.#terminateAll(new PythonSandboxError(reason, "CANCELLED"));
  }

  dispose() {
    this.#terminateAll(new PythonSandboxError("Python sandbox was closed.", "DISPOSED"));
  }

  async #ensureWorker(signal) {
    if (this.readyPromise) return raceWithAbort(this.readyPromise, signal);
    if (!PythonSandbox.isSupported()) {
      throw new PythonSandboxError("Web Workers and WebAssembly are required.", "UNSUPPORTED_BROWSER");
    }

    this.worker = new Worker(this.workerUrl, { name: "talkaton-python-analysis" });
    this.worker.addEventListener("message", event => this.#onMessage(event.data));
    this.worker.addEventListener("error", event => {
      this.#terminateAll(new PythonSandboxError(
        event.message || "The Python analysis worker stopped unexpectedly.",
        "WORKER_ERROR"
      ));
    });

    this.readyPromise = new Promise((resolve, reject) => {
      const id = "__ready__";
      this.pending.set(id, { resolve, reject, cleanup: () => {} });
      this.worker.postMessage({ type: "initialize", id, pyodideUrl: this.pyodideUrl });
    }).catch(error => {
      this.#terminateAll(error);
      throw error;
    });
    return raceWithAbort(this.readyPromise, signal);
  }

  #onMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "progress") {
      this.dispatchEvent(new CustomEvent("progress", { detail: message }));
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.cleanup();
    if (message.type === "result" || message.type === "ready") {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new PythonSandboxError(
      message.error?.message || "Python analysis failed.",
      message.error?.code || "EXECUTION_ERROR"
    ));
  }

  #terminateAll(error) {
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function prepareAnalysisFiles(files, signal) {
  const prepared = [];
  const usedNames = new Set();
  let totalBytes = 0;

  for (const input of [...files]) {
    if (signal?.aborted) throw abortError(signal.reason);
    if (!(input instanceof Blob)) {
      throw new PythonSandboxError("Analysis inputs must be browser File or Blob objects.", "INVALID_FILE");
    }
    const name = uniqueFileName(
      sanitizeFileName(input.name || `input-${prepared.length + 1}.csv`),
      usedNames
    );
    const extension = name.split(".").pop().toLowerCase();
    if (!SUPPORTED_FILE_EXTENSIONS.has(extension)) {
      throw new PythonSandboxError(`${name} must be a CSV, TSV, or XLSX file.`, "UNSUPPORTED_FILE");
    }
    if (input.size > MAX_FILE_BYTES) {
      throw new PythonSandboxError(`${name} is larger than 25 MB.`, "FILE_TOO_LARGE");
    }
    totalBytes += input.size;
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      throw new PythonSandboxError("Analysis files may total no more than 60 MB.", "FILES_TOO_LARGE");
    }
    prepared.push({
      name,
      type: input.type || mimeFromExtension(extension),
      data: await input.arrayBuffer()
    });
  }
  return prepared;
}

function uniqueFileName(name, usedNames) {
  if (!usedNames.has(name.toLowerCase())) {
    usedNames.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  let candidate;
  do {
    candidate = `${stem}-${index++}${extension}`;
  } while (usedNames.has(candidate.toLowerCase()));
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function sanitizeFileName(value) {
  const safe = String(value)
    .normalize("NFKC")
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    .replace(/[^\w.() -]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return safe || "input.csv";
}

function mimeFromExtension(extension) {
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === "tsv") return "text/tab-separated-values";
  return "text/csv";
}

function abortError(reason) {
  const message = typeof reason === "string" && reason ? reason : "Python execution was cancelled.";
  return new PythonSandboxError(message, "CANCELLED");
}

function raceWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal.reason));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export const PYTHON_ANALYSIS_LIMITS = Object.freeze({
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalFileBytes: MAX_TOTAL_FILE_BYTES,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  supportedExtensions: [...SUPPORTED_FILE_EXTENSIONS]
});
