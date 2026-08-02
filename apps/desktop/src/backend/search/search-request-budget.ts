export type SearchRequestConsumer = () => void;

export class SearchRequestBudgetExceededError extends Error {
  constructor() {
    super("Stream search request budget exhausted");
    this.name = "SearchRequestBudgetExceededError";
  }
}

export function isSearchRequestBudgetExceeded(error: unknown): boolean {
  return error instanceof SearchRequestBudgetExceededError;
}
