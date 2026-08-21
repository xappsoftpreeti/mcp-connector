import { XMLParser } from "fast-xml-parser";
import { toIsoDate } from "./dates.js";

const OBJECT_TAGS = new Set([
    "LEDGER",
    "GROUP",
    "COMPANY",
    "VOUCHER",
    "STOCKITEM",
    "STOCKGROUP",
    "GODOWN",
    "VOUCHERTYPE",
    "UNIT",
    "COSTCENTRE",
    "CURRENCY",
    "TALLYMESSAGE",
    "DSPACCNAME",
    "DSPACCINFO",
    "BSNAME",
    "PLNAME",
    "SSSTOCKNAME"
]);

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    ignoreDeclaration: true,
    removeNSPrefix: true,
    transformTagName: (tag) => String(tag).toUpperCase(),
    isArray: (name, _jpath, _isLeaf, isAttribute) => {
        if (isAttribute) {
            return false;
        }
        const upper = String(name).toUpperCase();
        return OBJECT_TAGS.has(upper) || upper.endsWith(".LIST");
    }
});

export function sanitizeXml(xml) {
    return String(xml).replace(
        /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/gi,
        "&amp;"
    );
}

export function parseAmount(value) {
    if (value == null || value === "") {
        return null;
    }

    const text = String(value).replace(/,/g, "").trim();
    if (!text) {
        return null;
    }

    const cr = /cr$/i.test(text);
    const dr = /dr$/i.test(text);
    const numeric = Number.parseFloat(text.replace(/[^\d.-]/g, ""));
    if (Number.isNaN(numeric)) {
        return null;
    }

    return {
        raw: String(value).trim(),
        value: numeric,
        abs: Math.abs(numeric),
        drcr: cr ? "Cr" : dr ? "Dr" : numeric < 0 ? "Cr" : "Dr"
    };
}

function firstDefined(object, keys) {
    for (const key of keys) {
        if (object[key] != null && object[key] !== "") {
            return object[key];
        }
    }
    return undefined;
}

function normalizeKey(key) {
    return String(key)
        .replace(/^@_/, "")
        .replace(/\.LIST$/i, "")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase();
}

function asScalar(value) {
    if (value == null || value === "") {
        return undefined;
    }
    if (typeof value !== "object") {
        return String(value).trim();
    }
    if (Array.isArray(value)) {
        const scalars = value.map(asScalar).filter((item) => item != null);
        if (scalars.length === 0) {
            return undefined;
        }
        return scalars.length === 1 ? scalars[0] : scalars;
    }
    if ("#text" in value && Object.keys(value).every((key) => key === "#text" || key.startsWith("@_"))) {
        return value["#text"] != null ? String(value["#text"]).trim() : value["@_NAME"];
    }
    if ("@_NAME" in value && Object.keys(value).every((key) => key.startsWith("@_"))) {
        return value["@_NAME"];
    }
    return undefined;
}

function flatten(node, prefix = "", output = {}) {
    if (node == null) {
        return output;
    }

    if (typeof node !== "object") {
        if (prefix) {
            output[prefix] = String(node).trim();
        }
        return output;
    }

    if (Array.isArray(node)) {
        const nested = [];
        for (const item of node) {
            const scalar = asScalar(item);
            if (scalar != null && typeof scalar !== "object") {
                nested.push(scalar);
            } else if (item && typeof item === "object") {
                const child = {};
                flatten(item, "", child);
                nested.push(child);
            }
        }
        if (nested.length) {
            output[prefix || "items"] = nested;
        }
        return output;
    }

    for (const [key, value] of Object.entries(node)) {
        if (key === "#text") {
            const dest = prefix || "value";
            output[dest] = String(value).trim();
            continue;
        }

        const name = key.startsWith("@_") ? key.slice(2).toLowerCase() : normalizeKey(key);
        const path = prefix ? `${prefix}.${name}` : name;
        const scalar = asScalar(value);

        if (scalar != null && (typeof scalar !== "object" || (Array.isArray(scalar) && scalar.every((item) => typeof item !== "object")))) {
            output[path] = scalar;
        } else if (value && typeof value === "object") {
            flatten(value, path, output);
        }
    }

    return output;
}

function extractErrors(xml, parsed) {
    const errors = [];
    const matches = String(xml).matchAll(/<LINEERROR\b[^>]*>([\s\S]*?)<\/LINEERROR>/gi);

    for (const match of matches) {
        const text = match[1].replace(/<[^>]+>/g, "").trim();
        if (text) {
            errors.push(text);
        }
    }

    const walk = (node) => {
        if (!node || typeof node !== "object") {
            return;
        }
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key.toUpperCase() === "LINEERROR" || key.toUpperCase() === "ERROR") {
                const text = asScalar(value);
                if (text) {
                    errors.push(String(text));
                }
            } else {
                walk(value);
            }
        }
    };

    walk(parsed);
    return [...new Set(errors)];
}

function asArray(value) {
    if (value == null) {
        return null;
    }
    return Array.isArray(value) ? value : [value];
}

function zipParallelReportLines(node, records) {
    const names = asArray(node.DSPACCNAME || node.BSNAME || node.PLNAME || node.SSSTOCKNAME);
    const amounts = asArray(node.DSPACCINFO || node.BSAMT || node.PLAMT || node.SSAMT);

    if (!names || !amounts || names.length !== amounts.length) {
        return false;
    }

    for (let index = 0; index < names.length; index += 1) {
        records.push({
            _tag: "REPORTLINE",
            ...flatten(names[index]),
            ...flatten(amounts[index])
        });
    }

    return true;
}

function collectRecords(node, records = []) {
    if (node == null) {
        return records;
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            collectRecords(item, records);
        }
        return records;
    }

    if (typeof node !== "object") {
        return records;
    }

    if (zipParallelReportLines(node, records)) {
        return records;
    }

    const directKeys = Object.keys(node).map((key) => key.toUpperCase());
    if (directKeys.some((key) => ["DSPDISPNAME", "BSNAME", "PLNAME", "SSNAME"].includes(key))) {
        records.push({ _tag: "REPORTLINE", ...flatten(node) });
    }

    for (const [key, value] of Object.entries(node)) {
        const upper = key.toUpperCase();
        if (upper === "CMPINFO") {
            continue;
        }

        if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) {
            for (const item of value) {
                if (item && typeof item === "object" && !Array.isArray(item)) {
                    records.push({ _tag: upper.replace(/\.LIST$/, ""), ...flatten(item) });
                }
            }
        } else if (OBJECT_TAGS.has(upper) && value && typeof value === "object" && !Array.isArray(value)) {
            records.push({ _tag: upper, ...flatten(value) });
        } else {
            collectRecords(value, records);
        }
    }

    return records;
}

function extractInterleavedReportLines(xml) {
    const source = String(xml);
    const tag = ["DSPACCNAME", "BSNAME", "PLNAME"].find((name) =>
        new RegExp(`<${name}\\b`, "i").test(source)
    );
    if (!tag) {
        return [];
    }

    const parts = source.split(new RegExp(`<${tag}\\b[^>]*>`, "i"));
    const lines = [];

    for (let index = 1; index < parts.length; index += 1) {
        const chunk = parts[index];
        const name =
            chunk.match(/<DSPDISPNAME\b[^>]*>([^<]*)<\/DSPDISPNAME>/i)?.[1]?.trim() ||
            chunk.match(/<NAME\b[^>]*>([^<]*)<\/NAME>/i)?.[1]?.trim() ||
            chunk.match(/^([^<]{1,120})</)?.[1]?.trim();
        const sub = chunk.match(/<PLSUBAMT\b[^>]*>([^<]*)<\/PLSUBAMT>/i)?.[1];
        const main = chunk.match(/<BSMAINAMT\b[^>]*>([^<]*)<\/BSMAINAMT>/i)?.[1];
        const debit = chunk.match(/<DSPACCDRAMT\b[^>]*>([^<]*)<\/DSPACCDRAMT>/i)?.[1]
            || chunk.match(/<DSPDRAMTA\b[^>]*>([^<]*)<\/DSPDRAMTA>/i)?.[1];
        const credit = chunk.match(/<DSPACCCRAMT\b[^>]*>([^<]*)<\/DSPACCCRAMT>/i)?.[1]
            || chunk.match(/<DSPCRAMTA\b[^>]*>([^<]*)<\/DSPCRAMTA>/i)?.[1];
        const parsedMain = parseAmount(main);
        const parsedSub = parseAmount(sub);
        const parsedDebit = parseAmount(debit);
        const parsedCredit = parseAmount(credit);
        const amount = parsedMain || parsedSub || parsedDebit || parsedCredit;

        if (name || amount) {
            lines.push({
                name: name || undefined,
                debit: parsedDebit?.value ?? null,
                credit: parsedCredit?.value ?? null,
                amount: amount?.value ?? null,
                mainAmount: parsedMain?.value ?? null,
                subAmount: parsedSub?.value ?? null
            });
        }
    }

    return lines;
}

function collectReportLines(flatRecords) {
    const lines = [];

    for (const record of flatRecords) {
        const name = firstDefined(record, [
            "name",
            "dspdispname",
            "dspaccname.dspdispname",
            "bsname",
            "plname",
            "ssname",
            "ledgername",
            "dspname"
        ]);
        const debit = parseAmount(
            firstDefined(record, ["dspaccdramt", "dramt", "debit", "bsamt.bsdebitamount"])
        );
        const credit = parseAmount(
            firstDefined(record, ["dspacccramt", "cramt", "credit", "bsamt.bscreditamount"])
        );
        const amount = parseAmount(
            firstDefined(record, [
                "bsmainamt",
                "plsubamt",
                "dspcramta",
                "dspdramta",
                "dspclamta",
                "amount",
                "closingbalance",
                "plamt",
                "bsamt",
                "ssamt",
                "dspaccamt"
            ])
        );

        if (name || debit || credit || amount) {
            const subAmount = parseAmount(record.plsubamt);
            const mainAmount = parseAmount(record.bsmainamt);
            lines.push({
                name,
                debit: debit?.value ?? null,
                credit: credit?.value ?? null,
                amount: amount?.value ?? debit?.value ?? credit?.value ?? null,
                mainAmount: mainAmount?.value ?? null,
                subAmount: subAmount?.value ?? null,
                fields: compactScalars(record)
            });
        }
    }

    return lines;
}

function usefulFields(extra) {
    const output = {};
    for (const [key, value] of Object.entries(extra)) {
        if (key.endsWith(".type")) {
            continue;
        }
        if (/^(is|as)[a-z]/.test(key) && /^(Yes|No)$/i.test(String(value))) {
            continue;
        }
        if (
            [
                "vouchertypename",
                "partyledgername",
                "numberingstyle",
                "persistedview",
                "objview",
                "voucherkey",
                "voucherretainkey",
                "reuseholeid",
                "vouchernumberseries"
            ].includes(key)
        ) {
            continue;
        }
        output[key] = value;
    }
    return output;
}

function compactScalars(record) {
    const output = {};
    for (const [key, value] of Object.entries(record)) {
        if (key === "_tag") {
            continue;
        }
        if (value == null || value === "") {
            continue;
        }
        if (typeof value === "object") {
            continue;
        }
        output[key] = value;
    }
    return output;
}

function amountField(flat, key) {
    if (flat[key] != null && flat[key] !== "") {
        return parseAmount(flat[key]);
    }
    if (String(flat[`${key}.type`] || "").toLowerCase() === "amount") {
        return { raw: "", value: 0, abs: 0, drcr: "Dr" };
    }
    return null;
}

function normalizeRecord(flat) {
    const tag = String(flat._tag || "").toUpperCase();
    const isStock = tag === "STOCKITEM";
    const closingBalance = amountField(flat, "closingbalance");
    const openingBalance = amountField(flat, "openingbalance");
    const closingValue = amountField(flat, "closingvalue");
    const amount = amountField(flat, "amount") || closingBalance || closingValue;

    const record = {
        name: firstDefined(flat, ["name", "dspdispname", "ledgername"]),
        parent: flat.parent,
        date: toIsoDate(flat.date) || flat.date,
        voucherNumber: flat.vouchernumber,
        voucherType: firstDefined(flat, ["vouchertypename", "vchtype"]),
        party: flat.partyledgername,
        narration: flat.narration,
        reference: flat.reference,
        gstin: firstDefined(flat, ["partygstin", "gstin"]),
        gstRegistrationType: flat.gstregistrationtype,
        state: flat.ledstatename,
        email: flat.email,
        phone: flat.ledgerphone,
        guid: flat.guid,
        masterId: flat.masterid,
        baseUnits: flat.baseunits,
        openingBalance: openingBalance?.value ?? null,
        closingBalance: closingBalance?.value ?? null,
        closingValue: closingValue?.value ?? null,
        amount: amount?.value ?? null,
        amountAbs: amount?.abs ?? null
    };

    if (isStock) {
        record.closingQty = closingBalance?.value ?? null;
    }

    const extra = usefulFields(compactScalars(flat));
    for (const key of Object.keys(record)) {
        delete extra[key.toLowerCase()];
    }

    if (Object.keys(extra).length) {
        record.fields = extra;
    }

    for (const [key, value] of Object.entries(record)) {
        if (value == null || value === "") {
            delete record[key];
        }
    }

    return record;
}

export function parseTallyResponse(xml) {
    if (xml == null || String(xml).trim() === "") {
        return {
            ok: false,
            error: "Tally returned an empty response",
            records: []
        };
    }

    const raw = String(xml);
    let parsed;

    try {
        parsed = parser.parse(sanitizeXml(raw));
    } catch (error) {
        return {
            ok: false,
            error: `Could not parse Tally XML: ${error.message}`,
            records: [],
            rawSnippet: raw.slice(0, 2000)
        };
    }

    const errors = extractErrors(raw, parsed);
    const currentCompany = String(raw).match(
        /<SVCURRENTCOMPANY\b[^>]*>([^<]+)<\/SVCURRENTCOMPANY>/i
    )?.[1]?.trim();
    const collected = collectRecords(parsed);
    const records = collected.map(normalizeRecord).filter((record) => Object.keys(record).length > 0);
    const xmlReportLines = extractInterleavedReportLines(raw);
    const reportLines = xmlReportLines.length ? xmlReportLines : collectReportLines(collected);

    if (errors.length && records.length === 0 && reportLines.length === 0) {
        return {
            ok: false,
            error: errors.join("; "),
            records: [],
            reportLines: [],
            currentCompany
        };
    }

    return {
        ok: true,
        records,
        reportLines,
        currentCompany,
        tallyErrors: errors.length ? errors : undefined
    };
}
