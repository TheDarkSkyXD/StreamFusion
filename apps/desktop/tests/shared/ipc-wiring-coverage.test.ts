import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const desktopRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sourceRoot = join(desktopRoot, "src");

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

interface IpcReferences {
  handles: string[];
  invokes: string[];
  listeners: string[];
  sends: string[];
}

function matchedChannels(source: string, expression: RegExp): string[] {
  return [...source.matchAll(expression)].map((match) => match[1]);
}

function collectIpcReferences(paths: readonly string[]): IpcReferences {
  const references: IpcReferences = { handles: [], invokes: [], listeners: [], sends: [] };

  for (const path of paths) {
    const source = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    references.handles.push(
      ...matchedChannels(source, /ipcMain\s*\.\s*handle\s*\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g),
      ...matchedChannels(
        source,
        /registerTrustedIpcHandler\s*\(\s*{[\s\S]*?channel\s*:\s*IPC_CHANNELS\.([A-Z0-9_]+)/g
      )
    );
    references.listeners.push(
      ...matchedChannels(source, /ipcMain\s*\.\s*on\s*\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)
    );
    references.invokes.push(
      ...matchedChannels(source, /ipcRenderer\s*\.\s*invoke\s*\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g),
      ...matchedChannels(source, /invokeUserProfile\s*\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)
    );
    references.sends.push(
      ...matchedChannels(source, /ipcRenderer\s*\.\s*send\s*\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)
    );
  }

  return references;
}

function duplicateNames(names: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([name]) => name);
}

// Guards: preload invoke/send channels stay paired with one main-process registration.
describe("IPC wiring coverage", () => {
  const references = collectIpcReferences(listTypeScriptFiles(sourceRoot));

  it("registers every channel invoked by preload exactly once", () => {
    const registered = new Set(references.handles);
    const missing = [...new Set(references.invokes)].filter((channel) => !registered.has(channel));

    expect(missing, "preload invoke channels missing an ipcMain.handle registration").toEqual([]);
    expect(duplicateNames(references.handles), "duplicate ipcMain.handle registrations").toEqual(
      []
    );
  });

  it("registers every channel sent by preload exactly once", () => {
    const registered = new Set(references.listeners);
    const missing = [...new Set(references.sends)].filter((channel) => !registered.has(channel));

    expect(missing, "preload send channels missing an ipcMain.on registration").toEqual([]);
    expect(duplicateNames(references.listeners), "duplicate ipcMain.on registrations").toEqual([]);
  });
});
