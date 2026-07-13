'use strict';

import type { NativeHostRequest, NativeHostResponse } from './iso/messaging/nativeProtocol';
import type {
  ApplyEditBatchReceiptV1,
  ApplyEditBatchRequestV1,
  EditTransactionV1,
  TransactionRuntimeContext,
  TransactionRuntimeRequestV1,
  TransactionRuntimeResponseV1,
} from './transactions/contracts';
import { IndexedDbTransactionRepository } from './transactions/indexedDbRepository';
import { createTransactionRuntimeHandler } from './transactions/runtime';
import { TransactionService } from './transactions/transactionService';

const NATIVE_HOST_NAME = 'com.ageaf.host';
let nativePort: chrome.runtime.Port | null = null;
const pending = new Map<string, (response: NativeHostResponse) => void>();
const streamPorts = new Map<string, chrome.runtime.Port>();

const transactionRepository = new IndexedDbTransactionRepository();
const transactionService = new TransactionService({ repository: transactionRepository });

async function sendToActiveOverleafTab<T>(message: unknown): Promise<T> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: 'https://www.overleaf.com/project/*',
  });
  const tabId = tabs[0]?.id;
  if (!tabId) throw new Error('EDITOR_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

const OVERLEAF_PROJECT_URL =
  /^https:\/\/www\.overleaf\.com\/project\/([^/?#]+)/;

function projectIdFromTabUrl(url?: string): string | null {
  const match = url?.match(OVERLEAF_PROJECT_URL);
  return match?.[1] ?? null;
}

function isExtensionHarnessUrl(url?: string): boolean {
  return Boolean(url?.startsWith(chrome.runtime.getURL('browser-test-harness.html')));
}

function rejectedRuntimeResponse(
  requestId: string,
  code: 'WRONG_PROJECT' | 'INVALID_REQUEST',
  message: string
): TransactionRuntimeResponseV1 {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    channel: 'iris:transaction-runtime',
    requestId,
    ok: false,
    error: { code, message },
  };
}

const handleTransactionRequest = createTransactionRuntimeHandler({
  service: transactionService,
  dispatchApply: (request: ApplyEditBatchRequestV1) =>
    sendToActiveOverleafTab<ApplyEditBatchReceiptV1>({
      type: 'iris:transaction:apply-batch',
      request,
    }),
  readFileSha256: async (transaction: EditTransactionV1) => {
    const response = await sendToActiveOverleafTab<{ sha256?: string }>({
      type: 'iris:transaction:read-sha256',
      transaction,
    });
    if (!response?.sha256) throw new Error('EDITOR_UNAVAILABLE');
    return response.sha256;
  },
});

function ensureNativePort(): chrome.runtime.Port | null {
  if (nativePort) return nativePort;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch {
    nativePort = null;
    return null;
  }

  nativePort.onMessage.addListener((message: NativeHostResponse) => {
    const handler = pending.get(message.id);
    if (handler) {
      pending.delete(message.id);
      handler(message);
      return;
    }
    const streamPort = streamPorts.get(message.id);
    if (streamPort) {
      try {
        streamPort.postMessage(message);
      } catch {
        streamPorts.delete(message.id);
      }
      if (message.kind === 'end' || message.kind === 'error') {
        streamPorts.delete(message.id);
      }
    }
  });
  nativePort.onDisconnect.addListener(() => {
    const errorMessage = chrome.runtime.lastError?.message || 'Native host disconnected';

    // Drain all pending requests with error
    for (const [id, handler] of pending.entries()) {
      handler({ id, kind: 'error', message: errorMessage });
    }
    pending.clear();

    // Drain all streaming ports with error
    for (const [id, port] of streamPorts.entries()) {
      try {
        port.postMessage({ id, kind: 'error', message: errorMessage });
      } catch {
        // Port may already be disconnected, ignore
      }
    }
    streamPorts.clear();

    nativePort = null;
  });
  return nativePort;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'iris:transaction-runtime-test') {
    if (!isExtensionHarnessUrl(sender.url)) {
      sendResponse(
        rejectedRuntimeResponse(
          typeof message.request?.requestId === 'string'
            ? message.request.requestId
            : 'rejected',
          'INVALID_REQUEST',
          'Unsupported runtime source'
        )
      );
      return true;
    }
    const context: TransactionRuntimeContext = {
      boundProjectId: null,
      source: 'test-harness',
    };
    void handleTransactionRequest(
      message.request as TransactionRuntimeRequestV1,
      context
    ).then(sendResponse);
    return true;
  }
  if (message?.type === 'iris:transaction-runtime') {
    const boundProjectId = projectIdFromTabUrl(sender.tab?.url);
    if (!boundProjectId) {
      sendResponse(
        rejectedRuntimeResponse(
          typeof message.request?.requestId === 'string'
            ? message.request.requestId
            : 'rejected',
          'WRONG_PROJECT',
          'Active tab is not an Overleaf project'
        )
      );
      return true;
    }
    const context: TransactionRuntimeContext = {
      boundProjectId,
      source: 'content-script',
    };
    void handleTransactionRequest(
      message.request as TransactionRuntimeRequestV1,
      context
    ).then(sendResponse);
    return true;
  }
  if (message?.type === 'ageaf:native-request') {
    const request = message.request as NativeHostRequest;
    const port = ensureNativePort();
    if (!port) {
      sendResponse({ id: request.id, kind: 'error', message: 'native_unavailable' });
      return undefined;
    }
    pending.set(request.id, sendResponse);
    try {
      port.postMessage(request);
    } catch {
      pending.delete(request.id);
      sendResponse({ id: request.id, kind: 'error', message: 'native_unavailable' });
      return undefined;
    }
    return true;
  }
  if (message?.type === 'ageaf:native-cancel') {
    const requestId = message.requestId as string;
    pending.delete(requestId);
    return undefined;
  }
  return undefined;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ageaf:native-stream') return;
  const native = ensureNativePort();
  if (!native) {
    port.onMessage.addListener((message: NativeHostRequest) => {
      try {
        port.postMessage({ id: message.id, kind: 'error', message: 'native_unavailable' });
      } catch {
        // ignore
      }
      try {
        port.disconnect();
      } catch {
        // ignore
      }
    });
    return;
  }
  port.onMessage.addListener((message: NativeHostRequest) => {
    streamPorts.set(message.id, port);
    try {
      native.postMessage(message);
    } catch {
      streamPorts.delete(message.id);
      try {
        port.postMessage({ id: message.id, kind: 'error', message: 'Native host disconnected' });
      } catch {
        // ignore
      }
      try {
        port.disconnect();
      } catch {
        // ignore
      }
    }
  });
  port.onDisconnect.addListener(() => {
    for (const [key, value] of streamPorts.entries()) {
      if (value === port) streamPorts.delete(key);
    }
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: 'ageaf:open-settings' }, () => {
      // It's expected that most tabs won't have our content script injected.
      // Avoid unhandled promise rejections like:
      // "Could not establish connection. Receiving end does not exist."
      void chrome.runtime.lastError;
    });
  });
});
