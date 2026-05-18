/**
 * ToastRoot — single sonner Toaster mount for the entire renderer.
 *
 * Imperative API: any component can call `toast.error(...)` /
 * `toast.success(...)` from `sonner` and the notification renders here.
 * Centralized so failure-mode UX (mod actions, pin/unpin, auth failures)
 * has one consistent surface across the app.
 */
import { Toaster } from "sonner";

export function ToastRoot() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      duration={5000}
      theme="dark"
    />
  );
}
