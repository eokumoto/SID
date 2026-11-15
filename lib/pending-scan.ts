"use client";

import type { Scan } from "./ui-types";

const databaseName = "sid";
const storeName = "scans";
const key = "pendingScan";
const maxAge = 60 * 60 * 1000;

export type PendingScan = {
  createdAt: number;
  file: Blob;
  fileName: string;
  scan: Omit<Scan, "photoUrl">;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function savePendingScan(value: PendingScan) {
  await withStore("readwrite", (store) => store.put(value, key));
}

export async function readPendingScan(): Promise<PendingScan | null> {
  const value = await withStore("readonly", (store) => store.get(key));
  if (!value || typeof value !== "object") return null;
  const scan = value as PendingScan;
  if (Date.now() - scan.createdAt > maxAge) {
    await clearPendingScan();
    return null;
  }
  return scan;
}

export async function clearPendingScan() {
  await withStore("readwrite", (store) => store.delete(key));
}
