import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Main-process memory only. Never send this object through IPC or persist it. */
export interface Credentials {
  accountKey: string;
  accountID: string;
  token: string;
}

export function accountKey(accountID: string): string {
  return createHash('sha256').update(accountID).digest('hex');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validOpaqueValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 16_384 &&
    value === value.trim() &&
    !/[\x00-\x1f\x7f]/u.test(value)
  );
}

/** Consistency check only: the official server verifies the token signature. */
export function validateCredentials(credentials: Credentials): void {
  try {
    const { token, accountID } = credentials;
    if (
      !validOpaqueValue(accountID) ||
      !validOpaqueValue(token) ||
      credentials.accountKey !== accountKey(accountID)
    )
      throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) throw new Error();
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!isRecord(claims)) throw new Error();
    const auth = claims['https://api.openai.com/auth'];
    if (!isRecord(auth) || auth.chatgpt_account_id !== accountID) throw new Error();
  } catch {
    throw new Error('Sign in to Codex with a ChatGPT account.');
  }
}

export async function readCredentials(
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
): Promise<Credentials> {
  try {
    const file = join(codexHome, 'auth.json');
    if ((await stat(file)).size > 2_000_000) throw new Error();
    const data = await readFile(file);
    if (data.length > 2_000_000) throw new Error();
    const auth: unknown = JSON.parse(data.toString('utf8'));
    if (
      !isRecord(auth) ||
      !isRecord(auth.tokens) ||
      !validOpaqueValue(auth.tokens.account_id) ||
      !validOpaqueValue(auth.tokens.access_token)
    )
      throw new Error();
    const credentials: Credentials = {
      accountKey: accountKey(auth.tokens.account_id),
      accountID: auth.tokens.account_id,
      token: auth.tokens.access_token,
    };
    validateCredentials(credentials);
    return credentials;
  } catch {
    throw new Error('Sign in to Codex with a ChatGPT account.');
  }
}

export async function getAccountKey(codexHome?: string): Promise<string | null> {
  try {
    return (await readCredentials(codexHome)).accountKey;
  } catch {
    return null;
  }
}
