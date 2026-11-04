import type { SegmentKey } from "./remotion/types";

/**
 * Keeps voice-over clips in the browser (IndexedDB), per question and segment, so a recording
 * survives a page reload or switching to another question and back. Nothing leaves the machine.
 */

export type ClipSource = "tts" | "rec" | "file";
export type StoredClip = { segment: SegmentKey; blob: Blob; sec: number; source: ClipSource };

const DB = "nirnoy-reel-studio";
const STORE = "voice";
let opening: Promise<IDBDatabase> | null = null;

const db = () =>
  (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));

const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise<T>((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

const key = (questionId: number, segment: SegmentKey) => `${questionId}:${segment}`;

export const saveClip = (questionId: number, clip: StoredClip) => run("readwrite", (s) => s.put(clip, key(questionId, clip.segment)));

export const deleteClip = (questionId: number, segment: SegmentKey) => run("readwrite", (s) => s.delete(key(questionId, segment)));

export const loadClips = (questionId: number) =>
  run<StoredClip[]>("readonly", (s) => s.getAll(IDBKeyRange.bound(`${questionId}:`, `${questionId}:￿`)));
