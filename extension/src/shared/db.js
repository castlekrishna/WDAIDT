/* WDAIDT V3.0.0 — Local IndexedDB Storage Engine (v3.0.0-alpha.2).
 * Foundation for conversation memory, segmented sequencing, and transactional accounting.
 * Zero external dependencies. Browser native IndexedDB with honest error handling.
 */

(() => {
  'use strict';

  // Database Identity Constants
  const DB_NAME = 'wdaidt_local_db';
  const DB_VERSION = 1;

  // Object Store Names
  const STORES = Object.freeze({
    CONVERSATIONS: 'conversations',
    MESSAGES: 'messages',
    MEMORY: 'conversation_memory'
  });

  // Valid Enums
  const VALID_ROLES = Object.freeze(['user', 'assistant']);
  const VALID_IDENTITY_STATUSES = Object.freeze(['provisional', 'resolved']);
  const VALID_COMPLETENESS_STATUSES = Object.freeze(['head_only', 'partial', 'complete']);
  const VALID_ORDER_CONFIDENCES = Object.freeze(['verified_continuous', 'gap_discontinuous', 'order_uncertain']);
  const VALID_CAPTURE_STATUSES = Object.freeze(['complete', 'streaming', 'partial']);
  const VALID_MEMORY_STATUSES = Object.freeze(['idle', 'generating', 'ready', 'stale', 'failed']);

  // Estimated record overhead for storage accounting (bytes)
  const RECORD_METADATA_OVERHEAD_BYTES = 128;

  // Custom Storage Error
  class StorageError extends Error {
    constructor(code, message, cause = null) {
      super(message);
      this.name = 'StorageError';
      this.code = code || 'INTERNAL_ERROR';
      this.cause = cause;
    }
  }

  // Pure synchronous SHA-256 implementation for deterministic content hashing across all contexts
  function sha256Sync(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i, j;
    let result = '';

    const words = [];
    const asciiBitLength = ascii.length * 8;

    let hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
    words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

    for (i = 0; i < ascii.length; i++) {
      words[i >> 2] |= ascii.charCodeAt(i) << (24 - ((i % 4) * 8));
    }

    for (i = 0; i < words.length; i += 16) {
      const w = words.slice(i, i + 16);
      const oldHash = hash.slice(0);

      for (j = 0; j < 64; j++) {
        const w15 = w[j - 15];
        const w2 = w[j - 2];

        const s0 = j < 16 ? w[j] : (w[j] = (
          (w[j - 16] +
            (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
            w[j - 7] +
            (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0
        ));

        const s1 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
        const ch = (hash[0] & hash[1]) ^ (~hash[0] & hash[2]);
        const temp1 = (hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) +
          ((hash[4] & hash[5]) ^ (~hash[4] & hash[6])) + k[j] + s0) | 0;
        const temp2 = (s1 + ch) | 0;

        hash = [(temp1 + temp2) | 0, hash[0], hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
      }

      for (j = 0; j < 8; j++) {
        hash[j] = (hash[j] + oldHash[j]) | 0;
      }
    }

    for (i = 0; i < 8; i++) {
      for (j = 3; j >= 0; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  function computeContentHash(content) {
    const norm = String(content || '').replace(/\r\n?/g, '\n').trim();
    return sha256Sync(norm);
  }

  function estimateSizeBytes(charCount, recordCount = 1) {
    const chars = Math.max(0, parseInt(charCount, 10) || 0);
    const records = Math.max(0, parseInt(recordCount, 10) || 0);
    return (chars * 2) + (records * RECORD_METADATA_OVERHEAD_BYTES);
  }

  // Record Validation Functions
  function validateConversation(conv) {
    if (!conv || typeof conv !== 'object') {
      throw new StorageError('VALIDATION_ERROR', 'Conversation record must be an object.');
    }
    if (!conv.conversationId || typeof conv.conversationId !== 'string' || !conv.conversationId.trim()) {
      throw new StorageError('VALIDATION_ERROR', 'Conversation requires a non-empty string conversationId.');
    }
    if (conv.platform && conv.platform !== 'chatgpt') {
      throw new StorageError('VALIDATION_ERROR', `Unsupported platform "${conv.platform}". Only "chatgpt" is supported.`);
    }
    if (conv.identityStatus && !VALID_IDENTITY_STATUSES.includes(conv.identityStatus)) {
      throw new StorageError('VALIDATION_ERROR', `Invalid identityStatus: ${conv.identityStatus}`);
    }
    if (conv.completenessStatus && !VALID_COMPLETENESS_STATUSES.includes(conv.completenessStatus)) {
      throw new StorageError('VALIDATION_ERROR', `Invalid completenessStatus: ${conv.completenessStatus}`);
    }
    return true;
  }

  function validateMessage(msg) {
    if (!msg || typeof msg !== 'object') {
      throw new StorageError('VALIDATION_ERROR', 'Message record must be an object.');
    }
    if (!msg.messageId || typeof msg.messageId !== 'string' || !msg.messageId.trim()) {
      throw new StorageError('VALIDATION_ERROR', 'Message requires a non-empty string messageId.');
    }
    if (!msg.conversationId || typeof msg.conversationId !== 'string' || !msg.conversationId.trim()) {
      throw new StorageError('VALIDATION_ERROR', 'Message requires a non-empty string conversationId.');
    }
    if (!msg.role || !VALID_ROLES.includes(msg.role)) {
      throw new StorageError('VALIDATION_ERROR', `Message requires a valid role ("user" or "assistant"), got: ${msg.role}`);
    }
    if (typeof msg.content !== 'string') {
      throw new StorageError('VALIDATION_ERROR', 'Message requires a string content property.');
    }
    if (msg.segmentId != null && (!Number.isInteger(msg.segmentId) || msg.segmentId < 0)) {
      throw new StorageError('VALIDATION_ERROR', 'Message segmentId must be a non-negative integer.');
    }
    if (msg.turnSequence != null && (!Number.isInteger(msg.turnSequence) || msg.turnSequence < 0)) {
      throw new StorageError('VALIDATION_ERROR', 'Message turnSequence must be a non-negative integer.');
    }
    if (msg.orderConfidence && !VALID_ORDER_CONFIDENCES.includes(msg.orderConfidence)) {
      throw new StorageError('VALIDATION_ERROR', `Invalid orderConfidence: ${msg.orderConfidence}`);
    }
    if (msg.captureStatus && !VALID_CAPTURE_STATUSES.includes(msg.captureStatus)) {
      throw new StorageError('VALIDATION_ERROR', `Invalid captureStatus: ${msg.captureStatus}`);
    }
    return true;
  }

  function validateMemory(mem) {
    if (!mem || typeof mem !== 'object') {
      throw new StorageError('VALIDATION_ERROR', 'Memory record must be an object.');
    }
    if (!mem.conversationId || typeof mem.conversationId !== 'string' || !mem.conversationId.trim()) {
      throw new StorageError('VALIDATION_ERROR', 'Memory requires a non-empty string conversationId.');
    }
    if (mem.status && !VALID_MEMORY_STATUSES.includes(mem.status)) {
      throw new StorageError('VALIDATION_ERROR', `Invalid memory status: ${mem.status}`);
    }
    return true;
  }

  // Schema Initialization and Migration Logic
  function initializeSchema(db, oldVersion, newVersion) {
    // Version 1: Initial V3 Storage Foundation
    if (oldVersion < 1) {
      // 1. conversations store
      if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
        const convStore = db.createObjectStore(STORES.CONVERSATIONS, { keyPath: 'conversationId' });
        convStore.createIndex('by_externalChatId', ['platform', 'externalChatId'], { unique: false });
        convStore.createIndex('by_lastActivityAt', 'lastActivityAt', { unique: false });
        convStore.createIndex('by_identityStatus', 'identityStatus', { unique: false });
        convStore.createIndex('by_completenessStatus', 'completenessStatus', { unique: false });
      }

      // 2. messages store
      if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
        const msgStore = db.createObjectStore(STORES.MESSAGES, { keyPath: 'messageId' });
        msgStore.createIndex('by_conversationId', 'conversationId', { unique: false });
        // Segmented Sequence Index: UNIQUE within contiguous segment
        msgStore.createIndex('by_conv_segment_seq', ['conversationId', 'segmentId', 'turnSequence'], { unique: true });
        // Global Sequence Index: NON-UNIQUE across gap-discontinuous segments
        msgStore.createIndex('by_conv_sequence', ['conversationId', 'turnSequence'], { unique: false });
        msgStore.createIndex('by_conv_sourceId', ['conversationId', 'sourceMessageId'], { unique: false });
        msgStore.createIndex('by_capturedAt', 'capturedAt', { unique: false });
        msgStore.createIndex('by_conv_capturedAt', ['conversationId', 'capturedAt'], { unique: false });
      }

      // 3. conversation_memory store
      if (!db.objectStoreNames.contains(STORES.MEMORY)) {
        const memStore = db.createObjectStore(STORES.MEMORY, { keyPath: 'conversationId' });
        memStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
        memStore.createIndex('by_status', 'status', { unique: false });
      }
    }
  }

  // Database Connection Management
  function createStorageEngine(options = {}) {
    const customIdb = options.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    const KeyRange = options.IDBKeyRange ||
      (typeof IDBKeyRange !== 'undefined' ? IDBKeyRange : null) ||
      (customIdb && customIdb.IDBKeyRange ? customIdb.IDBKeyRange : null);
    const dbName = options.name || DB_NAME;
    const dbVersion = options.version || DB_VERSION;
    const onUpgradeHook = options.onUpgrade || null;

    let dbInstance = null;
    let isConnecting = null;

    function getIdb() {
      if (!customIdb) {
        throw new StorageError(
          'INDEXEDDB_UNAVAILABLE',
          'IndexedDB is not available in the current environment.'
        );
      }
      return customIdb;
    }

    async function open() {
      if (dbInstance) return dbInstance;
      if (isConnecting) return isConnecting;

      isConnecting = new Promise((resolve, reject) => {
        try {
          const idb = getIdb();
          const req = idb.open(dbName, dbVersion);

          req.onupgradeneeded = (evt) => {
            const db = req.result;
            const oldV = evt.oldVersion;
            const newV = evt.newVersion || dbVersion;
            try {
              initializeSchema(db, oldV, newV);
              if (typeof onUpgradeHook === 'function') {
                onUpgradeHook(db, oldV, newV, req.transaction);
              }
            } catch (err) {
              reject(new StorageError('UPGRADE_FAILED', `Schema initialization failed: ${err.message}`, err));
            }
          };

          req.onsuccess = () => {
            dbInstance = req.result;
            dbInstance.onversionchange = () => {
              // Gracefully close on external upgrade to avoid blocking
              try { dbInstance.close(); } catch { /* ignore */ }
              dbInstance = null;
            };
            dbInstance.onclose = () => {
              dbInstance = null;
            };
            resolve(dbInstance);
          };

          req.onerror = () => {
            const err = req.error;
            let code = 'OPEN_FAILED';
            if (err && err.name === 'QuotaExceededError') code = 'QUOTA_EXCEEDED';
            reject(new StorageError(code, `Failed to open IndexedDB "${dbName}": ${(err && err.message) || req.error}`, err));
          };

          req.onblocked = () => {
            reject(new StorageError('UPGRADE_BLOCKED', `Opening IndexedDB "${dbName}" was blocked by unclosed connections.`));
          };
        } catch (e) {
          if (e instanceof StorageError) {
            reject(e);
          } else {
            reject(new StorageError('OPEN_FAILED', `Unexpected exception opening IndexedDB: ${e.message}`, e));
          }
        }
      }).finally(() => {
        isConnecting = null;
      });

      return isConnecting;
    }

    function close() {
      if (dbInstance) {
        try { dbInstance.close(); } catch { /* ignore */ }
        dbInstance = null;
      }
    }

    async function deleteDatabase() {
      close();
      const idb = getIdb();
      return new Promise((resolve, reject) => {
        const req = idb.deleteDatabase(dbName);
        req.onsuccess = () => resolve({ deleted: true });
        req.onerror = () => reject(new StorageError('DELETE_FAILED', `Failed to delete IndexedDB "${dbName}": ${req.error?.message}`));
        req.onblocked = () => reject(new StorageError('DELETE_BLOCKED', `Deleting IndexedDB "${dbName}" was blocked.`));
      });
    }

    // Transaction Runner Helper: Segregates transactions & enforces atomic commit
    function runTx(storeNames, mode, executor) {
      return open().then((db) => {
        return new Promise((resolve, reject) => {
          let tx;
          try {
            tx = db.transaction(storeNames, mode);
          } catch (err) {
            let code = 'TRANSACTION_ERROR';
            if (err.name === 'QuotaExceededError') code = 'QUOTA_EXCEEDED';
            return reject(new StorageError(code, `Failed to start transaction on [${storeNames}]: ${err.message}`, err));
          }

          let txResult = undefined;
          let settled = false;
          let workerFinished = false;
          let txCompleted = false;

          function setResult(val) {
            txResult = val;
          }

          function checkSuccess() {
            if (!settled && txCompleted && workerFinished) {
              settled = true;
              resolve(txResult);
            }
          }

          tx.oncomplete = () => {
            txCompleted = true;
            checkSuccess();
          };

          tx.onerror = (e) => {
            if (!settled) {
              settled = true;
              const err = tx.error || (e && e.target && e.target.error);
              let code = 'TRANSACTION_ERROR';
              if (err && err.name === 'ConstraintError') code = 'CONSTRAINT_ERROR';
              if (err && err.name === 'QuotaExceededError') code = 'QUOTA_EXCEEDED';
              reject(new StorageError(code, `Transaction failed on [${storeNames}]: ${(err && err.message) || 'Unknown error'}`, err));
            }
          };

          tx.onabort = () => {
            if (!settled) {
              settled = true;
              const err = tx.error;
              let code = 'TRANSACTION_ABORTED';
              if (err && err.name === 'ConstraintError') code = 'CONSTRAINT_ERROR';
              if (err && err.name === 'QuotaExceededError') code = 'QUOTA_EXCEEDED';
              reject(new StorageError(code, `Transaction was aborted on [${storeNames}]: ${(err && err.message) || 'Aborted'}`, err));
            }
          };

          const stores = Array.isArray(storeNames)
            ? storeNames.map((s) => tx.objectStore(s))
            : [tx.objectStore(storeNames)];

          try {
            const maybePromise = executor(stores, setResult, tx);
            if (maybePromise && typeof maybePromise.then === 'function') {
              maybePromise
                .then((val) => {
                  if (val !== undefined && txResult === undefined) {
                    txResult = val;
                  }
                  workerFinished = true;
                  checkSuccess();
                })
                .catch((err) => {
                  if (!settled) {
                    settled = true;
                    try { tx.abort(); } catch { /* ignore */ }
                    reject(err instanceof StorageError ? err : new StorageError('TRANSACTION_ERROR', err.message, err));
                  }
                });
            } else {
              workerFinished = true;
              checkSuccess();
            }
          } catch (err) {
            if (!settled) {
              settled = true;
              try { tx.abort(); } catch { /* ignore */ }
              reject(err instanceof StorageError ? err : new StorageError('TRANSACTION_ERROR', err.message, err));
            }
          }
        });
      });
    }

    // ── Conversations API ──────────────────────────────────────────────────

    async function createConversation(data) {
      validateConversation(data);
      const now = Date.now();
      const record = {
        conversationId: String(data.conversationId).trim(),
        platform: data.platform || 'chatgpt',
        externalChatId: data.externalChatId || null,
        identityStatus: data.identityStatus || 'provisional',
        completenessStatus: data.completenessStatus || 'head_only',
        title: data.title != null ? String(data.title) : null,
        createdAt: data.createdAt || now,
        lastActivityAt: data.lastActivityAt || now,
        lastCapturedMessageId: data.lastCapturedMessageId || null,
        messageCount: 0,
        totalCharacterCount: 0,
        estimatedSizeBytes: RECORD_METADATA_OVERHEAD_BYTES,
        summaryRevision: 0,
        summaryUpdatedAt: null
      };

      await runTx(STORES.CONVERSATIONS, 'readwrite', ([convStore], setResult) => {
        const req = convStore.add(record);
        req.onsuccess = () => {
          setResult(record);
        };
      });

      return record;
    }

    async function getConversation(conversationId) {
      if (!conversationId) return null;
      return runTx(STORES.CONVERSATIONS, 'readonly', ([convStore], setResult) => {
        const req = convStore.get(conversationId);
        req.onsuccess = () => {
          setResult(req.result || null);
        };
      });
    }

    async function getConversationByExternalId(externalChatId, platform = 'chatgpt') {
      if (!externalChatId) return null;
      return runTx(STORES.CONVERSATIONS, 'readonly', ([convStore], setResult) => {
        const index = convStore.index('by_externalChatId');
        const req = index.get([platform, externalChatId]);
        req.onsuccess = () => {
          setResult(req.result || null);
        };
      });
    }

    async function updateConversation(conversationId, updates) {
      if (!conversationId) throw new StorageError('VALIDATION_ERROR', 'conversationId is required for update.');
      return runTx(STORES.CONVERSATIONS, 'readwrite', ([convStore], setResult, tx) => {
        const getReq = convStore.get(conversationId);
        getReq.onsuccess = () => {
          const existing = getReq.result;
          if (!existing) {
            const err = new StorageError('RECORD_NOT_FOUND', `Conversation "${conversationId}" not found.`);
            try { tx.abort(); } catch { /* ignore */ }
            throw err;
          }
          const merged = { ...existing, ...updates, conversationId };
          validateConversation(merged);
          const putReq = convStore.put(merged);
          putReq.onsuccess = () => {
            setResult(merged);
          };
        };
      });
    }

    async function deleteConversation(conversationId) {
      if (!conversationId) return { deleted: false };
      return runTx([STORES.CONVERSATIONS, STORES.MESSAGES, STORES.MEMORY], 'readwrite', ([convStore, msgStore, memStore], setResult) => {
        const getReq = convStore.get(conversationId);
        getReq.onsuccess = () => {
          const existing = getReq.result;
          if (!existing) {
            setResult({ deleted: false });
            return;
          }

          const msgIndex = msgStore.index('by_conversationId');
          const range = KeyRange && typeof KeyRange.only === 'function' ? KeyRange.only(conversationId) : conversationId;

          const finishDeletion = (keys) => {
            for (const pk of keys) {
              msgStore.delete(pk);
            }
            memStore.delete(conversationId);
            convStore.delete(conversationId);
            setResult({ deleted: true, conversationId });
          };

          if (typeof msgIndex.getAllKeys === 'function') {
            const keysReq = msgIndex.getAllKeys(range);
            keysReq.onsuccess = () => {
              finishDeletion(keysReq.result || []);
            };
          } else if (typeof msgIndex.getAll === 'function') {
            const allReq = msgIndex.getAll(range);
            allReq.onsuccess = () => {
              const keys = (allReq.result || []).map((m) => m.messageId);
              finishDeletion(keys);
            };
          } else {
            const curReq = msgIndex.openCursor(range);
            const keys = [];
            curReq.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                keys.push(cursor.primaryKey);
                cursor.continue();
              } else {
                finishDeletion(keys);
              }
            };
          }
        };
      });
    }

    async function listConversations(options = {}) {
      const limit = Math.max(1, parseInt(options.limit, 10) || 50);
      const reverse = options.reverse !== false;

      return runTx(STORES.CONVERSATIONS, 'readonly', ([convStore], setResult) => {
        const index = convStore.index('by_lastActivityAt');
        const direction = reverse ? 'prev' : 'next';
        const req = index.openCursor(null, direction);
        const results = [];

        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && results.length < limit) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            setResult(results);
          }
        };
      });
    }

    // ── Messages API ───────────────────────────────────────────────────────

    async function createMessage(data) {
      validateMessage(data);
      const now = Date.now();
      const content = String(data.content || '');
      const charCount = content.length;
      const sizeBytes = estimateSizeBytes(charCount, 1);
      const contentHash = data.contentHash || computeContentHash(content);

      const record = {
        messageId: String(data.messageId).trim(),
        conversationId: String(data.conversationId).trim(),
        sourceMessageId: data.sourceMessageId ? String(data.sourceMessageId).trim() : null,
        role: data.role,
        segmentId: data.segmentId != null ? data.segmentId : 0,
        turnSequence: data.turnSequence != null ? data.turnSequence : 0,
        orderConfidence: data.orderConfidence || 'verified_continuous',
        content,
        contentHash,
        revisionNumber: data.revisionNumber || 1,
        auditMetadata: data.auditMetadata || null,
        sourceTimestamp: data.sourceTimestamp != null ? data.sourceTimestamp : null,
        capturedAt: data.capturedAt || now,
        characterCount: charCount,
        estimatedSizeBytes: sizeBytes,
        captureStatus: data.captureStatus || 'complete'
      };

      await runTx([STORES.CONVERSATIONS, STORES.MESSAGES], 'readwrite', ([convStore, msgStore], setResult, tx) => {
        const getConvReq = convStore.get(record.conversationId);
        getConvReq.onsuccess = () => {
          const conv = getConvReq.result;
          if (!conv) {
            const err = new StorageError('RECORD_NOT_FOUND', `Parent conversation "${record.conversationId}" not found.`);
            try { tx.abort(); } catch { /* ignore */ }
            throw err;
          }

          const addMsgReq = msgStore.add(record);
          addMsgReq.onsuccess = () => {
            conv.messageCount = (conv.messageCount || 0) + 1;
            conv.totalCharacterCount = (conv.totalCharacterCount || 0) + charCount;
            conv.estimatedSizeBytes = (conv.estimatedSizeBytes || RECORD_METADATA_OVERHEAD_BYTES) + sizeBytes;
            conv.lastActivityAt = Math.max(conv.lastActivityAt || 0, record.capturedAt);
            conv.lastCapturedMessageId = record.messageId;

            const putConvReq = convStore.put(conv);
            putConvReq.onsuccess = () => {
              setResult(record);
            };
          };
        };
      });

      return record;
    }

    async function getMessage(messageId) {
      if (!messageId) return null;
      return runTx(STORES.MESSAGES, 'readonly', ([msgStore], setResult) => {
        const req = msgStore.get(messageId);
        req.onsuccess = () => {
          setResult(req.result || null);
        };
      });
    }

    async function getMessagesByConversation(conversationId, options = {}) {
      if (!conversationId) return [];
      const segmentId = options.segmentId;
      const limit = options.limit ? Math.max(1, parseInt(options.limit, 10) || 1000) : 1000;
      const reverse = !!options.reverse;

      return runTx(STORES.MESSAGES, 'readonly', ([msgStore], setResult) => {
        const results = [];
        let req;

        if (segmentId != null) {
          const index = msgStore.index('by_conv_segment_seq');
          const range = KeyRange && typeof KeyRange.bound === 'function'
            ? KeyRange.bound(
                [conversationId, segmentId, options.minSequence != null ? options.minSequence : -Infinity],
                [conversationId, segmentId, options.maxSequence != null ? options.maxSequence : Infinity]
              )
            : null;
          req = index.openCursor(range, reverse ? 'prev' : 'next');
        } else {
          const index = msgStore.index('by_conversationId');
          const range = KeyRange && typeof KeyRange.only === 'function' ? KeyRange.only(conversationId) : conversationId;
          req = index.openCursor(range, reverse ? 'prev' : 'next');
        }

        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && results.length < limit) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            if (segmentId == null) {
              results.sort((a, b) => {
                if (a.segmentId !== b.segmentId) return a.segmentId - b.segmentId;
                return a.turnSequence - b.turnSequence;
              });
              if (reverse) results.reverse();
            }
            setResult(results);
          }
        };
      });
    }

    // In-Place Message Revision Update Policy
    async function updateMessageContent(messageId, newContent, options = {}) {
      if (!messageId) throw new StorageError('VALIDATION_ERROR', 'messageId is required.');
      if (typeof newContent !== 'string') {
        throw new StorageError('VALIDATION_ERROR', 'newContent must be a string.');
      }

      return runTx([STORES.CONVERSATIONS, STORES.MESSAGES, STORES.MEMORY], 'readwrite', ([convStore, msgStore, memStore], setResult, tx) => {
        const getMsgReq = msgStore.get(messageId);
        getMsgReq.onsuccess = () => {
          const msg = getMsgReq.result;
          if (!msg) {
            const err = new StorageError('RECORD_NOT_FOUND', `Message "${messageId}" not found.`);
            try { tx.abort(); } catch { /* ignore */ }
            throw err;
          }

          const getConvReq = convStore.get(msg.conversationId);
          getConvReq.onsuccess = () => {
            const conv = getConvReq.result;
            if (!conv) {
              const err = new StorageError('RECORD_NOT_FOUND', `Parent conversation "${msg.conversationId}" not found.`);
              try { tx.abort(); } catch { /* ignore */ }
              throw err;
            }

            const oldChars = msg.characterCount || 0;
            const oldBytes = msg.estimatedSizeBytes || estimateSizeBytes(oldChars, 1);
            const oldHash = msg.contentHash;

            const newChars = newContent.length;
            const newBytes = estimateSizeBytes(newChars, 1);
            const newHash = options.contentHash || computeContentHash(newContent);

            msg.content = newContent;
            msg.contentHash = newHash;
            msg.characterCount = newChars;
            msg.estimatedSizeBytes = newBytes;
            msg.revisionNumber = (msg.revisionNumber || 1) + 1;
            msg.auditMetadata = {
              previousContentHash: oldHash,
              lastEditedAt: Date.now(),
              revisionCount: ((msg.auditMetadata && msg.auditMetadata.revisionCount) || 1) + 1
            };
            if (options.captureStatus) msg.captureStatus = options.captureStatus;

            msgStore.put(msg);

            // Reconcile conversation accounting
            conv.totalCharacterCount = Math.max(0, (conv.totalCharacterCount || 0) + (newChars - oldChars));
            conv.estimatedSizeBytes = Math.max(RECORD_METADATA_OVERHEAD_BYTES, (conv.estimatedSizeBytes || 0) + (newBytes - oldBytes));
            conv.lastActivityAt = Math.max(conv.lastActivityAt || 0, Date.now());
            convStore.put(conv);

            const getMemReq = memStore.get(msg.conversationId);
            getMemReq.onsuccess = () => {
              const mem = getMemReq.result;
              if (mem && mem.status !== 'stale') {
                mem.status = 'stale';
                memStore.put(mem);
              }
              setResult(msg);
            };
          };
        };
      });
    }

    async function deleteMessage(messageId) {
      if (!messageId) return { deleted: false };
      return runTx([STORES.CONVERSATIONS, STORES.MESSAGES, STORES.MEMORY], 'readwrite', ([convStore, msgStore, memStore], setResult) => {
        const getMsgReq = msgStore.get(messageId);
        getMsgReq.onsuccess = () => {
          const msg = getMsgReq.result;
          if (!msg) {
            setResult({ deleted: false });
            return;
          }

          const getConvReq = convStore.get(msg.conversationId);
          getConvReq.onsuccess = () => {
            const conv = getConvReq.result;
            msgStore.delete(messageId);

            if (conv) {
              conv.messageCount = Math.max(0, (conv.messageCount || 1) - 1);
              conv.totalCharacterCount = Math.max(0, (conv.totalCharacterCount || msg.characterCount) - msg.characterCount);
              conv.estimatedSizeBytes = Math.max(
                RECORD_METADATA_OVERHEAD_BYTES,
                (conv.estimatedSizeBytes || msg.estimatedSizeBytes) - msg.estimatedSizeBytes
              );
              convStore.put(conv);

              const getMemReq = memStore.get(msg.conversationId);
              getMemReq.onsuccess = () => {
                const mem = getMemReq.result;
                if (mem && mem.status !== 'stale') {
                  mem.status = 'stale';
                  memStore.put(mem);
                }
                setResult({ deleted: true, messageId });
              };
            } else {
              setResult({ deleted: true, messageId });
            }
          };
        };
      });
    }

    // ── Conversation Memory Store API ──────────────────────────────────────

    async function getConversationMemory(conversationId) {
      if (!conversationId) return null;
      return runTx(STORES.MEMORY, 'readonly', ([memStore], setResult) => {
        const req = memStore.get(conversationId);
        req.onsuccess = () => {
          setResult(req.result || null);
        };
      });
    }

    async function setConversationMemory(data) {
      validateMemory(data);
      const now = Date.now();
      const compactSummary = String(data.compactSummary || '');
      const charCount = compactSummary.length;
      const sizeBytes = estimateSizeBytes(charCount, 1);

      const record = {
        conversationId: String(data.conversationId).trim(),
        schemaVersion: data.schemaVersion || 1,
        summaryRevision: data.summaryRevision != null ? data.summaryRevision : 0,
        sourceMessageCheckpoint: data.sourceMessageCheckpoint || null,
        generationId: data.generationId || null,
        status: data.status || 'ready',
        updatedAt: data.updatedAt || now,
        retryCount: data.retryCount || 0,
        lastError: data.lastError || null,
        compactSummary,
        activeTopics: Array.isArray(data.activeTopics) ? data.activeTopics : [],
        constraints: Array.isArray(data.constraints) ? data.constraints : [],
        characterCount: charCount,
        estimatedSizeBytes: sizeBytes
      };

      return runTx([STORES.CONVERSATIONS, STORES.MEMORY], 'readwrite', ([convStore, memStore], setResult, tx) => {
        const getConvReq = convStore.get(record.conversationId);
        getConvReq.onsuccess = () => {
          const conv = getConvReq.result;
          if (!conv) {
            const err = new StorageError('RECORD_NOT_FOUND', `Parent conversation "${record.conversationId}" not found.`);
            try { tx.abort(); } catch { /* ignore */ }
            throw err;
          }

          const getMemReq = memStore.get(record.conversationId);
          getMemReq.onsuccess = () => {
            const existingMem = getMemReq.result;
            const oldMemBytes = existingMem ? (existingMem.estimatedSizeBytes || 0) : 0;

            memStore.put(record);

            // Reconcile conversation totals:
            // totalCharacterCount strictly measures message content, so it is preserved.
            // estimatedSizeBytes incorporates memory record footprint.
            conv.estimatedSizeBytes = Math.max(
              RECORD_METADATA_OVERHEAD_BYTES,
              (conv.estimatedSizeBytes || RECORD_METADATA_OVERHEAD_BYTES) + (sizeBytes - oldMemBytes)
            );
            conv.summaryRevision = record.summaryRevision;
            conv.summaryUpdatedAt = record.updatedAt;

            const putConvReq = convStore.put(conv);
            putConvReq.onsuccess = () => {
              setResult(record);
            };
          };
        };
      });
    }

    // ── Global Storage Accounting API ──────────────────────────────────────

    async function getStorageAccounting() {
      return runTx(STORES.CONVERSATIONS, 'readonly', ([convStore], setResult) => {
        const req = convStore.openCursor();
        let convCount = 0;
        let totalMessages = 0;
        let totalChars = 0;
        let totalEstimatedBytes = 0;

        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const c = cursor.value;
            convCount += 1;
            totalMessages += (c.messageCount || 0);
            totalChars += (c.totalCharacterCount || 0);
            totalEstimatedBytes += (c.estimatedSizeBytes || RECORD_METADATA_OVERHEAD_BYTES);
            cursor.continue();
          } else {
            setResult({
              conversationCount: convCount,
              totalMessageCount: totalMessages,
              totalCharacterCount: totalChars,
              estimatedStorageBytes: totalEstimatedBytes
            });
          }
        };
      });
    }

    // Authoritative Repair & Verification of Accounting Totals
    async function repairConversationAccounting(conversationId) {
      if (!conversationId) return null;
      return runTx([STORES.CONVERSATIONS, STORES.MESSAGES, STORES.MEMORY], 'readwrite', ([convStore, msgStore, memStore], setResult) => {
        const getConvReq = convStore.get(conversationId);
        getConvReq.onsuccess = () => {
          const conv = getConvReq.result;
          if (!conv) {
            setResult(null);
            return;
          }

          const msgIndex = msgStore.index('by_conversationId');
          const range = KeyRange && typeof KeyRange.only === 'function' ? KeyRange.only(conversationId) : conversationId;

          const computeAndSave = (msgs) => {
            let exactMsgCount = 0;
            let exactMsgChars = 0;
            let estimatedBytes = RECORD_METADATA_OVERHEAD_BYTES;
            let latestCapturedAt = conv.createdAt;
            let lastMsgId = null;

            for (const m of (msgs || [])) {
              exactMsgCount += 1;
              const mChars = m.content ? m.content.length : 0;
              exactMsgChars += mChars;
              estimatedBytes += (m.estimatedSizeBytes || estimateSizeBytes(mChars, 1));
              if (m.capturedAt && m.capturedAt >= latestCapturedAt) {
                latestCapturedAt = m.capturedAt;
                lastMsgId = m.messageId;
              }
            }

            const getMemReq = memStore.get(conversationId);
            getMemReq.onsuccess = () => {
              const mem = getMemReq.result;
              if (mem) {
                estimatedBytes += (mem.estimatedSizeBytes || estimateSizeBytes(mem.compactSummary ? mem.compactSummary.length : 0, 1));
              }

              conv.messageCount = exactMsgCount;
              conv.totalCharacterCount = exactMsgChars; // Message content characters only
              conv.estimatedSizeBytes = estimatedBytes; // Metadata + messages + summary
              conv.lastActivityAt = Math.max(conv.lastActivityAt || 0, latestCapturedAt);
              if (lastMsgId) conv.lastCapturedMessageId = lastMsgId;

              const putReq = convStore.put(conv);
              putReq.onsuccess = () => {
                setResult(conv);
              };
            };
          };

          if (typeof msgIndex.getAll === 'function') {
            const allReq = msgIndex.getAll(range);
            allReq.onsuccess = () => {
              computeAndSave(allReq.result || []);
            };
          } else {
            const msgs = [];
            const curReq = msgIndex.openCursor(range);
            curReq.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                msgs.push(cursor.value);
                cursor.continue();
              } else {
                computeAndSave(msgs);
              }
            };
          }
        };
      });
    }

    return Object.freeze({
      open,
      close,
      deleteDatabase,
      // Conversations
      createConversation,
      getConversation,
      getConversationByExternalId,
      updateConversation,
      deleteConversation,
      listConversations,
      // Messages
      createMessage,
      getMessage,
      getMessagesByConversation,
      updateMessageContent,
      deleteMessage,
      // Memory
      getConversationMemory,
      setConversationMemory,
      // Accounting
      getStorageAccounting,
      repairConversationAccounting,
      // Pure Utilities & Errors
      computeContentHash,
      estimateSizeBytes,
      StorageError,
      RECORD_METADATA_OVERHEAD_BYTES,
      STORES,
      DB_NAME,
      DB_VERSION
    });
  }

  // Export module interface
  const WDAIDT_DB = Object.freeze({
    DB_NAME,
    DB_VERSION,
    STORES,
    StorageError,
    RECORD_METADATA_OVERHEAD_BYTES,
    computeContentHash,
    estimateSizeBytes,
    createStorageEngine
  });

  if (typeof self !== 'undefined') {
    self.WDAIDT_DB = WDAIDT_DB;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.WDAIDT_DB = WDAIDT_DB;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WDAIDT_DB, ...WDAIDT_DB };
  }
})();
