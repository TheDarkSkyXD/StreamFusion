export const ImpactFeedbackStyle = { Light: "light", Medium: "medium" } as const;
export const NotificationFeedbackType = { Warning: "warning" } as const;
export async function selectionAsync(): Promise<void> {}
export async function impactAsync(_style: unknown): Promise<void> {}
export async function notificationAsync(_type: unknown): Promise<void> {}
