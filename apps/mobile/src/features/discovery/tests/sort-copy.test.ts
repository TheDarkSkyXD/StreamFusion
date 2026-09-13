import { describe, expect, it } from "vitest";

import { sortCopy } from "../utils/sort-copy";

describe("sortCopy", () => {
  it("sorts a copy so Hermes does not need Array.toSorted", () => {
    const input = [3, 1, 2];
    expect(sortCopy(input, (left, right) => left - right)).toEqual([1, 2, 3]);
    expect(input).toEqual([3, 1, 2]);
  });
});
