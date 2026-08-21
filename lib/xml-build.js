import { toTallyDate } from "./dates.js";
import { COLLECTION_SPECS } from "./catalog.js";

export function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

export function assertReadOnlyExport(xml) {
    if (/<TALLYREQUEST>\s*Import/i.test(xml)) {
        throw new Error("Refusing to send an Import request. This MCP is read-only.");
    }
}

function staticVariables({ company, fromDate, toDate, explode } = {}) {
    const lines = ["<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"];

    if (company) {
        lines.push(`<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>`);
    }
    if (fromDate) {
        lines.push(`<SVFROMDATE TYPE="Date">${escapeXml(fromDate)}</SVFROMDATE>`);
    }
    if (toDate) {
        lines.push(`<SVTODATE TYPE="Date">${escapeXml(toDate)}</SVTODATE>`);
    }
    if (explode) {
        lines.push("<EXPLODEFLAG>Yes</EXPLODEFLAG>");
    }

    return lines.join("\n                ");
}

function envelope({ type, id, company, fromDate, toDate, explode = false, tdl = "" }) {
    const tallyFrom = fromDate ? toTallyDate(fromDate) : undefined;
    const tallyTo = toDate ? toTallyDate(toDate) : undefined;

    return `<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>${escapeXml(type)}</TYPE>
        <ID>${escapeXml(id)}</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                ${staticVariables({ company, fromDate: tallyFrom, toDate: tallyTo, explode })}
            </STATICVARIABLES>
            ${tdl}
        </DESC>
    </BODY>
</ENVELOPE>
`;
}

function fetchMethods(methods) {
    return `<FETCH>${methods.map((method) => escapeXml(method)).join(", ")}</FETCH>`;
}

function tdlMessage(inner) {
    return `<TDL>
                <TDLMESSAGE>
                    ${inner}
                </TDLMESSAGE>
            </TDL>`;
}

export function buildSimpleCollectionXml(simpleId, options = {}) {
    return envelope({
        type: "Collection",
        id: simpleId,
        company: options.company,
        fromDate: options.fromDate,
        toDate: options.toDate
    });
}

export function buildTdlCollectionXml(spec, options = {}) {
    const { collectionName, type, methods } = spec;
    const filterXml = options.filterFormula
        ? `<FILTER>${escapeXml(options.filterName || "MCP_FILTER")}</FILTER>`
        : "";
    const formulaXml = options.filterFormula
        ? `<SYSTEM TYPE="Formulae" NAME="${escapeXml(options.filterName || "MCP_FILTER")}" ISMODIFY="No">${escapeXml(options.filterFormula)}</SYSTEM>`
        : "";

    const inner = `<COLLECTION NAME="${escapeXml(collectionName)}" ISMODIFY="No" ISFIXED="No" ISINITIALIZE="Yes" ISOPTION="No" ISINTERNAL="No">
                        <TYPE>${escapeXml(type)}</TYPE>
                        ${fetchMethods(methods)}
                        ${filterXml}
                    </COLLECTION>
                    ${formulaXml}`;

    return envelope({
        type: "Collection",
        id: collectionName,
        company: options.company,
        fromDate: options.fromDate,
        toDate: options.toDate,
        tdl: tdlMessage(inner)
    });
}

export function buildMasterCollectionXml(kind, options = {}) {
    const spec = COLLECTION_SPECS[kind];
    if (!spec) {
        throw new Error(`Unknown master collection: ${kind}`);
    }
    return buildTdlCollectionXml(spec, options);
}

export function buildVoucherCollectionXml(options = {}) {
    const methods = [
        "Date",
        "VoucherNumber",
        "VoucherTypeName",
        "PartyLedgerName",
        "Amount",
        "Narration",
        "Reference",
        "MasterID"
    ];

    if (options.details) {
        methods.push("AllLedgerEntries.List", "InventoryEntries.List");
    }

    let filterFormula;
    if (options.voucherTypeNames?.length) {
        filterFormula = options.voucherTypeNames
            .map((name) => `$VoucherTypeName = "${String(name).replace(/"/g, "")}"`)
            .join(" OR ");
    }

    return buildTdlCollectionXml(
        {
            collectionName: "MCP_VOUCHERS",
            type: "Voucher",
            methods
        },
        {
            company: options.company,
            fromDate: options.fromDate,
            toDate: options.toDate,
            filterFormula,
            filterName: "MCP_VCH_FILTER"
        }
    );
}

export function buildReportXml(reportId, options = {}) {
    return envelope({
        type: "Data",
        id: reportId,
        company: options.company,
        fromDate: options.fromDate,
        toDate: options.toDate,
        explode: true
    });
}

export function getCollectionSpec(kind) {
    return COLLECTION_SPECS[kind];
}
