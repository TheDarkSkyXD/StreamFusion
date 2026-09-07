export type SearchRequestConsumer = () => void;

export class SearchRequestBudgetExceededError extends Error {
  constructor() {
    super("Stream search request budget exhausted");
    this.name = "SearchRequestBudgetExceededError";
  }
}
