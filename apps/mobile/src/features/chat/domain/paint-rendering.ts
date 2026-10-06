import type {
  ChatPaintLayer,
  ChatPaintStop,
  ChatUsernamePaint,
} from "../capabilities/chat-interactions";

export function paintLayers(
  paint: ChatUsernamePaint,
): readonly ChatPaintLayer[] {
  return paint.kind === "layers" ? paint.layers : [{ ...paint, opacity: 1 }];
}

export function gradientStops(
  layer: Extract<ChatPaintLayer, { kind: "linear" | "radial" }>,
): readonly ChatPaintStop[] {
  if (!layer.repeat || layer.stops.length < 2) return layer.stops;
  const start = layer.stops[0]?.at ?? 0;
  const end = layer.stops.at(-1)?.at ?? 1;
  const period = end - start;
  if (period <= 0 || period >= 1) return layer.stops;
  const repeated: ChatPaintStop[] = [];
  for (
    let cycle = Math.floor(-start / period);
    cycle * period + start <= 1 && repeated.length < 256;
    cycle += 1
  ) {
    for (const stop of layer.stops) {
      const at = stop.at + cycle * period;
      if (at >= 0 && at <= 1) repeated.push({ at, color: stop.color });
    }
  }
  return repeated;
}
