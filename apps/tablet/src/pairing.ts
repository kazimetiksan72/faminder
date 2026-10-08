export type PairingCode = { code: string; secret: string; expiresAt: string };

// Pairing must recover without a button on the wall tablet.
export function createPairingLoop(options: {
  create: () => Promise<PairingCode>;
  poll: (code: PairingCode) => Promise<{ token?: string }>;
  saveToken: (token: string) => Promise<void>;
  onCode: (code: PairingCode | null) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onPaired: (token: string) => void;
}) {
  let code: PairingCode | null = null;
  let pending = false;
  let stopped = false;
  let retryAt = 0;
  return {
    stop() {
      stopped = true;
    },
    async tick() {
      if (stopped || pending || Date.now() < retryAt) return;
      pending = true;
      try {
        if (!code || Date.parse(code.expiresAt) <= Date.now()) {
          options.onCode(null);
          options.onBusy(true);
          code = await options.create();
          if (stopped) return;
          options.onCode(code);
          options.onBusy(false);
          options.onError('');
        }
        const answer = await options.poll(code);
        if (stopped) return;
        if (answer.token) {
          await options.saveToken(answer.token);
          if (stopped) return;
          stopped = true;
          options.onPaired(answer.token);
        } else options.onError('');
      } catch (error) {
        if (stopped) return;
        if ((error as { status?: number }).status === 410) {
          code = null;
          options.onCode(null);
          retryAt = 0;
        } else {
          retryAt = Date.now() + 15000;
          options.onError(
            `${(error as Error).message} Bağlantı otomatik olarak yeniden denenecek.`,
          );
        }
      } finally {
        pending = false;
        if (!stopped) options.onBusy(false);
      }
    },
  };
}
