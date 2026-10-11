/** A small IndexedDB store with localStorage and in-memory fallbacks. */
export function createRecordStore({
  databaseName,
  storeName,
  localStorageKey,
  indexedDBFactory = globalThis.indexedDB,
  localStorageProvider = globalThis.localStorage
}) {
  if (!databaseName || !storeName || !localStorageKey) throw new TypeError("Record store names are required.");
  const memory = new Map();
  let databasePromise;
  let useIndexedDB = Boolean(indexedDBFactory);

  async function openDatabase() {
    if (!useIndexedDB) return null;
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBFactory.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "storageId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB could not be opened."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked."));
    }).catch(error => {
      useIndexedDB = false;
      databasePromise = undefined;
      console.warn(`Talkaton is using fallback storage for ${storeName}:`, error);
      return null;
    });
    return databasePromise;
  }

  async function withStore(mode, operation) {
    const database = await openDatabase();
    if (!database) return undefined;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try {
        result = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error || result?.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    });
  }

  function readFallback() {
    try {
      const stored = localStorageProvider?.getItem(localStorageKey);
      if (stored) return new Map(JSON.parse(stored).map(record => [record.storageId, record]));
    } catch (error) {
      console.warn(`Talkaton could not read ${storeName} fallback storage:`, error);
    }
    return new Map(memory);
  }

  function writeFallback(records) {
    memory.clear();
    records.forEach((value, key) => memory.set(key, clone(value)));
    try {
      localStorageProvider?.setItem(localStorageKey, JSON.stringify([...records.values()]));
    } catch (error) {
      console.warn(`Talkaton could not persist all ${storeName} fallback data:`, error);
    }
  }

  return Object.freeze({
    async getAll() {
      if (useIndexedDB) {
        try {
          const result = await withStore("readonly", store => store.getAll());
          if (result) return result.map(clone);
        } catch (error) {
          useIndexedDB = false;
          console.warn(`Talkaton could not read IndexedDB ${storeName}:`, error);
        }
      }
      return [...readFallback().values()].map(clone);
    },

    async get(storageId) {
      if (useIndexedDB) {
        try {
          const result = await withStore("readonly", store => store.get(storageId));
          return result ? clone(result) : null;
        } catch (error) {
          useIndexedDB = false;
          console.warn(`Talkaton could not read IndexedDB ${storeName}:`, error);
        }
      }
      return clone(readFallback().get(storageId) || null);
    },

    async put(record) {
      if (!record?.storageId) throw new TypeError("A storageId is required.");
      const value = clone(record);
      if (useIndexedDB) {
        try {
          await withStore("readwrite", store => store.put(value));
          return clone(value);
        } catch (error) {
          useIndexedDB = false;
          console.warn(`Talkaton could not write IndexedDB ${storeName}:`, error);
        }
      }
      const records = readFallback();
      records.set(value.storageId, value);
      writeFallback(records);
      return clone(value);
    },

    async delete(storageId) {
      if (useIndexedDB) {
        try {
          await withStore("readwrite", store => store.delete(storageId));
          return;
        } catch (error) {
          useIndexedDB = false;
          console.warn(`Talkaton could not delete IndexedDB ${storeName}:`, error);
        }
      }
      const records = readFallback();
      records.delete(storageId);
      writeFallback(records);
    },

    async clear() {
      if (useIndexedDB) {
        try {
          await withStore("readwrite", store => store.clear());
          return;
        } catch (error) {
          useIndexedDB = false;
          console.warn(`Talkaton could not clear IndexedDB ${storeName}:`, error);
        }
      }
      writeFallback(new Map());
    }
  });
}

function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
