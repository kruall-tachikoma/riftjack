import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export type ManagerRun = { id: string; key: string; request: string; commands: string[]; results: string[]; state: 'prepared' | 'declined' | 'running' | 'complete' | 'failed' | 'uncertain'; next: number };
export class ManagerHistory {
  private runs: ManagerRun[];
  constructor(private file: string) { this.runs = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []; }
  recent(key: string) { return this.runs.filter(r => r.key === key).slice(-8); }
  unresolved(command: string) { return this.runs.some(r => (r.state === 'running' || r.state === 'uncertain') && r.commands[r.next] === command); }
  begin(key: string, request: string, commands: string[]) {
    const run: ManagerRun = { id: randomUUID(), key, request, commands, results: [], state: 'prepared', next: 0 };
    const next = [...this.runs, run]; this.save(next); this.runs = next; return run;
  }
  update(run: ManagerRun, fields: Partial<ManagerRun>) { const updated = { ...run, ...fields }; this.save(this.runs.map(r => r.id === run.id ? updated : r)); Object.assign(run, fields); }
  private save(runs: ManagerRun[]) {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(this.file + '.tmp', JSON.stringify(runs, null, 2), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
}
