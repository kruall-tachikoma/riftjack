import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { State } from '../src/state.js';
import { TurnReaction } from '../src/turn-reaction.js';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'turn-reaction-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  return { file, state: new State(file) };
}
const allowed = async () => true;

test('the next task removes the persisted reaction, including after restart and across rooms', async t => {
  const { file, state } = fixture(t), calls: string[] = [];
  const transport = {
    send: async (room: string, id: string) => { calls.push(`send ${room} ${id}`); return '$reaction'; },
    remove: async (room: string, id: string) => { calls.push(`remove ${room} ${id}`); },
  };
  await new TurnReaction(state, '@bot:test', transport).completed('!first:test', '$reply', allowed);
  const restarted = new TurnReaction(new State(file), '@bot:test', transport);
  await restarted.started();
  assert.deepEqual(calls, ['send !first:test $reply', 'remove !first:test $reaction']);
  assert.equal(new State(file).turnReaction('@bot:test'), undefined);
  await restarted.completed('!second:test', '$next', allowed);
  assert.equal(calls.at(-1), 'send !second:test $next');
});

test('a task starting during reaction delivery removes it before start resolves', async t => {
  const { state } = fixture(t);
  let finish!: (id: string) => void, sending!: () => void;
  const ready = new Promise<void>(resolve => { sending = resolve; });
  const removed: string[] = [];
  const reaction = new TurnReaction(state, '@bot:test', {
    send: () => { sending(); return new Promise(resolve => { finish = resolve; }); },
    remove: async (_room, id) => { removed.push(id); },
  });
  const complete = reaction.completed('!room:test', '$reply', allowed);
  await ready;
  const start = reaction.started();
  finish('$late');
  await Promise.all([complete, start]);
  assert.deepEqual(removed, ['$late']);
  assert.equal(state.turnReaction('@bot:test'), undefined);
});

test('a new task invalidates completion waiting for access checks', async t => {
  const { state } = fixture(t);
  let finish!: (ok: boolean) => void, checking!: () => void;
  const ready = new Promise<void>(resolve => { checking = resolve; });
  const reaction = new TurnReaction(state, '@bot:test', {
    send: async () => { assert.fail('Must not mark a running task'); }, remove: async () => {},
  });
  const complete = reaction.completed('!room:test', '$reply', () => {
    checking(); return new Promise(resolve => { finish = resolve; });
  });
  await ready;
  const start = reaction.started(); finish(true);
  await Promise.all([complete, start]);
});

test('queued work arriving during delivery removes the transient marker', async t => {
  const { state } = fixture(t); let idle = true, removed = false;
  const reaction = new TurnReaction(state, '@bot:test', {
    send: async () => { idle = false; return '$reaction'; },
    remove: async () => { removed = true; },
  });
  await reaction.completed('!room:test', '$reply', async () => idle);
  assert.equal(removed, true);
});

test('failed removal retains the receipt for retry and cannot accumulate markers', async t => {
  const { state } = fixture(t); let fail = true;
  state.saveTurnReaction('@bot:test', { room: '!room:test', eventId: '$old' });
  const reaction = new TurnReaction(state, '@bot:test', {
    send: async () => { assert.fail('Old marker was not removed'); },
    remove: async () => { if (fail) throw new Error('offline'); },
  });
  await assert.rejects(reaction.started(), /offline/);
  await assert.rejects(reaction.completed('!room:test', '$new', allowed), /offline/);
  assert.equal(state.turnReaction('@bot:test')?.eventId, '$old');
  fail = false; await reaction.started();
  assert.equal(state.turnReaction('@bot:test'), undefined);
});

test('disabled or busy completion sends no marker', async t => {
  const { state } = fixture(t);
  const reaction = new TurnReaction(state, '@bot:test', {
    send: async () => { assert.fail('Disabled'); }, remove: async () => {},
  });
  await reaction.completed('!room:test', '$reply', async () => false);
});
