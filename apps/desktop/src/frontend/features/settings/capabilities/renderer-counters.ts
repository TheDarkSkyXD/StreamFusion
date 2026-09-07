export interface RendererCounters {
  chatCalls(): Readonly<Record<string, number>>;
  renderCounts(): Readonly<Record<string, number>>;
  intervalCount(): number;
}
