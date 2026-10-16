import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/storage/db';

let s: Store;
let name = '';
let n = 0;
beforeEach(async () => {
  name = 'poker-lab-test-' + ++n;
  s = new Store(name);
  await s.init();
});

describe('Store', () => {
  it('persists to IndexedDB', () => expect(s.persistent).toBe(true));
  it('add/list/get/update/remove round-trip and notify subscribers', async () => {
    let calls = 0;
    s.onChange('results', () => calls++);
    const id = await s.add('results', { name: 'Freezeout', buyIn: 30, prize: 0 });
    expect(s.list('results')).toHaveLength(1);
    expect(s.get('results', id)!.name).toBe('Freezeout');
    await s.update('results', id, { prize: 90 });
    expect(s.get('results', id)!.prize).toBe(90);
    expect(s.get('results', id)!.buyIn).toBe(30);
    await s.remove('results', id);
    expect(s.list('results')).toHaveLength(0);
    expect(calls).toBe(3);
  });
  it('survives a reload (new Store instance reads the same data)', async () => {
    await s.add('hands', { cards: 'AhKd' });
    const s2 = new Store(name);
    await s2.init();
    expect(s2.list('hands')).toHaveLength(1);
  });
  it('update of a missing doc throws', async () => {
    await expect(s.update('results', 'nope', { a: 1 })).rejects.toThrow();
  });
  it('export and import (merge and replace)', async () => {
    await s.add('results', { name: 'A' });
    await s.add('practice', { n: 1 });
    const dump = s.exportAll();
    expect(dump.app).toBe('poker-lab');
    const s2 = new Store(name + '-b');
    await s2.init();
    await s2.add('results', { name: 'Other' });
    expect(await s2.importAll(JSON.parse(JSON.stringify(dump)), 'merge')).toBe(2);
    expect(s2.list('results')).toHaveLength(2);
    await s2.importAll(dump, 'replace');
    expect(s2.list('results')).toHaveLength(1);
  });
  it('rejects a foreign file', async () => {
    await expect(s.importAll({ hello: 1 })).rejects.toThrow(/not a Poker Lab backup/);
  });
  it('works in memory when IndexedDB is unavailable', async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error simulate blocked storage
    globalThis.indexedDB = undefined;
    const m = new Store();
    await m.init();
    globalThis.indexedDB = real;
    expect(m.persistent).toBe(false);
    const id = await m.add('results', { name: 'mem' });
    expect(m.get('results', id)!.name).toBe('mem');
  });
});
