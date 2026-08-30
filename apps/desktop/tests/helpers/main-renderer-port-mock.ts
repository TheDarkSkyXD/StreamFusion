import type { BrowserWindow } from "electron";

import type {
  MainRendererPort,
  WindowBinding,
  WindowCleanup,
} from "@backend/ipc/main-renderer-port";
import { registerFeatureRollback } from "@backend/ipc/feature-registration-transaction";
import type { IpcChannel } from "@shared/ipc-channels";

function once(cleanup: WindowCleanup): WindowCleanup {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    cleanup();
  };
}

export function createMainRendererPortMock(window: BrowserWindow): MainRendererPort {
  let current: BrowserWindow | null = null;
  let detachWindowEvents: WindowCleanup | null = null;
  const bindings = new Map<string, { attach: WindowBinding; cleanup: WindowCleanup | null }>();
  const currentWindow = () => (current && !current.isDestroyed() ? current : null);
  const trustedSender = () => {
    const activeWindow = currentWindow();
    if (!activeWindow || activeWindow.webContents.isDestroyed()) return null;
    if (activeWindow.webContents.isCrashed?.()) return null;
    const frame = activeWindow.webContents.mainFrame;
    if (frame && (frame.isDestroyed() || frame.detached)) return null;
    return activeWindow.webContents;
  };
  const detachBindings = () => {
    for (const binding of bindings.values()) {
      binding.cleanup?.();
      binding.cleanup = null;
    }
  };

  const renderer: MainRendererPort = {
    current: currentWindow,
    trustedSender,
    bind: (nextWindow) => {
      if (current === nextWindow && !nextWindow.isDestroyed()) return;
      renderer.detach();
      current = nextWindow;
      const detachIfCurrent = () => {
        if (current === nextWindow) renderer.detach();
      };
      nextWindow.once?.("closed", detachIfCurrent);
      nextWindow.webContents.once?.("destroyed", detachIfCurrent);
      detachWindowEvents = once(() => {
        nextWindow.removeListener?.("closed", detachIfCurrent);
        nextWindow.webContents.removeListener?.("destroyed", detachIfCurrent);
      });
      try {
        for (const binding of bindings.values()) {
          const cleanup = binding.attach(nextWindow);
          binding.cleanup = cleanup ? once(cleanup) : null;
        }
      } catch (error) {
        renderer.detach();
        throw error;
      }
    },
    detach: () => {
      detachWindowEvents?.();
      detachWindowEvents = null;
      detachBindings();
      current = null;
    },
    send: (channel: IpcChannel, ...args: unknown[]) => {
      const sender = trustedSender();
      if (!sender) return false;
      try {
        sender.send(channel, ...args);
        return true;
      } catch {
        return false;
      }
    },
    sendToOwner: (ownerId: number, channel: IpcChannel, ...args: unknown[]) => {
      const sender = trustedSender();
      if (!sender || sender.id !== ownerId) return false;
      try {
        sender.send(channel, ...args);
        return true;
      } catch {
        return false;
      }
    },
    useWindow: (key: string, attach: WindowBinding) => {
      if (bindings.has(key)) throw new Error(`Window binding already registered: ${key}`);
      const activeWindow = currentWindow();
      const binding = { attach, cleanup: null as WindowCleanup | null };
      bindings.set(key, binding);
      try {
        if (activeWindow) {
          const cleanup = attach(activeWindow);
          binding.cleanup = cleanup ? once(cleanup) : null;
        }
      } catch (error) {
        bindings.delete(key);
        throw error;
      }
      const removeBinding = once(() => {
        binding.cleanup?.();
        binding.cleanup = null;
        bindings.delete(key);
      });
      registerFeatureRollback(removeBinding);
      return removeBinding;
    },
    dispose: () => {
      renderer.detach();
      bindings.clear();
    },
  };

  renderer.bind(window);
  return renderer;
}
