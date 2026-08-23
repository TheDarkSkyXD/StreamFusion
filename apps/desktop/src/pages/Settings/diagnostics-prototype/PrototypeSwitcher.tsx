import { LuArrowLeft, LuArrowRight } from "react-icons/lu";

export type DiagnosticsPrototypeVariant = "a" | "b" | "c";

const VARIANT_LABELS: Record<DiagnosticsPrototypeVariant, string> = {
  a: "Tabbed diagnostics",
  b: "Investigation timeline",
  c: "Subject explorer",
};

interface PrototypeSwitcherProps {
  current: DiagnosticsPrototypeVariant;
  onPrevious: () => void;
  onNext: () => void;
}

export function PrototypeSwitcher({ current, onPrevious, onNext }: PrototypeSwitcherProps) {
  if (!import.meta.env.DEV) return null;

  return (
    <div
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-black px-1.5 py-1.5 text-white shadow-[0_4px_16px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]"
      role="group"
      aria-label="Diagnostics prototype variant"
    >
      <button
        type="button"
        onClick={onPrevious}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
        aria-label="Previous prototype variant"
      >
        <LuArrowLeft className="h-4 w-4" aria-hidden />
      </button>
      <div className="min-w-52 px-3 text-center text-xs font-semibold tracking-wide">
        <span className="text-white/55">{current.toUpperCase()}</span>
        <span className="mx-2 text-white/25">/</span>
        <span>{VARIANT_LABELS[current]}</span>
      </div>
      <button
        type="button"
        onClick={onNext}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
        aria-label="Next prototype variant"
      >
        <LuArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
