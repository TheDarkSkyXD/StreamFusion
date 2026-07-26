---
name: StreamFusion
description: Unified Twitch + Kick desktop viewer with premium tool-grade UI
colors:
  storm-white: "#ffffff"
  storm-neutral: "#a3a3a3"
  storm-crimson: "#dc143c"
  twitch-purple: "#9146ff"
  twitch-deep: "#772ce8"
  twitch-bright: "#a970ff"
  kick-green: "#53fc18"
  kick-deep: "#3dd912"
  kick-bright: "#7aff4d"
  void-black: "#0f0f0f"
  dark-surface: "#1a1a1a"
  mid-surface: "#252525"
  raised-surface: "#2d2d2d"
  text-primary: "#ffffff"
  text-secondary: "#a0a0a0"
  text-muted: "#666666"
  text-category: "#b2b2b2"
  tag-surface: "#4a4d55"
  tag-surface-hover: "#5a5d66"
  tag-text: "#efeff1"
  divider: "#333333"
  danger: "#dc143c"
  live-red: "#dc2626"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.025em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.storm-white}"
    textColor: "{colors.void-black}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "rgba(255,255,255,0.9)"
    textColor: "{colors.void-black}"
  button-secondary:
    backgroundColor: "{colors.mid-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.text-primary}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.text-primary}"
  button-twitch:
    backgroundColor: "{colors.twitch-purple}"
    textColor: "{colors.storm-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-kick:
    backgroundColor: "{colors.kick-green}"
    textColor: "{colors.void-black}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.storm-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card-default:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "24px"
  chip-tag:
    backgroundColor: "{colors.tag-surface}"
    textColor: "{colors.tag-text}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  chip-tag-hover:
    backgroundColor: "{colors.tag-surface-hover}"
    textColor: "{colors.tag-text}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  nav-item-active:
    backgroundColor: "#404040"
    textColor: "{colors.storm-white}"
---

# Design System: StreamFusion

## 1. Overview

**Creative North Star: "The Dark Theater"**

The stream is the show. StreamFusion is the dark room around the screen: invisible when the content plays, ambient when you glance away, instantly responsive when you reach for a control. Every element exists to frame the content, not to compete with it.

The system is dark by conviction, not by trend. Streamers broadcast against black; the UI honors that by refusing to introduce competing light sources. Surfaces step through four tonal layers (#0f0f0f to #2d2d2d) to create spatial hierarchy without a single shadow at rest. When interaction demands attention (popovers, dialogs, dropdowns), subtle shadows lift elements off the stage, then vanish.

StreamFusion rejects: the gamer aesthetic (no neon, no RGB glow, no angular esports energy); the Twitch/Kick visual language (this is its own product, not a reskin); generic SaaS blandness (this is a media app, not a dashboard); and Electron jank (native speed, no layout shifts, no web-page-in-a-window artifacts).

**Key Characteristics:**
- Dark tonal layering with four deliberate surface steps
- Crimson accent used sparingly for live states and critical actions
- Platform colors (Twitch purple, Kick green) as contextual accents, never the identity
- Inter as the sole typeface: clean, dense, optimized for small sizes
- Tactile interactions: elements respond immediately to input with color shifts and subtle transforms

## 2. Colors: The Void Palette

A disciplined dark palette where content luminance is the brightest thing on screen. The UI stays below the content's brightness threshold.

### Primary

- **Storm Crimson** (#dc143c): The singular accent. Used for live indicators, destructive actions, and moments that demand attention. Its rarity is its power. Never decorative.

### Secondary

- **Twitch Purple** (#9146ff / dark: #772ce8 / bright: #a970ff): Platform identification only. Appears on Twitch badges, Twitch-specific buttons, and platform indicators. Never used as a general accent.
- **Kick Green** (#53fc18 / dark: #3dd912 / bright: #7aff4d): Platform identification only. Same rules as Twitch Purple.

### Neutral

- **Void Black** (#0f0f0f): The deepest surface. Main content background. Nearly black, not pure black.
- **Dark Surface** (#1a1a1a): Sidebar, title bar, card backgrounds. One step above the void.
- **Mid Surface** (#252525): Tertiary containers, secondary buttons, muted backgrounds.
- **Raised Surface** (#2d2d2d): Elevated containers, popovers, the highest tonal step before shadows take over.
- **Storm White** (#ffffff): Primary text, primary buttons. High contrast against the void.
- **Secondary Text** (#a0a0a0): Supporting text, timestamps, metadata.
- **Muted Text** (#666666): Disabled states, placeholder text. Deliberately low contrast.
- **Category Text** (#b2b2b2): Category labels, stream info. Between secondary and primary.
- **Divider** (#333333): All borders and separators. Subtle, never prominent.

### Named Rules

**The Stage Light Rule.** Storm Crimson appears on no more than 5% of any given screen. Its scarcity is what makes the live badge pulse with urgency. If crimson is everywhere, nothing is live.

**The Platform Guest Rule.** Twitch Purple and Kick Green are guests in StreamFusion's house. They identify their platform, then step back. Never use them as general UI accents, hover states, or decorative elements.

## 3. Typography

**Body Font:** Inter (with system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif)

**Character:** Inter is the workhorse. Dense, legible at small sizes, neutral enough to disappear behind the content. No display font; the content IS the display.

### Hierarchy

- **Display** (700, 1.5rem/24px, 1.2 line-height): Page headings, section titles. Used sparingly.
- **Title** (700, 0.875rem/14px, 1.25 line-height): Stream titles, card headings. The primary reading size.
- **Body** (500, 0.875rem/14px, 1.5 line-height): Chat messages, descriptions, general content. 65-75ch max line length.
- **Label** (600, 0.75rem/12px, 1.33 line-height, 0.025em tracking): Badges, viewer counts, tags, metadata. The smallest readable size.

### Named Rules

**The Single Voice Rule.** Inter is the only typeface. No display fonts, no monospace for style, no serif accents. One voice, many weights.

## 4. Elevation: The Shadow Protocol

Surfaces are flat at rest. Depth is conveyed through tonal layering: four background steps from Void Black (#0f0f0f) through Raised Surface (#2d2d2d). This is the dominant spatial language.

Shadows appear only as a response to interaction state. They signal temporary elevation: something has risen above the tonal stack and will return.

### Shadow Vocabulary

- **Popover shadow** (`0 4px 16px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)`): Dropdowns, context menus, autocomplete panels. Appears on mount, disappears on dismiss.
- **Dialog shadow** (`0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)`): Modal dialogs, confirmation panels. The heaviest shadow in the system.
- **Toast shadow** (`0 2px 8px rgba(0,0,0,0.3)`): Lightweight notification float.

### Named Rules

**The Flat-By-Default Rule.** No surface has a shadow at rest. If you're writing `box-shadow` on a card, container, or section, stop. Use a tonal background step instead. Shadows are reserved for elements that appear, then vanish.

## 5. Components

### Buttons

Tactile and responsive. Every button shifts color immediately on hover; the transition is fast enough (200ms) to feel direct, not animated.

- **Shape:** Gently curved edges (8px radius)
- **Primary:** Storm White background (#ffffff), Void Black text (#0f0f0f). Height 40px, padding 8px 16px. The highest-contrast element on screen.
- **Hover:** Background drops to 90% opacity. Immediate.
- **Focus:** 2px ring, Storm White (#ffffff). Visible on keyboard navigation.
- **Secondary:** Mid Surface background (#252525), primary text. Hover shifts to Raised Surface (#2d2d2d).
- **Ghost:** Transparent at rest. Hover reveals Dark Surface (#1a1a1a).
- **Outline:** 1px border (Divider #333333), transparent background. Hover fills with Dark Surface.
- **Platform variants:** Twitch Purple and Kick Green backgrounds, used only for platform-specific actions (connect account, follow on platform). Never as general buttons.
- **Destructive:** Danger Red (#dc143c) background, white text.

### Chips / Tags

- **Style:** Full rounded (9999px radius), Tag Surface background (#4a4d55), tag text (#efeff1). Compact: 2px 10px padding, 11px font, bold weight.
- **Hover:** Background shifts to Tag Surface Hover (#5a5d66). Fast transition.
- **Use:** Stream tags, language labels, category filters. Never as buttons or navigation.

### Cards / Containers

- **Corner Style:** Moderately curved (12px radius)
- **Background:** Dark Surface (#1a1a1a) with 1px Divider border (#333333)
- **Shadow Strategy:** None at rest. Tonal step IS the elevation.
- **Stream cards:** Border disappears at rest (transparent), appears on hover as a subtle ring (1px Divider). Thumbnail scales 105% on hover (300ms, ease-out). The card is a viewport into the stream, not a decorative container.
- **Internal Padding:** 24px for standalone cards, 12px for content-dense cards (stream info).

### Inputs / Fields

- **Style:** Dark Surface background (#1a1a1a), 1px Divider border (#333333), 8px radius.
- **Focus:** Border shifts to Storm White ring. No glow, no shadow. Clean state change.
- **Disabled:** Muted Text (#666666), reduced opacity (50%).

### Navigation

The sidebar is a vertical rail: icon + label pairs, 56px wide when collapsed (icon only), 224px expanded.

- **Default:** Transparent background, white text, 8px radius.
- **Hover:** Background shifts to Mid Surface (#252525).
- **Active:** Neutral-700 (#404040) background, white text. The active state is a filled container, not a colored accent.
- **Divider:** A 1px horizontal line (Divider #333333, 50% opacity) separates navigation from followed channels.

### Title Bar

Frameless window with custom controls. Dark Surface background (#1a1a1a), 28px height, bottom border (Divider #333333). Window control buttons: 48px wide, full height. Close button turns Danger Red on hover. Minimize/maximize shift to Mid Surface.

## 6. Do's and Don'ts

### Do:

- **Do** use the four tonal surface steps (#0f0f0f, #1a1a1a, #252525, #2d2d2d) as the primary depth language. Every new container should be exactly one step lighter than its parent.
- **Do** keep Storm Crimson (#dc143c) below 5% of any screen's surface area. If it's on more than the live badge and one CTA, it's overused.
- **Do** use platform colors (Twitch Purple, Kick Green) exclusively for platform identification: badges, connect buttons, platform indicators. Nowhere else.
- **Do** respect `prefers-reduced-motion`. All animations (thumbnail scale, stagger entrance, fade-in) must degrade to instant state changes.
- **Do** maintain WCAG AA contrast: 4.5:1 for body text, 3:1 for large text and interactive elements.
- **Do** keep transitions fast: 200ms for color/opacity, 300ms for transforms. Nothing slower unless choreographed.

### Don't:

- **Don't** use neon gradients, RGB glow effects, or angular esports-style shapes. The audience watches games; the tool is not a game.
- **Don't** replicate Twitch or Kick's visual language. No purple-dominant themes, no green-dominant themes. StreamFusion has its own identity.
- **Don't** add shadows to resting surfaces. Cards, sections, containers: flat. Shadows are for popovers, dialogs, and toasts only.
- **Don't** use `border-left` or `border-right` greater than 1px as colored accent stripes.
- **Don't** use gradient text (`background-clip: text`).
- **Don't** use glassmorphism decoratively. `backdrop-blur` is functional (viewer count overlays on thumbnails), not aesthetic.
- **Don't** build the hero-metric template (big number, small label, gradient accent). This is a media app, not a SaaS dashboard.
- **Don't** let the UI feel like a web page in a window. No layout shifts, no sluggish transitions, no visible reflows. If it feels like a browser tab with a title bar, it has failed.
- **Don't** use em dashes. Use commas, colons, semicolons, periods, or parentheses.
