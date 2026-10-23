import { z } from "zod";

export const DEVELOPER_WIDGET_FRAME = "streamfusion-developer-widgets";

const cssRect = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const layout = z.object({
  revision: z.number().int().nonnegative(),
  rectsCss: z.array(cssRect).max(16),
});

export type DeveloperWidgetLayout = z.infer<typeof layout>;

export function parseDeveloperWidgetLayout(
  value: unknown,
  viewport: { width: number; height: number }
): DeveloperWidgetLayout | null {
  const parsed = layout.safeParse(value, { jitless: true });
  if (
    !parsed.success ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  const rectsCss = parsed.data.rectsCss.flatMap((rect) => {
    const width = rect.x + rect.width > viewport.width ? viewport.width - rect.x : rect.width;
    const height = rect.y + rect.height > viewport.height ? viewport.height - rect.y : rect.height;
    return width > 0 && height > 0 ? [{ ...rect, width, height }] : [];
  });
  if (
    rectsCss.some(
      (rect) =>
        rect.x === 0 &&
        rect.y === 0 &&
        rect.width === viewport.width &&
        rect.height === viewport.height
    )
  )
    return null;
  return { revision: parsed.data.revision, rectsCss };
}

export function shapeFromDeveloperWidgetLayout(
  value: DeveloperWidgetLayout,
  viewport: { width: number; height: number },
  zoom: number
): { x: number; y: number; width: number; height: number }[] {
  return value.rectsCss.map((rect) => {
    const x = Math.floor(rect.x * zoom);
    const y = Math.floor(rect.y * zoom);
    return {
      x,
      y,
      width: Math.ceil(Math.min(viewport.width, rect.x + rect.width) * zoom) - x,
      height: Math.ceil(Math.min(viewport.height, rect.y + rect.height) * zoom) - y,
    };
  });
}
