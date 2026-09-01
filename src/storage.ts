import type {
  AnnotationDocument,
  AnswerIdentity,
  LoadedAnnotation,
} from "./types";

const DATABASE_NAME = "paintgpt-answer-annotations";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";
const MESSAGE_INDEX = "by-message";

interface StoredAnnotation extends AnnotationDocument {
  key: string;
  messageKey: string;
}

function messageKey(identity: Pick<AnswerIdentity, "conversationId" | "messageId">) {
  return `${identity.conversationId}::${identity.messageId}`;
}

function documentKey(identity: AnswerIdentity) {
  return `${messageKey(identity)}::${identity.contentHash}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex(MESSAGE_INDEX, "messageKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开批注数据库"));
  });
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("批注数据库操作失败"));
  });
}

function stripStorageFields(stored: StoredAnnotation): AnnotationDocument {
  const { key: _key, messageKey: _messageKey, ...document } = stored;
  return document;
}

export async function loadAnnotation(identity: AnswerIdentity): Promise<LoadedAnnotation> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const exact = (await waitForRequest(
      store.get(documentKey(identity)),
    )) as StoredAnnotation | undefined;

    if (exact) {
      return { document: stripStorageFields(exact), contentMismatch: false };
    }

    const candidates = (await waitForRequest(
      store.index(MESSAGE_INDEX).getAll(messageKey(identity)),
    )) as StoredAnnotation[];
    const latest = candidates.sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return latest
      ? { document: stripStorageFields(latest), contentMismatch: true }
      : { document: null, contentMismatch: false };
  } finally {
    database.close();
  }
}

export async function saveAnnotation(document: AnnotationDocument): Promise<void> {
  const database = await openDatabase();
  try {
    const identity: AnswerIdentity = document;
    const stored: StoredAnnotation = {
      ...document,
      key: documentKey(identity),
      messageKey: messageKey(identity),
    };
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await waitForRequest(transaction.objectStore(STORE_NAME).put(stored));
  } finally {
    database.close();
  }
}

export const storageKeys = { messageKey, documentKey };
