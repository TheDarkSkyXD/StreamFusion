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

StreamFusion uses one root npm workspace and lockfile:

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
│   ├── desktop/
│   └── worker/
├── packages/
│   └── core/
├── package-lock.json
└── package.json
```

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed:

- **Node.js** (v22 or later)
- **npm 11.19.0**
- **Git**

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/TheDarkSkyXD/StreamFusion.git
    cd StreamFusion
    ```

2.  **Install dependencies**:
    ```bash
    npm install --global npm@11.19.0
    npm run install:dependencies
    ```

    The install command uses the root workspace lockfile. It installs with lifecycle scripts
    disabled, checks the seven-day release-age policy and registry signatures, then runs
    only the version-pinned scripts in `allowScripts`. Use `npm install <package>` for the
    root. Use `npm install --workspace streamfusion <package>` for the desktop app,
    `npm install --workspace @streamfusion/mobile <package>` for the Android app, and
    `npm install --workspace streamfusion-worker <package>` for the Worker. Mobile
    dependencies and tooling belong to `apps/mobile`. Shared-core tooling belongs to
    the `@streamfusion/core` workspace under `packages/core`.
    See the [npm security research](docs/brainstorms/2026-08-29-npm-supply-chain-security-research.md)
    for the policy and its limits.

### Running Locally

To choose Electron, Browser, or Mobile development mode:

```bash
npm start
```

Run `npm run desktop` to start Electron without the picker. Run `npm run mobile` to
build, install, and start the Android development client on a connected device or
emulator. Mobile source, Expo configuration, generated Android files, tests, assets,
and dependency declarations stay under `apps/mobile`.



## 🤝 Contributing

Contributions are welcome! Please feel free to check out the [issues](https://github.com/TheDarkSkyXD/StreamFusion/issues) page if you want to contribute.

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

### Linting & Formatting

The desktop app uses **ESLint** for linting and **Prettier** for formatting.

- Check for errors: `npm run lint`
- Auto-fix errors: `npm --prefix apps/desktop run lint:fix`
- Format code: `npm --prefix apps/desktop run format`
- Check formatting: `npm --prefix apps/desktop run format:check`

## 📝 License

Distributed under the License. See `LICENSE` for more information.

## 📬 Contact

Project Link: [https://github.com/TheDarkSkyXD/StreamFusion](https://github.com/TheDarkSkyXD/StreamFusion)
