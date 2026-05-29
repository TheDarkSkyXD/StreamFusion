import { describe, expect, it, vi } from "vitest";

// The production module imports from "electron" for Menu/BrowserWindow types,
// but the pure function under test only needs primitive params. Mock the
// surface we don't use so the import resolves in a non-Electron test runner.
vi.mock("electron", () => ({
  Menu: { buildFromTemplate: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}));

import { buildContextMenuTemplate } from "@/backend/context-menu";

type Input = Parameters<typeof buildContextMenuTemplate>[0];

function makeParams(overrides: Partial<Input> = {}): Input {
  return {
    selectionText: "",
    isEditable: false,
    ...overrides,
  };
}

describe("buildContextMenuTemplate", () => {
  it("returns empty template when nothing is selected and target is not editable", () => {
    expect(buildContextMenuTemplate(makeParams())).toEqual([]);
  });

  it("includes Copy when selection text is non-empty", () => {
    expect(buildContextMenuTemplate(makeParams({ selectionText: "hello" }))).toEqual([
      { role: "copy" },
    ]);
  });

  it("includes Paste when the target is editable", () => {
    expect(buildContextMenuTemplate(makeParams({ isEditable: true }))).toEqual([
      { role: "paste" },
    ]);
  });

  it("includes Copy then Paste when text is selected inside an editable", () => {
    expect(
      buildContextMenuTemplate(makeParams({ selectionText: "hi", isEditable: true })),
    ).toEqual([{ role: "copy" }, { role: "paste" }]);
  });

  it("treats whitespace-only selection as no selection", () => {
    expect(buildContextMenuTemplate(makeParams({ selectionText: "   \n\t " }))).toEqual([]);
  });

  it("still shows Paste when a whitespace-only selection is inside an editable", () => {
    expect(
      buildContextMenuTemplate(makeParams({ selectionText: " ", isEditable: true })),
    ).toEqual([{ role: "paste" }]);
  });
});
