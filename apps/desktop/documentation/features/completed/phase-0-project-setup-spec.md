# Phase 0: Project Setup & Initial Configuration

**Document Name:** Project Setup Implementation Plan  
**Date:** December 7, 2025  
**Version:** 1.0  
**Status:** Planning  
**Priority:** Critical (Start Here)

---

## Executive Summary

This phase establishes the foundational architecture for StreamFusion, a cross-platform Electron desktop application for unified Twitch and Kick streaming. It covers project scaffolding, core dependencies, build configuration, and the fundamental application framework that all subsequent features will build upon.

## Prerequisites

- Node.js v18+ installed
- npm or yarn package manager
- Git for version control
- VS Code (recommended) with TypeScript and ESLint extensions

---

## Architecture Overview

### Technology Stack

| Category | Technology | Purpose |
|----------|------------|---------|
| **Framework** | Electron | Desktop app container |
| **Build Tool** | Electron Forge | Build, package, and publish |
| **Language** | TypeScript | Type-safe development |
| **UI Library** | React 18+ | Frontend framework |
| **Styling** | TailwindCSS | Utility-first CSS |
| **Components** | shadcn/ui | Pre-built accessible components |
| **State** | Zustand | Lightweight state management |
| **Data Fetching** | TanStack Query | Server state management |
| **Routing** | TanStack Router | Type-safe routing |

### Project Structure

```
streamfusion/
├── .github/                    # GitHub workflows and templates
│   ├── workflows/             # CI/CD pipelines
│   └── ISSUE_TEMPLATE/        # Issue templates
├── .vscode/                    # VS Code configuration
│   ├── settings.json          # Workspace settings
│   └── extensions.json        # Recommended extensions
├── assets/                     # Static assets
│   ├── icons/                 # App icons (all platforms)
│   └── images/                # Static images
├── build/                      # Build configuration
│   ├── entitlements.mac.plist # macOS entitlements
│   └── installer.nsh          # Windows installer config
├── src/
│   ├── backend/                  # Main process (Node.js)
│   │   ├── api/              # API integrations
│   │   ├── core/             # Core functionality
│   │   │   ├── app.ts        # App initialization
│   │   │   ├── ipc-handlers.ts
│   │   │   └── window-manager.ts
│   │   ├── services/         # Backend services
│   │   ├── utils/            # Utility functions
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   └── index.ts          # Entry point
│   ├── frontend/              # Renderer process (React)
│   │   ├── assets/
│   │   ├── components/
│   │   │   ├── ui/           # shadcn components
│   │   │   ├── layout/       # Layout components
│   │   │   └── common/       # Shared components
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── routes/
│   │   ├── store/
│   │   ├── styles/
│   │   │   ├── globals.css
│   │   │   └── tailwind.css
│   │   ├── utils/
│   │   ├── App.tsx
│   │   ├── index.html
│   │   └── index.tsx
│   ├── preload/               # Preload scripts
│   │   ├── index.ts
│   │   └── api.ts
│   └── shared/                # Shared between processes
│       ├── types/
│       ├── constants.ts
│       └── utils/
├── test/                       # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .eslintrc.cjs
├── .prettierrc
├── electron.vite.config.ts
├── forge.config.ts
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── postcss.config.js
```

---

## Implementation Phases

### Phase 0.1: Project Initialization (Day 1)

#### Tasks

- [ ] **0.1.1** Initialize Electron Forge project with Vite + React + TypeScript template
  ```bash
  # Install in current directory using ./
  npm init electron-app@latest ./ -- --template=vite-typescript
  # OR
  npx create-electron-app@latest ./ --template=vite-typescript
  ```

- [ ] **0.1.2** Configure forge.config.ts for multi-platform builds
  - Windows: NSIS installer, portable exe
  - macOS: DMG, pkg with notarization support
  - Linux: deb, rpm, AppImage

- [ ] **0.1.3** Set up TypeScript configuration
  - Strict mode enabled
  - Path aliases for clean imports (`@backend/`, `@frontend/`, `@shared/`)
  - Separate configs for backend, frontend, and preload

- [ ] **0.1.4** Initialize Git repository with .gitignore

#### Verification

- [ ] `npm run start` launches the Electron app
- [ ] Hot Module Replacement (HMR) works for renderer
- [ ] TypeScript compilation succeeds without errors

---

### Phase 0.2: Development Environment Setup (Day 1-2)

#### Tasks

- [ ] **0.2.1** Install and configure ESLint
  ```json
  {
    "extends": [
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:react/recommended",
      "plugin:react-hooks/recommended",
      "prettier"
    ]
  }
  ```

- [ ] **0.2.2** Install and configure Prettier
  ```json
  {
    "semi": true,
    "singleQuote": true,
    "tabWidth": 2,
    "trailingComma": "es5",
    "printWidth": 100
  }
  ```

- [ ] **0.2.3** Configure VS Code settings
  - Format on save
  - ESLint auto-fix
  - Recommended extensions

- [ ] **0.2.4** Set up Husky for pre-commit hooks
  - Lint-staged for staged files
  - Type checking before commit

#### Verification

- [ ] ESLint catches code issues
- [ ] Prettier auto-formats on save
- [ ] Pre-commit hooks run successfully

---

### Phase 0.3: TailwindCSS & shadcn/ui Integration (Day 2-3)

#### Tasks

- [ ] **0.3.1** Install TailwindCSS with PostCSS
  ```bash
  npm install -D tailwindcss postcss autoprefixer
  npx tailwindcss init -p
  ```

- [ ] **0.3.2** Configure tailwind.config.js
  ```javascript
  module.exports = {
    content: ['./src/frontend/**/*.{html,js,ts,jsx,tsx}'],
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          // StreamFusion brand colors
          'storm-primary': '#6366f1',
          'storm-secondary': '#8b5cf6',
          'storm-accent': '#06b6d4',
          // Platform colors
          'twitch-purple': '#9146ff',
          'kick-green': '#53fc18',
        },
        fontFamily: {
          sans: ['Inter', 'system-ui', 'sans-serif'],
        },
      },
    },
    plugins: [require('@tailwindcss/typography')],
  };
  ```

- [ ] **0.3.3** Initialize shadcn/ui
  ```bash
  npx shadcn@latest init
  ```
  - Configure for TypeScript and Tailwind
  - Set component path to `src/frontend/components/ui`

- [ ] **0.3.4** Install essential shadcn components
  - Button, Card, Input, Dialog, Dropdown, Tooltip
  - Tabs, ScrollArea, Popover, Separator

- [ ] **0.3.5** Create global CSS with CSS variables for theming

#### Verification

- [ ] TailwindCSS classes apply correctly
- [ ] Dark mode toggle works
- [ ] shadcn components render properly

---

### Phase 0.4: State Management & Routing (Day 3-4)

#### Tasks

- [ ] **0.4.1** Install Zustand
  ```bash
  npm install zustand
  ```

- [ ] **0.4.2** Create base store structure
  ```typescript
  // src/frontend/store/app-store.ts
  interface AppState {
    theme: 'light' | 'dark' | 'system';
    sidebarOpen: boolean;
    setTheme: (theme: AppState['theme']) => void;
    toggleSidebar: () => void;
  }
  ```

- [ ] **0.4.3** Install TanStack Query
  ```bash
  npm install @tanstack/react-query @tanstack/react-query-devtools
  ```

- [ ] **0.4.4** Configure QueryClient and Provider
  - Default stale time, retry logic
  - Devtools in development mode

- [ ] **0.4.5** Install TanStack Router
  ```bash
  npm install @tanstack/react-router
  ```

- [ ] **0.4.6** Set up initial routes
  - `/` - Home/Browse
  - `/following` - Following page
  - `/categories` - Categories
  - `/settings` - Settings
  - `/stream/:platform/:channel` - Stream view

#### Verification

- [ ] Zustand state persists correctly
- [ ] React Query devtools accessible
- [ ] Routes navigate correctly

---

### Phase 0.5: IPC Communication Layer (Day 4-5)

#### Tasks

- [ ] **0.5.1** Create type-safe IPC channel definitions
  ```typescript
  // src/shared/ipc-channels.ts
  export const IPC_CHANNELS = {
    // App
    APP_GET_VERSION: 'app:get-version',
    APP_MINIMIZE: 'app:minimize',
    APP_MAXIMIZE: 'app:maximize',
    APP_CLOSE: 'app:close',
    
    // Settings
    SETTINGS_GET: 'settings:get',
    SETTINGS_SET: 'settings:set',
    
    // Auth
    AUTH_LOGIN: 'auth:login',
    AUTH_LOGOUT: 'auth:logout',
    AUTH_GET_STATUS: 'auth:get-status',
  } as const;
  ```

- [ ] **0.5.2** Implement preload script with contextBridge
  ```typescript
  // src/preload/index.ts
  import { contextBridge, ipcRenderer } from 'electron';
  
  contextBridge.exposeInMainWorld('electronAPI', {
    // Type-safe API exposed to renderer
  });
  ```

- [ ] **0.5.3** Create IPC handlers in main process
  ```typescript
  // src/backend/core/ipc-handlers.ts
  export function registerIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion());
    // ... more handlers
  }
  ```

- [ ] **0.5.4** Create React hooks for IPC communication
  ```typescript
  // src/frontend/hooks/useElectron.ts
  export function useAppVersion() {
    return useQuery({
      queryKey: ['app-version'],
      queryFn: () => window.electronAPI.getVersion(),
    });
  }
  ```

#### Verification

- [ ] IPC messages pass between main and renderer
- [ ] Type safety maintained across the boundary
- [ ] Error handling works for failed IPC calls

---

### Phase 0.6: Window Management (Day 5-6)

#### Tasks

- [ ] **0.6.1** Create WindowManager class
  ```typescript
  // src/backend/core/window-manager.ts
  class WindowManager {
    private mainWindow: BrowserWindow | null = null;
    
    createMainWindow(): BrowserWindow;
    getMainWindow(): BrowserWindow | null;
    // Pop-out windows for multi-stream
    createPopoutWindow(streamId: string): BrowserWindow;
  }
  ```

- [ ] **0.6.2** Configure main window options
  - Frame: false (custom title bar)
  - Min size: 1024x768
  - Default size: 1400x900
  - Persist window bounds
  - Background color matching theme

- [ ] **0.6.3** Implement custom title bar component
  - Window controls (minimize, maximize, close)
  - App title/branding
  - Draggable regions

- [ ] **0.6.4** Add window state persistence
  - Remember size, position, maximized state
  - Multi-monitor support

#### Verification

- [ ] Custom title bar renders correctly
- [ ] Window controls function properly
- [ ] Window state persists between sessions

---

### Phase 0.7: Basic Layout Shell (Day 6-7)

#### Tasks

- [ ] **0.7.1** Create main layout components
  ```
  Layout/
  ├── AppShell.tsx           # Main wrapper
  ├── TitleBar.tsx           # Custom title bar
  ├── Sidebar.tsx            # Left navigation
  ├── ContentArea.tsx        # Main content
  └── StatusBar.tsx          # Bottom status
  ```

- [ ] **0.7.2** Implement responsive sidebar
  - Collapsible on small windows
  - Navigation items with icons
  - Following channels list (placeholder)

- [ ] **0.7.3** Create header navigation
  - Search bar (placeholder)
  - User profile area
  - Platform indicators

- [ ] **0.7.4** Add placeholder pages
  - Home (Browse)
  - Following
  - Categories
  - Settings

#### Verification

- [ ] Layout renders on all supported screen sizes
- [ ] Navigation works correctly
- [ ] Dark/light theme applies to all components

---

### Phase 0.8: Build & Distribution Setup (Day 7-8)

#### Tasks

- [ ] **0.8.1** Configure Electron Forge makers
  ```typescript
  // forge.config.ts
  makers: [
    { name: '@electron-forge/maker-squirrel', config: {} },
    { name: '@electron-forge/maker-dmg', config: {} },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
  ]
  ```

- [ ] **0.8.2** Create app icons
  - Windows: .ico (256x256)
  - macOS: .icns (1024x1024)
  - Linux: .png (512x512)

- [ ] **0.8.3** Configure auto-updater
  ```typescript
  // src/backend/services/auto-updater.ts
  import { autoUpdater } from 'electron-updater';
  
  export function setupAutoUpdater() {
    autoUpdater.checkForUpdatesAndNotify();
  }
  ```

- [ ] **0.8.4** Set up GitHub Actions for CI/CD
  - Build on push to main
  - Test on pull requests
  - Release on tags

#### Verification

- [ ] `npm run make` produces installers for all platforms
- [ ] Auto-updater configured (test with mock server)
- [ ] GitHub Actions workflow runs successfully

---

## Testing & Verification

### Unit Tests
- [ ] IPC channel handlers
- [ ] Store actions and selectors
- [ ] Utility functions

### Integration Tests
- [ ] Main-renderer IPC communication
- [ ] Window management operations
- [ ] Route navigation

### Manual Verification Checklist
- [ ] App launches successfully on Windows
- [ ] App launches successfully on macOS
- [ ] App launches successfully on Linux
- [ ] Theme switching works
- [ ] Window controls function properly
- [ ] Navigation between pages works
- [ ] HMR works during development

---

## Security Considerations

### Electron Security Best Practices

1. **Context Isolation**: Enabled by default
2. **Node Integration**: Disabled in renderer
3. **Sandbox**: Enabled for renderer processes
4. **CSP**: Implement Content Security Policy
5. **Preload Scripts**: Use contextBridge for IPC

```typescript
// BrowserWindow configuration
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: path.join(__dirname, 'preload.js'),
}
```

---

## Dependencies

### Production Dependencies

```json
{
  "dependencies": {
    "@tanstack/react-query": "^5.x",
    "@tanstack/react-router": "^1.x",
    "class-variance-authority": "^0.7.x",
    "clsx": "^2.x",
    "date-fns": "^3.x",
    "electron-store": "^8.x",
    "lucide-react": "^0.x",
    "react": "^18.x",
    "react-dom": "^18.x",
    "tailwind-merge": "^2.x",
    "zustand": "^4.x"
  }
}
```

### Development Dependencies

```json
{
  "devDependencies": {
    "@electron-forge/cli": "^7.x",
    "@electron-forge/plugin-vite": "^7.x",
    "@electron-forge/maker-squirrel": "^7.x",
    "@electron-forge/maker-dmg": "^7.x",
    "@electron-forge/maker-deb": "^7.x",
    "@eslint/js": "^9.x",
    "@types/react": "^18.x",
    "autoprefixer": "^10.x",
    "electron": "^32.x",
    "eslint": "^9.x",
    "postcss": "^8.x",
    "prettier": "^3.x",
    "tailwindcss": "^3.x",
    "typescript": "^5.x",
    "vite": "^5.x"
  }
}
```

---

## Success Criteria

Phase 0 is complete when:

1. ✅ Electron app launches successfully on all target platforms
2. ✅ React renders with TailwindCSS and shadcn components
3. ✅ Type-safe IPC communication established
4. ✅ Basic layout shell with navigation works
5. ✅ Dark/light theme switching functional
6. ✅ Build process creates distributable packages
7. ✅ Development workflow is smooth (HMR, linting, formatting)

---

## Next Phase

→ **[Phase 1: Authentication & User Management](./phase-1-authentication-spec.md)**

