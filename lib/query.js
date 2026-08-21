import { sendToTally } from "../tally.js";
import {
    COLLECTION_SPECS,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    REPORTS,
    ROOT_GROUPS,
    VOUCHER_RESOURCES,
    VOUCHER_TYPE_ALIASES,
    describeCatalog,
    resolveResource
} from "./catalog.js";
import {
    assertReadOnlyExport,
    buildMasterCollectionXml,
    buildReportXml,
    buildSimpleCollectionXml,
    buildVoucherCollectionXml
} from "./xml-build.js";
import { parseTallyResponse } from "./parse.js";
import { applyPeriod, defaultVoucherDateRange } from "./dates.js";

const DATA_NOTE =
    "Figures below came from TallyPrime. Missing fields were not in Tally's response. Do not invent values.";

async function exportXml(xml) {
    assertReadOnlyExport(xml);
    const raw = await sendToTally(xml);
    return parseTallyResponse(raw);
}

function clampLimit(limit) {
    const value = Number(limit);
    if (!Number.isFinite(value)) {
        return DEFAULT_LIMIT;
    }
    return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

function includesText(value, needle) {
    if (!needle) {
        return true;
    }
    if (value == null) {
        return false;
    }
    return String(value).toLowerCase().includes(String(needle).toLowerCase());
}

function buildGroupIndex(groups) {
    const byName = new Map();
    for (const group of groups) {
        if (group.name) {
            byName.set(String(group.name).toLowerCase(), group);
        }
    }
    return byName;
}

function parentChain(parentName, groupsByName) {
    const chain = [];
    let current = parentName;
    const seen = new Set();

    while (current) {
        const key = String(current).toLowerCase();
        if (seen.has(key)) {
            break;
        }
        seen.add(key);
        chain.push(key);
        current = groupsByName.get(key)?.parent;
    }

    return chain;
}

function isUnderRoots(record, rootNames, groupsByName) {
    const roots = rootNames.map((name) => name.toLowerCase());
    const chain = parentChain(record.parent, groupsByName);
    if (record.parent) {
        chain.unshift(String(record.parent).toLowerCase());
    }
    if (record.name) {
        chain.push(String(record.name).toLowerCase());
    }
    return chain.some((name) => roots.includes(name));
}

function amountOf(record) {
    const value = record.amountAbs ?? Math.abs(record.amount ?? record.closingBalance ?? record.closingValue ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function round2(value) {
    return Math.round(Number(value) * 100) / 100;
}

function summarize(records) {
    let signedTotal = 0;
    let absoluteTotal = 0;
    let rowsWithAmount = 0;
    let minDate;
    let maxDate;

    for (const record of records) {
        const signed = Number(record.amount ?? record.closingBalance ?? 0);
        if (record.amount != null || record.closingBalance != null) {
            signedTotal += signed;
            absoluteTotal += amountOf(record);
            rowsWithAmount += 1;
        }
        if (record.date) {
            if (!minDate || record.date < minDate) {
                minDate = record.date;
            }
            if (!maxDate || record.date > maxDate) {
                maxDate = record.date;
            }
        }
    }

    return {
        count: records.length,
        rowsWithAmount,
        signedTotal: round2(signedTotal),
        absoluteTotal: round2(absoluteTotal),
        minDate,
        maxDate
    };
}

function groupKey(record, groupBy) {
    switch (String(groupBy || "")) {
        case "party":
            return record.party || record.name || "(none)";
        case "voucherType":
            return record.voucherType || "(none)";
        case "parent":
            return record.parent || "(none)";
        case "month":
            return record.date ? String(record.date).slice(0, 7) : "(none)";
        default:
            return null;
    }
}

function groupRecords(records, groupBy) {
    const mode = String(groupBy || "");
    if (!["party", "voucherType", "parent", "month"].includes(mode)) {
        return undefined;
    }

    const buckets = new Map();
    for (const record of records) {
        const key = groupKey(record, mode);
        if (!buckets.has(key)) {
            buckets.set(key, []);
        }
        buckets.get(key).push(record);
    }

    return [...buckets.entries()]
        .map(([key, rows]) => ({
            key,
            ...summarize(rows)
        }))
        .sort((left, right) => right.absoluteTotal - left.absoluteTotal);
}

function attachAnalytics(records, filters, extra = {}) {
    const includeTotals = filters.includeTotals !== false;
    const grouped = groupRecords(records, filters.groupBy);

    return {
        ...extra,
        ...(includeTotals ? { summary: summarize(records) } : {}),
        ...(grouped ? { groups: grouped } : {})
    };
}

function applyRecordFilters(records, filters = {}) {
    return records.filter((record) => {
        if (filters.search) {
            const haystack = [
                record.name,
                record.party,
                record.voucherNumber,
                record.narration,
                record.parent,
                record.reference
            ];
            if (!haystack.some((value) => includesText(value, filters.search))) {
                return false;
            }
        }
        if (filters.nameContains && !includesText(record.name, filters.nameContains)) {
            return false;
        }
        if (filters.parent && !includesText(record.parent, filters.parent)) {
            return false;
        }
        if (filters.party && !includesText(record.party || record.name, filters.party)) {
            return false;
        }
        if (filters.voucherType && !includesText(record.voucherType, filters.voucherType)) {
            return false;
        }
        if (filters.minAmount != null && amountOf(record) < Number(filters.minAmount)) {
            return false;
        }
        if (filters.maxAmount != null && amountOf(record) > Number(filters.maxAmount)) {
            return false;
        }
        if (filters.belowQty != null) {
            const qty = record.closingQty ?? record.closingBalance;
            if (qty == null || Number(qty) > Number(filters.belowQty)) {
                return false;
            }
        }
        if (filters.nonZero) {
            if (amountOf(record) === 0) {
                return false;
            }
        }
        return true;
    });
}

function sortRecords(records, sortBy, sortDir) {
    if (!sortBy) {
        return records;
    }

    const direction = String(sortDir || "asc").toLowerCase() === "desc" ? -1 : 1;
    const key = String(sortBy);

    const copy = [...records];
    copy.sort((left, right) => {
        const pick = (record) => {
            switch (key) {
                case "amount":
                case "closingBalance":
                    return amountOf(record);
                case "closingQty":
                    return Number(record.closingQty ?? record.closingBalance ?? 0);
                case "date":
                    return record.date || "";
                case "name":
                default:
                    return String(record.name || record.party || "").toLowerCase();
            }
        };

        const a = pick(left);
        const b = pick(right);
        if (typeof a === "number" && typeof b === "number") {
            return (a - b) * direction;
        }
        return String(a).localeCompare(String(b)) * direction;
    });
    return copy;
}

function paginate(records, limit, extra = {}) {
    const capped = clampLimit(limit);
    return {
        ...extra,
        totalMatched: records.length,
        returned: Math.min(capped, records.length),
        truncated: records.length > capped,
        records: records.slice(0, capped)
    };
}

function successPayload(body) {
    return {
        ok: true,
        source: "TallyPrime",
        invented: false,
        readOnly: true,
        note: DATA_NOTE,
        ...body
    };
}

function failurePayload(error, extra = {}) {
    return {
        ok: false,
        source: "TallyPrime",
        invented: false,
        readOnly: true,
        error: error.message || String(error),
        message: "Tally request failed. Do not invent data.",
        ...extra
    };
}

async function exportCollection(kind, options = {}) {
    const spec = COLLECTION_SPECS[kind];
    if (!spec) {
        throw new Error(`Unsupported collection: ${kind}`);
    }

    const attempts = spec.preferSimple
        ? [
            () => exportXml(buildSimpleCollectionXml(spec.simpleId, options)),
            () => exportXml(buildMasterCollectionXml(kind, options))
        ]
        : [
            () => exportXml(buildMasterCollectionXml(kind, options)),
            () => exportXml(buildSimpleCollectionXml(spec.simpleId, options))
        ];

    let lastError;
    for (const attempt of attempts) {
        const result = await attempt();
        if (result.ok) {
            return result;
        }
        lastError = result.error;
    }

    return { ok: false, error: lastError || `Tally returned no ${kind} data`, records: [] };
}

async function loadGroupsAndLedgers(company) {
    const [groupResult, ledgerResult] = await Promise.all([
        exportCollection("groups", { company }),
        exportCollection("ledgers", { company })
    ]);

    if (!ledgerResult.ok) {
        throw new Error(ledgerResult.error || "Could not read ledgers from Tally");
    }

    return {
        groups: groupResult.records || [],
        ledgers: ledgerResult.records || [],
        groupsOk: groupResult.ok
    };
}

function classifyLedgers(ledgers, groups, rootKey) {
    const groupsByName = buildGroupIndex(groups);
    const roots = ROOT_GROUPS[rootKey];
    if (!roots) {
        return ledgers;
    }
    return ledgers.filter((ledger) => isUnderRoots(ledger, roots, groupsByName));
}

async function queryClassifiedLedgers(rootKey, filters) {
    const { groups, ledgers, groupsOk } = await loadGroupsAndLedgers(filters.company);
    const classified = classifyLedgers(ledgers, groups, rootKey);
    const filtered = applyRecordFilters(classified, filters);

    return successPayload({
        resource: rootKey,
        company: filters.company || "currently loaded company",
        nestedGroupsUsed: groupsOk,
        ...attachAnalytics(filtered, filters),
        ...paginate(
            sortRecords(filtered, filters.sortBy || "name", filters.sortDir || "asc"),
            filters.limit
        )
    });
}

async function resolveVoucherTypeNames(requestedType, company) {
    if (!requestedType) {
        return [];
    }

    const key = String(requestedType).toLowerCase().replace(/\s+/g, "_");
    const aliases = VOUCHER_TYPE_ALIASES[key] || VOUCHER_TYPE_ALIASES[`${key}s`] || [requestedType];
    const typesResult = await exportCollection("voucher_types", { company });
    const types = typesResult.records || [];

    if (!types.length) {
        return aliases;
    }

    const matched = types
        .filter((type) => {
            const name = String(type.name || "").toLowerCase();
            const parent = String(type.parent || "").toLowerCase();
            return aliases.some((alias) => {
                const needle = alias.toLowerCase();
                return name === needle || parent === needle;
            });
        })
        .map((type) => type.name)
        .filter(Boolean);

    return matched.length ? [...new Set(matched)] : aliases;
}

async function queryVouchers(resource, filters) {
    const preset = VOUCHER_RESOURCES[resource];
    const requestedType = filters.voucherType || preset;
    const dateDefaulted = !filters.fromDate && !filters.toDate;
    if (dateDefaulted) {
        Object.assign(filters, defaultVoucherDateRange());
    }

    const voucherTypeNames = requestedType
        ? await resolveVoucherTypeNames(requestedType, filters.company)
        : [];

    const result = await exportXml(
        buildVoucherCollectionXml({
            company: filters.company,
            fromDate: filters.fromDate,
            toDate: filters.toDate,
            voucherTypeNames,
            details: filters.details
        })
    );

    if (!result.ok) {
        throw new Error(result.error || "Could not read vouchers from Tally");
    }

    const nodeFilters = {
        ...filters,
        voucherType: undefined
    };
    const voucherRecords = result.records.filter(
        (record) => record.date || record.voucherNumber || record.voucherType
    );
    const filtered = applyRecordFilters(voucherRecords, nodeFilters);

    return successPayload({
        resource,
        company: filters.company || result.currentCompany || "currently loaded company",
        currentCompany: result.currentCompany,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        dateDefaulted: dateDefaulted || undefined,
        periodNote: dateDefaulted
            ? "No fromDate/toDate was provided, so the last 31 calendar days were used. If this is empty, the loaded Tally company may be an older financial year — pass dates inside that year. Do not invent vouchers."
            : undefined,
        voucherTypesUsed: voucherTypeNames,
        ...attachAnalytics(filtered, filters),
        ...paginate(
            sortRecords(filtered, filters.sortBy || "date", filters.sortDir || "desc"),
            filters.limit
        )
    });
}

async function queryMasters(kind, filters) {
    const lookup = kind === "inventory" ? "stock_items" : kind;
    const result = await exportCollection(lookup, {
        company: filters.company,
        fromDate: filters.fromDate,
        toDate: filters.toDate
    });

    if (!result.ok) {
        throw new Error(result.error || `Could not read ${kind} from Tally`);
    }

    let records = result.records;
    if (lookup === "stock_items") {
        records = records.map((item) => ({
            ...item,
            closingQty: item.closingQty ?? item.closingBalance ?? null
        }));
    }

    const filtered = applyRecordFilters(records, filters);
    const defaultSort = lookup === "stock_items" ? "closingQty" : "name";
    const defaultDir = lookup === "stock_items" ? "asc" : "asc";

    return successPayload({
        resource: kind,
        company: filters.company || "currently loaded company",
        ...attachAnalytics(filtered, filters),
        ...paginate(
            sortRecords(filtered, filters.sortBy || defaultSort, filters.sortDir || defaultDir),
            filters.limit
        )
    });
}

async function queryGst(filters) {
    const { groups, ledgers, groupsOk } = await loadGroupsAndLedgers(filters.company);
    const taxLedgers = applyRecordFilters(
        classifyLedgers(ledgers, groups, "gst"),
        filters
    );
    const partiesWithGstin = ledgers.filter((ledger) => ledger.gstin);

    return successPayload({
        resource: "gst",
        company: filters.company || "currently loaded company",
        nestedGroupsUsed: groupsOk,
        taxLedgers: paginate(
            sortRecords(taxLedgers, filters.sortBy || "name", filters.sortDir || "asc"),
            filters.limit
        ),
        partiesWithGstin: paginate(partiesWithGstin, filters.limit),
        message:
            "taxLedgers are Duties & Taxes ledgers. partiesWithGstin are ledgers where Tally returned a GSTIN. For GST returns, also call tally_report with report=gst."
    });
}

async function queryOutstanding(kind, filters) {
    const rootKey = kind === "outstanding_payables" ? "suppliers" : "customers";
    const result = await queryClassifiedLedgers(rootKey, {
        ...filters,
        nonZero: true,
        sortBy: filters.sortBy || "amount",
        sortDir: filters.sortDir || "desc"
    });

    return {
        ...result,
        resource: kind
    };
}

export async function queryTally(input = {}) {
    const resource = resolveResource(input.resource);
    let filters;

    try {
        filters = applyPeriod({ ...input, resource });
    } catch (error) {
        return failurePayload(error, { resource: input.resource });
    }

    if (filters.compareFromDate || filters.compareToDate) {
        if (!filters.compareFromDate || !filters.compareToDate) {
            return failurePayload(
                new Error("Comparison requires both compareFromDate and compareToDate."),
                { resource }
            );
        }
        if (!filters.fromDate || !filters.toDate) {
            return failurePayload(
                new Error("Comparison also requires fromDate and toDate for the current period."),
                { resource }
            );
        }

        const currentFilters = {
            ...filters,
            compareFromDate: undefined,
            compareToDate: undefined
        };
        const priorFilters = {
            ...filters,
            fromDate: filters.compareFromDate,
            toDate: filters.compareToDate,
            compareFromDate: undefined,
            compareToDate: undefined,
            financialYear: undefined
        };

        const [current, prior] = await Promise.all([
            queryTallyOnce(resource, currentFilters),
            queryTallyOnce(resource, priorFilters)
        ]);

        const currentSummary = current.summary || summarize(current.records || []);
        const priorSummary = prior.summary || summarize(prior.records || []);

        return successPayload({
            resource,
            comparison: true,
            currentPeriod: {
                fromDate: filters.fromDate,
                toDate: filters.toDate,
                ok: current.ok,
                summary: currentSummary,
                totalMatched: current.totalMatched
            },
            priorPeriod: {
                fromDate: filters.compareFromDate,
                toDate: filters.compareToDate,
                ok: prior.ok,
                summary: priorSummary,
                totalMatched: prior.totalMatched
            },
            delta: current.ok && prior.ok
                ? {
                    count: (currentSummary.count || 0) - (priorSummary.count || 0),
                    signedTotal: round2((currentSummary.signedTotal || 0) - (priorSummary.signedTotal || 0)),
                    absoluteTotal: round2((currentSummary.absoluteTotal || 0) - (priorSummary.absoluteTotal || 0))
                }
                : undefined,
            current,
            prior,
            message:
                "Both periods were queried from TallyPrime. If either side failed, do not invent a comparison."
        });
    }

    return queryTallyOnce(resource, filters);
}

async function queryTallyOnce(resource, filters) {
    try {
        if (resource === "companies") {
            return await queryMasters("companies", filters);
        }
        if (resource === "ledgers" || resource === "groups" || resource === "stock_groups" || resource === "godowns" || resource === "voucher_types") {
            return await queryMasters(resource, filters);
        }
        if (resource === "stock_items" || resource === "inventory") {
            return await queryMasters(resource, filters);
        }
        if (resource === "customers" || resource === "suppliers" || resource === "cash" || resource === "bank") {
            return await queryClassifiedLedgers(resource, filters);
        }
        if (resource === "gst") {
            return await queryGst(filters);
        }
        if (resource === "outstanding_receivables" || resource === "outstanding_payables") {
            return await queryOutstanding(resource, filters);
        }
        if (resource in VOUCHER_RESOURCES) {
            return await queryVouchers(resource, filters);
        }

        return failurePayload(new Error(`Unknown resource "${filters.resource}". Call tally_describe for the allowed list.`));
    } catch (error) {
        return failurePayload(error, { resource });
    }
}

async function ledgerFallbackReport(reportKey, filters) {
    if (reportKey === "outstanding_receivables") {
        return queryOutstanding("outstanding_receivables", filters);
    }
    if (reportKey === "outstanding_payables") {
        return queryOutstanding("outstanding_payables", filters);
    }
    if (reportKey === "stock_summary") {
        return queryMasters("inventory", filters);
    }
    return null;
}

export async function runTallyReport(input = {}) {
    let options;
    try {
        options = applyPeriod({ ...input });
    } catch (error) {
        return failurePayload(error, { report: input.report });
    }

    const reportKey = String(options.report || "").toLowerCase();
    const spec = REPORTS[reportKey];

    if (!spec) {
        return failurePayload(
            new Error(`Unknown report "${input.report}". Call tally_describe for the allowed list.`)
        );
    }

    const period = {
        company: options.company,
        fromDate: options.fromDate,
        toDate: options.toDate
    };

    try {
        let lastError;
        for (const reportId of spec.ids) {
            const result = await exportXml(buildReportXml(reportId, period));
            if (result.ok && (result.reportLines.length || result.records.length)) {
                return successPayload({
                    resource: "report",
                    report: reportKey,
                    tallyReportId: reportId,
                    company: options.company || result.currentCompany || "currently loaded company",
                    currentCompany: result.currentCompany,
                    fromDate: options.fromDate || "company current period",
                    toDate: options.toDate || "company current period",
                    financialYearLabel: options.financialYearLabel,
                    lines: result.reportLines.length ? result.reportLines : undefined,
                    records: result.reportLines.length ? undefined : result.records,
                    tallyErrors: result.tallyErrors
                });
            }
            lastError = result.error || `Tally report "${reportId}" returned no parseable lines`;
        }

        const fallback = await ledgerFallbackReport(reportKey, options);
        if (fallback?.ok) {
            return {
                ...fallback,
                report: reportKey,
                usedLedgerFallback: true,
                message:
                    "Tally did not return a parseable named report. These rows are live ledger/stock balances from Tally instead. Do not invent figures."
            };
        }

        return failurePayload(new Error(lastError), { report: reportKey });
    } catch (error) {
        return failurePayload(error, { report: reportKey });
    }
}

export function describeTally() {
    return describeCatalog();
}

export function isFailure(result) {
    return !result || result.ok === false;
}
