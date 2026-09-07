type EventListener<
  TEvents extends object,
  TEvent extends keyof TEvents,
> = TEvents[TEvent] extends (...args: infer TArgs) => unknown
  ? (...args: TArgs) => void
  : never;

export interface ChatConnection<
  TEvents extends object,
  TConnectArgs extends unknown[],
  TJoinArgs extends unknown[],
  TSendArgs extends unknown[],
  TLeaveArgs extends unknown[],
> {
  connect(...args: TConnectArgs): Promise<void>;
  disconnect(): Promise<void>;
  on<TEvent extends keyof TEvents>(
    event: TEvent,
    listener: EventListener<TEvents, TEvent>,
  ): void;
  off<TEvent extends keyof TEvents>(
    event: TEvent,
    listener: EventListener<TEvents, TEvent>,
  ): void;
  sendMessage(...args: TSendArgs): Promise<void>;
  joinChannel(...args: TJoinArgs): Promise<void>;
  leaveChannel(...args: TLeaveArgs): Promise<void>;
}
