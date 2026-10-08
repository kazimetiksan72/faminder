import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPairingLoop, type PairingCode } from './pairing';
const code = (value: string): PairingCode => ({
  code: value,
  secret: `secret-${value}`,
  expiresAt: new Date(Date.now() + 600000).toISOString(),
});
function setup() {
  const options = {
    create: vi.fn(async () => code('111111')),
    poll: vi.fn<() => Promise<{ token?: string }>>().mockResolvedValue({}),
    saveToken: vi.fn(async (_token: string) => {}),
    onCode: vi.fn(),
    onBusy: vi.fn(),
    onError: vi.fn(),
    onPaired: vi.fn(),
  };
  return { ...options, loop: createPairingLoop(options) };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T16:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});
describe('hands-free tablet pairing', () => {
  it('renews an expired code and completes pairing without a tablet action', async () => {
    const s = setup();
    await s.loop.tick();
    expect(s.onCode).toHaveBeenLastCalledWith(expect.objectContaining({ code: '111111' }));
    await vi.advanceTimersByTimeAsync(600000);
    s.create.mockResolvedValueOnce(code('222222'));
    s.poll.mockResolvedValueOnce({ token: 'device-token' });
    await s.loop.tick();
    expect(s.onCode).toHaveBeenLastCalledWith(expect.objectContaining({ code: '222222' }));
    expect(s.poll).toHaveBeenLastCalledWith(expect.objectContaining({ code: '222222' }));
    expect(s.saveToken).toHaveBeenCalledWith('device-token');
    expect(s.onPaired).toHaveBeenCalledWith('device-token');
    await s.loop.tick();
    expect(s.create).toHaveBeenCalledTimes(2);
    expect(s.saveToken).toHaveBeenCalledOnce();
  });
  it('recovers from an offline first start without hammering the pairing API', async () => {
    const s = setup();
    s.create.mockRejectedValueOnce(new Error('Offline'));
    await s.loop.tick();
    expect(s.onError).toHaveBeenCalledWith(expect.stringContaining('yeniden denenecek'));
    await vi.advanceTimersByTimeAsync(4000);
    await s.loop.tick();
    expect(s.create).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(12000);
    await s.loop.tick();
    expect(s.onCode).toHaveBeenLastCalledWith(expect.objectContaining({ code: '111111' }));
    expect(s.poll).toHaveBeenCalledOnce();
  });
  it('replaces a code rejected as expired by the server', async () => {
    const s = setup();
    s.poll.mockRejectedValueOnce(Object.assign(new Error('Expired'), { status: 410 }));
    await s.loop.tick();
    expect(s.onCode).toHaveBeenLastCalledWith(null);
    s.create.mockResolvedValueOnce(code('222222'));
    await s.loop.tick();
    expect(s.poll).toHaveBeenLastCalledWith(expect.objectContaining({ code: '222222' }));
  });
  it('retries a failed poll using the same live code', async () => {
    const s = setup();
    s.poll.mockRejectedValueOnce(new Error('Offline'));
    await s.loop.tick();
    await vi.advanceTimersByTimeAsync(16000);
    s.poll.mockResolvedValueOnce({ token: 'recovered-token' });
    await s.loop.tick();
    expect(s.create).toHaveBeenCalledOnce();
    expect(s.onPaired).toHaveBeenCalledWith('recovered-token');
  });
  it('does not overlap requests or install a late code after stopping', async () => {
    const s = setup();
    let resolve!: (value: PairingCode) => void;
    s.create.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = s.loop.tick();
    await s.loop.tick();
    expect(s.create).toHaveBeenCalledOnce();
    s.loop.stop();
    resolve(code('111111'));
    await pending;
    expect(s.onCode.mock.calls).toEqual([[null]]);
    expect(s.poll).not.toHaveBeenCalled();
    expect(s.saveToken).not.toHaveBeenCalled();
  });
});
