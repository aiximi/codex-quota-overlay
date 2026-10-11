import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { QuotaSnapshot, ResetOutcome } from '../shared/contracts.js';
import { isRecord, validOpaqueValue } from './auth.js';
import { parseQuota } from './quota.js';

export interface ConsumeResetRequest {
  creditID: string;
  idempotencyKey: string;
  expectedAccountKey: string;
  currentAccountKey: () => Promise<string | null>;
}

export interface ClientOptions {
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  spawn?: (
    executable: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => ChildProcessWithoutNullStreams;
}

export function childEnvironment(source = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, RUST_LOG: 'off' };
  const hasHTTPProxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((key) =>
    /^https?:\/\//iu.test(env[key] || ''),
  );
  if (hasHTTPProxy) {
    for (const key of ['ALL_PROXY', 'all_proxy']) {
      if (/^socks5h:\/\//iu.test(env[key] || '')) delete env[key];
    }
  }
  return env;
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  child.stdin.end();
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 1_000);
  timer.unref();
}

/** One short-lived official CLI child per operation. No requests are retried. */
export class CodexClient {
  private running = false;
  private stopped = false;
  private cancel: (() => void) | null = null;
  private readonly timeoutMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly spawnChild: NonNullable<ClientOptions['spawn']>;

  constructor(
    private readonly executable: string,
    options: ClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.platform = options.platform ?? process.platform;
    this.spawnChild =
      options.spawn ??
      ((file, args, env) =>
        spawn(file, args, {
          env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }));
  }

  async readLimits(): Promise<QuotaSnapshot> {
    return parseQuota(
      await this.request(
        'account/rateLimits/read',
        // The Windows desktop CLI defines this request as parameterless.
        // An object is rejected before any quota is read. Preserve the existing
        // macOS request shape, which supports explicit reset-credit details.
        this.platform === 'win32' ? null : { excludeResetCreditDetails: false },
      ),
    );
  }

  async consumeReset(request: ConsumeResetRequest): Promise<ResetOutcome> {
    if (
      !validOpaqueValue(request.creditID) ||
      !validOpaqueValue(request.expectedAccountKey) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        request.idempotencyKey,
      )
    ) {
      throw new Error('The selected reset is invalid. Refresh and select it again.');
    }
    const validateAccount = async (): Promise<void> => {
      if ((await request.currentAccountKey()) !== request.expectedAccountKey) {
        throw new Error('The signed-in account changed. Refresh before resetting.');
      }
    };
    const result = await this.request(
      'account/rateLimitResetCredit/consume',
      {
        creditId: request.creditID,
        idempotencyKey: request.idempotencyKey,
      },
      validateAccount,
    );
    if (
      result.outcome === 'reset' ||
      result.outcome === 'alreadyRedeemed' ||
      result.outcome === 'nothingToReset' ||
      result.outcome === 'noCredit'
    )
      return result.outcome;
    throw new Error('The reset result is unrecognized. Refresh to check its status.');
  }

  close(): void {
    this.stopped = true;
    this.cancel?.();
  }

  private async request(
    method: string,
    params: Record<string, unknown> | null,
    validateAccount?: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    if (this.stopped) throw new Error('The quota service is closed.');
    if (this.running) throw new Error('Another quota operation is in progress.');
    this.running = true;
    try {
      await validateAccount?.();
      if (this.stopped) throw new Error('The quota service is closed.');
      return await this.exchange(method, params, validateAccount);
    } finally {
      this.running = false;
    }
  }

  private exchange(
    method: string,
    params: Record<string, unknown> | null,
    validateAccount?: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnChild(this.executable, ['app-server', '--stdio'], childEnvironment());
      } catch {
        reject(new Error('Codex CLI could not be started. Check its executable path.'));
        return;
      }
      let finished = false;
      let sentRequest = false;
      let buffer = '';
      let receivedBytes = 0;
      let queue = Promise.resolve();
      const finish = (error?: Error, result?: Record<string, unknown>): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.cancel = null;
        terminate(child);
        if (error) reject(error);
        else resolve(result!);
      };
      const timer = setTimeout(
        () => finish(new Error('The quota service timed out. Refresh to check its status.')),
        this.timeoutMs,
      );
      this.cancel = () => finish(new Error('The quota operation was stopped.'));
      const send = (payload: Record<string, unknown>): void => {
        if (finished) return;
        child.stdin.write(JSON.stringify(payload) + '\n', (error) => {
          if (error)
            finish(new Error('The quota service connection ended. Refresh to check its status.'));
        });
      };
      const receive = async (line: string): Promise<void> => {
        if (finished || !line.trim()) return;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (!isRecord(message) || message.id === undefined) return;
        if (typeof message.method === 'string') {
          send({ id: message.id, error: { code: -32601, message: 'Unsupported request' } });
          return;
        }
        if (message.id !== 1 && !(message.id === 2 && sentRequest)) return;
        if (isRecord(message.error)) {
          const raw = typeof message.error.message === 'string' ? message.error.message : '';
          const authentication = /not logged|unauthorized|authentication|requires chatgpt/iu.test(
            raw,
          );
          throw new Error(
            authentication
              ? 'Sign in to Codex with a ChatGPT account.'
              : 'The quota service rejected the request. Refresh to check its status.',
          );
        }
        if (!isRecord(message.result))
          throw new Error('The quota service returned unrecognized data.');
        if (message.id === 1 && !sentRequest) {
          send({ method: 'initialized' });
          await validateAccount?.();
          if (finished || this.stopped) return;
          sentRequest = true;
          send({ id: 2, method, params });
        } else if (message.id === 2) {
          finish(undefined, message.result);
        }
      };
      child.stderr.resume(); // Deliberately discard service diagnostics; they may contain account data.
      child.stderr.on('error', () => {
        /* Diagnostics are optional and never displayed. */
      });
      child.stdin.on('error', () => finish(new Error('The quota service connection ended.')));
      child.stdout.on('error', () => finish(new Error('The quota service connection ended.')));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (finished) return;
        buffer += chunk;
        receivedBytes += Buffer.byteLength(chunk);
        if (receivedBytes > 2_000_000) {
          finish(new Error('The quota service returned too much data.'));
          return;
        }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          queue = queue
            .then(() => receive(line))
            .catch((error: unknown) => {
              finish(
                error instanceof Error ? error : new Error('The quota service request failed.'),
              );
            });
        }
      });
      child.on('error', () =>
        finish(new Error('Codex CLI could not be started. Check its executable path.')),
      );
      child.on('close', () => {
        void queue.finally(() =>
          finish(new Error('The quota service connection ended. Refresh to check its status.')),
        );
      });
      send({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: {
            name: 'codex-quota-overlay',
            title: 'Codex Quota Overlay',
            version: '1.0.0',
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
            explicitGatewayOauth: true,
          },
        },
      });
    });
  }
}
