export function isKickRequestCancellation(message: string): boolean {
  return /(?:net::)?ERR_ABORTED/i.test(message);
}

export function isKickNetworkFailure(message: string): boolean {
  return /net::ERR_/i.test(message) && !isKickRequestCancellation(message);
}
