# mcp-connector

Read-only TallyPrime MCP. Cursor asks accounting questions; this server fetches live company data over Tally XML Export. Nothing is created, altered, or deleted in Tally.

Flow:

`Cursor → Streamable HTTP MCP → Node → TallyPrime`

## Setup

Copy `.env.example` to `.env` next to `tally.js` and `server.js`:

```
TALLY_URL=http://192.168.29.149:9000
HOST=0.0.0.0
PORT=3000
```

`TALLY_URL` is the TallyPrime HTTP port on the Tally PC (9000). Do not expose that port to the internet.

```bash
npm install
node server.js
```

Health: `GET http://127.0.0.1:3000/health`  
MCP: `POST http://127.0.0.1:3000/mcp`

STDIO (optional): `node server.js --stdio`

Tally connectivity check: `node test-tally.js`

## Remote Cursor

On another PC on the LAN, add this MCP server (this machine’s LAN IP is `192.168.29.47`):

```json
{
  "mcpServers": {
    "tally": {
      "url": "http://192.168.29.47:3000/mcp"
    }
  }
}
```

Allow inbound TCP 3000 on this PC. Keep Tally port 9000 local.

## Tools

Four tools, not one per report:

| Tool | Purpose |
|---|---|
| `query_tally` | Companies, ledgers, groups, customers, suppliers, cash, bank, stock, GST, vouchers, outstanding |
| `tally_report` | Profit & loss, balance sheet, trial balance, registers, GST and stock reports |
| `tally_describe` | Catalog of resources, filters, and example questions |
| `get_ledgers` | Original smoke test: Tally Collection `List of Ledgers`, raw XML |

Dates should match the loaded Tally financial year. Pass `financialYear` such as `26-27`, or explicit `fromDate` / `toDate` as `YYYY-MM-DD`.

## Layout

```
mcp-connector/
  .env
  tally.js          Tally HTTP client (Export POST)
  server.js         Streamable HTTP MCP
  test-tally.js     Connectivity check
  lib/
    mcp-server.js   Tool registration
    query.js        Read-only query layer
    catalog.js      Resources and reports
    dates.js        Dates and Indian FY
    parse.js        Tally XML → JSON
    xml-build.js    Read-only Export XML
```
