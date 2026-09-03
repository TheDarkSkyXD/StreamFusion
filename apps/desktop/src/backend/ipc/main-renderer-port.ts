import type { BrowserWindow, WebContents } from "electron";

import type { IpcChannel } from "../../shared/ipc-channels";
import { registerFeatureRollback } from "./feature-registration-transaction";

export type WindowCleanup = () => void;
export type WindowBinding = (window: BrowserWindow) => WindowCleanup | void;

export interface MainRendererPort {
  current(): BrowserWindow | null;
  trustedSender(): WebContents | null;
  bind(window: BrowserWindow): void;
  detach(): void;
  send(channel: IpcChannel, ...args: unknown[]): boolean;
  sendToOwner(ownerId: number, channel: IpcChannel, ...args: unknown[]): boolean;
  useWindow(key: string, attach: WindowBinding): WindowCleanup;
  dispose(): void;
}

interface RegisteredWindowBinding {
  attach: WindowBinding;
  cleanup: WindowCleanup | null;
}

function once(cleanup: WindowCleanup): WindowCleanup {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    cleanup();
  };
}

/** Owns the replaceable main-renderer window and every resource tied to its lifetime. */
export class MainRendererPortController implements MainRendererPort {
  readonly #bindings = new Map<string, RegisteredWindowBinding>();
  #window: BrowserWindow | null = null;
  #detachWindowEvents: WindowCleanup | null = null;

  current(): BrowserWindow | null {
    const window = this.#window;
    return window && !window.isDestroyed() ? window : null;
  }

  trustedSender(): WebContents | null {
    const window = this.current();
    if (!window || window.webContents.isDestroyed()) return null;
    if (window.webContents.isCrashed?.()) return null;
    const { mainFrame } = window.webContents;
    if (mainFrame && mainFrame.isDestroyed()) return null;
    return window.webContents;
  }

  bind(window: BrowserWindow): void {
    if (this.#window === window && !window.isDestroyed()) return;
    this.detach();
    this.#window = window;

    const detachIfCurrent = (): void => {
      if (this.#window === window) this.detach();
    };
    window.once("closed", detachIfCurrent);
    window.webContents.once("destroyed", detachIfCurrent);
    this.#detachWindowEvents = once(() => {
      window.removeListener("closed", detachIfCurrent);
      window.webContents.removeListener("destroyed", detachIfCurrent);
    });

    try {
      for (const binding of this.#bindings.values()) {
        binding.cleanup = this.#attach(binding.attach, window);
      }
    } catch (error) {
      this.detach();
      throw error;
    }
  }

  detach(): void {
    this.#detachWindowEvents?.();
    this.#detachWindowEvents = null;
    this.#window = null;
    for (const binding of this.#bindings.values()) {
      binding.cleanup?.();
      binding.cleanup = null;
    }
  }

  send(channel: IpcChannel, ...args: unknown[]): boolean {
    const sender = this.trustedSender();
    if (!sender) return false;
    try {
      sender.send(channel, ...args);
      return true;
    } catch {
      return false;
    }
  }

  sendToOwner(ownerId: number, channel: IpcChannel, ...args: unknown[]): boolean {
    const sender = this.trustedSender();
    if (!sender || sender.id !== ownerId) return false;
    try {
      sender.send(channel, ...args);
      return true;
    } catch {
      return false;
    }
  }

  useWindow(key: string, attach: WindowBinding): WindowCleanup {
    if (this.#bindings.has(key)) throw new Error(`Window binding already registered: ${key}`);

    const binding: RegisteredWindowBinding = { attach, cleanup: null };
    this.#bindings.set(key, binding);
    const window = this.current();
    try {
      if (window) binding.cleanup = this.#attach(attach, window);
    } catch (error) {
      this.#bindings.delete(key);
      throw error;
    }

    const removeBinding = once(() => {
      binding.cleanup?.();
      binding.cleanup = null;
      this.#bindings.delete(key);
    });
    registerFeatureRollback(removeBinding);
    return removeBinding;
  }

  dispose(): void {
    this.detach();
    for (const binding of this.#bindings.values()) binding.cleanup?.();
    this.#bindings.clear();
  }

  #attach(attach: WindowBinding, window: BrowserWindow): WindowCleanup | null {
    const cleanup = attach(window);
    return cleanup ? once(cleanup) : null;
  }
}
