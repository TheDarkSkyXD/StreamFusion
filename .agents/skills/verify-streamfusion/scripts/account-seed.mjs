export function createVerificationAccountSeed(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error("Account storage must be an object");
  }
  return Object.fromEntries(
    ["preferences", "lastActiveTab", "windowBounds"]
      .filter((key) => Object.hasOwn(stored, key))
      .map((key) => [key, stored[key]]),
  );
}
