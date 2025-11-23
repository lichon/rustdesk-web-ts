# RustDesk Web Client

This is a web-based client for RustDesk, It allows you to connect to and control remote devices directly from your web browser.

## Features

*   **Remote Desktop Access:** Connect to RustDesk client from the web.
*   **Remote Camera Access:** View remote camera/desktop from the web.
*   **File Transfers:** Support for trzsz/ZMODEM file transfers.
*   **Terminal Interface:** Built with Xterm.js for a powerful and feature-rich terminal experience.
*   **Modern Tech Stack:** Utilizes React, Vite, and TypeScript for a fast and reliable development experience.
*   **Deployable on the Edge:** Designed to be deployed to Cloudflare Workers.
*   **Built-in rustdesk server:** rustdesk hbbs with websocket relay supported.

![](https://github.com/lichon/rustdesk-web-ts/blob/main/public/ssc.gif)

## Getting Started

Follow these instructions to get a local copy up and running for development and testing purposes.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later recommended)
*   [pnpm](https://pnpm.io/installation)

### Installation

1.  Clone the repository:
    ```sh
    git clone https://github.com/lichon/rustdesk-web-ts.git
    cd rustdesk-web-ts
    ```

2.  Install the dependencies:
    ```sh
    pnpm install
    ```

### Development

To run the application in development mode:

```sh
pnpm dev
```

This will start a local development server, typically at `http://localhost:80`.

### Building

To create a production build of the application:

```sh
pnpm build
```

The build artifacts will be stored in the `dist/` directory.

## Deployment

This project is configured for deployment to [Cloudflare Workers](https://workers.cloudflare.com/).

To deploy the application, run:

```sh
pnpm deploy
```

This will build the project and deploy it using the Wrangler CLI.

## Available Scripts

*   `pnpm dev`: Runs the app in development mode.
*   `pnpm build`: Builds the app for production.
*   `pnpm lint`: Lints the source code using ESLint.
*   `pnpm preview`: Serves the production build locally for preview.
*   `pnpm deploy`: Deploys the application to Cloudflare Workers.
*   `pnpm cf-typegen`: Generates types for Cloudflare Workers.

## Technologies Used

*   [React](https://react.dev/)
*   [Vite](https://vitejs.dev/)
*   [TypeScript](https://www.typescriptlang.org/)
*   [Xterm.js](https://xtermjs.org/) - Terminal UI component
*   [Hono](https://hono.dev/) - Web framework for the worker
*   [Tailwind CSS](https://tailwindcss.com/)
*   [Protobuf-TS](https://github.com/protobuf-ts/protobuf-ts) - Protocol Buffers for TypeScript
*   [Cloudflare Workers](https://workers.cloudflare.com/)
