import { describe, expect, it } from "vitest";

import {
  collectDeveloperWidgetRects,
  tracksDeveloperWidgetMotion,
} from "../components/dev/developer-widget-geometry";

describe("developer widget geometry", () => {
  it("tracks finite motion of painted roots without following descendant spinners", () => {
    const panel = document.createElement("aside");
    panel.className = "tsqd-main-panel";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    panel.append(spinner);
    document.body.append(panel);
    expect(tracksDeveloperWidgetMotion(spinner, false)).toBe(false);
    expect(tracksDeveloperWidgetMotion(panel, false)).toBe(true);
    panel.style.animationIterationCount = "infinite";
    expect(tracksDeveloperWidgetMotion(panel, true)).toBe(false);
    panel.style.animationIterationCount = "1";
    expect(tracksDeveloperWidgetMotion(panel, true)).toBe(true);
    panel.remove();
  });

  it("reports the launcher, then the painted panel and protruding minimize button", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const launcher = document.createElement("div");
    launcher.className = "tsqd-open-btn-container";
    const wrapper = document.createElement("div");
    wrapper.className = "tsqd-parent-container";
    const panel = document.createElement("aside");
    panel.className = "tsqd-main-panel";
    const minimize = document.createElement("button");
    minimize.className = "tsqd-minimize-btn";
    root.append(launcher, wrapper, panel, minimize);
    Object.defineProperty(launcher, "getBoundingClientRect", {
      value: () => ({ x: 10, y: 20, width: 60, height: 60 }),
    });
    Object.defineProperty(wrapper, "getBoundingClientRect", {
      value: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    });
    Object.defineProperty(panel, "getBoundingClientRect", {
      value: () => ({ x: 0, y: 540, width: 1920, height: 500 }),
    });
    Object.defineProperty(minimize, "getBoundingClientRect", {
      value: () => ({ x: 1890, y: 526, width: 22, height: 15 }),
    });
    expect(collectDeveloperWidgetRects(root, { width: 1920, height: 1080 })).toEqual([
      { x: 0, y: 540, width: 1920, height: 500 },
      { x: 1890, y: 526, width: 22, height: 15 },
    ]);
    panel.remove();
    minimize.remove();
    expect(collectDeveloperWidgetRects(root, { width: 1920, height: 1080 })).toEqual([
      { x: 10, y: 20, width: 60, height: 60 },
    ]);
    root.remove();
  });

  it("includes separate body-portaled settings menus without a full-page wrapper", () => {
    const root = document.createElement("div");
    const panel = document.createElement("aside");
    panel.className = "tsqd-main-panel";
    root.append(panel);
    document.body.append(root);
    Object.defineProperty(panel, "getBoundingClientRect", {
      value: () => ({ x: 0, y: 500, width: 800, height: 200 }),
    });
    const menu = document.createElement("div");
    menu.className = "tsqd-settings-menu";
    const submenu = document.createElement("div");
    submenu.className = "tsqd-settings-submenu";
    document.body.append(menu, submenu);
    Object.defineProperty(menu, "getBoundingClientRect", {
      value: () => ({ x: 700, y: 420, width: 90, height: 65 }),
    });
    Object.defineProperty(submenu, "getBoundingClientRect", {
      value: () => ({ x: 600, y: 390, width: 80, height: 35 }),
    });
    expect(collectDeveloperWidgetRects(root, { width: 800, height: 700 })).toEqual([
      { x: 0, y: 500, width: 800, height: 200 },
      { x: 700, y: 420, width: 90, height: 65 },
      { x: 600, y: 390, width: 80, height: 35 },
    ]);
    root.remove();
    menu.remove();
    submenu.remove();
  });
});
