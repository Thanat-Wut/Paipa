import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const globalsCss = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8").replace(/^@import[^;]+;\s*/m, "");

const navigationItems = ["Home", "Lobby", "Memories", "Board", "Chat", "Poll", "Plan", "Members", "Money", "Summary", "Settings"];

function desktopSidebarMarkup() {
  return `
    <div class="trip-shell">
      <aside class="sidebar">
        <a class="brand" href="/trips"><span class="brand-mark">P</span><span>PAIPA<small>TRIP TOGETHER</small></span></a>
        <a class="back-link" href="/trips">ทุกทริป</a>
        <div class="sidebar-trip">
          <span class="eyebrow">OUR SHARED ROOM</span>
          <strong>Short viewport trip</strong>
          <small>จุดหมาย</small>
        </div>
        <nav aria-label="Trip navigation" class="sidebar-nav">
          ${navigationItems.map((label) => `<a href="#${label.toLowerCase()}">${label}</a>`).join("")}
        </nav>
      </aside>
      <main class="trip-main"><div class="trip-content"><div style="height:1200px">Main content</div></div></main>
    </div>
    <nav aria-label="Trip mobile navigation" class="bottom-nav">
      <div class="mobile-nav-primary">
        <a href="#home">Home</a><a href="#lobby">Lobby</a><a href="#board">Board</a><a href="#chat">Chat</a>
      </div>
      <div class="mobile-nav-more"><button type="button">เพิ่มเติม</button></div>
    </nav>`;
}

test("desktop Trip sidebar scrolls independently when navigation exceeds the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 650 });
  await page.setContent(`<style>${globalsCss}</style>${desktopSidebarMarkup()}`);

  const sidebarNav = page.locator("nav.sidebar-nav");
  const initialMetrics = await sidebarNav.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });

  expect(initialMetrics.overflowY).toBe("auto");
  expect(initialMetrics.scrollHeight).toBeGreaterThan(initialMetrics.clientHeight);
  expect(initialMetrics.scrollTop).toBe(0);

  await sidebarNav.getByRole("link", { name: "Settings" }).scrollIntoViewIfNeeded();
  const [navBox, settingsBox] = await Promise.all([sidebarNav.boundingBox(), sidebarNav.getByRole("link", { name: "Settings" }).boundingBox()]);
  expect(navBox).toBeTruthy();
  expect(settingsBox).toBeTruthy();
  if (!navBox || !settingsBox) throw new Error("Sidebar navigation boxes were not measurable");
  expect(settingsBox.y).toBeGreaterThanOrEqual(navBox.y);
  expect(settingsBox.y + settingsBox.height).toBeLessThanOrEqual(navBox.y + navBox.height + 1);
  expect(await sidebarNav.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test("keeps mobile navigation reachable without horizontal overflow", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 700 }, { width: 360, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.setContent(`<style>${globalsCss}</style>${desktopSidebarMarkup()}`);
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.getByRole("button", { name: "เพิ่มเติม" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
});
