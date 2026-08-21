const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const MONTH_INDEX = Object.fromEntries(
    MONTHS.map((name, index) => [name.toLowerCase(), index])
);

function pad(value) {
    return String(value).padStart(2, "0");
}

export function parseDate(input) {
    if (input == null || input === "") {
        return null;
    }

    const text = String(input).trim();

    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (match) {
        return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    }

    match = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (match) {
        const month = MONTH_INDEX[match[2].toLowerCase()];
        if (month == null) {
            return null;
        }
        return new Date(Number(match[3]), month, Number(match[1]));
    }

    return null;
}

export function toTallyDate(input) {
    if (input == null || input === "") {
        return undefined;
    }

    const date = parseDate(input);
    if (!date || Number.isNaN(date.getTime())) {
        throw new Error(`Invalid date "${input}". Use YYYY-MM-DD.`);
    }

    return `${pad(date.getDate())}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function lastNDaysIso(days) {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (days - 1));
    return {
        fromDate: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
        toDate: `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`
    };
}

export function defaultVoucherDateRange() {
    return lastNDaysIso(31);
}

export function parseFinancialYear(input) {
    if (input == null || String(input).trim() === "") {
        return null;
    }

    const text = String(input).trim().replace(/^FY\s*/i, "").trim();
    const match = text.match(/^(20)?(\d{2})\s*[-/]\s*(?:20)?(\d{2})$/);
    if (!match) {
        return null;
    }

    const startYear = Number(`${match[1] || "20"}${match[2]}`);
    if (!Number.isFinite(startYear) || startYear < 1990 || startYear > 2100) {
        return null;
    }

    return {
        fromDate: `${startYear}-04-01`,
        toDate: `${startYear + 1}-03-31`,
        label: `FY ${startYear}-${String(startYear + 1).slice(-2)}`
    };
}

export function applyPeriod(filters = {}) {
    const next = { ...filters };

    if (next.financialYear && (!next.fromDate || !next.toDate)) {
        const fy = parseFinancialYear(next.financialYear);
        if (!fy) {
            throw new Error(
                `Invalid financialYear "${next.financialYear}". Use Indian FY format such as 24-25 or 2024-25.`
            );
        }
        next.fromDate = next.fromDate || fy.fromDate;
        next.toDate = next.toDate || fy.toDate;
        next.financialYearLabel = fy.label;
    }

    return next;
}

export function toIsoDate(input) {
    if (input == null || input === "") {
        return undefined;
    }

    const date = parseDate(input);
    if (!date || Number.isNaN(date.getTime())) {
        return String(input).trim();
    }

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
