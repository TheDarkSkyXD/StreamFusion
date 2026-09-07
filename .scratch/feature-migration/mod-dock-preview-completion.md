# Dock preview fix

Hidden dock tools now open one floating preview (340px maximum width, 600px maximum height). Close, Escape, clicking its dock icon again, or selecting another tool closes/replaces that preview. The existing dock layout and saved JSON are untouched by these actions. Public media and existing panes keep their mounted instances and geometry.

Add to workspace is explicit. A legal insertion is selected only when the new pane is at least 240x180px and existing panes retain those minimums, or retain their pre-existing smaller size. Chat remains at its existing full-height edge. If no insertion fits, Add is disabled with an explanation and the preview remains usable. Narrow layouts retain their full-width, 360px stacked-card behavior. Mod Actions can only join its pinned partner horizontally; AutoMod and Retention stay pinned. Existing saved layouts are not rewritten. Adding the preview preserves its component instance.

Files: ModWorkspace.tsx, dock-layout.ts, mod-workspace.css, ModWorkspace.test.tsx, en/es moderation workspace strings and generated catalogs.

Verification: mod-dock-preview-tests.log has 24 passing workspace/page tests; mod-dock-preview-domain-tests.log has passing existing dock-layout tests. Whole TypeScript and scoped ESLint exit 0. mod-dock-preview-i18n.log confirms all 50 catalogs complete. Parent owns T3 visual verification. No Agent Browser or remote moderation used.
