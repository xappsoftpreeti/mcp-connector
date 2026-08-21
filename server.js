import dotenv from "dotenv";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createTallyMcpServer } from "./lib/mcp-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
    path: path.join(__dirname, ".env")
});

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);

function lanIPv4Addresses() {
    const addresses = new Set();
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries || []) {
            if (entry.family === "IPv4" && !entry.internal) {
                addresses.add(entry.address);
            }
        }
    }
    return [...addresses];
}

function allowedHosts() {
    const extra = String(process.env.MCP_ALLOWED_HOSTS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    return [
        ...new Set([
            "localhost",
            "127.0.0.1",
            "::1",
            "192.168.29.149",
            ...lanIPv4Addresses(),
            ...extra
        ])
    ];
}

function startStdio() {
    serveStdio(() => createTallyMcpServer());
    console.error("Tally MCP server started (stdio)");
}

function startHttp() {
    if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
        throw new Error(`Invalid PORT "${process.env.PORT}". Use a number between 1 and 65535.`);
    }

    const hosts = allowedHosts();
    const handler = createMcpHandler(() => createTallyMcpServer(), {
        onerror: (error) => {
            console.error("MCP handler error:", error.message);
        }
    });
    const nodeHandler = toNodeHandler(handler, {
        onerror: (error) => {
            console.error("MCP adapter error:", error.message);
        }
    });
    const app = createMcpExpressApp({
        host: HOST,
        allowedHosts: hosts,
        jsonLimit: "2mb"
    });

    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            service: "tally-mcp"
        });
    });

    app.all("/mcp", (req, res) => {
        void nodeHandler(req, res, req.body).catch((error) => {
            console.error("MCP request failed:", error.message);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: "Internal server error"
                    },
                    id: null
                });
            }
        });
    });

    app.use((error, _req, res, next) => {
        if (res.headersSent) {
            next(error);
            return;
        }

        if (error instanceof SyntaxError && "body" in error) {
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: -32700,
                    message: "Parse error"
                },
                id: null
            });
            return;
        }

        console.error("HTTP server error:", error.message);
        res.status(500).json({
            error: "Internal server error"
        });
    });

    const httpServer = app.listen(PORT, HOST, () => {
        const lan = lanIPv4Addresses();
        console.error(`Tally MCP server started (Streamable HTTP)`);
        console.error(`Listening on ${HOST}:${PORT}`);
        console.error(`Health: http://127.0.0.1:${PORT}/health`);
        console.error(`MCP:    http://127.0.0.1:${PORT}/mcp`);
        for (const address of lan) {
            console.error(`LAN MCP: http://${address}:${PORT}/mcp`);
        }
        console.error(`Allowed Host headers: ${hosts.join(", ")}`);
        console.error("Tally remains read-only on TALLY_URL; port 9000 is not exposed.");
    });

    httpServer.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
            console.error(`Port ${PORT} is already in use. Stop the other process or set PORT in .env.`);
        } else {
            console.error(`Could not start HTTP MCP: ${error.message}`);
        }
        process.exit(1);
    });

    const shutdown = async () => {
        console.error("Shutting down Tally MCP HTTP server...");
        try {
            await handler.close();
        } catch (error) {
            console.error("Error while closing MCP handler:", error.message);
        }
        httpServer.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

const useStdio =
    process.argv.includes("--stdio") ||
    String(process.env.MCP_TRANSPORT || "").toLowerCase() === "stdio";

if (useStdio) {
    startStdio();
} else {
    startHttp();
}
