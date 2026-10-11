/* global loadPyodide, importScripts */
const ALLOWED_PACKAGES = new Set([
  "numpy", "pandas", "matplotlib", "scipy", "scikit-learn", "sympy", "statsmodels"
]);
const INPUT_ROOT = "/talkaton-input";
let pyodide = null;
let initializing = null;
let activeRun = false;
const nativeNetworkApis = {
  fetch: self.fetch,
  importScripts: self.importScripts,
  WebSocket: self.WebSocket,
  EventSource: self.EventSource,
  XMLHttpRequest: self.XMLHttpRequest,
  Worker: self.Worker,
  SharedWorker: self.SharedWorker,
  indexedDB: self.indexedDB,
  caches: self.caches
};

self.addEventListener("message", event => {
  const message = event.data || {};
  if (message.type === "initialize") {
    initialize(message).catch(error => postFailure(message.id, error, "INITIALIZATION_ERROR"));
  } else if (message.type === "run") {
    execute(message).catch(error => postFailure(message.id, error, "EXECUTION_ERROR"));
  }
});

async function initialize({ id, pyodideUrl }) {
  if (!initializing) {
    initializing = (async () => {
      postProgress(id, "runtime", "Loading the local Python runtime…");
      importScripts(String(pyodideUrl));
      pyodide = await loadPyodide({ indexURL: new URL(".", String(pyodideUrl)).href });
      await pyodide.loadPackage(["micropip"]);
    })();
  }
  await initializing;
  self.postMessage({ type: "ready", id, result: { ready: true } });
}

async function execute({ id, code, files = [], packages = [] }) {
  await initializeIfNeeded(id);
  if (activeRun) throw codedError("Python is already running an analysis.", "BUSY");
  activeRun = true;
  const startedAt = performance.now();
  const stdout = [];
  const stderr = [];

  try {
    resetInputDirectory();
    const fileMap = writeInputFiles(files);
    const requested = packages.filter(name => ALLOWED_PACKAGES.has(name));
    const rejected = packages.filter(name => !ALLOWED_PACKAGES.has(name));
    if (rejected.length) {
      throw codedError(`Unsupported Python package: ${rejected.join(", ")}`, "UNSUPPORTED_PACKAGE");
    }

    const needsTables = files.length > 0;
    const needsWorkbook = files.some(file => file.name.toLowerCase().endsWith(".xlsx"));
    const corePackages = new Set(requested);
    if (needsTables) corePackages.add("pandas");
    if (needsTables || /(?:^|\W)(?:plt|matplotlib)(?:\W|$)/.test(code)) corePackages.add("matplotlib");
    if (corePackages.size) {
      postProgress(id, "packages", "Preparing analysis packages…");
      await pyodide.loadPackage([...corePackages]);
    }
    if (needsWorkbook) {
      postProgress(id, "packages", "Preparing XLSX support…");
      await pyodide.runPythonAsync("import micropip; await micropip.install('openpyxl==3.1.5')");
    }

    pyodide.setStdout({ batched: value => stdout.push(String(value)) });
    pyodide.setStderr({ batched: value => stderr.push(String(value)) });
    pyodide.globals.set("_talkaton_user_code", String(code));
    pyodide.globals.set("_talkaton_input_json", JSON.stringify(fileMap));
    postProgress(id, "execute", "Running Python in the isolated browser worker…");
    blockNetworkApis();
    const payload = await pyodide.runPythonAsync(PYTHON_HARNESS);
    self.postMessage({
      type: "result",
      id,
      result: {
        ...JSON.parse(payload),
        stdout: stdout.join("\n"),
        stderr: stderr.join("\n"),
        durationMs: Math.round(performance.now() - startedAt)
      }
    });
  } finally {
    restoreNetworkApis();
    activeRun = false;
    try { pyodide.globals.delete("_talkaton_user_code"); } catch {}
    try { pyodide.globals.delete("_talkaton_input_json"); } catch {}
  }
}

function blockNetworkApis() {
  setWorkerGlobal("fetch", () => Promise.reject(codedError("Network access is disabled inside Python analysis.", "NETWORK_BLOCKED")));
  setWorkerGlobal("importScripts", () => { throw codedError("Network imports are disabled inside Python analysis.", "NETWORK_BLOCKED"); });
  for (const name of ["WebSocket", "EventSource", "XMLHttpRequest", "Worker", "SharedWorker", "indexedDB", "caches"]) {
    setWorkerGlobal(name, undefined);
  }
}

function restoreNetworkApis() {
  for (const [name, value] of Object.entries(nativeNetworkApis)) setWorkerGlobal(name, value);
}

function setWorkerGlobal(name, value) {
  try {
    Object.defineProperty(self, name, { value, configurable: true, writable: true });
  } catch {
    try { self[name] = value; } catch {}
  }
}

async function initializeIfNeeded(id) {
  if (!pyodide) {
    throw codedError("The Python runtime is not ready. Call warmup() or run() again.", "NOT_READY");
  }
  await initializing;
  postProgress(id, "ready", "Python runtime ready.");
}

function resetInputDirectory() {
  pyodide.FS.mkdirTree(INPUT_ROOT);
  for (const name of pyodide.FS.readdir(INPUT_ROOT)) {
    if (name === "." || name === "..") continue;
    try { pyodide.FS.unlink(`${INPUT_ROOT}/${name}`); } catch {}
  }
}

function writeInputFiles(files) {
  const mapping = {};
  for (const file of files) {
    const path = `${INPUT_ROOT}/${file.name}`;
    pyodide.FS.writeFile(path, new Uint8Array(file.data), { canOwn: true });
    mapping[file.name] = path;
  }
  return mapping;
}

function postProgress(id, stage, message) {
  self.postMessage({ type: "progress", id, stage, message });
}

function postFailure(id, error, fallbackCode) {
  self.postMessage({
    type: "error",
    id,
    error: {
      message: String(error?.message || error || "Python analysis failed."),
      code: error?.code || fallbackCode
    }
  });
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const PYTHON_HARNESS = `
import ast
import base64
import io
import json
import math
import os
import traceback

INPUT_FILES = json.loads(_talkaton_input_json)

def read_table(name, **kwargs):
    """Read an uploaded CSV, TSV, or XLSX file into a pandas DataFrame."""
    import pandas as pd
    if name not in INPUT_FILES:
        raise FileNotFoundError(f"No uploaded analysis file named {name!r}")
    path = INPUT_FILES[name]
    extension = os.path.splitext(name)[1].lower()
    if extension == ".csv":
        return pd.read_csv(path, **kwargs)
    if extension == ".tsv":
        return pd.read_csv(path, sep="\\t", **kwargs)
    if extension == ".xlsx":
        return pd.read_excel(path, engine="openpyxl", **kwargs)
    raise ValueError("Only CSV, TSV, and XLSX analysis inputs are supported")

def _serializable(value):
    try:
        import pandas as pd
        if isinstance(value, pd.DataFrame):
            clean = value.astype(object).where(pd.notnull(value), None)
            return {
                "type": "dataframe",
                "columns": [str(column) for column in clean.columns],
                "rows": clean.head(1000).values.tolist(),
                "rowCount": int(len(clean)),
                "truncated": len(clean) > 1000,
            }
        if isinstance(value, pd.Series):
            clean = value.astype(object).where(pd.notnull(value), None)
            return {
                "type": "series",
                "name": str(clean.name or "value"),
                "values": clean.head(1000).tolist(),
                "rowCount": int(len(clean)),
                "truncated": len(clean) > 1000,
            }
    except ImportError:
        pass
    try:
        import numpy as np
        if isinstance(value, np.ndarray):
            flat_size = int(value.size)
            return {
                "type": "array",
                "shape": list(value.shape),
                "values": value.flatten()[:10000].tolist(),
                "truncated": flat_size > 10000,
            }
        if isinstance(value, np.generic):
            return value.item()
    except ImportError:
        pass
    if value is None or isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return {"type": "repr", "value": repr(value)}

def _json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value

def _run_user_code(source):
    tree = ast.parse(source, filename="<talkaton-analysis>", mode="exec")
    namespace = {
        "__name__": "__talkaton_analysis__",
        "INPUT_FILES": INPUT_FILES,
        "read_table": read_table,
    }
    last_value = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        expression = ast.Expression(tree.body.pop().value)
        exec(compile(tree, "<talkaton-analysis>", "exec"), namespace, namespace)
        last_value = eval(compile(expression, "<talkaton-analysis>", "eval"), namespace, namespace)
    else:
        exec(compile(tree, "<talkaton-analysis>", "exec"), namespace, namespace)
        last_value = namespace.get("result")
    return last_value

value = _run_user_code(_talkaton_user_code)
figures = []
try:
    import matplotlib.pyplot as plt
    for number in plt.get_fignums()[:12]:
        buffer = io.BytesIO()
        plt.figure(number).savefig(buffer, format="png", dpi=144, bbox_inches="tight")
        figures.append({
            "name": f"figure-{number}.png",
            "mimeType": "image/png",
            "dataUrl": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"),
        })
    plt.close("all")
except ImportError:
    pass

json.dumps(_json_safe({
    "result": _serializable(value),
    "figures": figures,
    "inputFiles": list(INPUT_FILES.keys()),
}), allow_nan=False, default=str)
`;
