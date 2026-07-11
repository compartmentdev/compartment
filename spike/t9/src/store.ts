import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEvent, Database, Row } from './types.js';

export class Store {
  private writes: Promise<void> = Promise.resolve();
  public constructor(
    private readonly path: string,
    private readonly auditPath: string,
  ) {}

  public async read(): Promise<Database> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { rows: [] };
    }
  }

  public async put(row: Row): Promise<void> {
    await this.enqueue(async () => {
      const db = await this.read();
      const index = db.rows.findIndex((candidate) => candidate.id === row.id);
      if (index === -1) db.rows.push(row);
      else db.rows[index] = row;
      await this.write(db);
    });
  }

  public async patch(id: string, patch: Partial<Row>): Promise<void> {
    await this.enqueue(async () => {
      const db = await this.read();
      const row = db.rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`missing row ${id}`);
      Object.assign(row, patch);
      await this.write(db);
    });
  }

  public async audit(event: Omit<AuditEvent, 'at'>): Promise<void> {
    await mkdir(dirname(this.auditPath), { recursive: true });
    await appendFile(this.auditPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  }

  private async write(db: Database): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(db, null, 2)}\n`);
    await rename(temporary, this.path);
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writes.then(operation, operation);
    this.writes = next.catch(() => undefined);
    await next;
  }
}
