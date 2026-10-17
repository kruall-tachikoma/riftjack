import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { PublicError } from './errors.js';
import type { MatrixEvent } from './bridge.js';

export type RoomPolicy = { bot: string; room: string; audience: 'owner' | 'users' | 'members'; users: string[]; mode: 'off' | 'mentions' | 'threads' | 'all' };
export const validUser = (v: unknown): v is string => typeof v === 'string' && /^@[^\s:]+:[^\s]+$/.test(v);
export const validRoom = (v: unknown): v is string => typeof v === 'string' && /^![^\s]+$/.test(v);
export function roomPolicy(value: unknown): RoomPolicy {
  const p = value as RoomPolicy;
  if (!p || !validUser(p.bot) || !validRoom(p.room) || !['owner', 'users', 'members'].includes(p.audience) ||
      !['off', 'mentions', 'threads', 'all'].includes(p.mode) || !Array.isArray(p.users) || !p.users.every(validUser) ||
      Object.keys(p).some(k => !['bot', 'room', 'audience', 'users', 'mode'].includes(k))) throw new PublicError('Invalid room policy.');
  return { ...p, users: [...new Set(p.users)] };
}
export class RoomPolicies {
  private policies: RoomPolicy[];
  constructor(private file: string, private owner: string) {
    this.policies = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).map(roomPolicy) : [];
  }
  list() { return this.policies.map(p => ({ ...p, users: [...p.users] })); }
  get(bot: string, room: string) { return this.policies.find(p => p.bot === bot && p.room === room); }
  has(bot: string, room: string, sender: string) {
    const p = this.get(bot, room);
    return !!p && p.mode !== 'off' && (sender === this.owner || p.audience === 'members' || (p.audience === 'users' && p.users.includes(sender)));
  }
  set(sender: string, value: unknown) {
    if (sender !== this.owner) throw new PublicError('Only the owner can change room policies.');
    const p = roomPolicy(value), next = this.policies.filter(x => x.bot !== p.bot || x.room !== p.room).concat(p);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file); this.policies = next;
  }
  async allowed(bot: string, room: string, sender: string, state: () => Promise<any[]>) {
    if (!this.has(bot, room, sender)) return false;
    const s = await state();
    const content = (type: string, key = '') => s.find(e => e.type === type && e.state_key === key)?.content;
    return this.has(bot, room, sender) && content('m.room.encryption')?.algorithm === 'm.megolm.v1.aes-sha2' &&
      content('m.room.join_rules')?.join_rule === 'invite' && content('m.room.history_visibility')?.history_visibility === 'joined' &&
      [bot, sender].every(id => content('m.room.member', id)?.membership === 'join');
  }
  async triggers(bot: string, room: string, event: MatrixEvent, read: (id: string) => Promise<MatrixEvent | undefined>) {
    const p = this.get(bot, room);
    if (!p || p.mode === 'off') return false;
    if (event.content?.body && /^!(approve|deny|answer|cancel)(?:\s|$)/.test(event.content.body)) return true;
    if (event.type === 'm.reaction') return true; // Reaction authorization is checked separately.
    if (p.mode === 'all') return true;
    if (event.content?.['m.mentions']?.user_ids?.includes(bot)) return true;
    if (p.mode !== 'threads') return false;
    const r = event.content?.['m.relates_to'];
    return r?.rel_type === 'm.thread' && !!r.event_id && (await read(r.event_id))?.sender === bot;
  }
}
