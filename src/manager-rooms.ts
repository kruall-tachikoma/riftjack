import { PublicError } from './errors.js';
import { roomPolicy, validRoom, validUser, type RoomPolicy } from './room-policies.js';
export type ManagerRoomRequest = { action: 'invite'; bot: string; room: string } | { action: 'policy'; policy: RoomPolicy } | { action: 'list' };
export function parseManagerRoomRequest(text: string): ManagerRoomRequest | null {
  if (text.trim() === 'list room policies') return { action: 'list' };
  const invite = /^invite bot (\S+) to (\S+)$/.exec(text.trim());
  if (invite) {
    if (!validUser(invite[1]) || !validRoom(invite[2])) throw new PublicError('Use exact bot and room IDs.');
    return { action: 'invite', bot: invite[1], room: invite[2] };
  }
  if (text.startsWith('set room policy ')) {
    let value: unknown;
    try { value = JSON.parse(text.slice('set room policy '.length)); } catch { throw new PublicError('Supply a valid JSON room policy.'); }
    return { action: 'policy', policy: roomPolicy(value) };
  }
  return null;
}
export const managerRoomHelp = `Room operations:
list room policies
invite bot @bot:example.org to !room:example.org
set room policy {"bot":"@bot:example.org","room":"!room:example.org","audience":"owner","users":[],"mode":"mentions"}
Audience: owner, users (explicit Matrix user IDs), members (all current human members).
Mode: off, mentions (explicit Matrix mention only), threads (mention or thread rooted at the bot's message), all.
Only the owner can manage room policies/invitations. Manager must already be joined to the room and able to invite; rooms must be encrypted, invite-only, with joined history visibility. Policies grant access in that room only. Existing linked rooms cannot be overridden here.`;
