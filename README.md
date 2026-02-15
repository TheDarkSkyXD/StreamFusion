# StreamStorm

![StreamStorm Banner](https://via.placeholder.com/1200x300?text=StreamStorm)
<!-- You can replace the placeholder image above with a real banner or logo once available -->

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.0.0--beta.1-blue.svg)](https://github.com/TheDarkSkyXD/StreamStorm/releases)
![Build Status](https://img.shields.io/github/actions/workflow/status/TheDarkSkyXD/StreamStorm/build.yml?label=Build)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/TheDarkSkyXD/StreamStorm?label=CodeRabbit+Reviews&labelColor=171717&color=FF570A)

**StreamStorm** is a unified, cross-platform desktop application designed to bring the best of **Twitch** and **Kick** live streaming into a single, cohesive interface. Built with modern web technologies and packaged via Electron, StreamStorm offers a lightweight, meaningful, and feature-rich viewing experience.

## ✨ Features

- **Unified Dashboard**: seamlessly browse and watch streams from both twitch.tv and kick.com in one place.
- **Custom Chat Integration**: Interact with chats from both platforms directly within the app.
- **Enhanced Player**: Features an advanced video player with HLS support, offering low latency and high quality.
- **Auto-Retry Mechanism**: Robust handling of stream interruptions with automatic retries for continuous playback.
- **Ad-Block Capabilities**: Built-in mechanisms to provide a cleaner viewing experience (Twitch only).
- **Cross-Platform**: Available for Windows, macOS (Intel & Apple Silicon), and Linux (AppImage).
- **Performance Focused**: optimized for low resource usage compared to running multiple browser tabs.

## 🛠 Tech Stack

StreamStorm is built as a monorepo using **npm workspaces**, leveraging a powerful modern stack:

- **Core Framework**: [Electron](https://www.electronjs.org/) & [React](https://reactjs.org/)
- **Build Tooling**: [Vite](https://vitejs.dev/) & [Electron-Vite](https://electron-vite.org/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Data Fetching**: [TanStack Query](https://tanstack.com/query/latest)
- **Routing**: [TanStack Router](https://tanstack.com/router/latest)
- **Database**: [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3) (for local data persistence)
- **APIs**: Twitch (tmi.js), Kick (Pusher-js), and internal tRPC for IPC.

## 📂 Project Structure

This project is organized as a monorepo:

```bash
StreamStorm/
├── apps/
│   ├── desktop/       # Main Electron application source code

├── packages/          # Shared internal packages (if any)
└── package.json       # Root configuration and workspace definitions
```

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed:

- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)
- **Git**

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/TheDarkSkyXD/StreamStorm.git
    cd StreamStorm
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

### Running Locally

To start the desktop application in development mode with hot-reloading:

```bash
npm start
```
*Alternatively, you can run `npm run dev` directly inside `apps/desktop`.*



## 🤝 Contributing

Contributions are welcome! Please feel free to check out the [issues](https://github.com/TheDarkSkyXD/StreamStorm/issues) page if you want to contribute.

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

### Linting & Formatting

This project uses **Biome** for fast linting and formatting.

- Check for errors: `npm run lint`
- Auto-fix errors: `npm run lint:fix --workspace=streamstorm`
- Format code: `npm run format --workspace=streamstorm`

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

## 📬 Contact

Project Link: [https://github.com/TheDarkSkyXD/StreamStorm](https://github.com/TheDarkSkyXD/StreamStorm)
