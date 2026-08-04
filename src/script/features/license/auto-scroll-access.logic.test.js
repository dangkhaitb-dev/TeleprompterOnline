import { describe, expect, it, vi } from 'vitest';

vi.mock('./license.logic.js', () => ({
  getAutoScrollLicenseStatus: vi.fn(),
}));

import {
  AUTO_SCROLL_MONTHLY_LIMIT,
  createAutoScrollAccessController,
} from './auto-scroll-access.logic.js';

function setup({ licensed = false, count = 0, month = '2026-08' } = {}) {
  let stored = { month, count };
  const writeUsage = vi.fn((next) => { stored = next; });
  const controller = createAutoScrollAccessController({
    getLicenseStatus: vi.fn(async () => ({ valid: licensed })),
    readUsage: () => stored,
    writeUsage,
    now: () => new Date('2026-08-04T12:00:00'),
  });
  return { controller, writeUsage, getStored: () => stored };
}

describe('createAutoScrollAccessController', () => {
  it('allows 500 successful free Auto Scroll sessions and blocks the next one', async () => {
    const { controller, getStored } = setup({ count: AUTO_SCROLL_MONTHLY_LIMIT - 1 });
    controller.beginSession();

    const prepared = await controller.prepareStart();
    expect(prepared.allowed).toBe(true);
    expect(controller.commitSuccessfulStart(prepared).allowed).toBe(true);
    expect(getStored().count).toBe(AUTO_SCROLL_MONTHLY_LIMIT);

    controller.beginSession();
    await expect(controller.prepareStart()).resolves.toMatchObject({
      allowed: false,
      reason: 'monthly-limit',
    });
  });

  it('counts only the first successful Auto Scroll activation in a reading session', async () => {
    const { controller, writeUsage, getStored } = setup({ count: 12 });
    controller.beginSession();

    const first = await controller.prepareStart();
    controller.commitSuccessfulStart(first);
    const resume = await controller.prepareStart();
    controller.commitSuccessfulStart(resume);

    expect(getStored().count).toBe(13);
    expect(writeUsage).toHaveBeenCalledOnce();
  });

  it('does not consume a free use when Auto Scroll fails to start', async () => {
    const { controller, writeUsage, getStored } = setup({ count: 42 });
    controller.beginSession();

    await controller.prepareStart();

    expect(getStored().count).toBe(42);
    expect(writeUsage).not.toHaveBeenCalled();
  });

  it('never increments monthly usage for a valid license', async () => {
    const { controller, writeUsage } = setup({ licensed: true, count: 500 });
    controller.beginSession();

    const prepared = await controller.prepareStart();
    expect(prepared).toMatchObject({ allowed: true, licensed: true });
    expect(controller.commitSuccessfulStart(prepared).allowed).toBe(true);
    expect(writeUsage).not.toHaveBeenCalled();
  });

  it('resets the free counter when the local calendar month changes', async () => {
    const { controller, getStored } = setup({ count: 500, month: '2026-07' });
    controller.beginSession();

    const prepared = await controller.prepareStart();
    controller.commitSuccessfulStart(prepared);

    expect(getStored()).toEqual({ month: '2026-08', count: 1 });
  });
});
