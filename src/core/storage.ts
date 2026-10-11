import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRecord } from './auth.js';

/** Small, atomic settings/receipt store. Authentication credentials never belong here. */
export class Store {
  private values: Record<string, unknown>;

  constructor(private readonly filePath: string) {
    try {
      if (!existsSync(filePath)) {
        this.values = {};
        return;
      }
      if (statSync(filePath).size > 4_000_000) throw new Error();
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      if (!isRecord(parsed)) throw new Error();
      this.values = parsed;
    } catch {
      // Never silently discard an unreadable pending-reset receipt.
      throw new Error(
        'Local settings could not be read. Restore the settings file before continuing.',
      );
    }
  }

  get<T>(key: string): T | undefined {
    const value = Object.hasOwn(this.values, key) ? this.values[key] : undefined;
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  set(key: string, value: unknown): void {
    this.persist({ ...this.values, [key]: structuredClone(value) });
  }

  delete(key: string): void {
    const next = { ...this.values };
    delete next[key];
    this.persist(next);
  }

  private persist(next: Record<string, unknown>): void {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const serialized = JSON.stringify(next, null, 2) + '\n';
      if (Buffer.byteLength(serialized) > 4_000_000) throw new Error();
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, serialized, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, this.filePath);
      // Flush the renamed directory entry as well where the OS supports it.
      // Windows does not expose directory fsync through Node's filesystem API.
      if (process.platform !== 'win32') {
        const directory = openSync(dirname(this.filePath), 'r');
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
      }
      this.values = next;
    } catch {
      throw new Error('Local settings could not be saved. No new reset will be submitted.');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      try {
        unlinkSync(temporary);
      } catch {
        /* The atomic rename already removed it. */
      }
    }
  }
}
