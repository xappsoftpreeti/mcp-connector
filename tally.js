import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load .env from the same folder as this file (mcp-connector)
dotenv.config({
    path: path.join(__dirname, ".env")
});

const TALLY_URL = process.env.TALLY_URL;

if (!TALLY_URL) {
    throw new Error(
        `TALLY_URL is missing. Expected .env at: ${path.join(__dirname, ".env")}`
    );
}

export async function sendToTally(xml) {
    return new Promise((resolve, reject) => {
        const url = new URL(TALLY_URL);

        const options = {
            hostname: url.hostname,
            port: url.port || 80,
            path: "/",
            method: "POST",
            headers: {
                "Content-Type": "text/xml; charset=utf-8",
                "Content-Length": Buffer.byteLength(xml)
            }
        };

        const request = http.request(options, (response) => {
            let data = "";

            response.setEncoding("utf8");

            response.on("data", (chunk) => {
                data += chunk;
            });

            response.on("end", () => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(
                        new Error(
                            `Tally returned HTTP ${response.statusCode}: ${data}`
                        )
                    );
                }
            });
        });

        request.on("error", (error) => {
            reject(
                new Error(
                    `Could not connect to Tally at ${TALLY_URL}: ${error.message}`
                )
            );
        });

        request.write(xml);
        request.end();
    });  
}