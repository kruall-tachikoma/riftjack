import type { State } from './state.js';

type Transport = {
  send: (room: string, eventId: string) => Promise<string>;
  remove: (room: string, reactionId: string) => Promise<unknown>;
};

// One indicator per bot, even when its next turn runs in another room.
export class TurnReaction {
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();
  constructor(private state: State, private bot: string, private transport: Transport) {}

  private serialize(action: () => Promise<void>) {
    const task = this.tail.then(action);
    this.tail = task.catch(() => {});
    return task;
  }

  private async clear() {
    const marker = this.state.turnReaction(this.bot);
    if (!marker) return;
    await this.transport.remove(marker.room, marker.eventId);
    this.state.saveTurnReaction(this.bot, undefined);
  }

  started() {
    ++this.revision;
    return this.serialize(() => this.clear());
  }

  completed(room: string, eventId: string, allowed: () => Promise<boolean>) {
    const revision = this.revision;
    return this.serialize(async () => {
      await this.clear();
      if (revision !== this.revision || !(await allowed()) || revision !== this.revision) return;
      const reactionId = await this.transport.send(room, eventId);
      this.state.saveTurnReaction(this.bot, { room, eventId: reactionId });
      // A worker can claim its next task while the Matrix request is in flight.
      if (revision !== this.revision || !(await allowed()) || revision !== this.revision) await this.clear();
    });
  }
}
