import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_PORT_NAME,
  handleAiPortConnection,
  mapProviderError,
  AiStreamClient,
  type AiPortHandlerDeps,
  type PortLike,
  type ServerPortMessage,
} from '../src/lib/ai-port';
import {
  ProviderAbortError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderProtocolError,
  ProviderResponseTooLargeError,
  ProviderTimeoutError,
} from '../src/lib/provider-network';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';

class MockPort implements PortLike {
  name: string;
  messagesSent: ServerPortMessage[] = [];
  messageListeners: ((msg: unknown, port: PortLike) => void)[] = [];
  disconnectListeners: ((port: PortLike) => void)[] = [];
  isDisconnected = false;

  constructor(name = AI_PORT_NAME) {
    this.name = name;
  }

  postMessage(msg: unknown) {
    if (this.isDisconnected) {
      throw new Error('Attempt to postMessage on disconnected port');
    }
    this.messagesSent.push(msg as ServerPortMessage);
  }

  disconnect() {
    if (!this.isDisconnected) {
      this.isDisconnected = true;
      for (const cb of [...this.disconnectListeners]) {
        cb(this);
      }
    }
  }

  onMessage = {
    addListener: (cb: (msg: unknown, port: PortLike) => void) => {
      this.messageListeners.push(cb);
    },
    removeListener: (cb: (msg: unknown, port: PortLike) => void) => {
      const idx = this.messageListeners.indexOf(cb);
      if (idx >= 0) this.messageListeners.splice(idx, 1);
    },
  };

  onDisconnect = {
    addListener: (cb: (port: PortLike) => void) => {
      this.disconnectListeners.push(cb);
    },
    removeListener: (cb: (port: PortLike) => void) => {
      const idx = this.disconnectListeners.indexOf(cb);
      if (idx >= 0) this.disconnectListeners.splice(idx, 1);
    },
  };

  simulateMessage(msg: unknown) {
    for (const cb of [...this.messageListeners]) {
      cb(msg, this);
    }
  }
}

const defaultSettings: Settings = {
  ...DEFAULT_SETTINGS,
  aiEnabled: true,
  provider: 'openai',
};

const fakeApiKey = 'TEST_ANTHROPIC_KEY_DO_NOT_LOG';

function makeDeps(overrides?: Partial<AiPortHandlerDeps>): AiPortHandlerDeps {
  return {
    getSettings: async () => defaultSettings,
    getApiKey: async () => fakeApiKey,
    streamFn: async (_settings, _key, _payload, _signal, onChunk) => {
      onChunk('chunk 1');
      onChunk('chunk 2');
    },
    ...overrides,
  };
}

// ============================================================================
// A. Connection (1-5)
// ============================================================================

test('1. Port connect: handleAiPortConnection 挂载 onMessage 和 onDisconnect 监听器', () => {
  const port = new MockPort();
  handleAiPortConnection(port, makeDeps());
  assert.equal(port.messageListeners.length, 1);
  assert.equal(port.disconnectListeners.length, 1);
});

test('2. AI_START creates request state: 发送 AI_START 激活请求状态并开始处理', async () => {
  const port = new MockPort();
  handleAiPortConnection(port, makeDeps());

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_2',
    payload: { word: 'test', sentence: 'This is a test.' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(port.messagesSent.length >= 2);
  assert.equal(port.messagesSent[0]?.type, 'AI_CHUNK');
});

test('3. AI_START creates AbortController: 传递有效未中止的 signal 给底层 streamFn', async () => {
  let receivedSignal: AbortSignal | undefined;
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, signal, onChunk) => {
        receivedSignal = signal;
        onChunk('chunk');
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_3',
    payload: { word: 'apple', sentence: 'An apple.' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(receivedSignal);
  assert.equal(receivedSignal?.aborted, false);
});

test('4. disconnect cleans state: port.disconnect 清除状态，后续消息被完全忽略', async () => {
  const port = new MockPort();
  handleAiPortConnection(port, makeDeps());

  port.disconnect();
  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_4',
    payload: { word: 'test', sentence: 'test' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(port.messagesSent.length, 0);
});

test('5. disconnect aborts active request: 断开连接时主动触发进行中请求的 abort', async () => {
  let signalAborted = false;
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, signal) => {
        signal?.addEventListener('abort', () => {
          signalAborted = true;
        });
        await new Promise((r) => setTimeout(r, 50));
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_5',
    payload: { word: 'rock', sentence: 'Solid rock.' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.disconnect();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(signalAborted, true);
});

// ============================================================================
// B. Streaming (6-9)
// ============================================================================

test('6. provider chunk → AI_CHUNK: provider 产出的增量准确封装为 AI_CHUNK 转发', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, _sig, onChunk) => {
        onChunk('delta_6');
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_6',
    payload: { word: 'hello', sentence: 'hello world' },
  });

  await new Promise((r) => setTimeout(r, 10));
  const chunkMsg = port.messagesSent.find((m) => m.type === 'AI_CHUNK');
  assert.deepEqual(chunkMsg, {
    type: 'AI_CHUNK',
    requestId: 'req_6',
    text: 'delta_6',
  });
});

test('7. multiple chunks preserve order: 多个 chunk 发送时严格保持时序一致', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, _sig, onChunk) => {
        onChunk('chunk_A');
        onChunk('chunk_B');
        onChunk('chunk_C');
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_7',
    payload: { word: 'order', sentence: 'in order' },
  });

  await new Promise((r) => setTimeout(r, 10));
  const chunks = port.messagesSent.filter((m) => m.type === 'AI_CHUNK').map((m) => (m as any).text);
  assert.deepEqual(chunks, ['chunk_A', 'chunk_B', 'chunk_C']);
});

test('8. stream completion → AI_DONE: 流正常结束时准确发出 AI_DONE 消息', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, _sig, onChunk) => {
        onChunk('final_chunk');
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_8',
    payload: { word: 'fin', sentence: 'the end' },
  });

  await new Promise((r) => setTimeout(r, 10));
  const lastMsg = port.messagesSent[port.messagesSent.length - 1];
  assert.deepEqual(lastMsg, {
    type: 'AI_DONE',
    requestId: 'req_8',
  });
});

test('9. provider error → AI_ERROR: 底层网络异常安全映射为 AI_ERROR', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async () => {
        throw new ProviderHttpError(500, 'Internal Server Error');
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_9',
    payload: { word: 'err', sentence: 'error test' },
  });

  await new Promise((r) => setTimeout(r, 10));
  const errMsg = port.messagesSent.find((m) => m.type === 'AI_ERROR');
  assert.ok(errMsg);
  assert.equal(errMsg?.requestId, 'req_9');
  assert.equal((errMsg as any).code, 'HTTP_ERROR');
});

// ============================================================================
// C. requestId (10-14)
// ============================================================================

test('10. correct requestId forwarded: 所有流式消息必须严格携带原始 requestId', async () => {
  const port = new MockPort();
  handleAiPortConnection(port, makeDeps());

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_10_match',
    payload: { word: 'test', sentence: 'test' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(port.messagesSent.length > 0);
  for (const msg of port.messagesSent) {
    assert.equal(msg.requestId, 'req_10_match');
  }
});

test('11. wrong requestId dropped: 缺少或非法格式的 requestId 消息被安全忽略或报错', async () => {
  const port = new MockPort();
  handleAiPortConnection(port, makeDeps());

  port.simulateMessage({
    type: 'AI_START',
    requestId: '',
    payload: { word: 'test', sentence: 'test' },
  });

  port.simulateMessage({
    type: 'AI_ABORT',
    requestId: '',
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(port.messagesSent.length, 0);
});

test('12. stale chunk dropped: 旧请求产生的迟到 chunk 严禁投递至当前活跃 Port', async () => {
  const hooks = { triggerLateChunk: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload, _sig, onChunk) => {
        if (payload.word === 'A') {
          hooks.triggerLateChunk = () => onChunk('late_chunk_A');
        } else {
          onChunk('chunk_B');
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'sent A' },
  });

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.triggerLateChunk?.();
  await new Promise((r) => setTimeout(r, 10));

  const hasLateA = port.messagesSent.some(
    (m) => m.requestId === 'req_A' && (m as any).text === 'late_chunk_A',
  );
  assert.equal(hasLateA, false);
});

test('13. stale done dropped: 旧请求的迟到完成通知严禁发送', async () => {
  const hooks = { finishA: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload) => {
        if (payload.word === 'A') {
          await new Promise((resolve) => {
            hooks.finishA = () => resolve(undefined);
          });
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'sent A' },
  });

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.finishA?.();
  await new Promise((r) => setTimeout(r, 10));

  const hasDoneA = port.messagesSent.some(
    (m) => m.requestId === 'req_A' && m.type === 'AI_DONE',
  );
  assert.equal(hasDoneA, false);
});

test('14. stale error dropped: 旧请求的迟到异常严禁污染新请求', async () => {
  const hooks = { rejectA: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload) => {
        if (payload.word === 'A') {
          await new Promise((_, reject) => {
            hooks.rejectA = () => reject(new ProviderNetworkError('late network error'));
          });
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'sent A' },
  });

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.rejectA?.();
  await new Promise((r) => setTimeout(r, 10));

  const hasErrorA = port.messagesSent.some(
    (m) => m.requestId === 'req_A' && m.type === 'AI_ERROR',
  );
  assert.equal(hasErrorA, false);
});

// ============================================================================
// D. Same-Port replacement (15-20)
// ============================================================================

test('15. Same-Port: A starts - 初始请求 A 成功建立并投递首包', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, _sig, onChunk) => {
        onChunk('chunk_A');
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_15_A',
    payload: { word: 'wordA', sentence: 'sent A' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(port.messagesSent.some((m) => m.requestId === 'req_15_A' && (m as any).text === 'chunk_A'));
});

test('16. Same-Port: B starts on same Port - 同一 Port 接收到请求 B', async () => {
  const port = new MockPort();
  handleAiPortConnection(port, makeDeps());

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_16_A',
    payload: { word: 'A', sentence: 'sent A' },
  });
  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_16_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(port.messagesSent.some((m) => m.requestId === 'req_16_B'));
});

test('17. Same-Port: A is aborted - 收到 B 时自动 abort 正在进行的 A', async () => {
  let signalAAborted = false;
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload, signal) => {
        if (payload.word === 'wordA') {
          signal?.addEventListener('abort', () => {
            signalAAborted = true;
          });
          await new Promise((r) => setTimeout(r, 50));
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_17_A',
    payload: { word: 'wordA', sentence: 'sent A' },
  });
  await new Promise((r) => setTimeout(r, 5));

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_17_B',
    payload: { word: 'wordB', sentence: 'sent B' },
  });
  await new Promise((r) => setTimeout(r, 5));

  assert.equal(signalAAborted, true);
});

test('18. Same-Port: A becomes stale - A 被标记 stale，其后续任何输出均被拦截', async () => {
  const hooks = { emitLateA: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload, _sig, onChunk) => {
        if (payload.word === 'wordA') {
          hooks.emitLateA = () => onChunk('stale_chunk_18');
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_18_A',
    payload: { word: 'wordA', sentence: 'sent A' },
  });
  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_18_B',
    payload: { word: 'wordB', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.emitLateA?.();
  await new Promise((r) => setTimeout(r, 10));

  const hasStale = port.messagesSent.some((m) => (m as any).text === 'stale_chunk_18');
  assert.equal(hasStale, false);
});

test('19. Same-Port: B becomes active - B 成为此 Port 的唯一定义活跃请求', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload, _sig, onChunk) => {
        onChunk(`data_${payload.word}`);
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_19_A',
    payload: { word: 'A', sentence: 'sent A' },
  });
  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_19_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 10));
  const lastMsg = port.messagesSent[port.messagesSent.length - 1];
  assert.equal(lastMsg?.requestId, 'req_19_B');
  assert.equal(lastMsg?.type, 'AI_DONE');
});

test('20. Same-Port: B stream continues - B 请求顺利完整收尾不受干扰', async () => {
  const hooks = { finishB: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload, _sig, onChunk) => {
        if (payload.word === 'B') {
          onChunk('chunk_B1');
          await new Promise((resolve) => {
            hooks.finishB = () => {
              onChunk('chunk_B2');
              resolve(undefined);
            };
          });
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_20_A',
    payload: { word: 'A', sentence: 'sent A' },
  });
  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_20_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.finishB?.();
  await new Promise((r) => setTimeout(r, 10));

  const msgsB = port.messagesSent.filter((m) => m.requestId === 'req_20_B');
  assert.equal(msgsB.length, 3); // B1, B2, DONE
  assert.equal(msgsB[2]?.type, 'AI_DONE');
});

// ============================================================================
// E. Cross-Port isolation (21-26)
// ============================================================================

test('21. Cross-Port: A chunk only reaches A - Port A 的 chunk 绝不送达 Port B', async () => {
  const portA = new MockPort();
  const portB = new MockPort();
  const deps = makeDeps({
    streamFn: async (_s, _k, payload, _sig, onChunk) => {
      onChunk(`chunk_${payload.word}`);
    },
  });
  handleAiPortConnection(portA, deps);
  handleAiPortConnection(portB, deps);

  portA.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'sent A' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(portA.messagesSent.some((m) => (m as any).text === 'chunk_A'));
  assert.equal(portB.messagesSent.length, 0);
});

test('22. Cross-Port: B chunk only reaches B - Port B 的 chunk 绝不送达 Port A', async () => {
  const portA = new MockPort();
  const portB = new MockPort();
  const deps = makeDeps({
    streamFn: async (_s, _k, payload, _sig, onChunk) => {
      onChunk(`chunk_${payload.word}`);
    },
  });
  handleAiPortConnection(portA, deps);
  handleAiPortConnection(portB, deps);

  portB.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(portB.messagesSent.some((m) => (m as any).text === 'chunk_B'));
  assert.equal(portA.messagesSent.length, 0);
});

test('23. Cross-Port: A abort does not cancel B - Port A 中止绝不影响 Port B', async () => {
  let signalBAborted = false;
  const hooks = { finishB: undefined as (() => void) | undefined };
  const portA = new MockPort();
  const portB = new MockPort();

  const deps = makeDeps({
    streamFn: async (_s, _k, payload, signal, onChunk) => {
      if (payload.word === 'B') {
        signal?.addEventListener('abort', () => {
          signalBAborted = true;
        });
        await new Promise((resolve) => {
          hooks.finishB = () => {
            onChunk('chunk_B_done');
            resolve(undefined);
          };
        });
      } else {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  });

  handleAiPortConnection(portA, deps);
  handleAiPortConnection(portB, deps);

  portA.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'sent A' },
  });
  portB.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  portA.simulateMessage({ type: 'AI_ABORT', requestId: 'req_A' });
  await new Promise((r) => setTimeout(r, 5));

  assert.equal(signalBAborted, false);
  hooks.finishB?.();
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(portB.messagesSent.some((m) => m.type === 'AI_DONE'));
});

test('24. Cross-Port: B abort does not cancel A - Port B 中止绝不影响 Port A', async () => {
  let signalAAborted = false;
  const hooks = { finishA: undefined as (() => void) | undefined };
  const portA = new MockPort();
  const portB = new MockPort();

  const deps = makeDeps({
    streamFn: async (_s, _k, payload, signal, onChunk) => {
      if (payload.word === 'A') {
        signal?.addEventListener('abort', () => {
          signalAAborted = true;
        });
        await new Promise((resolve) => {
          hooks.finishA = () => {
            onChunk('chunk_A_done');
            resolve(undefined);
          };
        });
      } else {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  });

  handleAiPortConnection(portA, deps);
  handleAiPortConnection(portB, deps);

  portA.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'sent A' },
  });
  portB.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  portB.simulateMessage({ type: 'AI_ABORT', requestId: 'req_B' });
  await new Promise((r) => setTimeout(r, 5));

  assert.equal(signalAAborted, false);
  hooks.finishA?.();
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(portA.messagesSent.some((m) => m.type === 'AI_DONE'));
});

test('25. Cross-Port: A replacement does not affect B - Port A 发生重置不影响 Port B', async () => {
  const portA = new MockPort();
  const portB = new MockPort();
  const hooks = { finishB: undefined as (() => void) | undefined };

  const deps = makeDeps({
    streamFn: async (_s, _k, payload, _sig, onChunk) => {
      if (payload.word === 'B') {
        await new Promise((resolve) => {
          hooks.finishB = () => {
            onChunk('chunk_B_success');
            resolve(undefined);
          };
        });
      } else {
        onChunk(`chunk_${payload.word}`);
      }
    },
  });

  handleAiPortConnection(portA, deps);
  handleAiPortConnection(portB, deps);

  portA.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A1',
    payload: { word: 'A1', sentence: 'sent A1' },
  });
  portB.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  portA.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A2',
    payload: { word: 'A2', sentence: 'sent A2' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.finishB?.();
  await new Promise((r) => setTimeout(r, 10));

  const doneB = portB.messagesSent.find((m) => m.type === 'AI_DONE');
  assert.ok(doneB);
  assert.equal(doneB?.requestId, 'req_B');
});

test('26. Cross-Port: A disconnect does not affect B - Port A 断开不影响 Port B 持续流式', async () => {
  const portA = new MockPort();
  const portB = new MockPort();
  const hooks = { finishB: undefined as (() => void) | undefined };

  const deps = makeDeps({
    streamFn: async (_s, _k, payload, _sig, onChunk) => {
      if (payload.word === 'B') {
        await new Promise((resolve) => {
          hooks.finishB = () => {
            onChunk('chunk_B_continue');
            resolve(undefined);
          };
        });
      }
    },
  });

  handleAiPortConnection(portA, deps);
  handleAiPortConnection(portB, deps);

  portA.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'sent A' },
  });
  portB.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'sent B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  portA.disconnect();
  await new Promise((r) => setTimeout(r, 5));

  hooks.finishB?.();
  await new Promise((r) => setTimeout(r, 10));

  const doneB = portB.messagesSent.find((m) => m.type === 'AI_DONE');
  assert.ok(doneB);
  assert.equal(doneB?.requestId, 'req_B');
});

// ============================================================================
// F. Abort (27-31)
// ============================================================================

test('27. Abort: AI_ABORT reaches controller - AI_ABORT 消息触发内部控制器 abort', async () => {
  let aborted = false;
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, signal) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
        });
        await new Promise((r) => setTimeout(r, 40));
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_27',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.simulateMessage({ type: 'AI_ABORT', requestId: 'req_27' });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(aborted, true);
});

test('28. Abort: provider receives aborted signal - streamFn 接收到的 signal.aborted 为 true', async () => {
  let observedAborted = false;
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, signal) => {
        await new Promise((r) => setTimeout(r, 20));
        observedAborted = !!signal?.aborted;
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_28',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.simulateMessage({ type: 'AI_ABORT', requestId: 'req_28' });
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(observedAborted, true);
});

test('29. Abort: no post-abort AI_CHUNK - 中断后不再向下游发送任何 AI_CHUNK', async () => {
  const hooks = { emitChunk: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, _sig, onChunk) => {
        hooks.emitChunk = () => onChunk('post_abort_chunk');
        await new Promise((r) => setTimeout(r, 40));
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_29',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.simulateMessage({ type: 'AI_ABORT', requestId: 'req_29' });
  await new Promise((r) => setTimeout(r, 5));

  hooks.emitChunk?.();
  await new Promise((r) => setTimeout(r, 10));

  const hasChunk = port.messagesSent.some((m) => (m as any).text === 'post_abort_chunk');
  assert.equal(hasChunk, false);
});

test('30. Abort: no stale AI_DONE - 中断后严禁发送 AI_DONE', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async () => {
        await new Promise((r) => setTimeout(r, 20));
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_30',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.simulateMessage({ type: 'AI_ABORT', requestId: 'req_30' });
  await new Promise((r) => setTimeout(r, 25));

  const hasDone = port.messagesSent.some((m) => m.type === 'AI_DONE');
  assert.equal(hasDone, false);
});

test('31. Abort: cleanup happens - 主动中断正常完成清理且不发送错误通知', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, signal) => {
        await new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new ProviderAbortError('aborted')));
        });
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_31',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.simulateMessage({ type: 'AI_ABORT', requestId: 'req_31' });
  await new Promise((r) => setTimeout(r, 15));

  const hasError = port.messagesSent.some((m) => m.type === 'AI_ERROR');
  assert.equal(hasError, false);
});

// ============================================================================
// G. API Key isolation (32-38)
// ============================================================================

test('32. API Key isolation: Port messages contain no API Key', async () => {
  const port = new MockPort();
  handleAiPortConnection(port, makeDeps());

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_32',
    payload: { word: 'secret', sentence: 'test' },
  });

  await new Promise((r) => setTimeout(r, 10));
  const serialized = JSON.stringify(port.messagesSent);
  assert.equal(serialized.includes(fakeApiKey), false);
});

test('33. API Key isolation: AI_START contains no API Key', () => {
  const startMsg = {
    type: 'AI_START',
    requestId: 'req_33',
    payload: { word: 'word', sentence: 'sentence' },
  };
  assert.equal('key' in startMsg, false);
  assert.equal('apiKey' in startMsg, false);
  assert.equal('apiKey' in startMsg.payload, false);
});

test('34. API Key isolation: AI_CHUNK contains no API Key', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, _sig, onChunk) => {
        onChunk('pure text chunk');
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_34',
    payload: { word: 'word', sentence: 'sentence' },
  });

  await new Promise((r) => setTimeout(r, 10));
  const chunk = port.messagesSent.find((m) => m.type === 'AI_CHUNK') as any;
  assert.ok(chunk);
  assert.equal(chunk.text.includes(fakeApiKey), false);
});

test('35. API Key isolation: AI_ERROR contains no API Key', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async () => {
        throw new ProviderHttpError(401, `Failed key: ${fakeApiKey}`);
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_35',
    payload: { word: 'word', sentence: 'sentence' },
  });

  await new Promise((r) => setTimeout(r, 10));
  const errorMsg = port.messagesSent.find((m) => m.type === 'AI_ERROR') as any;
  assert.ok(errorMsg);
  assert.equal(errorMsg.message.includes(fakeApiKey), false);
});

test('36. API Key isolation: provider invocation receives Key only internally in Background', async () => {
  let internalKey = '';
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, key, _p, _sig, onChunk) => {
        internalKey = key;
        onChunk('ok');
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_36',
    payload: { word: 'word', sentence: 'sentence' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(internalKey, fakeApiKey);
});

test('37. API Key isolation: logs contain no Key', () => {
  const mapped = mapProviderError(new Error(`Failed with key ${fakeApiKey}`), fakeApiKey);
  assert.equal(mapped.message.includes(fakeApiKey), false);
});

test('38. API Key isolation: errors contain no Key', () => {
  const mapped = mapProviderError(new ProviderHttpError(401, `Forbidden: ${fakeApiKey}`), fakeApiKey);
  assert.equal(mapped.message.includes(fakeApiKey), false);
});

// ============================================================================
// H. Disconnect / lifecycle (39-43)
// ============================================================================

test('39. Disconnect during stream: 流式传输中途断开时主动 abort', async () => {
  let aborted = false;
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, signal) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
        });
        await new Promise((r) => setTimeout(r, 50));
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_39',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.disconnect();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(aborted, true);
});

test('40. Disconnect after completion: 完成后的断开正常释放无异常', async () => {
  const port = new MockPort();
  handleAiPortConnection(port, makeDeps());

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_40',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.doesNotThrow(() => {
    port.disconnect();
  });
});

test('41. Disconnect after abort: 主动 abort 后再断开正常无异常', async () => {
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async () => {
        await new Promise((r) => setTimeout(r, 40));
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_41',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.simulateMessage({ type: 'AI_ABORT', requestId: 'req_41' });
  await new Promise((r) => setTimeout(r, 5));

  assert.doesNotThrow(() => {
    port.disconnect();
  });
});

test('42. Late provider chunk after disconnect is ignored', async () => {
  const hooks = { lateChunk: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, _p, _sig, onChunk) => {
        hooks.lateChunk = () => onChunk('late_chunk_42');
        await new Promise((r) => setTimeout(r, 40));
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_42',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.disconnect();
  await new Promise((r) => setTimeout(r, 5));

  assert.doesNotThrow(() => {
    hooks.lateChunk?.();
  });
  const hasLate = port.messagesSent.some((m) => (m as any).text === 'late_chunk_42');
  assert.equal(hasLate, false);
});

test('43. Late provider completion after disconnect is ignored', async () => {
  const hooks = { finish: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async () => {
        await new Promise((resolve) => {
          hooks.finish = () => resolve(undefined);
        });
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_43',
    payload: { word: 'w', sentence: 's' },
  });

  await new Promise((r) => setTimeout(r, 5));
  port.disconnect();
  await new Promise((r) => setTimeout(r, 5));

  assert.doesNotThrow(() => {
    hooks.finish?.();
  });
  const hasDone = port.messagesSent.some((m) => m.type === 'AI_DONE');
  assert.equal(hasDone, false);
});

// ============================================================================
// I. Race Conditions (44-47)
// ============================================================================

test('44. Race: A chunk → B start → A late chunk', async () => {
  const hooks = { emitLateA: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload, _sig, onChunk) => {
        if (payload.word === 'wordA') {
          onChunk('chunk_A1');
          hooks.emitLateA = () => onChunk('chunk_A2_late');
        } else {
          onChunk('chunk_B1');
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'wordA', sentence: 'sentence A' },
  });
  await new Promise((r) => setTimeout(r, 5));

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'wordB', sentence: 'sentence B' },
  });
  await new Promise((r) => setTimeout(r, 5));

  hooks.emitLateA?.();
  await new Promise((r) => setTimeout(r, 10));

  const texts = port.messagesSent.filter((m) => m.type === 'AI_CHUNK').map((m) => (m as any).text);
  assert.deepEqual(texts, ['chunk_A1', 'chunk_B1']);
});

test('45. Race: A start → B start → A done', async () => {
  const hooks = { finishA: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload) => {
        if (payload.word === 'A') {
          await new Promise((resolve) => {
            hooks.finishA = () => resolve(undefined);
          });
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'A' },
  });
  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.finishA?.();
  await new Promise((r) => setTimeout(r, 10));

  const doneA = port.messagesSent.find((m) => m.requestId === 'req_A' && m.type === 'AI_DONE');
  assert.equal(doneA, undefined);
});

test('46. Race: A start → B start → A error', async () => {
  const hooks = { errorA: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload) => {
        if (payload.word === 'A') {
          await new Promise((_, reject) => {
            hooks.errorA = () => reject(new ProviderHttpError(500, 'A late error'));
          });
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'A' },
  });
  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.errorA?.();
  await new Promise((r) => setTimeout(r, 10));

  const errorMsgA = port.messagesSent.find((m) => m.requestId === 'req_A' && m.type === 'AI_ERROR');
  assert.equal(errorMsgA, undefined);
});

test('47. Race: B completes while A stale callbacks arrive', async () => {
  const hooks = { lateCallbackA: undefined as (() => void) | undefined };
  const port = new MockPort();
  handleAiPortConnection(
    port,
    makeDeps({
      streamFn: async (_s, _k, payload, _sig, onChunk) => {
        if (payload.word === 'A') {
          hooks.lateCallbackA = () => onChunk('stale_A');
        } else {
          onChunk('chunk_B');
        }
      },
    }),
  );

  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_A',
    payload: { word: 'A', sentence: 'A' },
  });
  port.simulateMessage({
    type: 'AI_START',
    requestId: 'req_B',
    payload: { word: 'B', sentence: 'B' },
  });

  await new Promise((r) => setTimeout(r, 5));
  hooks.lateCallbackA?.();
  await new Promise((r) => setTimeout(r, 10));

  const doneB = port.messagesSent.find((m) => m.requestId === 'req_B' && m.type === 'AI_DONE');
  assert.ok(doneB);
});

// ============================================================================
// J. Failure Mapping (48-52)
// ============================================================================

test('48. Failure: ProviderHttpError maps to HTTP_ERROR', () => {
  const mapped = mapProviderError(new ProviderHttpError(403, 'Forbidden'));
  assert.equal(mapped.code, 'HTTP_ERROR');
});

test('49. Failure: ProviderNetworkError maps to NETWORK_ERROR', () => {
  const mapped = mapProviderError(new ProviderNetworkError('DNS failure'));
  assert.equal(mapped.code, 'NETWORK_ERROR');
});

test('50. Failure: ProviderTimeoutError maps to TIMEOUT', () => {
  const mapped = mapProviderError(new ProviderTimeoutError('Timed out'));
  assert.equal(mapped.code, 'TIMEOUT');
});

test('51. Failure: ProviderProtocolError maps to PROTOCOL_ERROR', () => {
  const mapped = mapProviderError(new ProviderProtocolError('Invalid event'));
  assert.equal(mapped.code, 'PROTOCOL_ERROR');
});

test('52. Failure: ProviderResponseTooLargeError maps to RESPONSE_TOO_LARGE', () => {
  const mapped = mapProviderError(new ProviderResponseTooLargeError('Stream exceeded 2MB'));
  assert.equal(mapped.code, 'RESPONSE_TOO_LARGE');
});

// ============================================================================
// Client Harness Tests
// ============================================================================

test('Client: AiStreamClient 管理连接与状态，正确派发 chunk 与 done', async () => {
  const mockPort = new MockPort();
  const client = new AiStreamClient(() => mockPort);

  const chunksReceived: string[] = [];
  let doneReceived = false;

  client.start(
    { word: 'client', sentence: 'test client' },
    {
      onChunk: (t) => chunksReceived.push(t),
      onDone: () => {
        doneReceived = true;
      },
      onError: () => {},
    },
  );

  const activeId = client.getActiveRequestId();
  assert.ok(activeId);

  mockPort.simulateMessage({ type: 'AI_CHUNK', requestId: activeId, text: 'c1' });
  mockPort.simulateMessage({ type: 'AI_CHUNK', requestId: activeId, text: 'c2' });
  mockPort.simulateMessage({ type: 'AI_DONE', requestId: activeId });

  assert.deepEqual(chunksReceived, ['c1', 'c2']);
  assert.equal(doneReceived, true);
  assert.equal(client.getActiveRequestId(), null);
});

test('Client: AiStreamClient 丢弃过期或未知的 requestId 消息', async () => {
  const mockPort = new MockPort();
  const client = new AiStreamClient(() => mockPort);

  const chunks: string[] = [];
  client.start(
    { word: 'word', sentence: 'sentence' },
    {
      onChunk: (t) => chunks.push(t),
      onDone: () => {},
      onError: () => {},
    },
  );

  mockPort.simulateMessage({ type: 'AI_CHUNK', requestId: 'wrong_id', text: 'ignored' });
  assert.equal(chunks.length, 0);
});
