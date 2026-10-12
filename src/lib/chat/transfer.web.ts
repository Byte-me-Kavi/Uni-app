// The web app's version of transfer.ts: the browser holds picked files as blob URLs, and opening
// a document hands its link to a new tab (the browser's own PDF viewer, or a download).

export async function fileSize(uri: string) {
  return (await (await fetch(uri)).blob()).size;
}

export async function exists(uri: string | undefined) {
  return !!uri;
}

export async function putFile(url: string, headers: Record<string, string>, uri: string, onProgress: (share: number) => void) {
  try {
    const blob = await (await fetch(uri)).blob();
    const response = await fetch(url, { method: 'PUT', headers, body: blob });
    // 412: an earlier attempt with this same link already stored the file.
    if (response.ok || response.status === 412) onProgress(1);
    return response.status === 412 ? 200 : response.status;
  } catch {
    return 0;
  }
}

export async function openFile(file: { url: string }) {
  window.open(file.url, '_blank', 'noopener');
}

export async function shareFile(file: { url: string }) {
  window.open(file.url, '_blank', 'noopener');
}

// The web build keeps nothing for offline.
export async function offlineCopy(_file: { path: string; name: string }): Promise<string | null> {
  return null;
}

export async function keepOffline(_file: { url: string; path: string; name: string }): Promise<number> {
  return 0;
}

export async function dropOffline(_file: { path: string; name: string }) {}
