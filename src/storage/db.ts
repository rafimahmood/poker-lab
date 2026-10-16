/**
 * Local-first storage. Data lives in the visitor's own browser (IndexedDB), is cached in memory for
 * synchronous reads, and notifies subscribers on change. If IndexedDB is unavailable (private mode,
 * blocked storage) it falls back to memory only and `persistent` is false so the UI can say so.
 */
export const COLLECTIONS = ['results', 'hands', 'hhimports', 'lessons', 'practice', 'sessions', 'tours', 'tourhands', 'livehands'] as const;
export type CollectionName = (typeof COLLECTIONS)[number];
export type Doc = { id: string; [k: string]: any };
export type Dump = { app: 'poker-lab'; version: 1; exported: string; data: Partial<Record<CollectionName, Doc[]>> };

const DEFAULT_DB = 'poker-lab';
const DB_VERSION = 1;

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t: IDBTransaction): Promise<void> => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export class Store {
  persistent = false;
  private db: IDBDatabase | null = null;
  private cache = new Map<CollectionName, Map<string, Doc>>();
  private subs = new Map<CollectionName, Set<() => void>>();

  constructor(private dbName = DEFAULT_DB) { for (const c of COLLECTIONS) { this.cache.set(c, new Map()); this.subs.set(c, new Set()); } }

  async init(): Promise<void> {
    try {
      if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
      const open = indexedDB.open(this.dbName, DB_VERSION);
      open.onupgradeneeded = () => { for (const c of COLLECTIONS) if (!open.result.objectStoreNames.contains(c)) open.result.createObjectStore(c, { keyPath: 'id' }); };
      this.db = await req(open);
      for (const c of COLLECTIONS) {
        const rows = (await req(this.db.transaction(c).objectStore(c).getAll())) as Doc[];
        const m = this.cache.get(c)!;
        rows.forEach((r) => m.set(r.id, r));
      }
      this.persistent = true;
    } catch {
      this.db = null;
      this.persistent = false;
    }
  }

  list<T extends Doc = Doc>(c: CollectionName): T[] { return [...this.cache.get(c)!.values()] as T[]; }
  get<T extends Doc = Doc>(c: CollectionName, id: string): T | undefined { return this.cache.get(c)!.get(id) as T | undefined; }

  onChange(c: CollectionName, cb: () => void): () => void {
    this.subs.get(c)!.add(cb);
    return () => void this.subs.get(c)!.delete(cb);
  }
  private emit(c: CollectionName) { this.subs.get(c)!.forEach((cb) => { try { cb(); } catch (e) { console.error(e); } }); }

  private async write(c: CollectionName, fn: (os: IDBObjectStore) => void) {
    if (!this.db) return;
    const t = this.db.transaction(c, 'readwrite');
    fn(t.objectStore(c));
    await done(t);
  }

  async add(c: CollectionName, data: Record<string, any>): Promise<string> {
    const id = data.id ?? newId();
    await this.set(c, id, data);
    return id;
  }

  async set(c: CollectionName, id: string, data: Record<string, any>): Promise<void> {
    const doc: Doc = JSON.parse(JSON.stringify({ ...data, id }));
    await this.write(c, (os) => void os.put(doc));
    this.cache.get(c)!.set(id, doc);
    this.emit(c);
  }

  /** Shallow-merge `patch` into an existing doc. */
  async update(c: CollectionName, id: string, patch: Record<string, any>): Promise<void> {
    const cur = this.get(c, id);
    if (!cur) throw new Error(`${c}/${id} not found`);
    await this.set(c, id, { ...cur, ...patch });
  }

  async remove(c: CollectionName, id: string): Promise<void> {
    await this.write(c, (os) => void os.delete(id));
    this.cache.get(c)!.delete(id);
    this.emit(c);
  }

  async clear(c: CollectionName): Promise<void> {
    await this.write(c, (os) => void os.clear());
    this.cache.get(c)!.clear();
    this.emit(c);
  }

  exportAll(): Dump {
    const data: Dump['data'] = {};
    for (const c of COLLECTIONS) data[c] = this.list(c);
    return { app: 'poker-lab', version: 1, exported: new Date().toISOString(), data };
  }

  /** Import a backup. 'merge' keeps existing docs with other ids; 'replace' wipes first. Returns docs written. */
  async importAll(dump: unknown, mode: 'merge' | 'replace' = 'merge'): Promise<number> {
    const d = dump as Dump;
    if (!d || d.app !== 'poker-lab' || typeof d.data !== 'object' || !d.data) throw new Error('That file is not a Poker Lab backup.');
    let n = 0;
    for (const c of COLLECTIONS) {
      const rows = d.data[c];
      if (!Array.isArray(rows)) continue;
      if (mode === 'replace') await this.clear(c);
      for (const r of rows) {
        if (r && typeof r.id === 'string') { await this.set(c, r.id, r); n++; }
      }
    }
    return n;
  }
}

export const store = new Store();
