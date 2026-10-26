// In-memory IndexedDB mock harness for Node.js test environment.
// Implements DOMException, IDBKeyRange, IDBDatabase, IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor.
// Strictly enforces transaction rollback and unique compound key constraints.

class MockDOMException extends Error {
  constructor(name, message) {
    super(message || name);
    this.name = name;
  }
}

class MockIDBKeyRange {
  constructor(lower, upper, lowerOpen = false, upperOpen = false) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }

  static only(value) {
    return new MockIDBKeyRange(value, value, false, false);
  }

  static lowerBound(lower, open = false) {
    return new MockIDBKeyRange(lower, undefined, open, false);
  }

  static upperBound(upper, open = false) {
    return new MockIDBKeyRange(undefined, upper, false, open);
  }

  static bound(lower, upper, lowerOpen = false, upperOpen = false) {
    return new MockIDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }

  includes(key) {
    function compare(a, b) {
      if (Array.isArray(a) && Array.isArray(b)) {
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          if (a[i] === undefined && b[i] !== undefined) return -1;
          if (a[i] !== undefined && b[i] === undefined) return 1;
          const c = compare(a[i], b[i]);
          if (c !== 0) return c;
        }
        return 0;
      }
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }

    if (this.lower !== undefined) {
      const c = compare(key, this.lower);
      if (this.lowerOpen ? c <= 0 : c < 0) return false;
    }
    if (this.upper !== undefined) {
      const c = compare(key, this.upper);
      if (this.upperOpen ? c >= 0 : c > 0) return false;
    }
    return true;
  }
}

function extractKey(obj, keyPath) {
  if (!obj || !keyPath) return undefined;
  if (Array.isArray(keyPath)) {
    return keyPath.map((k) => obj[k]);
  }
  return obj[keyPath];
}

function serializeKey(key) {
  if (Array.isArray(key)) {
    return key.map((k) => (k === undefined ? 'undefined' : JSON.stringify(k))).join('::');
  }
  return key === undefined ? 'undefined' : JSON.stringify(key);
}

class MockIDBRequest {
  constructor(transaction = null) {
    this.result = undefined;
    this.error = null;
    this.readyState = 'pending';
    this.transaction = transaction;
    this.onsuccess = null;
    this.onerror = null;
    if (this.transaction) {
      this.transaction._pendingCount += 1;
    }
  }

  _resolve(val) {
    this.readyState = 'done';
    this.result = val;
    if (typeof this.onsuccess === 'function') {
      try {
        this.onsuccess({ target: this });
      } catch (err) {
        if (this.transaction) this.transaction.abort(err);
      }
    }
    if (this.transaction) {
      this.transaction._pendingCount = Math.max(0, this.transaction._pendingCount - 1);
      this.transaction._checkCompletion();
    }
  }

  _reject(err) {
    this.readyState = 'done';
    this.error = err;
    if (typeof this.onerror === 'function') {
      try {
        this.onerror({ target: this });
      } catch { /* ignore */ }
    }
    if (this.transaction) {
      this.transaction._pendingCount = Math.max(0, this.transaction._pendingCount - 1);
      this.transaction.abort(err);
    }
  }
}

class MockIDBOpenDBRequest extends MockIDBRequest {
  constructor() {
    super(null);
    this.onupgradeneeded = null;
    this.onblocked = null;
  }
}

class MockIDBIndex {
  constructor(store, name, keyPath, options = {}) {
    this.store = store;
    this.name = name;
    this.keyPath = keyPath;
    this.unique = !!options.unique;
    this.multiEntry = !!options.multiEntry;
  }

  get(key) {
    const req = new MockIDBRequest(this.store.transaction);
    this.store.transaction._schedule(() => {
      const serializedTarget = serializeKey(key);
      const records = this.store._getRecords();
      for (const rec of records) {
        const k = extractKey(rec, this.keyPath);
        if (serializeKey(k) === serializedTarget) {
          req._resolve(structuredClone(rec));
          return;
        }
      }
      req._resolve(undefined);
    });
    return req;
  }

  getAll(range = null, count = Infinity) {
    const req = new MockIDBRequest(this.store.transaction);
    this.store.transaction._schedule(() => {
      const records = this.store._getRecords();
      const matched = [];
      for (const rec of records) {
        const k = extractKey(rec, this.keyPath);
        if (!range || (range.includes && range.includes(k)) || serializeKey(range) === serializeKey(k)) {
          matched.push(structuredClone(rec));
          if (matched.length >= count) break;
        }
      }
      req._resolve(matched);
    });
    return req;
  }

  getAllKeys(range = null, count = Infinity) {
    const req = new MockIDBRequest(this.store.transaction);
    this.store.transaction._schedule(() => {
      const records = this.store._getRecords();
      const matched = [];
      for (const rec of records) {
        const k = extractKey(rec, this.keyPath);
        if (!range || (range.includes && range.includes(k)) || serializeKey(range) === serializeKey(k)) {
          matched.push(rec[this.store.keyPath]);
          if (matched.length >= count) break;
        }
      }
      req._resolve(matched);
    });
    return req;
  }

  openCursor(range = null, direction = 'next') {
    const req = new MockIDBRequest(this.store.transaction);
    this.store.transaction._schedule(() => {
      const records = this.store._getRecords();
      const matched = [];

      for (const rec of records) {
        const k = extractKey(rec, this.keyPath);
        if (!range || (range.includes && range.includes(k)) || serializeKey(range) === serializeKey(k)) {
          matched.push({ key: k, primaryKey: rec[this.store.keyPath], value: structuredClone(rec) });
        }
      }

      // Sort
      matched.sort((a, b) => {
        const sa = serializeKey(a.key);
        const sb = serializeKey(b.key);
        return sa.localeCompare(sb);
      });
      if (direction === 'prev') matched.reverse();

      let idx = 0;
      const advance = () => {
        if (idx < matched.length) {
          const item = matched[idx];
          const cursor = {
            key: item.key,
            primaryKey: item.primaryKey,
            value: item.value,
            continue: () => {
              idx += 1;
              if (this.store.transaction) {
                this.store.transaction._pendingCount += 1;
              }
              this.store.transaction._schedule(() => {
                advance();
              });
            },
            delete: () => {
              const pk = item.primaryKey;
              const storeRecords = this.store._getRecords();
              const pos = storeRecords.findIndex((r) => r[this.store.keyPath] === pk);
              if (pos !== -1) storeRecords.splice(pos, 1);
            }
          };
          req._resolve(cursor);
        } else {
          req._resolve(null);
        }
      };
      advance();
    });
    return req;
  }
}

class MockIDBObjectStore {
  constructor(db, transaction, name, options = {}) {
    this.db = db;
    this.transaction = transaction;
    this.name = name;
    this.keyPath = options.keyPath || null;
    this.indexNames = {
      _items: new Set(),
      contains(name) { return this._items.has(name); },
      [Symbol.iterator]() { return this._items.values(); }
    };
    this._indexes = new Map();
  }

  createIndex(name, keyPath, options = {}) {
    const idx = new MockIDBIndex(this, name, keyPath, options);
    this._indexes.set(name, idx);
    this.indexNames._items.add(name);
    return idx;
  }

  index(name) {
    const idx = this._indexes.get(name);
    if (!idx) throw new MockDOMException('NotFoundError', `Index "${name}" not found.`);
    idx.store = this;
    return idx;
  }

  _getRecords() {
    return this.transaction._storeSnapshots.get(this.name);
  }

  get(key) {
    const req = new MockIDBRequest(this.transaction);
    this.transaction._schedule(() => {
      const records = this._getRecords();
      const rec = records.find((r) => r[this.keyPath] === key);
      req._resolve(rec ? structuredClone(rec) : undefined);
    });
    return req;
  }

  add(value) {
    const req = new MockIDBRequest(this.transaction);
    this.transaction._schedule(() => {
      const pk = value[this.keyPath];
      if (pk === undefined || pk === null) {
        const err = new MockDOMException('DataError', 'Missing primary key.');
        req._reject(err);
        return;
      }

      const records = this._getRecords();
      if (records.some((r) => r[this.keyPath] === pk)) {
        const err = new MockDOMException('ConstraintError', `Key "${pk}" already exists.`);
        req._reject(err);
        return;
      }

      // Check unique indexes
      for (const idx of this._indexes.values()) {
        if (idx.unique) {
          const valKey = extractKey(value, idx.keyPath);
          const serKey = serializeKey(valKey);
          if (records.some((r) => serializeKey(extractKey(r, idx.keyPath)) === serKey)) {
            const err = new MockDOMException('ConstraintError', `Unique constraint violated on index "${idx.name}".`);
            req._reject(err);
            return;
          }
        }
      }

      records.push(structuredClone(value));
      req._resolve(pk);
    });
    return req;
  }

  put(value) {
    const req = new MockIDBRequest(this.transaction);
    this.transaction._schedule(() => {
      const pk = value[this.keyPath];
      if (pk === undefined || pk === null) {
        const err = new MockDOMException('DataError', 'Missing primary key.');
        req._reject(err);
        return;
      }

      const records = this._getRecords();
      const existingIdx = records.findIndex((r) => r[this.keyPath] === pk);

      // Check unique indexes
      for (const idx of this._indexes.values()) {
        if (idx.unique) {
          const valKey = extractKey(value, idx.keyPath);
          const serKey = serializeKey(valKey);
          const conflict = records.find((r, i) => i !== existingIdx && serializeKey(extractKey(r, idx.keyPath)) === serKey);
          if (conflict) {
            const err = new MockDOMException('ConstraintError', `Unique constraint violated on index "${idx.name}".`);
            req._reject(err);
            return;
          }
        }
      }

      if (existingIdx !== -1) {
        records[existingIdx] = structuredClone(value);
      } else {
        records.push(structuredClone(value));
      }
      req._resolve(pk);
    });
    return req;
  }

  getAll(range = null, count = Infinity) {
    const req = new MockIDBRequest(this.transaction);
    this.transaction._schedule(() => {
      const records = this._getRecords();
      const matched = [];
      for (const rec of records) {
        const pk = rec[this.keyPath];
        if (!range || (range.includes && range.includes(pk)) || serializeKey(range) === serializeKey(pk)) {
          matched.push(structuredClone(rec));
          if (matched.length >= count) break;
        }
      }
      req._resolve(matched);
    });
    return req;
  }

  getAllKeys(range = null, count = Infinity) {
    const req = new MockIDBRequest(this.transaction);
    this.transaction._schedule(() => {
      const records = this._getRecords();
      const matched = [];
      for (const rec of records) {
        const pk = rec[this.keyPath];
        if (!range || (range.includes && range.includes(pk)) || serializeKey(range) === serializeKey(pk)) {
          matched.push(pk);
          if (matched.length >= count) break;
        }
      }
      req._resolve(matched);
    });
    return req;
  }

  delete(key) {
    const req = new MockIDBRequest(this.transaction);
    this.transaction._schedule(() => {
      const records = this._getRecords();
      const idx = records.findIndex((r) => r[this.keyPath] === key);
      if (idx !== -1) records.splice(idx, 1);
      req._resolve(undefined);
    });
    return req;
  }

  openCursor(range = null, direction = 'next') {
    const req = new MockIDBRequest(this.transaction);
    this.transaction._schedule(() => {
      const records = this._getRecords().slice();
      const matched = [];

      for (const rec of records) {
        const pk = rec[this.keyPath];
        if (!range || (range.includes && range.includes(pk)) || serializeKey(range) === serializeKey(pk)) {
          matched.push(structuredClone(rec));
        }
      }

      matched.sort((a, b) => {
        const sa = serializeKey(a[this.keyPath]);
        const sb = serializeKey(b[this.keyPath]);
        return sa.localeCompare(sb);
      });
      if (direction === 'prev') matched.reverse();

      let idx = 0;
      const advance = () => {
        if (idx < matched.length) {
          const item = matched[idx];
          const cursor = {
            key: item[this.keyPath],
            primaryKey: item[this.keyPath],
            value: item,
            continue: () => {
              idx += 1;
              if (this.transaction) {
                this.transaction._pendingCount += 1;
              }
              this.transaction._schedule(() => {
                advance();
              });
            },
            delete: () => {
              const pk = item[this.keyPath];
              const storeRecords = this.transaction._storeSnapshots.get(this.name);
              const pos = storeRecords.findIndex((r) => r[this.keyPath] === pk);
              if (pos !== -1) storeRecords.splice(pos, 1);
            }
          };
          req._resolve(cursor);
        } else {
          req._resolve(null);
        }
      };
      advance();
    });
    return req;
  }
}

class MockIDBTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.objectStoreNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._completed = false;
    this._aborted = false;
    this._pendingCount = 0;
    this._scheduledTasks = [];
    this._stores = new Map();

    // Clone working data snapshots for atomic isolation
    this._storeSnapshots = new Map();
    for (const s of this.objectStoreNames) {
      const realRecords = db._data.get(s) || [];
      this._storeSnapshots.set(s, realRecords.map((r) => structuredClone(r)));
    }

    queueMicrotask(() => this._drain());
  }

  objectStore(name) {
    if (!this.objectStoreNames.includes(name)) {
      throw new MockDOMException('NotFoundError', `Store "${name}" not in transaction scope.`);
    }
    if (!this._stores.has(name)) {
      const realStoreDef = this.db._storeDefs.get(name);
      const store = new MockIDBObjectStore(this.db, this, name, realStoreDef);
      store._indexes = realStoreDef._indexes;
      store.indexNames = realStoreDef.indexNames;
      this._stores.set(name, store);
    }
    return this._stores.get(name);
  }

  _schedule(fn) {
    if (this._completed || this._aborted) return;
    this._scheduledTasks.push(fn);
    queueMicrotask(() => this._drain());
  }

  _drain() {
    if (this._completed || this._aborted) return;

    while (this._scheduledTasks.length > 0 && !this._aborted) {
      const task = this._scheduledTasks.shift();
      try {
        task();
      } catch (err) {
        this.abort(err);
        return;
      }
    }

    this._checkCompletion();
  }

  _checkCompletion() {
    if (this._completed || this._aborted) return;

    setImmediate(() => {
      if (this._completed || this._aborted) return;
      if (this._scheduledTasks.length === 0 && this._pendingCount === 0) {
        this._completed = true;
        // Commit transaction: copy snapshots back to DB storage
        if (this.mode === 'readwrite' || this.mode === 'versionchange') {
          for (const [storeName, records] of this._storeSnapshots) {
            this.db._data.set(storeName, records);
          }
        }
        if (typeof this.oncomplete === 'function') {
          this.oncomplete({ target: this });
        }
      }
    });
  }

  abort(err = null) {
    if (this._aborted || this._completed) return;
    this._aborted = true;
    this.error = err || new MockDOMException('AbortError', 'Transaction aborted.');
    this._scheduledTasks = [];

    queueMicrotask(() => {
      if (typeof this.onerror === 'function') {
        this.onerror({ target: this });
      }
      if (typeof this.onabort === 'function') {
        this.onabort({ target: this });
      }
    });
  }
}

class MockIDBDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this._data = new Map();
    this._storeDefs = new Map();
    this.objectStoreNames = {
      _items: new Set(),
      contains(name) { return this._items.has(name); },
      [Symbol.iterator]() { return this._items.values(); }
    };
    this.onversionchange = null;
    this.onclose = null;
  }

  createObjectStore(name, options = {}) {
    const def = {
      name,
      keyPath: options.keyPath || 'id',
      indexNames: {
        _items: new Set(),
        contains(name) { return this._items.has(name); },
        [Symbol.iterator]() { return this._items.values(); }
      },
      _indexes: new Map()
    };
    this._storeDefs.set(name, def);
    this.objectStoreNames._items.add(name);
    if (!this._data.has(name)) this._data.set(name, []);

    const store = new MockIDBObjectStore(this, null, name, options);
    store._indexes = def._indexes;
    store.indexNames = def.indexNames;
    return store;
  }

  deleteObjectStore(name) {
    this._storeDefs.delete(name);
    this._data.delete(name);
    this.objectStoreNames._items.delete(name);
  }

  transaction(storeNames, mode = 'readonly') {
    return new MockIDBTransaction(this, storeNames, mode);
  }

  close() {
    if (typeof this.onclose === 'function') {
      this.onclose({ target: this });
    }
  }
}

class MockIndexedDBFactory {
  constructor() {
    this._databases = new Map();
  }

  open(name, version = 1) {
    const req = new MockIDBOpenDBRequest();

    queueMicrotask(() => {
      let db = this._databases.get(name);
      const isNew = !db;

      if (isNew) {
        db = new MockIDBDatabase(name, 0);
        this._databases.set(name, db);
      }

      req.result = db;

      if (isNew || version > db.version) {
        const oldVersion = db.version;
        db.version = version;
        const upgradeTx = new MockIDBTransaction(db, Array.from(db.objectStoreNames), 'versionchange');
        req.transaction = upgradeTx;

        if (typeof req.onupgradeneeded === 'function') {
          req.onupgradeneeded({
            target: req,
            oldVersion,
            newVersion: version
          });
        }

        upgradeTx.oncomplete = () => {
          if (typeof req.onsuccess === 'function') {
            req.onsuccess({ target: req });
          }
        };
      } else if (version < db.version) {
        const err = new MockDOMException('VersionError', `Requested version ${version} is lower than current ${db.version}.`);
        if (typeof req.onerror === 'function') {
          req.onerror({ target: { error: err } });
        }
      } else {
        if (typeof req.onsuccess === 'function') {
          req.onsuccess({ target: req });
        }
      }
    });

    return req;
  }

  deleteDatabase(name) {
    const req = new MockIDBOpenDBRequest();
    queueMicrotask(() => {
      this._databases.delete(name);
      req.result = undefined;
      if (typeof req.onsuccess === 'function') {
        req.onsuccess({ target: req });
      }
    });
    return req;
  }
}

function createMockIndexedDB() {
  return new MockIndexedDBFactory();
}

module.exports = {
  createMockIndexedDB,
  MockIDBKeyRange,
  MockDOMException
};
