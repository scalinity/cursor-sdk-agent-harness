import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SERVER_PORT = Number(process.env.PORT ?? 4783);
const SERVER_HOST = process.env.HOST ?? "127.0.0.1";
const SERVER_ORIGIN = `http://${SERVER_HOST}:${SERVER_PORT}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: SERVER_ORIGIN,
        changeOrigin: false,
      },
      "/ws": {
        target: SERVER_ORIGIN,
        ws: true,
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
  },
});
