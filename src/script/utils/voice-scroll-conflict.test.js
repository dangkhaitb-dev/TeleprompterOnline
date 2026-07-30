import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceScrollConflictChannel } from './voice-scroll-conflict.js';

class FakeBroadcastChannel {
  static channels = new Map();

  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    const peers = FakeBroadcastChannel.channels.get(name) || new Set();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }

  addEventListener(type, listener) {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'message') this.listeners.delete(listener);
  }

  postMessage(data) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) || []) {
      if (peer === this) continue;
      for (const listener of peer.listeners) listener({ data });
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

describe('voice-scroll conflict channel', () => {
  beforeEach(() => {
    FakeBroadcastChannel.channels.clear();
  });

  it('notifies every other open tab without echoing to the sender', () => {
    const tabA = createVoiceScrollConflictChannel({
      BroadcastChannelImpl: FakeBroadcastChannel,
    });
    const tabB = createVoiceScrollConflictChannel({
      BroadcastChannelImpl: FakeBroadcastChannel,
    });
    const tabC = createVoiceScrollConflictChannel({
      BroadcastChannelImpl: FakeBroadcastChannel,
    });
    const onA = vi.fn();
    const onB = vi.fn();
    const onC = vi.fn();
    tabA.subscribe(onA);
    tabB.subscribe(onB);
    tabC.subscribe(onC);

    tabA.publish();

    expect(onA).not.toHaveBeenCalled();
    expect(onB).toHaveBeenCalledOnce();
    expect(onC).toHaveBeenCalledOnce();

    tabA.close();
    tabB.close();
    tabC.close();
  });
});
