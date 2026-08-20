# StreamFusion

![StreamFusion Banner](https://via.placeholder.com/1200x300?text=StreamFusion)
<!-- You can replace the placeholder image above with a real banner or logo once available -->

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.0.0--beta.1-blue.svg)](https://github.com/TheDarkSkyXD/StreamFusion/releases)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/TheDarkSkyXD/StreamFusion?label=CodeRabbit+Reviews&labelColor=171717&color=FF570A)

**StreamFusion** is a unified, cross-platform desktop application designed to bring the best of **Twitch** and **Kick** live streaming into a single, cohesive interface. Built with modern web technologies and packaged via Electron, StreamFusion offers a lightweight, meaningful, and feature-rich viewing experience.

## ✨ Features

- **Unified Dashboard**: seamlessly browse and watch streams from both twitch.tv and kick.com in one place.
- **Custom Chat Integration**: Interact with chats from both platforms directly within the app.
- **Enhanced Player**: Features an advanced video player with HLS support, offering low latency and high quality.
- **Auto-Retry Mechanism**: Robust handling of stream interruptions with automatic retries for continuous playback.
- **Ad-Block Capabilities**: Built-in mechanisms to provide a cleaner viewing experience (Twitch only).
- **Cross-Platform**: Available for Windows, macOS (Intel & Apple Silicon), and Linux (AppImage).
- **Performance Focused**: optimized for low resource usage compared to running multiple browser tabs.

## 🛠 Tech Stack

StreamFusion is built as a **pnpm workspace**, leveraging a powerful modern stack:

- **Core Framework**: [Electron](https://www.electronjs.org/) & [React](https://reactjs.org/)
- **Build Tooling**: [Vite](https://vitejs.dev/) & [Electron-Vite](https://electron-vite.org/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Data Fetching**: [TanStack Query](https://tanstack.com/query/latest)
- **Routing**: [TanStack Router](https://tanstack.com/router/latest)
- **Database**: [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3) (for local data persistence)
- **APIs**: Twitch (tmi.js), Kick (Pusher-js), and typed Electron IPC through the preload bridge.

## 📂 Project Structure

This project is organized as a monorepo:

```bash
StreamFusion/
├── apps/
│   ├── desktop/        # Standalone Electron workspace and local dependencies
│   └── worker/         # Cloudflare Worker in the root tooling workspace
├── pnpm-workspace.yaml # Root tooling/worker dependency-security policy
├── pnpm-lock.yaml      # Root tooling and worker lockfile
└── package.json        # Root scripts and package-manager pin
```

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed:

- **Node.js** (v22 or later)
- **Corepack** (included with supported Node.js releases)
- **Git**

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/TheDarkSkyXD/StreamFusion.git
    cd StreamFusion
    ```

2.  **Install dependencies**:
    ```bash
    corepack enable
    cd apps/desktop
    pnpm install
    cd ../..
    ```

    pnpm 11.17.0 is pinned by the repository. Use pnpm for dependency changes and keep
    pnpm-generated lockfiles as the only lockfiles; do not use `npm install`.
    Use `pnpm add` and `pnpm remove` for package changes. Dependency lifecycle scripts
    run only when the package is explicitly approved in the workspace `allowBuilds` policy.
    Running `pnpm install` from `apps/desktop` installs only the desktop package and keeps
    its dependency artifacts in `apps/desktop/node_modules`; no root install is required.

### Running Locally

To start the desktop application in development mode with hot-reloading:

```bash
npm start
```

The root `npm start` command is a dependency-free wrapper around the desktop package's
start picker. From `apps/desktop`, you can also run `npm start` directly. Other project
commands use pnpm; for example, `pnpm dev` starts the desktop app directly.



## 🤝 Contributing

Contributions are welcome! Please feel free to check out the [issues](https://github.com/TheDarkSkyXD/StreamFusion/issues) page if you want to contribute.

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

### Linting & Formatting

The desktop app uses **ESLint** for linting and **Prettier** for formatting.

- Check for errors: `pnpm lint`
- Auto-fix errors: `pnpm --dir apps/desktop lint:fix`
- Format code: `pnpm --dir apps/desktop format`
- Check formatting: `pnpm --dir apps/desktop format:check`

## 📝 License

Distributed under the License. See `LICENSE` for more information.

## 📬 Contact

Project Link: [https://github.com/TheDarkSkyXD/StreamFusion](https://github.com/TheDarkSkyXD/StreamFusion)
