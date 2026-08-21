import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { sendToTally } from "../tally.js";
import { QUERY_RESOURCES, REPORTS } from "./catalog.js";
import { describeTally, isFailure, queryTally, runTallyReport } from "./query.js";

const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
};

const MAX_TOOL_CHARS = 350_000;

function toolText(payload) {
    let body = payload;
    let text = JSON.stringify(body, null, 2);

    while (text.length > MAX_TOOL_CHARS && Array.isArray(body.records) && body.records.length > 5) {
        body = {
            ...body,
            truncated: true,
            returned: Math.floor(body.records.length / 2),
            records: body.records.slice(0, Math.floor(body.records.length / 2)),
            message: "Response truncated. Narrow the date range, add a party filter, or lower limit. Do not invent the omitted rows."
        };
        text = JSON.stringify(body, null, 2);
    }

    return text;
}

function toolResult(payload) {
    const failed = isFailure(payload);
    return {
        content: [
            {
                type: "text",
                text: toolText(payload)
            }
        ],
        ...(failed ? { isError: true } : {})
    };
}

export function createTallyMcpServer() {
    const server = new McpServer({
        name: "tally-mcp",
        version: "1.0.0",
        instructions:
            "Read-only TallyPrime access. Prefer query_tally for companies, ledgers, customers, suppliers, sales, purchases, receipts, payments, outstanding, inventory, and GST. Prefer tally_report for profit and loss, balance sheet, and trial balance. Convert relative dates into YYYY-MM-DD, or pass financialYear such as 24-25. If the loaded company is 24-25, last month means July 2024, not July 2026. Never invent ledgers, balances, invoices, or report figures."
    });

    server.registerTool(
        "get_ledgers",
        {
            description:
                "Get ledgers from the currently loaded TallyPrime company.",

            inputSchema: z.object({})
        },

        async () => {
            const xml = `
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Collection</TYPE>
        <ID>List of Ledgers</ID>
    </HEADER>

    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
        </DESC>
    </BODY>
</ENVELOPE>
`;

            try {
                const response = await sendToTally(xml);

                return {
                    content: [
                        {
                            type: "text",
                            text: response
                        }
                    ]
                };

            } catch (error) {

                return {
                    content: [
                        {
                            type: "text",
                            text: `Tally connection failed: ${error.message}`
                        }
                    ],
                    isError: true
                };
            }
        }
    );

    server.registerTool(
        "tally_describe",
        {
            title: "Describe Tally query layer",
            description:
                "List the Tally resources, voucher types, reports, and filters this read-only MCP can query. Call this before query_tally or tally_report if you are unsure which resource to use.",
            annotations: READ_ONLY_ANNOTATIONS,
            inputSchema: z.object({})
        },
        async () => toolResult(describeTally())
    );

    server.registerTool(
        "query_tally",
        {
            title: "Query TallyPrime data",
            description:
                "Read live TallyPrime data for natural-language accounting questions. Use for companies, ledgers, groups, customers, suppliers, cash, bank, stock, GST, vouchers (sales, purchases, receipts, payments, contra, journals, credit notes, debit notes, day book), and outstanding receivables/payables. Pass financialYear such as 24-25, or fromDate/toDate as YYYY-MM-DD. Use search, minAmount, groupBy, and includeTotals. Returns only real Tally records; never invent missing rows or amounts.",
            annotations: READ_ONLY_ANNOTATIONS,
            inputSchema: z.object({
                resource: z
                    .enum(QUERY_RESOURCES)
                    .describe("What to read from Tally. Examples: sales, purchases, customers, receivables, payables, inventory, vouchers, gst."),
                company: z
                    .string()
                    .optional()
                    .describe("Exact Tally company name. Omit to use the currently loaded company."),
                financialYear: z
                    .string()
                    .optional()
                    .describe("Indian financial year such as 24-25 or 2024-25 (1 Apr to 31 Mar). Use when fromDate/toDate are omitted."),
                fromDate: z
                    .string()
                    .optional()
                    .describe("Period start as YYYY-MM-DD. Omit to use Tally's current company period or financialYear."),
                toDate: z
                    .string()
                    .optional()
                    .describe("Period end as YYYY-MM-DD. Omit to use Tally's current company period or financialYear."),
                voucherType: z
                    .string()
                    .optional()
                    .describe("Voucher class or exact Tally voucher type name, e.g. Sales, Purchase, Receipt, Payment, Contra, Journal, Credit Note, Debit Note."),
                party: z
                    .string()
                    .optional()
                    .describe("Customer, supplier, or ledger name; case-insensitive contains match."),
                search: z
                    .string()
                    .optional()
                    .describe("Search name, party, voucher number, narration, or parent."),
                nameContains: z
                    .string()
                    .optional()
                    .describe("Filter returned names by this substring."),
                parent: z
                    .string()
                    .optional()
                    .describe("Filter by parent group name."),
                minAmount: z
                    .number()
                    .optional()
                    .describe("Minimum absolute amount, e.g. 50000 for payments above ₹50,000."),
                maxAmount: z
                    .number()
                    .optional()
                    .describe("Maximum absolute amount."),
                belowQty: z
                    .number()
                    .optional()
                    .describe("For inventory/stock_items: only items with closing quantity at or below this value."),
                sortBy: z
                    .enum(["name", "amount", "date", "closingBalance", "closingQty"])
                    .optional()
                    .describe("Sort field. Use amount for outstanding, closingQty for stock, date for vouchers."),
                sortDir: z
                    .enum(["asc", "desc"])
                    .optional()
                    .describe("Sort direction. Use desc for 'who owes the most'."),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(500)
                    .optional()
                    .describe("Max rows to return (default 150, max 500)."),
                details: z
                    .boolean()
                    .optional()
                    .describe("If true, ask Tally for voucher ledger and inventory lines."),
                groupBy: z
                    .enum(["party", "month", "voucherType", "parent"])
                    .optional()
                    .describe("Group matching rows and return per-group counts and totals."),
                includeTotals: z
                    .boolean()
                    .optional()
                    .describe("Include count and amount totals for all matches, not just the returned page. Default true."),
                compareFromDate: z
                    .string()
                    .optional()
                    .describe("YYYY-MM-DD start of a second period to compare against fromDate/toDate."),
                compareToDate: z
                    .string()
                    .optional()
                    .describe("YYYY-MM-DD end of a second period to compare against fromDate/toDate.")
            })
        },
        async (args) => {
            try {
                return toolResult(await queryTally(args || {}));
            } catch (error) {
                return toolResult({
                    ok: false,
                    source: "TallyPrime",
                    invented: false,
                    error: error.message,
                    message: "Tally query failed. Do not invent data."
                });
            }
        }
    );

    server.registerTool(
        "tally_report",
        {
            title: "Run a TallyPrime report",
            description:
                "Export a named Tally report as data: profit and loss, balance sheet, trial balance, day book, outstanding, stock summary, stock movements, cash/bank books, registers, GST. Use YYYY-MM-DD for fromDate/toDate. Returns only what Tally exported; never invent report figures.",
            annotations: READ_ONLY_ANNOTATIONS,
            inputSchema: z.object({
                report: z
                    .enum(Object.keys(REPORTS))
                    .describe("Tally report to export, e.g. profit_and_loss, balance_sheet, trial_balance, outstanding_receivables, stock_summary, gst."),
                company: z
                    .string()
                    .optional()
                    .describe("Exact Tally company name. Omit to use the currently loaded company."),
                financialYear: z
                    .string()
                    .optional()
                    .describe("Indian financial year such as 24-25 or 2024-25."),
                fromDate: z
                    .string()
                    .optional()
                    .describe("Period start as YYYY-MM-DD."),
                toDate: z
                    .string()
                    .optional()
                    .describe("Period end as YYYY-MM-DD. Balance sheet is as of this date.")
            })
        },
        async (args) => {
            try {
                return toolResult(await runTallyReport(args || {}));
            } catch (error) {
                return toolResult({
                    ok: false,
                    source: "TallyPrime",
                    invented: false,
                    error: error.message,
                    message: "Tally report failed. Do not invent data."
                });
            }
        }
    );

    return server;
}
