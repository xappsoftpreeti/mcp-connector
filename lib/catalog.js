export const ROOT_GROUPS = {
    customers: ["Sundry Debtors"],
    suppliers: ["Sundry Creditors"],
    cash: ["Cash-in-Hand"],
    bank: ["Bank Accounts", "Bank OD A/c", "Bank OCC A/c"],
    gst: ["Duties & Taxes"],
    sales_accounts: ["Sales Accounts"],
    purchase_accounts: ["Purchase Accounts"],
    stock: ["Stock-in-Hand"]
};

export const VOUCHER_TYPE_ALIASES = {
    sales: ["Sales"],
    purchases: ["Purchase"],
    receipts: ["Receipt"],
    payments: ["Payment"],
    contra: ["Contra"],
    journals: ["Journal"],
    credit_notes: ["Credit Note"],
    debit_notes: ["Debit Note"],
    stock_journal: ["Stock Journal", "Physical Stock", "Manufacturing Journal"]
};

export const VOUCHER_RESOURCES = {
    vouchers: null,
    day_book: null,
    sales: "sales",
    purchases: "purchases",
    receipts: "receipts",
    payments: "payments",
    contra: "contra",
    journals: "journals",
    credit_notes: "credit_notes",
    debit_notes: "debit_notes",
    stock_movements: "stock_journal"
};

export const MASTER_RESOURCES = [
    "companies",
    "ledgers",
    "groups",
    "customers",
    "suppliers",
    "cash",
    "bank",
    "stock_items",
    "inventory",
    "stock_groups",
    "godowns",
    "voucher_types",
    "gst"
];

export const RESOURCE_ALIASES = {
    receivables: "outstanding_receivables",
    payables: "outstanding_payables",
    debtors: "customers",
    creditors: "suppliers"
};

export const QUERY_RESOURCES = [
    ...MASTER_RESOURCES,
    ...Object.keys(VOUCHER_RESOURCES),
    "outstanding_receivables",
    "outstanding_payables",
    ...Object.keys(RESOURCE_ALIASES)
];

export function resolveResource(resource) {
    const key = String(resource || "").toLowerCase();
    return RESOURCE_ALIASES[key] || key;
}

export const COLLECTION_SPECS = {
    companies: {
        collectionName: "MCP_COMPANIES",
        type: "Company",
        simpleId: "List of Companies",
        preferSimple: true,
        methods: ["Name", "StartingFrom", "GUID"]
    },
    ledgers: {
        collectionName: "MCP_LEDGERS",
        type: "Ledger",
        simpleId: "List of Ledgers",
        methods: [
            "Name",
            "Parent",
            "OpeningBalance",
            "ClosingBalance",
            "PartyGSTIN",
            "GSTRegistrationType",
            "LedStateName",
            "Email",
            "LedgerPhone"
        ]
    },
    groups: {
        collectionName: "MCP_GROUPS",
        type: "Group",
        simpleId: "List of Groups",
        methods: ["Name", "Parent"]
    },
    stock_items: {
        collectionName: "MCP_STOCKITEMS",
        type: "Stock Item",
        simpleId: "List of StockItems",
        methods: [
            "Name",
            "Parent",
            "ClosingBalance",
            "ClosingValue",
            "OpeningBalance",
            "BaseUnits"
        ]
    },
    stock_groups: {
        collectionName: "MCP_STOCKGROUPS",
        type: "Stock Group",
        simpleId: "List of StockGroups",
        methods: ["Name", "Parent"]
    },
    godowns: {
        collectionName: "MCP_GODOWNS",
        type: "Godown",
        simpleId: "List of Godowns",
        methods: ["Name", "Parent"]
    },
    voucher_types: {
        collectionName: "MCP_VOUCHERTYPES",
        type: "Voucher Type",
        simpleId: "List of Voucher Types",
        methods: ["Name", "Parent"]
    }
};

export const REPORTS = {
    profit_and_loss: {
        ids: ["Profit and Loss"],
        description: "Profit and Loss account for a period"
    },
    balance_sheet: {
        ids: ["Balance Sheet"],
        description: "Balance Sheet as of the toDate (or current period)"
    },
    trial_balance: {
        ids: ["Trial Balance"],
        description: "Trial Balance"
    },
    day_book: {
        ids: ["Day Book"],
        description: "Day Book of all vouchers in the period"
    },
    outstanding_receivables: {
        ids: ["Bills Receivable", "Ledger Outstandings"],
        description: "Outstanding receivables / bills receivable",
        fromLedgers: "customers"
    },
    outstanding_payables: {
        ids: ["Bills Payable", "Ledger Outstandings"],
        description: "Outstanding payables / bills payable",
        fromLedgers: "suppliers"
    },
    stock_summary: {
        ids: ["Stock Summary"],
        description: "Stock summary with quantities and values"
    },
    stock_movements: {
        ids: ["Movement Analysis", "Stock Vouchers"],
        description: "Stock movement analysis"
    },
    cash_book: {
        ids: ["Cash Book"],
        description: "Cash Book"
    },
    bank_book: {
        ids: ["Bank Book"],
        description: "Bank Book"
    },
    sales_register: {
        ids: ["Sales Register"],
        description: "Sales Register"
    },
    purchase_register: {
        ids: ["Purchase Register"],
        description: "Purchase Register"
    },
    receipt_register: {
        ids: ["Receipt Register"],
        description: "Receipt Register"
    },
    payment_register: {
        ids: ["Payment Register"],
        description: "Payment Register"
    },
    journal_register: {
        ids: ["Journal Register"],
        description: "Journal Register"
    },
    gst: {
        ids: ["GSTR-3B", "GST Returns", "GSTR1"],
        description: "GST / tax report as exported by Tally"
    },
    ratio_analysis: {
        ids: ["Ratio Analysis"],
        description: "Ratio Analysis"
    }
};

export const DEFAULT_LIMIT = 150;
export const MAX_LIMIT = 500;

export function describeCatalog() {
    return {
        source: "TallyPrime",
        readOnly: true,
        invented: false,
        instructions: [
            "This MCP only reads TallyPrime. It cannot create, alter, or delete data.",
            "Never invent ledgers, balances, invoices, or report figures.",
            "Convert natural-language dates such as 'last month' into YYYY-MM-DD before calling tools.",
            "If the loaded Tally company is an older financial year, use financialYear (e.g. 24-25) or dates inside that year. Example: company 24-25 loaded in Aug 2026 means July 2024, not July 2026.",
            "Use query_tally with includeTotals and groupBy for questions like total sales, top customers, or payments by month.",
            "For comparisons, pass fromDate/toDate plus compareFromDate/compareToDate, or call query_tally twice.",
            "If Tally returns no records or an error, say so. Do not guess."
        ],
        tools: {
            query_tally: "Masters, parties, inventory, vouchers, outstanding, GST ledgers",
            tally_report: "Named Tally reports: P&L, balance sheet, trial balance, registers, GST, stock",
            tally_describe: "This catalog",
            get_ledgers: "Original smoke-test tool; raw ledger XML"
        },
        resources: QUERY_RESOURCES,
        voucherTypeAliases: Object.keys(VOUCHER_TYPE_ALIASES),
        reports: Object.fromEntries(
            Object.entries(REPORTS).map(([key, value]) => [key, value.description])
        ),
        filters: {
            company: "Exact Tally company name. Omit to use the currently loaded company.",
            financialYear: "Indian FY such as 24-25 or 2024-25 (1 Apr to 31 Mar). Used when fromDate/toDate are omitted.",
            fromDate: "YYYY-MM-DD",
            toDate: "YYYY-MM-DD",
            search: "Matches name, party, voucher number, narration, or parent",
            groupBy: "party | month | voucherType | parent",
            includeTotals: "Include count and amount totals (default true)",
            compareFromDate: "YYYY-MM-DD start of a second period to compare",
            compareToDate: "YYYY-MM-DD end of a second period to compare",
            voucherType: "Sales, Purchase, Receipt, Payment, Contra, Journal, Credit Note, Debit Note, or a custom Tally voucher type name",
            party: "Customer/supplier/ledger name; case-insensitive contains match",
            nameContains: "Filter records by name",
            parent: "Filter by parent group",
            minAmount: "Minimum absolute amount",
            maxAmount: "Maximum absolute amount",
            belowQty: "Stock items with closing quantity at or below this value",
            sortBy: "name | amount | date | closingBalance | closingQty",
            sortDir: "asc | desc",
            limit: `1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}`,
            details: "If true, include voucher ledger/inventory lines when Tally returns them"
        },
        examples: [
            {
                question: "What were my sales last month?",
                tool: "query_tally",
                args: {
                    resource: "sales",
                    fromDate: "YYYY-MM-01",
                    toDate: "YYYY-MM-last-day"
                }
            },
            {
                question: "Who owes us the most?",
                tool: "query_tally",
                args: { resource: "outstanding_receivables", sortBy: "amount", sortDir: "desc" }
            },
            {
                question: "Show purchases from ABC Ltd.",
                tool: "query_tally",
                args: { resource: "purchases", party: "ABC Ltd." }
            },
            {
                question: "Show payments above 50000.",
                tool: "query_tally",
                args: { resource: "payments", minAmount: 50000 }
            },
            {
                question: "What is my current profit?",
                tool: "tally_report",
                args: { report: "profit_and_loss" }
            },
            {
                question: "What were my sales in FY 24-25?",
                tool: "query_tally",
                args: { resource: "sales", financialYear: "24-25", includeTotals: true }
            },
            {
                question: "Compare July 2024 sales with June 2024.",
                tool: "query_tally",
                args: {
                    resource: "sales",
                    fromDate: "2024-07-01",
                    toDate: "2024-07-31",
                    compareFromDate: "2024-06-01",
                    compareToDate: "2024-06-30"
                }
            },
            {
                question: "Which products are low in stock?",
                tool: "query_tally",
                args: { resource: "inventory", sortBy: "closingQty", sortDir: "asc" }
            }
        ]
    };
}
