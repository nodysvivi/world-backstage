export const MODULE_ID = 'world_backstage';
export const STATE_KEY = 'world_backstage_v1';
export const SNAPSHOT_KEY = 'world_backstage';
export const SCHEMA_VERSION = 14;
export const MINUTES_PER_DAY = 24 * 60;
export const RECOVERY_LIMIT = 3;

const TERMINAL_EVENT_STATES = new Set(['resolved', 'cancelled', 'missed']);
const ACTIVE_EVENT_STATES = new Set(['active', 'waiting']);
const VALID_CLOCK_MODES = new Set(['duration', 'active', 'scheduled', 'condition']);
const VALID_VISIBILITY = new Set(['hidden', 'trace', 'known', 'direct']);
const VALID_KNOWLEDGE = new Set(['hidden', 'known']);
const VALID_CLUE_STATES = new Set(['open', 'developing', 'triggered', 'echoed', 'resolved', 'discarded']);
const VALID_MEMORY_FACT_STATES = new Set(['active', 'disputed', 'superseded', 'invalidated']);
const VALID_MEMORY_CONFIDENCE = new Set(['low', 'medium', 'high']);
const MEMORY_SUMMARY_LEVELS = Object.freeze({
    DETAIL: 0,
    STAGE: 1,
    CHAPTER: 2,
    LONG_TERM: 3,
});
const MEMORY_ROLLUP_THRESHOLDS = Object.freeze({
    0: 12,
    1: 6,
    2: 3,
});
const VALID_EVENT_STATES = new Set([
    'active',
    'waiting',
    'ready',
    'resolved',
    'cancelled',
    'missed',
]);

const LIMITS = Object.freeze({
    people: 36,
    events: 96,
    archive: 120,
    echoes: 80,
    foregroundFacts: 24,
    worldFacts: 160,
    consistencyConflicts: 32,
    audit: 40,
    text: 800,
    innerVoice: 240,
    longTermGoal: 360,
    identityAnchor: 500,
    personalityAnchor: 600,
    appearanceProfile: 700,
    backgroundProfile: 900,
    worldbookRaw: 4000,
    speakingStyle: 360,
    behaviorBoundaries: 500,
    cognitiveRefs: 32,
    personState: 220,
    eventCause: 360,
    eventPublicTrace: 260,
    storySummaries: 2400,
    clues: 480,
    memoryFacts: 720,
    memoryDigest: 2400,
    metabolismLog: 180,
});

function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function asString(value, fallback = '', maxLength = LIMITS.text) {
    const result = typeof value === 'string' ? value.trim() : fallback;
    return result.slice(0, maxLength);
}

function asInteger(value, fallback = 0, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function uniqueStrings(value, maximum = 12) {
    return [...new Set(asArray(value)
        .map(item => asString(item, '', 120))
        .filter(Boolean))]
        .slice(0, maximum);
}

function mergeUniqueStrings(previous, incoming, maximum = 12) {
    return uniqueStrings([
        ...asArray(previous),
        ...asArray(incoming),
    ], maximum);
}

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix = 'wb') {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeId(value, prefix) {
    const candidate = asString(value, '', 100)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return candidate || makeId(prefix);
}

function normalizeClockMode(value) {
    return VALID_CLOCK_MODES.has(value) ? value : 'duration';
}

function normalizeVisibility(value) {
    return VALID_VISIBILITY.has(value) ? value : 'hidden';
}

function normalizeEventStatus(value) {
    return VALID_EVENT_STATES.has(value) ? value : 'active';
}

function normalizeKnowledge(value) {
    return VALID_KNOWLEDGE.has(value) ? value : 'hidden';
}

export function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function hasExplicitTimeEvidence(text) {
    const value = String(text || '');
    const chineseNumber = '[Một hai hai ba bốn năm sáu bảy tám chín mười trăm nghìn vạn rưỡi]';
    const arabicDurationUnit = '(?:Phút|Phút|Khắc|Giờ|Tiếng|Giờ đồng hồ|Ngày|Ngày|Tuần|Tuần|Tháng|Tháng|Năm)';
    const chineseDurationUnit = '(?:Phút|Khắc|Giờ|Tiếng|Giờ đồng hồ|Ngày|Ngày|Tuần|Tuần|Tháng|Tháng|Năm)';
    const patterns = [
        new RegExp(`\\d+(?:\\.\\d+)?\\s*${arabicDurationUnit}`),
        new RegExp(`${chineseNumber}+\\s*${chineseDurationUnit}`),
        /(?:Rạng sáng|Sáng sớm|Buổi sáng|Sáng|Buổi trưa|Buổi chiều|Chạng vạng|Buổi tối|Ban đêm)?\s*\d{1,2}\s*(?:Giờ|Giờ|[:：])\s*\d{0,2}/,
        new RegExp(`(?:Rạng sáng|Sáng sớm|Buổi sáng|Sáng|Buổi trưa|Buổi chiều|Chạng vạng|Buổi tối|Ban đêm)?\\s*${chineseNumber}+\\s*(?:Giờ|Giờ)`),
        /Thứ\s*\d+\s*[Ngày]/,
        new RegExp(`Thứ\\s*${chineseNumber}+\\s*[Ngày]`),
        /(?:Ngày hôm sau|Hôm sau|Ngày thứ hai|Cách ngày|Tuần thứ hai|Tuần sau|Tháng sau|Năm sau)/,
    ];
    return patterns.some(pattern => pattern.test(value));
}

export function resolveElapsedMinutes(rawMinutes, narrativeText, policy = 'explicit') {
    const minutes = asInteger(rawMinutes, 0, 0, 5 * 365 * MINUTES_PER_DAY);
    if (policy === 'open' || policy === 'world') return minutes;
    if (hasExplicitTimeEvidence(narrativeText)) return minutes;
    if (policy === 'cautious') return Math.min(minutes, 180);
    return 0;
}

export function formatWorldMinute(totalMinutes) {
    const safeTotal = asInteger(totalMinutes, 0, 0);
    const day = Math.floor(safeTotal / MINUTES_PER_DAY);
    const minuteOfDay = safeTotal % MINUTES_PER_DAY;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const pad = number => String(number).padStart(2, '0');

    return {
        day,
        hour,
        minute,
        time: `${pad(hour)}:${pad(minute)}`,
        stamp: `Thứ ${day} Ngày ${pad(hour)}:${pad(minute)}`,
    };
}

function daysInCalendarMonth(year, month) {
    if (month === 2) {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function normalizeCalendarDate({ year, month, day } = {}, fallback = {
    year: 1,
    month: 1,
    day: 1,
}) {
    const safeYear = asInteger(year, fallback.year, 1, 9999);
    const safeMonth = asInteger(month, fallback.month, 1, 12);
    return {
        year: safeYear,
        month: safeMonth,
        day: asInteger(
            day,
            fallback.day,
            1,
            daysInCalendarMonth(safeYear, safeMonth),
        ),
    };
}

function addCalendarDays(date, days) {
    const safe = normalizeCalendarDate(date);
    const value = new Date(0);
    value.setUTCHours(12, 0, 0, 0);
    value.setUTCFullYear(safe.year, safe.month - 1, 1);
    value.setUTCDate(safe.day + asInteger(days, 0, -1000000, 1000000));
    return {
        year: value.getUTCFullYear(),
        month: value.getUTCMonth() + 1,
        day: value.getUTCDate(),
    };
}

function calendarDayDifference(fromDate, toDate) {
    const from = normalizeCalendarDate(fromDate);
    const to = normalizeCalendarDate(toDate, from);
    const asUtcDay = value => {
        const date = new Date(0);
        date.setUTCHours(12, 0, 0, 0);
        date.setUTCFullYear(value.year, value.month - 1, value.day);
        return Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
    };
    return asUtcDay(to) - asUtcDay(from);
}

function extractExplicitCalendarDate(text = '') {
    const source = asString(text, '', 60000);
    const patterns = [
        /(?:^|\D)(\d{1,4})\s*Năm\s*(\d{1,2})\s*Tháng\s*(\d{1,2})\s*Ngày(?:\D|$)/g,
        /(?:^|\D)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/g,
    ];
    let latest = null;
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            if (year < 1 || year > 9999 || month < 1 || month > 12) continue;
            if (day < 1 || day > daysInCalendarMonth(year, month)) continue;
            const index = Number(match.index ?? 0);
            if (!latest || index >= latest.index) {
                latest = { year, month, day, index, excerpt: match[0].trim() };
            }
        }
    }
    return latest;
}


/**
 * Đọc từ một đoạn nội dung chính“Tác giả viết rõ ra”điểm neo thời gian.
 * Thủ công“Hiệu chuẩn với nội dung chính”Sử dụng nó: không gọi mô hình, không suy luận giờ bị thiếu.
 * Ưu tiên phân tích nội dung chính của“Thời gian và địa điểm” details；Chỉ khi không tìm thấy mới quay lại toàn bộ nội dung chính.
 */
export function extractNarrativeTimeAnchor(text = '') {
    const source = asString(text, '', 60000);
    if (!source.trim()) return null;

    const detailMatches = [...source.matchAll(/<details\b[^>]*>[\s\S]*?<summary\b[^>]*>[\s\S]*?(?:Thời gian\s*[Và]\s*Địa điểm|Thời gian địa điểm)[\s\S]*?<\/summary>[\s\S]*?<\/details>/giu)];
    const scope = detailMatches.length
        ? String(detailMatches.at(-1)?.[0] || '')
        : source;

    const date = extractExplicitCalendarDate(scope) || (scope === source ? null : extractExplicitCalendarDate(source));

    // Có dạng như ▶07:40→08:15：Thời gian kết thúc đại diện cho thời gian khi đoạn nội dung chính này kết thúc.
    const transitions = [...scope.matchAll(/(?:▶|>)?\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)\s*(?:→|->|Đến|Đến)\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)/gu)];
    let exact = null;
    if (transitions.length) {
        const match = transitions.at(-1);
        exact = { hour: Number(match[3]), minute: Number(match[4]), excerpt: match[0].trim() };
    } else {
        // Khi thanh thời gian chỉ có một giờ rõ ràng duy nhất cũng cho phép đồng bộ. Giới hạn ở“Thời gian và địa điểm”khu vực có thể giảm việc bắt nhầm các con số thông thường trong nội dung chính.
        const times = [...scope.matchAll(/(?:^|[^\d])([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?!\d)/gu)];
        if (times.length) {
            const match = times.at(-1);
            exact = { hour: Number(match[1]), minute: Number(match[2]), excerpt: match[0].trim() };
        }
    }

    const daypartMatch = [...scope.matchAll(/(?:Rạng sáng|Bình minh|Sáng sớm|Buổi sáng|Sáng|Buổi trưa|Buổi chiều|Buổi chiều|Chạng vạng|Hoàng hôn|Buổi tối|Buổi tối|Đêm khuya)/gu)].at(-1);
    const daypart = daypartMatch?.[0] || '';

    if (!date && !exact) return null;
    return {
        year: date?.year ?? null,
        month: date?.month ?? null,
        day: date?.day ?? null,
        hour: exact?.hour ?? null,
        minute: exact?.minute ?? null,
        daypart,
        structured: detailMatches.length > 0,
        precision: date && exact ? 'minute' : date ? (daypart ? 'daypart' : 'date') : 'minute',
        excerpt: [date?.excerpt, exact?.excerpt, daypart].filter(Boolean).join(' · ').slice(0, 240),
    };
}

function sequentialCalendarDate(absoluteDay) {
    return addCalendarDays(
        { year: 1, month: 1, day: 1 },
        Math.max(0, asInteger(absoluteDay, 1, 0) - 1),
    );
}

function normalizeWorldCalendar(raw, absoluteDay = 1) {
    const fallback = sequentialCalendarDate(absoluteDay);
    const anchor = normalizeCalendarDate({
        year: raw?.anchor_year ?? raw?.anchorYear,
        month: raw?.anchor_month ?? raw?.anchorMonth,
        day: raw?.anchor_day ?? raw?.anchorDay,
    }, fallback);
    return {
        name: asString(raw?.name, 'Lịch thế giới chính', 40),
        anchorAbsoluteDay: asInteger(
            raw?.anchor_absolute_day ?? raw?.anchorAbsoluteDay,
            absoluteDay,
            0,
            999999,
        ),
        anchorYear: anchor.year,
        anchorMonth: anchor.month,
        anchorDay: anchor.day,
    };
}

export function formatWorldCalendar(state, totalMinutes = state?.clock?.absoluteMinute ?? 0) {
    const clock = formatWorldMinute(totalMinutes);
    const calendar = normalizeWorldCalendar(state?.world?.calendar, clock.day);
    const date = addCalendarDays({
        year: calendar.anchorYear,
        month: calendar.anchorMonth,
        day: calendar.anchorDay,
    }, clock.day - calendar.anchorAbsoluteDay);
    const pad = number => String(number).padStart(2, '0');
    const dateLabel = `Ngày ${date.day} Tháng ${date.month} Năm ${date.year}`;
    return {
        ...clock,
        calendarName: calendar.name,
        year: date.year,
        month: date.month,
        dayOfMonth: date.day,
        date: dateLabel,
        shortDate: `Ngày ${pad(date.day)} Tháng ${pad(date.month)}`,
        stamp: `${calendar.name} ${dateLabel} ${clock.time}`,
    };
}

export function formatDuration(minutes) {
    const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    const days = Math.floor(safeMinutes / MINUTES_PER_DAY);
    const hours = Math.floor((safeMinutes % MINUTES_PER_DAY) / 60);
    const rest = safeMinutes % 60;
    const parts = [];

    if (days) parts.push(`${days} Ngày`);
    if (hours) parts.push(`${hours} Giờ`);
    if (rest || parts.length === 0) parts.push(`${rest} Phút`);
    return parts.join(' ');
}


const VALID_WORLD_FACT_SOURCES = new Set(['narrative', 'simulation', 'manual', 'event-settlement']);
const VALID_WORLD_FACT_CONFIDENCE = new Set(['low', 'medium', 'high']);

function worldFactStableKey(raw = {}) {
    const explicit = asString(raw?.key, '', 180);
    if (explicit) return explicit;
    const subjectType = asString(raw?.subject_type ?? raw?.subjectType, 'world', 40) || 'world';
    const subjectId = asString(
        raw?.subject_id ?? raw?.subjectId ?? raw?.subject ?? raw?.name,
        'world',
        120,
    ) || 'world';
    const field = asString(raw?.field, 'state', 80) || 'state';
    return `${subjectType}:${subjectId}:${field}`;
}

export function normalizeWorldFact(raw, existing = null, worldMinute = 0) {
    const key = worldFactStableKey(raw || existing || {});
    const source = asString(raw?.source, existing?.source || 'simulation', 40);
    const confidence = asString(raw?.confidence, existing?.confidence || 'high', 20);
    return {
        id: normalizeId(raw?.id || existing?.id || `world_fact_${hashText(key)}`, 'world_fact'),
        key,
        subjectType: asString(
            raw?.subject_type ?? raw?.subjectType,
            existing?.subjectType || 'world',
            40,
        ) || 'world',
        subjectId: asString(
            raw?.subject_id ?? raw?.subjectId,
            existing?.subjectId || '',
            120,
        ),
        subject: asString(raw?.subject, existing?.subject || '', 140),
        field: asString(raw?.field, existing?.field || 'state', 80) || 'state',
        value: asString(raw?.value, existing?.value || '', 520),
        source: VALID_WORLD_FACT_SOURCES.has(source) ? source : 'simulation',
        confidence: VALID_WORLD_FACT_CONFIDENCE.has(confidence) ? confidence : 'high',
        visibility: normalizeVisibility(raw?.visibility ?? existing?.visibility ?? 'hidden'),
        eventId: asString(
            raw?.event_id ?? raw?.eventId,
            existing?.eventId || '',
            120,
        ),
        messageId: asInteger(
            raw?.message_id ?? raw?.messageId,
            existing?.messageId ?? -1,
            -1,
        ),
        settledAt: asInteger(
            raw?.settled_at ?? raw?.settledAt,
            existing?.settledAt ?? worldMinute,
            0,
        ),
        updatedAt: asInteger(
            raw?.updated_at ?? raw?.updatedAt,
            worldMinute,
            0,
        ),
    };
}

function upsertWorldFact(state, raw, {
    worldMinute = state?.clock?.absoluteMinute || 0,
    source = '',
    messageId = null,
} = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const prepared = {
        ...raw,
        ...(source ? { source } : {}),
        ...(messageId !== null && messageId !== undefined ? { message_id: messageId } : {}),
    };
    const key = worldFactStableKey(prepared);
    const existing = asArray(state.worldFacts).find(item => item.key === key) || null;
    const fact = normalizeWorldFact(prepared, existing, worldMinute);
    if (!fact.value) return null;
    if (existing) Object.assign(existing, fact);
    else state.worldFacts.unshift(fact);
    state.worldFacts = state.worldFacts.slice(0, LIMITS.worldFacts);
    return fact;
}

function settlePersonStateFacts(state, person, source, messageId = null) {
    if (!person?.id) return;
    const fields = [
        ['location', 'Vị trí', person.location, 'hidden'],
        ['action', 'Hành động hiện tại', person.action, 'hidden'],
        ['physicalState', 'Trạng thái cơ thể', person.physicalState, 'hidden'],
        ['resourceState', 'Trạng thái tài nguyên', person.resourceState, 'hidden'],
    ];
    for (const [field, label, value, visibility] of fields) {
        const text = asString(value, '', 520);
        if (!text || /Chờ xác nhận$/.test(text)) continue;
        upsertWorldFact(state, {
            key: `person:${person.id}:${field}`,
            subject_type: 'person',
            subject_id: person.id,
            subject: person.name,
            field,
            value: text,
            visibility,
            confidence: 'high',
        }, {
            source,
            messageId,
        });
    }
}

export function settlePersonWorldState(inputState, personId, {
    source = 'manual',
    messageId = null,
} = {}) {
    const state = deepClone(inputState);
    const person = asArray(state.people).find(item => item.id === String(personId || ''));
    if (!person) return trimState(state);
    settlePersonStateFacts(state, person, source, messageId);
    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    return trimState(state);
}

function settleEventResultFact(state, event, messageId = null) {
    if (!event?.id || !TERMINAL_EVENT_STATES.has(event.status)) return;
    const result = asString(event.result || event.consequence || event.summary, '', 520);
    if (!result) return;
    upsertWorldFact(state, {
        key: `event:${event.id}:result`,
        subject_type: 'event',
        subject_id: event.id,
        subject: event.title,
        field: 'result',
        value: result,
        visibility: event.visibility,
        event_id: event.id,
        confidence: 'high',
    }, {
        source: 'event-settlement',
        messageId,
    });
}

function normalizeConsistencyConflict(raw, worldMinute = 0, messageId = null) {
    return {
        id: normalizeId(raw?.id || `conflict_${hashText(JSON.stringify(raw || {}))}`, 'conflict'),
        subject: asString(raw?.subject, 'Trạng thái thế giới', 140),
        field: asString(raw?.field, 'state', 80),
        expected: asString(raw?.expected ?? raw?.previous_value ?? raw?.previousValue, '', 420),
        observed: asString(raw?.observed ?? raw?.narrative_value ?? raw?.narrativeValue, '', 420),
        resolution: ['accept-narrative', 'keep-world', 'transition'].includes(raw?.resolution)
            ? raw.resolution
            : 'keep-world',
        reason: asString(raw?.reason, '', 360),
        messageId: asInteger(raw?.message_id ?? raw?.messageId, messageId ?? -1, -1),
        at: worldMinute,
    };
}

function selectRelevantWorldFacts(state, recentText = '', maximum = 12) {
    const text = String(recentText || '').toLocaleLowerCase();
    return asArray(state?.worldFacts)
        .map(fact => {
            const terms = [fact.subject, fact.subjectId, fact.field, fact.value]
                .filter(Boolean)
                .map(value => String(value).toLocaleLowerCase());
            let score = Number(fact.updatedAt || fact.settledAt || 0) / 1_000_000;
            if (terms.some(term => term.length >= 2 && text.includes(term))) score += 120;
            if (fact.source === 'narrative') score += 25;
            if (fact.source === 'event-settlement') score += 20;
            if (fact.confidence === 'high') score += 8;
            return { fact, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, maximum))
        .map(item => item.fact);
}

export function createInitialState({
    worldName = 'Thế giới chưa đặt tên',
    day = 1,
    hour = 8,
    minute = 0,
} = {}) {
    const absoluteMinute = (
        asInteger(day, 1, 0, 999999) * MINUTES_PER_DAY
        + asInteger(hour, 8, 0, 23) * 60
        + asInteger(minute, 0, 0, 59)
    );
    const absoluteDay = Math.floor(absoluteMinute / MINUTES_PER_DAY);
    const initialDate = sequentialCalendarDate(absoluteDay);

    return {
        schemaVersion: SCHEMA_VERSION,
        revision: 0,
        world: {
            name: asString(worldName, 'Thế giới chưa đặt tên', 80),
            title: 'Thế giới vẫn đang tiếp diễn ngoài ống kính',
            detail: 'Chưa hoàn thành suy diễn thế giới lần đầu tiên.',
            calendar: {
                name: 'Lịch thế giới chính',
                anchorAbsoluteDay: absoluteDay,
                anchorYear: initialDate.year,
                anchorMonth: initialDate.month,
                anchorDay: initialDate.day,
            },
        },
        clock: {
            absoluteMinute,
            lastCheckedAt: absoluteMinute,
            source: 'initial',
            reason: 'Thiết lập đồng hồ thế giới chính',
            anchored: false,
            precision: 'uninitialized',
        },
        people: [],
        events: [],
        echoes: [],
        archive: [],
        foregroundFacts: [],
        worldFacts: [],
        consistencyConflicts: [],
        needsReconciliation: false,
        storyMemory: {
            indexedThroughMessageId: -1,
            indexedAt: '',
            digest: {
                text: '',
                throughMessageId: -1,
                people: [],
                locations: [],
                tags: [],
                updatedAt: 0,
            },
            facts: [],
            summaries: [],
            clues: [],
            metabolismLog: [],
            lastMetabolismMessageId: -1,
        },
        audit: [],
        pendingSync: false,
        lastCommit: null,
        updatedAt: nowIso(),
    };
}

function normalizeStorySummary(raw, existing = null) {
    const startMessageId = asInteger(
        raw?.start_message_id ?? raw?.startMessageId,
        existing?.startMessageId ?? 0,
        0,
    );
    const endMessageId = asInteger(
        raw?.end_message_id ?? raw?.endMessageId,
        existing?.endMessageId ?? startMessageId,
        startMessageId,
    );
    const summary = asString(raw?.summary, existing?.summary || '', 1800);
    const level = asInteger(
        raw?.level ?? raw?.memory_level ?? raw?.memoryLevel,
        existing?.level ?? MEMORY_SUMMARY_LEVELS.STAGE,
        MEMORY_SUMMARY_LEVELS.DETAIL,
        MEMORY_SUMMARY_LEVELS.LONG_TERM,
    );
    return {
        id: normalizeId(
            raw?.id || existing?.id || `summary_${startMessageId}_${endMessageId}`,
            'summary',
        ),
        title: asString(raw?.title, existing?.title || `Thứ ${startMessageId}—${endMessageId} Tầng`, 120),
        summary,
        level,
        hierarchyManaged: Boolean(
            raw?.hierarchy_managed
            ?? raw?.hierarchyManaged
            ?? existing?.hierarchyManaged
            ?? false
        ),
        parentId: asString(
            raw?.parent_id ?? raw?.parentId,
            existing?.parentId || '',
            120,
        ),
        sourceSummaryIds: uniqueStrings(
            raw?.source_summary_ids ?? raw?.sourceSummaryIds ?? existing?.sourceSummaryIds,
            24,
        ),
        startMessageId,
        endMessageId,
        people: uniqueStrings(raw?.people ?? existing?.people, 20),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 16),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 20),
        locked: Boolean(raw?.locked ?? existing?.locked),
        important: Boolean(raw?.important ?? existing?.important),
        manual: Boolean(raw?.manual ?? existing?.manual),
        retentionState: ['active', 'compacted'].includes(raw?.retention_state ?? raw?.retentionState)
            ? (raw?.retention_state ?? raw?.retentionState)
            : (existing?.retentionState || 'active'),
        compactedReason: asString(
            raw?.compacted_reason ?? raw?.compactedReason,
            existing?.compactedReason || '',
            260,
        ),
        createdAt: asString(raw?.created_at ?? raw?.createdAt, existing?.createdAt || nowIso(), 40),
    };
}

function normalizeClue(raw, existing = null, worldMinute = 0, {
    sourceMessageId = null,
    sourceSwipeId = null,
} = {}) {
    const text = asString(raw?.text, existing?.text || '', 620);
    const clueId = raw?.id
        || existing?.id
        || (text ? `clue_${hashText(text)}` : '');
    const requestedStatus = asString(raw?.status, existing?.status || 'open', 20);
    return {
        id: normalizeId(clueId, 'clue'),
        title: asString(raw?.title, existing?.title || text.slice(0, 48) || 'Phục bút chưa đặt tên', 120),
        text,
        sourceMessageId: asInteger(
            raw?.source_message_id ?? raw?.sourceMessageId,
            existing?.sourceMessageId ?? sourceMessageId ?? 0,
            0,
        ),
        sourceSwipeId: asInteger(
            raw?.source_swipe_id ?? raw?.sourceSwipeId,
            existing?.sourceSwipeId ?? sourceSwipeId ?? 0,
            0,
        ),
        sourceExcerpt: asString(
            raw?.source_excerpt ?? raw?.sourceExcerpt,
            existing?.sourceExcerpt || '',
            220,
        ),
        people: uniqueStrings(raw?.people ?? existing?.people, 16),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 12),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 20),
        locked: Boolean(raw?.locked ?? existing?.locked),
        important: Boolean(raw?.important ?? existing?.important),
        manual: Boolean(raw?.manual ?? existing?.manual),
        status: VALID_CLUE_STATES.has(requestedStatus) ? requestedStatus : 'open',
        importance: asInteger(raw?.importance, existing?.importance ?? 1, 1, 3),
        visibility: normalizeVisibility(raw?.visibility ?? existing?.visibility ?? 'hidden'),
        resolution: asString(raw?.resolution, existing?.resolution || '', 520),
        lifecycleReason: asString(
            raw?.lifecycle_reason ?? raw?.lifecycleReason,
            existing?.lifecycleReason || '',
            360,
        ),
        resolvedMessageId: raw?.resolved_message_id ?? raw?.resolvedMessageId
            ?? existing?.resolvedMessageId
            ?? null,
        createdAt: asInteger(raw?.created_at ?? raw?.createdAt, existing?.createdAt ?? worldMinute, 0),
        updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, worldMinute, 0),
    };
}

function normalizeMemoryDigest(raw, existing = null, worldMinute = 0) {
    return {
        text: asString(raw?.text, existing?.text || '', LIMITS.memoryDigest),
        throughMessageId: asInteger(
            raw?.through_message_id ?? raw?.throughMessageId,
            existing?.throughMessageId ?? -1,
            -1,
        ),
        people: uniqueStrings(raw?.people ?? existing?.people, 32),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 24),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 32),
        updatedAt: asInteger(
            raw?.updated_at ?? raw?.updatedAt,
            existing?.updatedAt ?? worldMinute,
            0,
        ),
    };
}

function normalizeMemoryFact(raw, existing = null, worldMinute = 0, {
    sourceMessageId = null,
    sourceSwipeId = null,
} = {}) {
    const subject = asString(raw?.subject, existing?.subject || '', 100);
    const predicate = asString(raw?.predicate, existing?.predicate || '', 100);
    const value = asString(raw?.value, existing?.value || '', 520);
    const key = asString(
        raw?.key,
        existing?.key || [subject, predicate].filter(Boolean).join('：'),
        180,
    );
    const requestedStatus = asString(raw?.status, existing?.status || 'active', 20);
    const requestedConfidence = asString(
        raw?.confidence,
        existing?.confidence || 'high',
        20,
    );
    const factId = raw?.id
        || existing?.id
        || `memory_${hashText(`${key}\n${value}`)}`;
    return {
        id: normalizeId(factId, 'memory'),
        key,
        subject,
        predicate,
        value,
        sourceMessageId: asInteger(
            raw?.source_message_id ?? raw?.sourceMessageId,
            existing?.sourceMessageId ?? sourceMessageId ?? 0,
            0,
        ),
        sourceSwipeId: asInteger(
            raw?.source_swipe_id ?? raw?.sourceSwipeId,
            existing?.sourceSwipeId ?? sourceSwipeId ?? 0,
            0,
        ),
        sourceExcerpt: asString(
            raw?.source_excerpt ?? raw?.sourceExcerpt,
            existing?.sourceExcerpt || '',
            220,
        ),
        people: uniqueStrings(raw?.people ?? existing?.people, 20),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 16),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 24),
        locked: Boolean(raw?.locked ?? existing?.locked),
        important: Boolean(raw?.important ?? existing?.important),
        manual: Boolean(raw?.manual ?? existing?.manual),
        status: VALID_MEMORY_FACT_STATES.has(requestedStatus) ? requestedStatus : 'active',
        confidence: VALID_MEMORY_CONFIDENCE.has(requestedConfidence)
            ? requestedConfidence
            : 'medium',
        importance: asInteger(raw?.importance, existing?.importance ?? 2, 1, 3),
        visibility: normalizeVisibility(raw?.visibility ?? existing?.visibility ?? 'known'),
        supersedes: uniqueStrings(raw?.supersedes ?? existing?.supersedes, 12),
        supersededBy: asString(
            raw?.superseded_by ?? raw?.supersededBy,
            existing?.supersededBy || '',
            100,
        ),
        invalidationReason: asString(
            raw?.invalidation_reason ?? raw?.invalidationReason,
            existing?.invalidationReason || '',
            360,
        ),
        createdAt: asInteger(raw?.created_at ?? raw?.createdAt, existing?.createdAt ?? worldMinute, 0),
        updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, worldMinute, 0),
    };
}

function retainMemoryFacts(items) {
    const normalized = asArray(items);
    const protectedItems = normalized.filter(item => (
        item?.locked
        || item?.important
        || item?.manual
        || Number(item?.importance || 0) >= 3
        || item?.status === 'disputed'
    ));
    const protectedIds = new Set(protectedItems.map(item => item.id));
    const remainder = normalized
        .filter(item => !protectedIds.has(item.id))
        .sort((a, b) => {
            const statusWeight = value => ({ active: 4, disputed: 3, superseded: 1, invalidated: 0 }[value] ?? 0);
            const confidenceWeight = value => ({ high: 3, medium: 2, low: 0 }[value] ?? 1);
            return (
                statusWeight(b.status) - statusWeight(a.status)
                || Number(b.importance || 0) - Number(a.importance || 0)
                || confidenceWeight(b.confidence) - confidenceWeight(a.confidence)
                || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
            );
        })
        .slice(0, LIMITS.memoryFacts);
    return [...protectedItems, ...remainder]
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function retainStorySummaries(items) {
    const chronological = asArray(items)
        .sort((a, b) => Number(a.endMessageId || 0) - Number(b.endMessageId || 0));
    if (!chronological.length) return chronological;

    // Memory is allowed to forget low-value detail after it has been safely rolled
    // into a higher layer.  We keep the recent detail window, the story opening,
    // manually protected items and all chapter/long-term summaries.  Older compacted
    // L0/L1 nodes may leave the active store; their parent summaries still retain the
    // covered message range, so the original chat remains traceable without keeping
    // every intermediate summary forever.
    const latestMessageId = Number(chronological.at(-1)?.endMessageId || 0);
    const recentFloor = Math.max(0, latestMessageId - 480);
    const protectedIds = new Set();
    const protect = item => {
        if (item?.id) protectedIds.add(item.id);
    };

    for (const item of chronological) {
        const level = Number(item?.level || 0);
        const recent = Number(item?.endMessageId || 0) >= recentFloor;
        const activeUnrolled = !item?.parentId && item?.retentionState !== 'compacted';
        if (
            item?.locked
            || item?.important
            || item?.manual
            || level >= MEMORY_SUMMARY_LEVELS.CHAPTER
            || activeUnrolled
            || recent
        ) {
            protect(item);
        }
    }
    // A tiny amount of opening detail is intentionally kept as a durable story anchor.
    chronological.slice(0, 12).forEach(protect);

    const keep = new Map();
    for (const item of chronological) {
        if (protectedIds.has(item.id)) keep.set(item.id, item);
    }

    // Fill any remaining room with the newest useful summaries, but compacted old
    // details lose to active/higher-level memory.  This makes LIMITS.storySummaries a
    // real upper bound in ordinary cases instead of a pool that can grow forever.
    const candidates = chronological
        .filter(item => !keep.has(item.id) && item?.retentionState !== 'compacted')
        .sort((a, b) => (
            Number(b.level || 0) - Number(a.level || 0)
            || Number(b.endMessageId || 0) - Number(a.endMessageId || 0)
        ));
    for (const item of candidates) {
        if (keep.size >= LIMITS.storySummaries) break;
        keep.set(item.id, item);
    }

    return [...keep.values()]
        .sort((a, b) => Number(a.endMessageId || 0) - Number(b.endMessageId || 0));
}

function retainClues(items) {
    const normalized = asArray(items);
    const protectedItems = normalized.filter(item => (
        item?.locked
        || item?.important
        || item?.manual
        || ['open', 'developing', 'echoed', 'triggered'].includes(item?.status)
    ));
    const protectedIds = new Set(protectedItems.map(item => item.id));
    const remainder = normalized
        .filter(item => !protectedIds.has(item.id))
        .sort((a, b) => (
            Number(b.importance || 0) - Number(a.importance || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ))
        .slice(0, LIMITS.clues);
    return [...protectedItems, ...remainder]
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function normalizeStoryMemory(raw, worldMinute = 0) {
    const summaries = asArray(raw?.summaries)
        .map(summary => normalizeStorySummary(summary))
        .filter(summary => summary.summary);
    const clueMap = new Map();
    for (const clue of asArray(raw?.clues)) {
        const normalized = normalizeClue(clue, clue, worldMinute);
        if (!normalized.text) continue;
        clueMap.set(normalized.id, normalized);
    }
    const factMap = new Map();
    for (const fact of asArray(raw?.facts)) {
        const normalized = normalizeMemoryFact(fact, fact, worldMinute);
        if (!normalized.key || !normalized.value) continue;
        factMap.set(normalized.id, normalized);
    }
    return {
        indexedThroughMessageId: asInteger(
            raw?.indexedThroughMessageId ?? raw?.indexed_through_message_id,
            -1,
            -1,
        ),
        indexedAt: asString(raw?.indexedAt ?? raw?.indexed_at, '', 40),
        digest: normalizeMemoryDigest(raw?.digest, null, worldMinute),
        // Storage capacity and per-turn recall are intentionally separate.
        // Keep locked/important/open anchors even when the soft pool is full;
        // selectRelevantStoryMemory still injects only a small relevant subset.
        facts: retainMemoryFacts([...factMap.values()]),
        summaries: retainStorySummaries(summaries),
        clues: retainClues([...clueMap.values()]),
        metabolismLog: asArray(raw?.metabolismLog ?? raw?.metabolism_log)
            .slice(-LIMITS.metabolismLog)
            .map(item => ({
                id: asString(item?.id, makeId('metabolism'), 100),
                kind: asString(item?.kind, 'memory', 30),
                action: asString(item?.action, 'updated', 30),
                targetId: asString(item?.targetId ?? item?.target_id, '', 120),
                replacementId: asString(item?.replacementId ?? item?.replacement_id, '', 120),
                reason: asString(item?.reason, '', 360),
                sourceMessageId: asInteger(item?.sourceMessageId ?? item?.source_message_id, 0, 0),
                worldMinute: asInteger(item?.worldMinute ?? item?.world_minute, worldMinute, 0),
                createdAt: asString(item?.createdAt ?? item?.created_at, nowIso(), 40),
            })),
        lastMetabolismMessageId: asInteger(
            raw?.lastMetabolismMessageId ?? raw?.last_metabolism_message_id,
            -1,
            -1,
        ),
    };
}

function normalizeFactBeliefs(value, fallback = []) {
    const byKey = new Map();
    for (const raw of [...asArray(fallback), ...asArray(value)]) {
        const key = asString(raw?.key, '', 180);
        const valueText = asString(raw?.value, '', 520);
        if (!key || !valueText) continue;
        byKey.set(key, {
            key,
            value: valueText,
            factId: asString(raw?.fact_id ?? raw?.factId, '', 120),
            learnedAtMessageId: asInteger(raw?.learned_at_message_id ?? raw?.learnedAtMessageId, 0, 0),
            updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, 0, 0),
        });
    }
    return [...byKey.values()].slice(-LIMITS.cognitiveRefs);
}

function activeFactByKey(state, key) {
    const normalized = asString(key, '', 180);
    if (!normalized) return null;
    return asArray(state?.storyMemory?.facts)
        .filter(fact => fact.key === normalized && ['active', 'disputed'].includes(fact.status))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
}

function setFactBelief(person, fact, messageId = 0) {
    if (!person || !fact?.key || !fact?.value) return;
    const beliefs = normalizeFactBeliefs(person.knownFactBeliefs);
    const next = {
        key: fact.key,
        value: fact.value,
        factId: fact.id || '',
        learnedAtMessageId: asInteger(messageId, 0, 0),
        updatedAt: asInteger(fact.updatedAt, 0, 0),
    };
    const index = beliefs.findIndex(item => item.key === next.key);
    if (index >= 0) beliefs[index] = next;
    else beliefs.push(next);
    person.knownFactBeliefs = beliefs.slice(-LIMITS.cognitiveRefs);
}

function freezeKnownFactBeforeChange(state, fact) {
    if (!fact?.key || !fact?.value) return;
    for (const person of asArray(state?.people)) {
        const knowsKey = asArray(person?.knownFactKeys).some(key => (
            normalizedReference(key) === normalizedReference(fact.key)
        ));
        if (!knowsKey) continue;
        const hasSnapshot = asArray(person?.knownFactBeliefs).some(item => (
            normalizedReference(item?.key) === normalizedReference(fact.key)
        ));
        if (!hasSnapshot) setFactBelief(person, fact, person?.lastSeenMessageId || fact.sourceMessageId || 0);
    }
}

function normalizePerson(raw, existing = null, worldMinute = 0, {
    userName = '',
    allowUserInnerVoice = true,
    sourceMessageId = null,
} = {}) {
    const name = asString(raw?.name, existing?.name || 'Nhân vật chưa đặt tên', 80);
    const innerVoice = asString(raw?.inner_voice ?? raw?.innerVoice, '', LIMITS.innerVoice);
    const hasNewInnerVoice = Boolean(innerVoice);
    const longTermGoal = asString(
        raw?.long_term_goal ?? raw?.longTermGoal,
        '',
        LIMITS.longTermGoal,
    );
    // These are author-owned character anchors. A routine simulation may use
    // them as constraints, but must never silently rewrite an existing card.
    const identityAnchor = asString(
        existing
            ? existing.identityAnchor
            : (raw?.identity_anchor ?? raw?.identityAnchor),
        '',
        LIMITS.identityAnchor,
    );
    const personalityAnchor = asString(
        existing
            ? existing.personalityAnchor
            : (raw?.personality_anchor ?? raw?.personalityAnchor),
        '',
        LIMITS.personalityAnchor,
    );
    const appearanceProfile = asString(
        existing
            ? existing.appearanceProfile
            : (raw?.appearance_profile ?? raw?.appearanceProfile),
        '',
        LIMITS.appearanceProfile,
    );
    const backgroundProfile = asString(
        existing
            ? existing.backgroundProfile
            : (raw?.background_profile ?? raw?.backgroundProfile),
        '',
        LIMITS.backgroundProfile,
    );
    const worldbookRaw = asString(
        existing
            ? existing.worldbookRaw
            : (raw?.worldbook_raw ?? raw?.worldbookRaw),
        '',
        LIMITS.worldbookRaw,
    );
    const speakingStyle = asString(
        existing
            ? existing.speakingStyle
            : (raw?.speaking_style ?? raw?.speakingStyle),
        '',
        LIMITS.speakingStyle,
    );
    const behaviorBoundaries = asString(
        existing
            ? existing.behaviorBoundaries
            : (raw?.behavior_boundaries ?? raw?.behaviorBoundaries),
        '',
        LIMITS.behaviorBoundaries,
    );
    const suppliedInnerVoiceAt = raw?.inner_voice_at ?? raw?.innerVoiceAt;
    const suppliedLastSeen = raw?.last_seen_message_id ?? raw?.lastSeenMessageId;
    const presentInScene = raw?.present_in_scene ?? raw?.presentInScene;
    const suppliedLastSeenNumber = Number(suppliedLastSeen);
    const hasSuppliedLastSeen = (
        suppliedLastSeen !== null
        && suppliedLastSeen !== undefined
        && suppliedLastSeen !== ''
        && Number.isInteger(suppliedLastSeenNumber)
        && !(
            suppliedLastSeenNumber === 0
            && Number.isInteger(Number(sourceMessageId))
            && Number(sourceMessageId) > 0
        )
    );
    const normalizedUserName = asString(userName, '', 80).toLocaleLowerCase();
    const isUser = Boolean(
        (
            normalizedUserName
            && name.toLocaleLowerCase() === normalizedUserName
        )
        || raw?.is_user
        || raw?.isUser
        || raw?.role === 'user'
        || existing?.isUser,
    );
    const storedInnerVoice = isUser && !allowUserInnerVoice
        ? ''
        : (hasNewInnerVoice ? innerVoice : asString(existing?.innerVoice, '', LIMITS.innerVoice));

    return {
        id: normalizeId(raw?.id || existing?.id || name, 'person'),
        name,
        isUser,
        monogram: asString(raw?.monogram, existing?.monogram || name.slice(0, 1), 4),
        location: asString(raw?.location, existing?.location || 'Vị trí chờ xác nhận', 160),
        action: asString(raw?.action, existing?.action || 'Hành động hiện tại chờ xác nhận', 280),
        intent: asString(raw?.intent, existing?.intent || 'Ý định ngắn hạn chờ xác nhận', 320),
        longTermGoal: longTermGoal || asString(existing?.longTermGoal, '', LIMITS.longTermGoal),
        identityAnchor,
        personalityAnchor,
        appearanceProfile,
        backgroundProfile,
        worldbookRaw,
        speakingStyle,
        behaviorBoundaries,
        simulationEnabled: Boolean(
            raw?.simulation_enabled
            ?? raw?.simulationEnabled
            ?? existing?.simulationEnabled
            ?? true,
        ),
        locked: Boolean(raw?.locked ?? existing?.locked),
        manual: Boolean(raw?.manual ?? existing?.manual),
        trace: asString(raw?.trace, existing?.trace || '', 360),
        innerVoice: storedInnerVoice,
        innerVoiceAt: isUser && !allowUserInnerVoice
            ? worldMinute
            : hasNewInnerVoice
            ? asInteger(suppliedInnerVoiceAt, worldMinute, 0)
            : asInteger(existing?.innerVoiceAt, worldMinute, 0),
        knowledge: normalizeKnowledge(raw?.knowledge ?? existing?.knowledge),
        cognitionReady: Boolean(
            raw?.cognition_ready
            ?? raw?.cognitionReady
            ?? existing?.cognitionReady
            ?? false,
        ),
        knownEventIds: mergeUniqueStrings(
            existing?.knownEventIds,
            raw?.known_event_ids ?? raw?.knownEventIds,
            LIMITS.cognitiveRefs,
        ),
        knownFactKeys: mergeUniqueStrings(
            existing?.knownFactKeys,
            raw?.known_fact_keys ?? raw?.knownFactKeys,
            LIMITS.cognitiveRefs,
        ),
        knownFactBeliefs: normalizeFactBeliefs(
            raw?.known_fact_beliefs ?? raw?.knownFactBeliefs,
            existing?.knownFactBeliefs,
        ),
        knownClueIds: mergeUniqueStrings(
            existing?.knownClueIds,
            raw?.known_clue_ids ?? raw?.knownClueIds,
            LIMITS.cognitiveRefs,
        ),
        physicalState: asString(
            raw?.physical_state ?? raw?.physicalState ?? existing?.physicalState,
            '',
            LIMITS.personState,
        ),
        emotionalState: asString(
            raw?.emotional_state ?? raw?.emotionalState ?? existing?.emotionalState,
            '',
            LIMITS.personState,
        ),
        resourceState: asString(
            raw?.resource_state ?? raw?.resourceState ?? existing?.resourceState,
            '',
            LIMITS.personState,
        ),
        relevance: asInteger(raw?.relevance, existing?.relevance ?? 1, 0, 3),
        source: ['foreground', 'background', 'manual'].includes(raw?.source)
            ? raw.source
            : (existing?.source || 'background'),
        worldbookRef: asString(
            existing?.worldbookRef ?? raw?.worldbookRef ?? raw?.worldbook_ref,
            '',
            180,
        ),
        lastSeenMessageId: hasSuppliedLastSeen
            ? suppliedLastSeenNumber
            : (
                raw?.source === 'foreground'
                && Number.isInteger(Number(sourceMessageId))
            )
                ? Number(sourceMessageId)
                : asInteger(existing?.lastSeenMessageId, -1, -1),
        presentInSceneMessageId: presentInScene === true
            && Number.isInteger(Number(sourceMessageId))
            ? Number(sourceMessageId)
            : asInteger(existing?.presentInSceneMessageId, -1, -1),
        updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, worldMinute, 0),
    };
}

export function normalizeEvent(raw, worldMinute = 0, existing = null) {
    const clockMode = normalizeClockMode(raw?.clock_mode ?? raw?.clockMode ?? existing?.clockMode);
    const startedAt = asInteger(
        raw?.started_at ?? raw?.startedAt,
        existing?.startedAt ?? worldMinute,
        0,
    );
    const durationMinutes = asInteger(
        raw?.duration_minutes ?? raw?.durationMinutes,
        existing?.durationMinutes ?? 0,
        0,
        5 * 365 * MINUTES_PER_DAY,
    );
    let dueAt = raw?.scheduled_at ?? raw?.due_at ?? raw?.dueAt;
    dueAt = Number.isFinite(Number(dueAt))
        ? asInteger(dueAt, 0, 0)
        : (existing?.dueAt ?? null);

    if (dueAt === null && clockMode === 'duration' && durationMinutes > 0) {
        dueAt = startedAt + durationMinutes;
    }

    const status = normalizeEventStatus(raw?.status ?? existing?.status);
    const visibility = normalizeVisibility(raw?.visibility ?? existing?.visibility);
    const oldDelivery = existing?.delivery || {};
    const requestedDeliveryState = asString(raw?.delivery_state, oldDelivery.state || '', 30);
    const defaultDeliveryState = TERMINAL_EVENT_STATES.has(status) && visibility !== 'hidden'
        ? 'pending'
        : 'none';
    const deliveryState = ['none', 'pending', 'delivered', 'expired'].includes(requestedDeliveryState)
        ? requestedDeliveryState
        : (oldDelivery.state || defaultDeliveryState);

    return {
        id: normalizeId(raw?.id || existing?.id, 'event'),
        title: asString(raw?.title, existing?.title || 'Sự kiện chưa đặt tên', 140),
        place: asString(raw?.place, existing?.place || 'Địa điểm chờ xác nhận', 140),
        summary: asString(raw?.summary, existing?.summary || '', 420),
        consequence: asString(raw?.consequence, existing?.consequence || '', 420),
        expectedResult: asString(
            raw?.expected_result ?? raw?.expectedResult,
            existing?.expectedResult || '',
            420,
        ),
        result: asString(raw?.result, existing?.result || '', 520),
        status,
        clockMode,
        startedAt,
        dueAt,
        durationMinutes,
        accruedMinutes: asInteger(
            raw?.accrued_minutes ?? raw?.accruedMinutes,
            existing?.accruedMinutes ?? 0,
            0,
            5 * 365 * MINUTES_PER_DAY,
        ),
        lastCheckedAt: asInteger(
            raw?.last_checked_at ?? raw?.lastCheckedAt,
            existing?.lastCheckedAt ?? worldMinute,
            0,
        ),
        prerequisites: uniqueStrings(raw?.prerequisites ?? existing?.prerequisites, 12),
        cause: asString(
            raw?.cause ?? existing?.cause,
            '',
            LIMITS.eventCause,
        ),
        actors: mergeUniqueStrings(existing?.actors, raw?.actors, 16),
        knownBy: mergeUniqueStrings(
            existing?.knownBy,
            raw?.known_by ?? raw?.knownBy,
            LIMITS.cognitiveRefs,
        ),
        causedBy: mergeUniqueStrings(
            existing?.causedBy,
            raw?.caused_by ?? raw?.causedBy,
            12,
        ),
        publicTrace: visibility === 'hidden'
            ? ''
            : asString(
                raw?.public_trace ?? raw?.publicTrace ?? existing?.publicTrace,
                '',
                LIMITS.eventPublicTrace,
            ),
        visibility,
        delivery: {
            state: deliveryState,
            manualQueued: Boolean(
                raw?.delivery_queued
                ?? raw?.deliveryQueued
                ?? oldDelivery.manualQueued,
            ),
            attempts: asInteger(oldDelivery.attempts, 0, 0, 99),
            route: asString(raw?.delivery_route, oldDelivery.route || '', 220),
            confirmedAt: oldDelivery.confirmedAt ?? null,
            confirmedMessageId: oldDelivery.confirmedMessageId ?? null,
            lastOfferedAt: oldDelivery.lastOfferedAt ?? null,
        },
        createdAt: existing?.createdAt ?? worldMinute,
        updatedAt: asInteger(
            raw?.updated_at ?? raw?.updatedAt,
            existing?.updatedAt ?? worldMinute,
            0,
        ),
        resolvedAt: TERMINAL_EVENT_STATES.has(status)
            ? (existing?.resolvedAt ?? worldMinute)
            : null,
    };
}

export function eventProgress(event, worldMinute) {
    if (event?.status === 'ready' || TERMINAL_EVENT_STATES.has(event?.status)) {
        return {
            ratio: 1,
            percent: 100,
            remaining: 0,
        phase: event.status === 'ready' ? 'Thời gian đến chờ xác nhận' : 'Đã hình thành kết quả',
        };
    }

    if (event?.clockMode === 'condition') {
        return {
            ratio: null,
            percent: null,
            remaining: null,
            phase: 'Chờ điều kiện',
        };
    }

    if (event?.clockMode === 'active') {
        const duration = Math.max(1, Number(event.durationMinutes) || 1);
        const accrued = Math.max(0, Number(event.accruedMinutes) || 0);
        const ratio = clamp(accrued / duration, 0, 1);
        return {
            ratio,
            percent: Math.round(ratio * 100),
            remaining: Math.max(0, duration - accrued),
            phase: ratio >= 0.72 ? 'Sắp hoàn thành' : ratio >= 0.28 ? 'Phát triển' : 'Nảy mầm',
        };
    }

    const dueAt = Number(event?.dueAt);
    const startedAt = Number(event?.startedAt);
    if (!Number.isFinite(dueAt) || !Number.isFinite(startedAt) || dueAt <= startedAt) {
        return {
            ratio: null,
            percent: null,
            remaining: null,
            phase: event?.clockMode === 'scheduled' ? 'Chờ thời điểm' : 'Thời gian chờ xác nhận',
        };
    }

    const elapsed = Math.max(0, worldMinute - startedAt);
    const duration = dueAt - startedAt;
    const ratio = clamp(elapsed / duration, 0, 1);
    const remaining = Math.max(0, dueAt - worldMinute);
    let phase = ratio >= 0.72 ? 'Sắp hoàn thành' : ratio >= 0.28 ? 'Phát triển' : 'Nảy mầm';
    if (event.clockMode === 'scheduled') {
        phase = remaining <= 30 ? 'Đang đến gần' : 'Chờ thời điểm';
    }

    return {
        ratio,
        percent: Math.round(ratio * 100),
        remaining,
        phase,
    };
}

function appendAudit(state, entry) {
    state.audit.unshift({
        id: makeId('audit'),
        at: state.clock.absoluteMinute,
        createdAt: nowIso(),
        ...entry,
    });
    state.audit = state.audit.slice(0, LIMITS.audit);
}

export function settleTimedEvents(inputState, targetMinute, {
    source = 'world',
    reason = '',
} = {}) {
    const state = deepClone(inputState);
    const previousMinute = asInteger(state.clock?.absoluteMinute, 0, 0);
    const nextMinute = asInteger(targetMinute, previousMinute, 0);
    const previousStamp = formatWorldCalendar(state, previousMinute).stamp;

    state.clock = {
        ...state.clock,
        absoluteMinute: nextMinute,
        lastCheckedAt: nextMinute,
        source,
        reason: asString(reason, '', 240),
    };

    if (nextMinute >= previousMinute) {
        for (const event of state.events) {
            if (!ACTIVE_EVENT_STATES.has(event.status)) continue;
            event.lastCheckedAt = nextMinute;

            if (!['duration', 'scheduled'].includes(event.clockMode)) continue;
            if (!Number.isFinite(Number(event.dueAt))) continue;

            if (nextMinute >= Number(event.dueAt)) {
                event.status = 'ready';
                event.updatedAt = nextMinute;
                event.result = event.result || event.expectedResult || '';
            }
        }
    }

    if (nextMinute !== previousMinute) {
        appendAudit(state, {
            type: nextMinute > previousMinute ? 'clock_advanced' : 'clock_corrected',
            text: `${previousStamp} → ${formatWorldCalendar(state, nextMinute).stamp}`,
            reason: asString(reason, '', 240),
        });
    }

    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    return trimState(state);
}

function findPerson(state, raw) {
    const id = asString(raw?.id, '', 100);
    const name = asString(raw?.name, '', 80);
    return state.people.find(person => (id && person.id === normalizeId(id, 'person')) || (name && person.name === name));
}

function findEvent(state, raw) {
    const id = asString(raw?.id, '', 100);
    if (id) {
        const normalized = normalizeId(id, 'event');
        const byId = state.events.find(event => event.id === normalized);
        if (byId) return byId;
    }

    const title = asString(raw?.title, '', 140);
    const place = asString(raw?.place, '', 140);
    return state.events.find(event => (
        title
        && event.title === title
        && (!place || event.place === place)
        && !TERMINAL_EVENT_STATES.has(event.status)
    ));
}

function normalizedReference(value) {
    return asString(value, '', 120).toLocaleLowerCase();
}

function listReferencesPerson(value, person) {
    const id = normalizedReference(person?.id);
    const name = normalizedReference(person?.name);
    return asArray(value).some(item => {
        const ref = normalizedReference(item);
        return Boolean(ref && (ref === id || ref === name));
    });
}

function eventKnownToPerson(event, person) {
    const eventId = normalizedReference(event?.id);
    const personalLedger = asArray(person?.knownEventIds)
        .some(id => normalizedReference(id) === eventId);
    return personalLedger
        || listReferencesPerson(event?.knownBy, person)
        || listReferencesPerson(event?.actors, person);
}

function synchronizeCognitiveLedger(state) {
    for (const event of asArray(state?.events)) {
        for (const person of asArray(state?.people)) {
            if (eventKnownToPerson(event, person)) {
                person.knownEventIds = mergeUniqueStrings(
                    person.knownEventIds,
                    [event.id],
                    LIMITS.cognitiveRefs,
                );
            }
            if (asArray(person?.knownEventIds).some(
                id => normalizedReference(id) === normalizedReference(event?.id),
            )) {
                event.knownBy = mergeUniqueStrings(
                    event.knownBy,
                    [person.id],
                    LIMITS.cognitiveRefs,
                );
            }
        }
    }
}

function markTerminal(event, status, worldMinute, result = '') {
    event.status = status;
    event.result = asString(result, event.result || event.expectedResult || '', 520);
    event.resolvedAt = worldMinute;
    event.updatedAt = worldMinute;
    if (event.visibility !== 'hidden' && event.delivery.state !== 'delivered') {
        event.delivery.state = 'pending';
    }
}

function findClue(memory, raw) {
    const id = asString(raw?.id ?? raw, '', 100);
    if (id) {
        const normalized = normalizeId(id, 'clue');
        const byId = memory.clues.find(clue => clue.id === normalized);
        if (byId) return byId;
    }
    const text = asString(raw?.text, '', 620);
    if (!text) return null;
    const fingerprint = text.replace(/\s+/g, '').slice(0, 80);
    return memory.clues.find(clue => (
        clue.text.replace(/\s+/g, '').slice(0, 80) === fingerprint
    )) || null;
}

function appendMemoryMetabolism(state, {
    kind = 'memory',
    action = 'updated',
    targetId = '',
    replacementId = '',
    reason = '',
    sourceMessageId = 0,
} = {}) {
    state.storyMemory ||= {};
    state.storyMemory.metabolismLog = asArray(state.storyMemory.metabolismLog);
    state.storyMemory.metabolismLog.push({
        id: makeId('metabolism'),
        kind: asString(kind, 'memory', 30),
        action: asString(action, 'updated', 30),
        targetId: asString(targetId, '', 120),
        replacementId: asString(replacementId, '', 120),
        reason: asString(reason, '', 360),
        sourceMessageId: asInteger(sourceMessageId, 0, 0),
        worldMinute: asInteger(state.clock?.absoluteMinute, 0, 0),
        createdAt: nowIso(),
    });
    state.storyMemory.metabolismLog = state.storyMemory.metabolismLog.slice(-LIMITS.metabolismLog);
    state.storyMemory.lastMetabolismMessageId = Math.max(
        Number(state.storyMemory.lastMetabolismMessageId ?? -1),
        asInteger(sourceMessageId, -1, -1),
    );
}

function compactRolledUpSources(state, parentSummary, sources, { sourceMessageId = 0 } = {}) {
    for (const source of sources) {
        if (source.locked || source.important || source.manual) continue;
        if (asArray(source.tags).length) continue;
        if (Number(source.level || 0) >= MEMORY_SUMMARY_LEVELS.CHAPTER) continue;
        if (source.retentionState === 'compacted') continue;
        source.retentionState = 'compacted';
        source.compactedReason = `Chi tiết đã được ${parentSummary.title || `L${parentSummary.level}`} tóm tắt; nội dung chính gốc vẫn có thể xem lại theo phạm vi tin nhắn.`;
        source.summary = `Chi tiết đã được thu thập vào ký ức tầng trên; nội dung chính gốc xem tại tin nhắn ${source.startMessageId}—${source.endMessageId}。`;
        appendMemoryMetabolism(state, {
            kind: 'episode',
            action: 'compacted',
            targetId: source.id,
            replacementId: parentSummary.id,
            reason: source.compactedReason,
            sourceMessageId,
        });
    }
}

function findMemoryFact(memory, raw, {
    matchValue = true,
} = {}) {
    const id = asString(raw?.id ?? raw, '', 100);
    if (id) {
        const normalized = normalizeId(id, 'memory');
        const byId = memory.facts.find(fact => fact.id === normalized);
        if (byId) return byId;
    }
    const key = asString(raw?.key, '', 180);
    const value = asString(raw?.value, '', 520);
    if (!key) return null;
    return memory.facts.find(fact => (
        fact.key === key
        && (!matchValue || !value || fact.value === value)
    )) || null;
}

function applyMemoryFactUpdates(state, {
    factsUpsert = [],
    factsInvalidate = [],
} = {}, {
    sourceMessageId = null,
    sourceSwipeId = null,
} = {}) {
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    for (const rawFact of asArray(factsUpsert).slice(0, 32)) {
        const prepared = normalizeMemoryFact(rawFact, null, state.clock.absoluteMinute, {
            sourceMessageId,
            sourceSwipeId,
        });
        if (!prepared.key || !prepared.value) continue;

        const sameCandidate = findMemoryFact(state.storyMemory, prepared);
        const same = sameCandidate?.value === prepared.value ? sameCandidate : null;
        if (same) {
            if (same.locked) continue;
            Object.assign(
                same,
                normalizeMemoryFact(rawFact, same, state.clock.absoluteMinute, {
                    sourceMessageId,
                    sourceSwipeId,
                }),
            );
            continue;
        }

        const conflicts = state.storyMemory.facts.filter(fact => (
            fact.key === prepared.key
            && fact.value !== prepared.value
            && ['active', 'disputed'].includes(fact.status)
        ));
        if (conflicts.some(fact => fact.locked)) prepared.status = 'disputed';
        if (conflicts.some(fact => fact.id === prepared.id)) {
            prepared.id = normalizeId(
                `${prepared.id}_${hashText(prepared.value)}`,
                'memory',
            );
        }

        if (prepared.status === 'disputed') {
            for (const conflict of conflicts) {
                if (conflict.locked) continue;
                conflict.status = 'disputed';
                conflict.updatedAt = state.clock.absoluteMinute;
            }
        } else {
            for (const conflict of conflicts) {
                if (conflict.locked) continue;
                freezeKnownFactBeforeChange(state, conflict);
                conflict.status = 'superseded';
                conflict.supersededBy = prepared.id;
                conflict.invalidationReason = `Đã bị sự thật tiếp theo“${prepared.value}”Thay thế`;
                conflict.updatedAt = state.clock.absoluteMinute;
                appendMemoryMetabolism(state, {
                    kind: 'fact',
                    action: 'superseded',
                    targetId: conflict.id,
                    replacementId: prepared.id,
                    reason: conflict.invalidationReason,
                    sourceMessageId: sourceMessageId ?? prepared.sourceMessageId ?? 0,
                });
            }
            prepared.supersedes = uniqueStrings([
                ...prepared.supersedes,
                ...conflicts.filter(fact => !fact.locked).map(fact => fact.id),
            ], 12);
        }
        state.storyMemory.facts.unshift(prepared);
    }

    for (const rawInvalidation of asArray(factsInvalidate).slice(0, 32)) {
        const invalidation = typeof rawInvalidation === 'string'
            ? { id: rawInvalidation }
            : rawInvalidation;
        const fact = findMemoryFact(state.storyMemory, invalidation, { matchValue: false });
        if (!fact || fact.locked) continue;
        freezeKnownFactBeforeChange(state, fact);
        fact.status = 'invalidated';
        fact.invalidationReason = asString(
            invalidation?.reason ?? invalidation?.invalidation_reason,
            fact.invalidationReason || 'Đã bị nội dung chính tiếp theo phủ định',
            360,
        );
        fact.updatedAt = state.clock.absoluteMinute;
        appendMemoryMetabolism(state, {
            kind: 'fact',
            action: 'invalidated',
            targetId: fact.id,
            reason: fact.invalidationReason,
            sourceMessageId: sourceMessageId ?? fact.sourceMessageId ?? 0,
        });
    }
}

function applyClueUpdates(state, {
    cluesUpsert = [],
    cluesResolve = [],
} = {}, {
    sourceMessageId = null,
    sourceSwipeId = null,
} = {}) {
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    for (const rawClue of asArray(cluesUpsert).slice(0, 24)) {
        const existing = findClue(state.storyMemory, rawClue);
        if (existing?.locked) continue;
        const clue = normalizeClue(rawClue, existing, state.clock.absoluteMinute, {
            sourceMessageId,
            sourceSwipeId,
        });
        if (!clue.text) continue;
        if (existing) Object.assign(existing, clue);
        else state.storyMemory.clues.unshift(clue);
    }

    for (const rawResolution of asArray(cluesResolve).slice(0, 24)) {
        const resolution = typeof rawResolution === 'string'
            ? { id: rawResolution }
            : rawResolution;
        const clue = findClue(state.storyMemory, resolution);
        if (!clue || clue.locked) continue;
        clue.status = VALID_CLUE_STATES.has(resolution?.status)
            ? resolution.status
            : 'resolved';
        clue.resolution = asString(
            resolution?.resolution,
            clue.resolution || (clue.status === 'discarded' ? 'Sự phát triển tiếp theo đã chứng minh manh mối này không cần tiếp tục theo dõi' : 'Đã được nội dung chính tiếp theo hưởng ứng hoặc giải quyết'),
            520,
        );
        clue.lifecycleReason = asString(
            resolution?.reason ?? resolution?.lifecycle_reason ?? resolution?.lifecycleReason,
            clue.lifecycleReason || clue.resolution,
            360,
        );
        clue.resolvedMessageId = asInteger(
            resolution?.message_id ?? resolution?.messageId,
            sourceMessageId ?? clue.resolvedMessageId ?? 0,
            0,
        );
        clue.updatedAt = state.clock.absoluteMinute;
        appendMemoryMetabolism(state, {
            kind: 'clue',
            action: clue.status,
            targetId: clue.id,
            reason: clue.lifecycleReason || clue.resolution,
            sourceMessageId: sourceMessageId ?? clue.resolvedMessageId ?? 0,
        });
    }
}

function normalizeSimulationResult(payload) {
    const rawClockAnchor = payload?.clock_anchor ?? payload?.clockAnchor ?? {};
    const anchorMode = ['none', 'initialize', 'calibrate'].includes(rawClockAnchor?.mode)
        ? rawClockAnchor.mode
        : 'none';
    const anchorPrecision = ['minute', 'daypart', 'date'].includes(rawClockAnchor?.precision)
        ? rawClockAnchor.precision
        : 'minute';
    const anchorConfidence = ['low', 'medium', 'high'].includes(rawClockAnchor?.confidence)
        ? rawClockAnchor.confidence
        : 'low';
    return {
        elapsedMinutes: asInteger(
            payload?.elapsed_minutes ?? payload?.elapsedMinutes,
            0,
            0,
            5 * 365 * MINUTES_PER_DAY,
        ),
        timeReason: asString(payload?.time_reason ?? payload?.timeReason, '', 320),
        clockAnchor: {
            mode: anchorMode,
            calendarName: asString(
                rawClockAnchor?.calendar_name ?? rawClockAnchor?.calendarName,
                '',
                40,
            ),
            year: asInteger(rawClockAnchor?.year, 0, 0, 9999),
            month: asInteger(rawClockAnchor?.month, 0, 0, 12),
            day: asInteger(rawClockAnchor?.day, 0, 0, 31),
            hour: asInteger(rawClockAnchor?.hour, 0, 0, 23),
            minute: asInteger(rawClockAnchor?.minute, 0, 0, 59),
            hasDate: (() => {
                const year = Number(rawClockAnchor?.year);
                const month = Number(rawClockAnchor?.month);
                const day = Number(rawClockAnchor?.day);
                return Number.isFinite(year) && year >= 1 && year <= 9999
                    && Number.isFinite(month) && month >= 1 && month <= 12
                    && Number.isFinite(day) && day >= 1 && day <= 31;
            })(),
            hasTime: (() => {
                const rawHour = rawClockAnchor?.hour;
                const rawMinute = rawClockAnchor?.minute;
                if (rawHour === null || rawHour === undefined || rawHour === '') return false;
                if (rawMinute === null || rawMinute === undefined || rawMinute === '') return false;
                const hour = Number(rawHour);
                const minute = Number(rawMinute);
                return Number.isFinite(hour) && hour >= 0 && hour <= 23
                    && Number.isFinite(minute) && minute >= 0 && minute <= 59;
            })(),
            precision: anchorPrecision,
            confidence: anchorConfidence,
            sourceExcerpt: asString(
                rawClockAnchor?.source_excerpt ?? rawClockAnchor?.sourceExcerpt,
                '',
                220,
            ),
            reason: asString(rawClockAnchor?.reason, '', 240),
        },
        world: {
            title: asString(payload?.world?.title, '', 180),
            detail: asString(payload?.world?.detail, '', 640),
        },
        peopleUpsert: asArray(payload?.people_upsert ?? payload?.peopleUpsert).slice(0, LIMITS.people),
        peopleRemove: uniqueStrings(payload?.people_remove ?? payload?.peopleRemove, LIMITS.people),
        eventsCreate: asArray(payload?.events_create ?? payload?.eventsCreate).slice(0, 24),
        eventsUpdate: asArray(payload?.events_update ?? payload?.eventsUpdate).slice(0, 36),
        deliveriesConfirmed: uniqueStrings(
            payload?.deliveries_confirmed ?? payload?.deliveriesConfirmed,
            24,
        ),
        foregroundFacts: asArray(payload?.front_facts ?? payload?.frontFacts).slice(0, 16),
        worldFactsUpsert: asArray(
            payload?.world_facts_upsert ?? payload?.worldFactsUpsert,
        ).slice(0, 32),
        consistencyConflicts: asArray(
            payload?.consistency_conflicts ?? payload?.consistencyConflicts,
        ).slice(0, 24),
        memoryUpdates: {
            factsUpsert: asArray(
                payload?.memory_update?.facts_upsert
                ?? payload?.memoryUpdate?.factsUpsert,
            ).slice(0, 32),
            factsInvalidate: asArray(
                payload?.memory_update?.facts_invalidate
                ?? payload?.memoryUpdate?.factsInvalidate,
            ).slice(0, 32),
            cluesUpsert: asArray(
                payload?.memory_update?.clues_upsert
                ?? payload?.memoryUpdate?.cluesUpsert,
            ).slice(0, 24),
            cluesResolve: asArray(
                payload?.memory_update?.clues_resolve
                ?? payload?.memoryUpdate?.cluesResolve,
            ).slice(0, 24),
        },
    };
}

function conflictKeepsPersonField(rawConflicts, person, field) {
    const aliases = new Set([
        String(person?.id || '').toLocaleLowerCase(),
        String(person?.name || '').toLocaleLowerCase(),
    ].filter(Boolean));
    return asArray(rawConflicts).some(raw => {
        const subject = String(raw?.subject_id ?? raw?.subjectId ?? raw?.subject ?? '')
            .trim().toLocaleLowerCase();
        const rawField = String(raw?.field || '').trim();
        const resolution = String(raw?.resolution || '').trim();
        return aliases.has(subject) && rawField === field && resolution === 'keep-world';
    });
}

function narrativeSupportsLocationValue(narrativeText, value) {
    const text = String(narrativeText || '').replace(/\s+/g, '');
    const compactValue = String(value || '').replace(/\s+/g, '').trim();
    if (!text || compactValue.length < 2) return false;
    const terms = uniqueStrings([
        compactValue,
        ...compactValue.split(/[ của, ,，/·|｜]/g),
    ], 12).filter(term => term.length >= 2);
    for (const term of terms) {
        let index = text.indexOf(term);
        while (index >= 0) {
            const window = text.slice(Math.max(0, index - 28), Math.min(text.length, index + term.length + 18));
            if (
                /(?:Địa điểm|Vị trí|Nơi ở|Cảnh)[：:]/.test(window)
                || /(?:Tại|Nằm ở|Đang ở|Đến|Đến nơi|Tới|Trở về|Quay lại|Tiến vào|Bước vào|Đi đến|Kịp đến|Đã đi|Sống ở|Ở lại|Nán lại|Nằm ở|Ngồi ở|Đứng ở|Xuất hiện ở|Rời khỏi)[^。！？!?]{0,22}/.test(window)
            ) return true;
            index = text.indexOf(term, index + term.length);
        }
    }
    return false;
}

function authoritativePersonFact(state, personId, field) {
    const key = `person:${personId}:${field}`;
    return asArray(state?.worldFacts).find(fact => fact?.key === key && fact?.confidence === 'high') || null;
}

export function applySimulationResult(baseState, rawPayload, {
    messageId = null,
    swipeId = null,
    sourceKey = '',
    userName = '',
    allowUserInnerVoice = true,
    timePolicy = 'open',
    narrativeText = '',
    backgroundNpcBudget = LIMITS.people,
} = {}) {
    const payload = normalizeSimulationResult(rawPayload);
    const baseClockAnchored = Boolean(baseState?.clock?.anchored);
    const anchor = payload.clockAnchor;
    const narrativeCalendar = extractExplicitCalendarDate(narrativeText);
    const narrativeAnchor = extractNarrativeTimeAnchor(narrativeText);

    // A date explicitly written by the foreground is authoritative even after
    // the world clock has already been initialized. Dedicated “time & place”
    // details are also treated as a strong same-day clock source: when they move
    // forward on the current date, the backstage clock follows deterministically
    // instead of hoping the simulation model converts the timestamp to elapsed time.
    const currentCalendar = formatWorldCalendar(baseState);
    const currentMinuteOfDay = currentCalendar.hour * 60 + currentCalendar.minute;
    const narrativeMinuteOfDay = narrativeAnchor
        && narrativeAnchor.hour !== null
        && narrativeAnchor.minute !== null
        ? Number(narrativeAnchor.hour) * 60 + Number(narrativeAnchor.minute)
        : null;
    const structuredForwardExact = Boolean(
        baseClockAnchored
        && narrativeAnchor?.structured
        && Number.isFinite(narrativeMinuteOfDay)
        && narrativeMinuteOfDay >= currentMinuteOfDay
    );

    if (narrativeCalendar) {
        const dateChanged = (
            currentCalendar.year !== narrativeCalendar.year
            || currentCalendar.month !== narrativeCalendar.month
            || currentCalendar.dayOfMonth !== narrativeCalendar.day
        );
        const reliableExact = Boolean(
            narrativeAnchor
            && narrativeAnchor.hour !== null
            && narrativeAnchor.minute !== null
            && (
                !baseClockAnchored
                || dateChanged
                || structuredForwardExact
                || /→|->|Đến|Đến/.test(narrativeAnchor.excerpt || '')
            )
        );
        if (!anchor?.hasDate || dateChanged || reliableExact) {
            anchor.mode = baseClockAnchored ? 'calibrate' : 'initialize';
            anchor.year = narrativeCalendar.year;
            anchor.month = narrativeCalendar.month;
            anchor.day = narrativeCalendar.day;
            anchor.hasDate = true;
            if (reliableExact) {
                anchor.hour = narrativeAnchor.hour;
                anchor.minute = narrativeAnchor.minute;
                anchor.hasTime = true;
                anchor.precision = 'minute';
            } else if (!anchor.hasTime) {
                anchor.precision = narrativeAnchor?.daypart ? 'daypart' : 'date';
            }
            anchor.confidence = 'high';
            anchor.sourceExcerpt = anchor.sourceExcerpt || narrativeAnchor?.excerpt || narrativeCalendar.excerpt;
            anchor.reason = anchor.reason || (
                baseClockAnchored
                    ? 'Nội dung chính đưa ra thông tin thời gian rõ ràng mới, tự động hiệu chuẩn thời gian thế giới chính'
                    : 'Thiết lập điểm neo thời gian thế giới chính từ thông tin thời gian rõ ràng trong nội dung chính'
            );
        }
    } else if (structuredForwardExact) {
        anchor.mode = 'calibrate';
        anchor.year = currentCalendar.year;
        anchor.month = currentCalendar.month;
        anchor.day = currentCalendar.dayOfMonth;
        anchor.hour = narrativeAnchor.hour;
        anchor.minute = narrativeAnchor.minute;
        anchor.hasDate = true;
        anchor.hasTime = true;
        anchor.precision = 'minute';
        anchor.confidence = 'high';
        anchor.sourceExcerpt = anchor.sourceExcerpt || narrativeAnchor.excerpt;
        anchor.reason = anchor.reason || 'Cột thời gian của nội dung chính đưa ra giờ giấc rõ ràng muộn hơn, tự động hiệu chuẩn thời gian thế giới chính';
    }

    // Date and clock time are intentionally separate. A story may give an
    // authoritative YYYY/M/D while only saying “Sáng sớm/Buổi chiều” for the time of day.
    // Older builds required both fields, which caused the calendar date to stay
    // on the placeholder epoch forever.
    if (
        !baseClockAnchored
        && !anchor?.hasDate
        && narrativeCalendar
        && timePolicy === 'world'
    ) {
        anchor.mode = 'initialize';
        anchor.year = narrativeCalendar.year;
        anchor.month = narrativeCalendar.month;
        anchor.day = narrativeCalendar.day;
        anchor.hasDate = true;
        anchor.precision = anchor.precision === 'minute' ? 'date' : anchor.precision;
        anchor.confidence = ['medium', 'high'].includes(anchor.confidence)
            ? anchor.confidence
            : 'high';
        anchor.sourceExcerpt = anchor.sourceExcerpt || narrativeCalendar.excerpt;
        anchor.reason = anchor.reason || 'Thiết lập điểm neo lịch thế giới chính từ ngày tháng năm rõ ràng trong nội dung chính';
    }

    const anchorHasDate = Boolean(anchor?.hasDate);
    const anchorHasExactTime = Boolean(anchor?.hasTime);
    const initializeClock = !baseClockAnchored
        && anchorHasDate
        && ['initialize', 'calibrate'].includes(anchor?.mode)
        && ['medium', 'high'].includes(anchor?.confidence);
    const recalibrateClock = baseClockAnchored
        && anchorHasDate
        && anchor?.mode === 'calibrate'
        && anchor?.confidence === 'high';
    const anchorApplied = initializeClock || recalibrateClock;
    const exactAnchorApplied = anchorApplied && anchorHasExactTime;

    const requestedElapsedMinutes = payload.elapsedMinutes;
    const explicitTimeEvidence = hasExplicitTimeEvidence(narrativeText);
    if (exactAnchorApplied) {
        // A minute-precise clock_anchor represents the end-of-batch story time.
        // Applying elapsed_minutes on top would double-count the same span.
        payload.elapsedMinutes = 0;
    } else if (!anchorApplied && !baseClockAnchored && timePolicy === 'world') {
        // In world-clock mode, do not let the placeholder epoch drift forward.
        // The first successful time operation must establish a real story anchor.
        payload.elapsedMinutes = 0;
    } else {
        payload.elapsedMinutes = resolveElapsedMinutes(
            requestedElapsedMinutes,
            narrativeText,
            timePolicy,
        );
    }
    if (!explicitTimeEvidence && timePolicy !== 'open') {
        for (const update of payload.eventsUpdate) {
            const requestedWork = asInteger(
                update?.worked_minutes ?? update?.workedMinutes,
                0,
                0,
            );
            const guardedWork = timePolicy === 'cautious'
                ? Math.min(requestedWork, 180)
                : timePolicy === 'world'
                    ? requestedWork
                    : 0;
            update.worked_minutes = guardedWork;
            update.workedMinutes = guardedWork;
        }
    }
    if (anchorApplied) {
        payload.timeReason = anchor.reason
            || (initializeClock ? 'Thiết lập điểm neo thời gian thế giới chính từ ngữ cảnh câu chuyện' : 'Nội dung chính đưa ra thời gian tuyệt đối đáng tin cậy mới, hiệu chuẩn đồng hồ thế giới chính');
    } else if (!baseClockAnchored && timePolicy === 'world') {
        payload.timeReason = 'Chưa tìm thấy điểm neo thời gian câu chuyện đủ đáng tin cậy, vòng này không tiến hành đồng hồ giữ chỗ';
    } else if (requestedElapsedMinutes > 0 && payload.elapsedMinutes === 0) {
        payload.timeReason = 'Nội dung chính không có bằng chứng thời gian rõ ràng, có thể tính toán, vòng này giữ nguyên đồng hồ thế giới';
    } else if (payload.elapsedMinutes < requestedElapsedMinutes) {
        payload.timeReason = `Thời gian nội dung chính khá mơ hồ, vòng này tiến hành tối đa ${payload.elapsedMinutes} Phút`;
    }
    let anchoredBaseState = baseState;
    if (initializeClock) {
        const currentClock = formatWorldCalendar(baseState);
        anchoredBaseState = setWorldCalendar(baseState, {
            calendarName: anchor.calendarName || baseState?.world?.calendar?.name || 'Lịch thế giới chính',
            year: anchor.year,
            month: anchor.month,
            day: anchor.day,
            hour: anchorHasExactTime ? anchor.hour : currentClock.hour,
            minute: anchorHasExactTime ? anchor.minute : currentClock.minute,
            reason: payload.timeReason,
        });
        anchoredBaseState.clock.source = 'narrative-anchor-init';
        anchoredBaseState.clock.anchored = true;
        anchoredBaseState.clock.precision = anchor.precision;
        appendAudit(anchoredBaseState, {
            type: 'clock_anchor_initialized',
            text: `Thiết lập điểm neo thời gian thế giới chính:${formatWorldCalendar(anchoredBaseState).stamp}`,
            reason: anchor.sourceExcerpt
                ? `${payload.timeReason}；Căn cứ:${anchor.sourceExcerpt}`
                : payload.timeReason,
        });
    } else if (recalibrateClock) {
        const current = formatWorldCalendar(baseState);
        const dayDelta = calendarDayDifference({
            year: current.year,
            month: current.month,
            day: current.dayOfMonth,
        }, {
            year: anchor.year,
            month: anchor.month,
            day: anchor.day,
        });
        const currentMinuteOfDay = current.hour * 60 + current.minute;
        const anchorMinuteOfDay = anchorHasExactTime
            ? anchor.hour * 60 + anchor.minute
            : currentMinuteOfDay;
        const targetMinute = Math.max(
            0,
            baseState.clock.absoluteMinute
                + dayDelta * MINUTES_PER_DAY
                + anchorMinuteOfDay
                - currentMinuteOfDay,
        );
        anchoredBaseState = settleTimedEvents(baseState, targetMinute, {
            source: 'narrative-anchor',
            reason: payload.timeReason,
        });
        if (anchor.calendarName) {
            anchoredBaseState.world.calendar.name = anchor.calendarName;
        }
        anchoredBaseState.clock.anchored = true;
        anchoredBaseState.clock.precision = anchor.precision;
        appendAudit(anchoredBaseState, {
            type: 'clock_anchor_recalibrated',
            text: `Hiệu chuẩn lại thời gian thế giới chính:${formatWorldCalendar(anchoredBaseState).stamp}`,
            reason: anchor.sourceExcerpt
                ? `${payload.timeReason}；Căn cứ:${anchor.sourceExcerpt}`
                : payload.timeReason,
        });
    }
    let state = settleTimedEvents(
        anchoredBaseState,
        anchoredBaseState.clock.absoluteMinute + payload.elapsedMinutes,
        {
            source: anchorApplied ? anchoredBaseState.clock.source : 'narrative',
            reason: payload.timeReason || 'Suy diễn nội dung chính',
        },
    );
    const worldMinute = state.clock.absoluteMinute;

    if (payload.world.title) state.world.title = payload.world.title;
    if (payload.world.detail) state.world.detail = payload.world.detail;

    const preFactByKey = new Map(
        asArray(state.storyMemory?.facts)
            .filter(fact => ['active', 'disputed'].includes(fact.status))
            .map(fact => [fact.key, deepClone(fact)]),
    );
    const cognitionBefore = new Map(
        asArray(state.people).map(person => [person.id, {
            knownFactKeys: [...asArray(person.knownFactKeys)],
            knownFactBeliefs: normalizeFactBeliefs(person.knownFactBeliefs),
        }]),
    );
    const pendingFactBeliefUpdates = [];

    const generatedConsistencyConflicts = [];
    let backgroundNpcUpdates = 0;
    const maximumBackgroundNpcUpdates = asInteger(
        backgroundNpcBudget,
        LIMITS.people,
        0,
        LIMITS.people,
    );
    const enforceForegroundEvidence = maximumBackgroundNpcUpdates < LIMITS.people;
    const narrativeForPeople = asString(narrativeText, '', 60000).toLocaleLowerCase();
    for (const rawPerson of payload.peopleUpsert) {
        const personName = asString(rawPerson?.name, '', 80).toLocaleLowerCase();
        const playerPerson = Boolean(
            rawPerson?.is_user
            || rawPerson?.isUser
            || rawPerson?.role === 'user'
        );
        const namedInNarrative = Boolean(
            personName
            && narrativeForPeople
            && narrativeForPeople.includes(personName)
        );
        const foregroundPerson = playerPerson || (
            rawPerson?.source === 'foreground'
            && (!enforceForegroundEvidence || namedInNarrative)
        );
        if (!foregroundPerson) {
            if (backgroundNpcUpdates >= maximumBackgroundNpcUpdates) continue;
            backgroundNpcUpdates += 1;
        }
        const existing = findPerson(state, rawPerson);
        if (existing && !foregroundPerson && existing.simulationEnabled === false) continue;
        const existingCognition = existing ? cognitionBefore.get(existing.id) : null;
        const incomingFactKeys = uniqueStrings(rawPerson?.known_fact_keys ?? rawPerson?.knownFactKeys, LIMITS.cognitiveRefs);
        const refreshFactKeys = uniqueStrings(rawPerson?.known_fact_refresh_keys ?? rawPerson?.knownFactRefreshKeys, LIMITS.cognitiveRefs);
        pendingFactBeliefUpdates.push({
            personId: existing?.id || normalizeId(rawPerson?.id || rawPerson?.name, 'person'),
            incomingFactKeys,
            refreshFactKeys,
            previousKeys: existingCognition?.knownFactKeys || [],
            previousBeliefs: existingCognition?.knownFactBeliefs || [],
        });
        const person = normalizePerson(rawPerson, existing, worldMinute, {
            userName,
            allowUserInnerVoice,
            sourceMessageId: messageId,
        });
        if (existing && foregroundPerson && !baseState?.needsReconciliation) {
            const authoritativeLocation = authoritativePersonFact(state, existing.id, 'location');
            const requestedLocation = asString(
                rawPerson?.location,
                existing.location || '',
                160,
            );
            const locationChanged = Boolean(
                requestedLocation
                && authoritativeLocation?.value
                && requestedLocation !== authoritativeLocation.value
            );
            const explicitKeep = conflictKeepsPersonField(
                payload.consistencyConflicts,
                existing,
                'location',
            );
            const narrativeSupport = locationChanged
                ? narrativeSupportsLocationValue(narrativeText, requestedLocation)
                : true;
            if (locationChanged && (explicitKeep || !narrativeSupport)) {
                person.location = authoritativeLocation.value;
                generatedConsistencyConflicts.push({
                    subject: existing.name,
                    field: 'location',
                    previous_value: authoritativeLocation.value,
                    narrative_value: requestedLocation,
                    resolution: 'keep-world',
                    reason: explicitKeep
                        ? 'Suy diễn nhận diện được nội dung chính và vị trí chuẩn không có xung đột chuyển tiếp, giữ nguyên sự thật thế giới hiện có'
                        : 'Nội dung chính không tìm thấy bằng chứng thay đổi vị trí đủ rõ ràng, từ chối dùng mô hình suy luận ghi đè vị trí chuẩn mà không có chuyển tiếp',
                    message_id: messageId,
                });
            }
        }
        if (existing) {
            if (existing.locked) {
                person.name = existing.name;
                person.isUser = existing.isUser;
                person.longTermGoal = existing.longTermGoal;
                person.simulationEnabled = existing.simulationEnabled;
                person.locked = true;
                person.manual = existing.manual;
            }
            Object.assign(existing, person);
            settlePersonStateFacts(
                state,
                existing,
                foregroundPerson ? 'narrative' : 'simulation',
                messageId,
            );
        } else {
            state.people.push(person);
            settlePersonStateFacts(
                state,
                person,
                foregroundPerson ? 'narrative' : 'simulation',
                messageId,
            );
        }
    }

    if (payload.peopleRemove.length) {
        const removed = new Set(payload.peopleRemove.map(item => item.toLowerCase()));
        const removedPersonIds = new Set(
            state.people
                .filter(person => (
                    !person.locked
                    && (
                        removed.has(person.id.toLowerCase())
                        || removed.has(person.name.toLowerCase())
                    )
                ))
                .map(person => person.id),
        );
        state.people = state.people.filter(person => (
            person.locked
            || !removedPersonIds.has(person.id)
        ));
        if (removedPersonIds.size) {
            state.worldFacts = asArray(state.worldFacts).filter(fact => !(
                fact?.subjectType === 'person'
                && removedPersonIds.has(fact?.subjectId)
            ));
        }
    }

    for (const rawEvent of payload.eventsCreate) {
        const existing = findEvent(state, rawEvent);
        const event = normalizeEvent(rawEvent, worldMinute, existing);
        event.updatedAt = worldMinute;
        if (existing) {
            Object.assign(existing, event);
        } else {
            state.events.push(event);
        }
    }

    for (const update of payload.eventsUpdate) {
        const event = findEvent(state, update);
        if (!event) continue;

        const workedMinutes = asInteger(
            update?.worked_minutes ?? update?.workedMinutes,
            0,
            0,
            5 * 365 * MINUTES_PER_DAY,
        );
        if (workedMinutes && event.clockMode === 'active') {
            event.accruedMinutes = Math.min(
                event.durationMinutes || Number.MAX_SAFE_INTEGER,
                event.accruedMinutes + workedMinutes,
            );
            if (event.durationMinutes > 0 && event.accruedMinutes >= event.durationMinutes) {
                event.status = 'ready';
            }
        }

        if (update?.summary) event.summary = asString(update.summary, event.summary, 420);
        if (update?.consequence) event.consequence = asString(update.consequence, event.consequence, 420);
        if (update?.cause !== undefined) {
            event.cause = asString(update.cause, event.cause || '', LIMITS.eventCause);
        }
        event.actors = mergeUniqueStrings(event.actors, update?.actors, 16);
        event.knownBy = mergeUniqueStrings(
            event.knownBy,
            update?.known_by ?? update?.knownBy,
            LIMITS.cognitiveRefs,
        );
        event.causedBy = mergeUniqueStrings(
            event.causedBy,
            update?.caused_by ?? update?.causedBy,
            12,
        );
        if (update?.visibility) event.visibility = normalizeVisibility(update.visibility);
        if (update?.public_trace !== undefined || update?.publicTrace !== undefined) {
            event.publicTrace = asString(
                update?.public_trace ?? update?.publicTrace,
                event.publicTrace || '',
                LIMITS.eventPublicTrace,
            );
        }
        if (event.visibility === 'hidden') event.publicTrace = '';
        if (update?.delivery_route) {
            event.delivery.route = asString(update.delivery_route, event.delivery.route, 220);
        }

        const requestedStatus = normalizeEventStatus(update?.status ?? event.status);
        if (TERMINAL_EVENT_STATES.has(requestedStatus)) {
            markTerminal(event, requestedStatus, worldMinute, update?.result);
        } else {
            event.status = requestedStatus;
            event.updatedAt = worldMinute;
            if (requestedStatus === 'ready' && update?.result) {
                markTerminal(event, 'resolved', worldMinute, update.result);
            }
        }
    }

    for (const event of state.events) {
        if (event.status === 'ready' && event.result) {
            markTerminal(event, 'resolved', worldMinute, event.result);
        }
        if (TERMINAL_EVENT_STATES.has(event.status)) {
            settleEventResultFact(state, event, messageId);
        }
    }

    for (const rawFact of payload.worldFactsUpsert) {
        const source = ['foreground', 'narrative'].includes(rawFact?.source)
            ? 'narrative'
            : 'simulation';
        upsertWorldFact(state, rawFact, {
            source,
            messageId,
        });
    }

    const allConsistencyConflicts = [
        ...generatedConsistencyConflicts,
        ...payload.consistencyConflicts,
    ];
    if (allConsistencyConflicts.length) {
        const seen = new Set();
        const conflicts = allConsistencyConflicts
            .map(raw => normalizeConsistencyConflict(raw, worldMinute, messageId))
            .filter(conflict => {
                if (!conflict.expected && !conflict.observed) return false;
                const key = `${conflict.subject}\u0000${conflict.field}\u0000${conflict.expected}\u0000${conflict.observed}\u0000${conflict.messageId}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        state.consistencyConflicts = [
            ...conflicts,
            ...asArray(state.consistencyConflicts),
        ].slice(0, LIMITS.consistencyConflicts);
    }

    for (const rawId of payload.deliveriesConfirmed) {
        const event = state.events.find(item => item.id === normalizeId(rawId, 'event'));
        if (!event) continue;
        event.delivery.state = 'delivered';
        event.delivery.confirmedAt = worldMinute;
        event.delivery.confirmedMessageId = messageId;
        state.echoes.unshift({
            id: makeId('echo'),
            eventId: event.id,
            at: worldMinute,
            title: event.title,
            route: event.delivery.route || event.result || event.consequence,
            state: 'Đã được tiếp nối bởi nội dung chính',
        });
    }

    for (const rawFact of payload.foregroundFacts) {
        const text = asString(rawFact?.text, '', 420);
        if (!text) continue;
        state.foregroundFacts.unshift({
            id: normalizeId(rawFact?.id, 'fact'),
            at: worldMinute,
            text,
            affects: uniqueStrings(rawFact?.affects, 10),
            visibility: normalizeVisibility(rawFact?.visibility ?? 'known'),
        });
        upsertWorldFact(state, {
            key: rawFact?.key || `foreground:${hashText(text)}`,
            subject_type: rawFact?.subject_type || 'world',
            subject_id: rawFact?.subject_id || '',
            subject: rawFact?.subject || 'Sự thật nội dung chính',
            field: rawFact?.field || 'state',
            value: text,
            visibility: rawFact?.visibility ?? 'known',
            confidence: 'high',
        }, {
            source: 'narrative',
            messageId,
        });
    }

    applyMemoryFactUpdates(state, payload.memoryUpdates, {
        sourceMessageId: messageId,
        sourceSwipeId: swipeId,
    });
    applyClueUpdates(state, payload.memoryUpdates, {
        sourceMessageId: messageId,
        sourceSwipeId: swipeId,
    });
    for (const pending of pendingFactBeliefUpdates) {
        const person = state.people.find(item => item.id === pending.personId);
        if (!person) continue;
        person.knownFactBeliefs = normalizeFactBeliefs(person.knownFactBeliefs, pending.previousBeliefs);
        const previousKeys = new Set(pending.previousKeys.map(normalizedReference));
        const previousBeliefKeys = new Set(pending.previousBeliefs.map(item => normalizedReference(item.key)));
        const refreshKeys = new Set(pending.refreshFactKeys.map(normalizedReference));
        for (const key of pending.incomingFactKeys) {
            const normalizedKey = normalizedReference(key);
            const alreadyKnown = previousKeys.has(normalizedKey);
            const hasBelief = previousBeliefKeys.has(normalizedKey);
            if (alreadyKnown && hasBelief && !refreshKeys.has(normalizedKey)) continue;
            const fact = alreadyKnown && !hasBelief && !refreshKeys.has(normalizedKey)
                ? preFactByKey.get(key)
                : activeFactByKey(state, key);
            if (fact) setFactBelief(person, fact, messageId);
        }
    }
    synchronizeCognitiveLedger(state);

    state.needsReconciliation = false;
    state.pendingSync = false;
    state.lastCommit = {
        messageId,
        swipeId,
        sourceKey: asString(sourceKey, '', 180),
        at: worldMinute,
        committedAt: nowIso(),
    };
    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    appendAudit(state, {
        type: 'simulation_committed',
        text: `Suy diễn thế giới hoàn tất · ${formatWorldCalendar(state, worldMinute).stamp}`,
        reason: payload.timeReason,
    });
    return trimState(state);
}

export function addManualEvent(inputState, rawEvent) {
    const state = deepClone(inputState);
    const event = normalizeEvent({
        ...rawEvent,
        status: rawEvent?.status || 'active',
    }, state.clock.absoluteMinute);
    state.events.push(event);
    state.revision += 1;
    state.updatedAt = nowIso();
    appendAudit(state, {
        type: 'event_created',
        text: `Sự kiện mới thêm:${event.title}`,
        reason: 'Tạo thủ công',
    });
    return trimState(state);
}

export function setWorldClock(inputState, {
    day,
    hour,
    minute,
    reason = 'Hiệu chuẩn thủ công',
} = {}) {
    const target = (
        asInteger(day, 1, 0, 999999) * MINUTES_PER_DAY
        + asInteger(hour, 0, 0, 23) * 60
        + asInteger(minute, 0, 0, 59)
    );
    const state = settleTimedEvents(inputState, target, { source: 'manual', reason });
    state.clock.anchored = true;
    state.clock.precision = 'minute';
    return trimState(state);
}

export function setWorldCalendar(inputState, {
    calendarName = '',
    year,
    month,
    day,
    hour,
    minute,
    reason = 'Hiệu chuẩn lịch thủ công',
} = {}) {
    const currentClock = formatWorldMinute(inputState?.clock?.absoluteMinute ?? MINUTES_PER_DAY);
    const date = normalizeCalendarDate({ year, month, day }, sequentialCalendarDate(currentClock.day));
    const targetMinute = (
        currentClock.day * MINUTES_PER_DAY
        + asInteger(hour, currentClock.hour, 0, 23) * 60
        + asInteger(minute, currentClock.minute, 0, 59)
    );
    const state = settleTimedEvents(inputState, targetMinute, {
        source: 'manual',
        reason,
    });
    state.world.calendar = {
        name: asString(calendarName, state.world?.calendar?.name || 'Lịch thế giới chính', 40),
        anchorAbsoluteDay: currentClock.day,
        anchorYear: date.year,
        anchorMonth: date.month,
        anchorDay: date.day,
    };
    state.clock.anchored = true;
    state.clock.precision = 'minute';
    appendAudit(state, {
        type: 'calendar_calibrated',
        text: `Lịch được hiệu chuẩn thành ${formatWorldCalendar(state).stamp}`,
        reason: asString(reason, '', 240),
    });
    state.updatedAt = nowIso();
    return trimState(state);
}

export function advanceWorldClock(inputState, minutes, reason = 'Tiến hành thủ công') {
    const delta = asInteger(minutes, 0, 0, 5 * 365 * MINUTES_PER_DAY);
    return settleTimedEvents(
        inputState,
        inputState.clock.absoluteMinute + delta,
        { source: 'manual', reason },
    );
}

function eventPriority(event) {
    const visibilityScore = {
        direct: 40,
        known: 30,
        trace: 20,
        hidden: 0,
    }[event.visibility] || 0;
    const recency = Number(event.resolvedAt ?? event.updatedAt ?? 0);
    return visibilityScore * 1_000_000 + recency;
}

export function selectDeliveryCandidates(state, settings = {}) {
    const maximum = {
        restrained: 1,
        balanced: 2,
        active: 3,
        "Kiềm chế": 1,
        "Cân bằng": 2,
        "Tích cực": 3,
    }[settings.deliveryDensity] || 1;

    const manuallyQueued = state.events
        .filter(event => event.visibility !== 'hidden' && event.delivery?.manualQueued)
        .sort((a, b) => eventPriority(b) - eventPriority(a));
    const automatic = state.events
        .filter(event => (
            TERMINAL_EVENT_STATES.has(event.status)
            && event.visibility !== 'hidden'
            && event.delivery?.state === 'pending'
            && !event.delivery?.manualQueued
        ))
        .sort((a, b) => eventPriority(b) - eventPriority(a));
    return [...manuallyQueued, ...automatic].slice(0, Math.max(maximum, manuallyQueued.length));
}

export function recordDeliveryOffers(inputState, eventIds, {
    messageId = null,
    expireAfter = 3,
} = {}) {
    const state = deepClone(inputState);
    const ids = new Set(uniqueStrings(eventIds, 24).map(id => normalizeId(id, 'event')));

    for (const event of state.events) {
        if (!ids.has(event.id)) continue;
        if (event.delivery?.manualQueued) event.delivery.manualQueued = false;
        if (event.delivery?.state !== 'pending') continue;
        event.delivery.attempts = asInteger(event.delivery.attempts, 0, 0, 99) + 1;
        event.delivery.lastOfferedAt = state.clock.absoluteMinute;
        event.delivery.lastOfferedMessageId = messageId;

        if (event.delivery.attempts >= expireAfter && event.visibility !== 'direct') {
            event.delivery.state = 'expired';
            state.archive.unshift({
                id: makeId('archive'),
                eventId: event.id,
                at: state.clock.absoluteMinute,
                title: event.title,
                text: event.result || event.consequence || event.summary,
                visibility: event.visibility,
                deliveryState: 'expired',
            });
        }
    }

    state.updatedAt = nowIso();
    return trimState(state);
}

function selectRelevantPeople(state, recentText = '', maximum = 6) {
    const text = asString(recentText, '', 6000);
    return [...state.people]
        .map(person => ({
            person,
            score: (
                (text.includes(person.name) ? 100 : 0)
                + person.relevance * 10
                + (person.knowledge === 'known' ? 5 : 0)
                + person.updatedAt / 1_000_000
            ),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maximum)
        .map(item => item.person);
}

export function buildInjectionPackage(state, settings = {}, recentText = '') {
    if (!settings.enabled) {
        return { text: '', eventIds: [] };
    }

    // Authoritative world state is a continuity contract, not an optional reveal.
    // `worldPromptInjection` is kept as the legacy setting key, but from schema 14
    // onward it only controls whether settled outcomes may proactively surface in
    // the foreground. While the world engine itself is enabled, time / person state
    // / settled facts always participate in the prompt so the model cannot silently
    // fork a second world by ignoring backstage facts.
    const injectWorldState = settings.worldSimulationEnabled !== false;
    const injectWorldReveals = injectWorldState && settings.worldPromptInjection !== false;
    const injectMemory = settings.memorySystemEnabled !== false
        && settings.memoryPromptInjection !== false;
    if (!injectWorldState && !injectMemory) return { text: '', eventIds: [] };

    const clock = formatWorldCalendar(state);
    const people = injectWorldState ? selectRelevantPeople(state, recentText) : [];
    const authoritativeFacts = injectWorldState ? selectRelevantWorldFacts(state, recentText, 12) : [];
    const deliveries = injectWorldReveals ? selectDeliveryCandidates(state, settings) : [];
    const recalledMemory = injectMemory ? selectRelevantStoryMemory(state, recentText, {
        maximumFacts: 6,
        maximumClues: 3,
        maximumSummaries: 0,
        includeDigest: false,
    }) : { facts: [], clues: [] };
    const knownFacts = recalledMemory.facts.filter(fact => (
        ['known', 'direct'].includes(fact.visibility)
        && ['active', 'disputed'].includes(fact.status)
    ));
    const knownClues = recalledMemory.clues.filter(clue => (
        ['known', 'direct'].includes(clue.visibility)
        && clue.status !== 'discarded'
    ));
    const sceneTiming = {
        strict: 'Chỉ hiển thị khi chuyển cảnh, khoảng trống hoặc khi nhân vật có thể tiếp xúc thông tin một cách tự nhiên; nếu cảnh hiện tại không phù hợp thì tiếp tục trì hoãn.',
        smart: 'Trì hoãn thông tin phụ trong các cảnh quan trọng; chỉ những kết quả ảnh hưởng trực tiếp đến hành động trước mắt mới có thể tiến vào một cách tự nhiên.',
        open: 'Có thể thêm một thay đổi ngắn gọn, tự nhiên có thể nhận biết vào cảnh, nhưng đừng phát thanh chạy ngầm.',
    }[settings.sceneTiming] || 'Chỉ hiển thị vào thời điểm tự nhiên, không thông báo chạy ngầm.';

    const lines = ['<world_backstage_state>'];
    if (injectWorldState) {
        if (state.clock?.anchored) {
            lines.push(
                `Thời gian thế giới chính chuẩn:${state.world.name} · ${clock.stamp}`,
                `Trường dữ liệu ngày tháng chuẩn:year=${clock.year}; month=${clock.month}; day=${clock.dayOfMonth}; time=${clock.time}`,
                `Trạng thái tổng thể:${state.world.title}；${state.world.detail}`,
                'Quy tắc nhất quán thời gian: Thời gian thế giới chính được duy trì bởi mặt trái thế giới, là nguồn sự thật của nội dung chính vòng này. Nếu nội dung chính chứa“Thời gian và địa điểm”cột, tiêu đề ngày tháng hoặc hiển thị giờ giấc, phải đổi từng mục năm, tháng, ngày trong đó thành chuẩn ở trên year/month/day；Không được giữ lại năm tháng ngày cũ của vòng trước, cũng không được tự ý tạo ngày mới. Giờ giấc cũng lấy chuẩn time làm điểm bắt đầu của vòng này.',
                `Nếu đầu ra“Thời gian và địa điểm”cột, "ngày tháng nên được viết rõ thành":${clock.year}Năm${clock.month}Tháng${clock.dayOfMonth}ngày.`,
                'Nội dung chính chỉ chịu trách nhiệm kể chuyện, không tự ý đẩy nhanh đồng hồ thế giới thêm trong vòng này; thời gian thực tế trôi qua trong vòng này sẽ được mặt trái thế giới tổng kết sau khi nội dung chính kết thúc.',
            );
        } else {
            lines.push(
                'Thời gian thế giới chính: Chưa hoàn thành hiệu chuẩn điểm neo thời gian câu chuyện.',
                `Trạng thái tổng thể:${state.world.title}；${state.world.detail}`,
                'Quy tắc nhất quán thời gian: Hiện tại không lấy lịch giữ chỗ/giờ giấc giữ chỗ làm sự thật cốt truyện; sau khi nội dung chính vòng này kết thúc, mặt trái thế giới sẽ thiết lập điểm neo thời gian thế giới chính từ ngữ cảnh.',
            );
        }
    }

    if (people.length) {
        if (state.needsReconciliation) {
            lines.push(
                'Trạng thái nhân vật lưu trữ cũ (chờ hiệu chuẩn lại một lần ở tiền sảnh):',
                'Những trạng thái này đến từ bản ghi chạy ngầm trước khi nâng cấp; nếu xung đột với sự thật rõ ràng của nội dung chính gần đây, lấy nội dung chính làm chuẩn. Sau khi suy diễn thế giới thành công lần đầu sẽ tổng kết lại thành trạng thái chuẩn.',
            );
        } else {
            lines.push(
                'Trạng thái chuẩn của nhân vật hiện tại (phải duy trì tính liên tục; không có nghĩa là nhân vật chính biết toàn bộ thông tin chạy ngầm):',
                'Nếu nội dung chính không viết rõ việc di chuyển, rời đi, quay lại hoặc thay đổi trạng thái mới, không được đưa nhân vật vào vị trí xung đột với ở đây mà không có lý do; nếu nội dung chính đã xảy ra thay đổi mới rõ ràng, thì tiếp tục theo thay đổi mới, và được mặt trái thế giới ghi ngược lại.',
            );
        }
        for (const person of people) {
            const boundary = person.knowledge === 'known' ? 'Có thể biết' : 'Hậu trường';
            lines.push(`- ${person.name}｜${person.location}｜${person.action}｜${boundary}`);
        }
    }

    if (authoritativeFacts.length) {
        lines.push(
            'Sự thật thế giới đã tổng kết (đây là trạng thái khách quan của thế giới, không phải đề xuất cốt truyện tùy chọn; phải duy trì sự nhất quán, nhưng nhân vật có biết hay không vẫn tùy thuộc vào ranh giới nhận thức):',
        );
        for (const fact of authoritativeFacts) {
            const subject = fact.subject || fact.subjectId || 'Thế giới';
            lines.push(`- ${subject}｜${fact.field}：${fact.value}｜Hiển thị=${fact.visibility}`);
        }
        lines.push('Mức độ hiển thị chỉ quyết định những sự thật này đi vào ống kính như thế nào, không quyết định chúng có tồn tại hay không. Sự thật ẩn có thể ràng buộc tính liên tục, nhưng không được vì thế mà khiến nhân vật không hay biết đột nhiên biết được.');
    }

    if (knownFacts.length || knownClues.length) {
        lines.push('Ký ức dài hạn liên quan đến bối cảnh hiện tại, "và nhân vật đã có đủ tư cách để biết":');
        for (const fact of knownFacts) {
            const qualifier = fact.status === 'disputed' ? '（cách nói có tranh cãi, không thể coi là kết luận)' : '';
            lines.push(`- Sự thật｜${fact.subject || fact.key}｜${fact.predicate || 'Thông tin liên quan'}：${fact.value}${qualifier}`);
        }
        for (const clue of knownClues) {
            lines.push(`- Manh mối｜${clue.title}：${clue.text}`);
        }
        lines.push('Chỉ dùng để duy trì hồi ức, cam kết và sự hô ứng trước sau; không được viết bù ký ức ẩn chưa được liệt kê thành kiến thức của nhân vật.');
    }

    if (deliveries.length) {
        lines.push('Sự kiện có thể hiển thị tự nhiên được người dùng điểm danh hoặc hệ thống chọn trong vòng này:');
        for (const event of deliveries) {
            const route = event.delivery.route || event.result || event.consequence || event.summary;
            const request = event.delivery?.manualQueued ? 'Người dùng yêu cầu ưu tiên hiển thị vòng tiếp theo' : 'Hệ thống đề cử';
            lines.push(`- [${event.id}] ${event.title}：${route}（${event.visibility}；${request}）`);
        }
        lines.push(`Nhịp độ hiển thị:${sceneTiming}`);
        lines.push('Chỉ coi những kết quả thực sự được viết vào nội dung chính, được nhân vật nhận thức hoặc để lại dấu vết có thể thấy là đã được tiếp nối; đừng tuyên bố“chạy ngầm đã đệ trình”。');
    }

    lines.push('Cấm nhắc đến“Mặt trái thế giới”、bảng trạng thái, khối chèn hoặc độc thoại hậu trường.');
    lines.push('</world_backstage_state>');

    const keptLines = [];
    let usedCharacters = 0;
    for (const line of lines) {
        const addition = line.length + (keptLines.length ? 1 : 0);
        if (usedCharacters + addition > 4200) break;
        keptLines.push(line);
        usedCharacters += addition;
    }
    const originalKeptCount = keptLines.length;
    if (originalKeptCount < lines.length) {
        const closing = '</world_backstage_state>';
        if (keptLines.at(-1) === closing) keptLines.pop();
        const notice = '（Các thông tin ít liên quan còn lại đã được nén và lược bỏ, cấm tự ý bổ sung.)';
        while (keptLines.length > 1 && [...keptLines, notice, closing].join('\n').length > 4200) {
            keptLines.pop();
        }
        keptLines.push(notice, closing);
    }

    return {
        text: keptLines.join('\n'),
        eventIds: deliveries.map(event => event.id),
        omittedLines: Math.max(0, lines.length - originalKeptCount),
    };
}

function modelText(value, maximum) {
    return asString(value, '', maximum);
}

export function planMemoryRollup(state) {
    const memory = normalizeStoryMemory(state?.storyMemory, state?.clock?.absoluteMinute || 0);
    for (const sourceLevel of [MEMORY_SUMMARY_LEVELS.CHAPTER, MEMORY_SUMMARY_LEVELS.STAGE, MEMORY_SUMMARY_LEVELS.DETAIL]) {
        const threshold = MEMORY_ROLLUP_THRESHOLDS[sourceLevel];
        const candidates = memory.summaries
            .filter(summary => (
                summary.hierarchyManaged
                && !summary.manual
                && Number(summary.level) === sourceLevel
                && summary.retentionState !== 'compacted'
                && !summary.parentId
            ))
            .sort((a, b) => (
                Number(a.startMessageId || 0) - Number(b.startMessageId || 0)
                || Number(a.endMessageId || 0) - Number(b.endMessageId || 0)
            ));
        if (candidates.length < threshold) continue;
        const sources = candidates.slice(0, threshold);
        return {
            sourceLevel,
            targetLevel: Math.min(MEMORY_SUMMARY_LEVELS.LONG_TERM, sourceLevel + 1),
            threshold,
            sourceSummaryIds: sources.map(summary => summary.id),
            summaries: sources,
        };
    }
    return null;
}

export function buildMemoryRollupPrompt(state, plan, { compact = false } = {}) {
    const sourceLevel = asInteger(plan?.sourceLevel, 0, 0, 2);
    const targetLevel = Math.min(3, sourceLevel + 1);
    const sourceIds = new Set(asArray(plan?.sourceSummaryIds));
    const memory = normalizeStoryMemory(state?.storyMemory, state?.clock?.absoluteMinute || 0);
    const sources = memory.summaries
        .filter(summary => sourceIds.has(summary.id))
        .sort((a, b) => Number(a.startMessageId) - Number(b.startMessageId));
    if (!sources.length) throw new Error('Không có ký ức tầng dưới nào có thể nén');
    const levelNames = ['Đoạn đơn vòng', 'Tóm tắt giai đoạn', 'Tóm tắt chương', 'Trải nghiệm dài hạn'];
    const lengthRule = compact
        ? 'summary Kiểm soát trong khoảng 180—320 chữ, chỉ giữ lại những thay đổi thực sự sẽ ảnh hưởng đến việc hiểu trong tương lai.'
        : targetLevel === MEMORY_SUMMARY_LEVELS.STAGE
            ? 'summary Khoảng 220—420 chữ.'
            : targetLevel === MEMORY_SUMMARY_LEVELS.CHAPTER
                ? 'summary Khoảng 320—600 chữ.'
                : 'summary Khoảng 420—800 chữ, nhấn mạnh mối quan hệ dài hạn, mục tiêu, bước ngoặt và các manh mối vẫn chưa kết thúc.';
    const payload = sources.map(summary => ({
        id: summary.id,
        level: summary.level,
        title: summary.title,
        summary: modelText(summary.summary, 1200),
        start_message_id: summary.startMessageId,
        end_message_id: summary.endMessageId,
        people: summary.people,
        locations: summary.locations,
        tags: summary.tags,
    }));
    return [
        'Bạn là“Mặt trái thế giới”nhân viên nén ký ức dài hạn của. Ở đây chỉ thực hiện nén hồ sơ, không viết tiếp cốt truyện, không suy diễn tương lai, không sửa đổi bất kỳ sự thật nào.',
        `Vui lòng đem bên dưới ${sources.length} mục ${levelNames[sourceLevel]} nén thành 1 mục ${levelNames[targetLevel]}。`,
        'Yêu cầu:',
        '1. Chỉ có thể sử dụng tóm tắt tầng dưới được cung cấp; cấm viết thêm các tình tiết không tồn tại.',
        '2. Ưu tiên giữ lại thay đổi mối quan hệ, mục tiêu dài hạn, cam kết, bước ngoặt quan trọng, xung đột kéo dài, vật phẩm quan trọng và các vấn đề chưa giải quyết. Các hành động thông thường, không khí lặp đi lặp lại và các chi tiết phụ đã hết hiệu lực có thể loại bỏ.',
        '3. Tóm tắt mới là chỉ mục dài hạn tầng trên. source_summary_ids và phạm vi tin nhắn sẽ được giữ lại, nhưng tóm tắt tầng dưới thông thường sau khi thiết lập tầng trên có thể bị nén thành chỗ dành sẵn gọn nhẹ; do đó những chi tiết thực sự ảnh hưởng đến việc hiểu trong tương lai phải được đưa vào tầng trên, các chi tiết phụ không quan trọng có thể chủ động bỏ qua.',
        '4. people / locations / tags Chỉ giữ lại các mục quan trọng thực sự xuyên suốt đoạn này.',
        `5. ${lengthRule}`,
        '6. Chỉ trả về hợp lệ JSON，Không cần khối mã và giải thích.',
        '',
        `Tầng nguồn:L${sourceLevel} ${levelNames[sourceLevel]}`,
        `Tầng đích:L${targetLevel} ${levelNames[targetLevel]}`,
        'Ký ức tầng dưới:',
        JSON.stringify(payload),
        '',
        'Cấu trúc trả về:',
        JSON.stringify({
            summary_rollup: {
                title: '',
                summary: '',
                people: [],
                locations: [],
                tags: [],
            },
        }),
    ].join('\n');
}

export function applyMemoryRollupResult(inputState, rawPayload, plan = {}) {
    const state = deepClone(inputState);
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    const sourceIds = new Set(asArray(plan?.sourceSummaryIds));
    const sources = state.storyMemory.summaries
        .filter(summary => sourceIds.has(summary.id))
        .sort((a, b) => Number(a.startMessageId) - Number(b.startMessageId));
    if (!sources.length) return trimState(state);
    if (sources.some(summary => summary.parentId)) return trimState(state);
    const sourceLevel = asInteger(plan?.sourceLevel, sources[0]?.level ?? 0, 0, 2);
    if (sources.some(summary => Number(summary.level) !== sourceLevel)) return trimState(state);
    const raw = rawPayload?.summary_rollup ?? rawPayload?.summaryRollup ?? rawPayload;
    const summaryText = asString(raw?.summary, '', 1800);
    if (!summaryText) return trimState(state);
    const targetLevel = Math.min(MEMORY_SUMMARY_LEVELS.LONG_TERM, sourceLevel + 1);
    const first = sources[0];
    const last = sources.at(-1);
    const id = normalizeId(
        raw?.id || `summary_L${targetLevel}_${first.startMessageId}_${last.endMessageId}_${hashText(sources.map(item => item.id).join('|'))}`,
        'summary',
    );
    const existing = state.storyMemory.summaries.find(summary => summary.id === id);
    const normalized = normalizeStorySummary({
        ...raw,
        id,
        summary: summaryText,
        level: targetLevel,
        hierarchy_managed: true,
        source_summary_ids: sources.map(summary => summary.id),
        start_message_id: first.startMessageId,
        end_message_id: last.endMessageId,
        important: sources.some(summary => summary.important),
    }, existing);
    if (existing) Object.assign(existing, normalized);
    else state.storyMemory.summaries.push(normalized);
    for (const source of sources) source.parentId = normalized.id;
    compactRolledUpSources(state, normalized, sources, {
        sourceMessageId: last.endMessageId,
    });
    state.storyMemory.lastMetabolismMessageId = Math.max(
        Number(state.storyMemory.lastMetabolismMessageId || -1),
        Number(last.endMessageId || -1),
    );
    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    appendAudit(state, {
        type: 'memory_rollup',
        text: `Nén ký ức hoàn tất · L${sourceLevel} → L${targetLevel}`,
        reason: `${sources.length} trải nghiệm tầng dưới đã thiết lập chỉ mục tầng trên có thể truy xuất`,
    });
    return trimState(state);
}

function memoryTerms(item) {
    return uniqueStrings([
        item?.subject || '',
        item?.predicate || '',
        ...(item?.people || []),
        ...(item?.locations || []),
        ...(item?.tags || []),
    ], 40).filter(term => term.length >= 2);
}

function memorySearchText(item) {
    return [
        item?.key,
        item?.subject,
        item?.predicate,
        item?.value,
        item?.title,
        item?.text,
        item?.summary,
        ...memoryTerms(item),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function memoryBigrams(value) {
    const normalized = String(value || '')
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '');
    const result = new Set();
    for (let index = 0; index < normalized.length - 1 && result.size < 180; index += 1) {
        result.add(normalized.slice(index, index + 2));
    }
    return result;
}

function memoryMatchScore(item, query, {
    referenceMessageId = 0,
} = {}) {
    const normalizedQuery = String(query || '').toLocaleLowerCase();
    let score = Number(item?.importance || 0) * 5;
    for (const term of memoryTerms(item)) {
        if (normalizedQuery.includes(term.toLocaleLowerCase())) score += 18;
    }
    const queryBigrams = memoryBigrams(normalizedQuery);
    if (queryBigrams.size) {
        const itemBigrams = memoryBigrams(memorySearchText(item));
        let overlap = 0;
        for (const term of queryBigrams) {
            if (itemBigrams.has(term)) overlap += 1;
        }
        score += Math.min(20, overlap * 2);
    }
    if (item?.status === 'open') score += 8;
    if (item?.status === 'developing' || item?.status === 'echoed') score += 6;
    if (item?.status === 'triggered') score += 9;
    if (item?.status === 'active') score += 7;
    if (item?.status === 'disputed') score += 2;
    if (item?.confidence === 'high') score += 4;
    if (item?.confidence === 'low') score -= 3;

    const sourceMessageId = Number(
        item?.sourceMessageId
        ?? item?.endMessageId
        ?? item?.throughMessageId
        ?? referenceMessageId,
    );
    const age = Math.max(0, Number(referenceMessageId || 0) - sourceMessageId);
    const decay = Math.min(18, Math.floor(Math.log2(1 + age / 12) * 4));
    score -= Number(item?.importance || 1) >= 3 ? Math.floor(decay / 3) : decay;
    return score;
}

export function selectRelevantStoryMemory(state, narrativeText = '', {
    maximumFacts = 10,
    maximumClues = 8,
    maximumSummaries = 4,
    includeDigest = true,
} = {}) {
    const memory = normalizeStoryMemory(state?.storyMemory, state?.clock?.absoluteMinute || 0);
    const referenceMessageId = Math.max(
        Number(state?.lastCommit?.messageId || 0),
        Number(memory.indexedThroughMessageId || 0),
    );
    const facts = memory.facts
        .filter(fact => ['active', 'disputed'].includes(fact.status))
        .map(fact => ({
            fact,
            score: memoryMatchScore(fact, narrativeText, { referenceMessageId }),
        }))
        .sort((a, b) => (
            b.score - a.score
            || Number(b.fact.updatedAt) - Number(a.fact.updatedAt)
        ))
        .slice(0, Math.max(0, maximumFacts))
        .map(({ fact, score }) => ({
            id: fact.id,
            key: fact.key,
            subject: fact.subject,
            predicate: fact.predicate,
            value: modelText(fact.value, 420),
            people: fact.people,
            locations: fact.locations,
            tags: fact.tags,
            status: fact.status,
            confidence: fact.confidence,
            importance: fact.importance,
            visibility: fact.visibility,
            source_message_id: fact.sourceMessageId,
            source_swipe_id: fact.sourceSwipeId,
            recall_score: score,
        }));
    const clues = memory.clues
        .filter(clue => !['resolved', 'discarded'].includes(clue.status))
        .map(clue => ({
            clue,
            score: memoryMatchScore(clue, narrativeText, { referenceMessageId }),
        }))
        .sort((a, b) => (
            b.score - a.score
            || Number(b.clue.updatedAt) - Number(a.clue.updatedAt)
        ))
        .slice(0, Math.max(0, maximumClues))
        .map(({ clue }) => ({
            id: clue.id,
            title: modelText(clue.title, 100),
            text: modelText(clue.text, 360),
            people: clue.people,
            locations: clue.locations,
            tags: clue.tags,
            status: clue.status,
            importance: clue.importance,
            visibility: clue.visibility,
            source_message_id: clue.sourceMessageId,
            source_swipe_id: clue.sourceSwipeId,
            resolution: modelText(clue.resolution, 260),
        }));
    const scoredSummaries = memory.summaries
        .filter(summary => summary.retentionState !== 'compacted')
        .map(summary => ({
            summary,
            score: memoryMatchScore(summary, narrativeText, { referenceMessageId }),
        }));
    const anchors = [];
    for (const level of [MEMORY_SUMMARY_LEVELS.LONG_TERM, MEMORY_SUMMARY_LEVELS.CHAPTER]) {
        const newest = scoredSummaries
            .filter(item => Number(item.summary.level) === level)
            .sort((a, b) => Number(b.summary.endMessageId) - Number(a.summary.endMessageId))[0];
        if (newest) anchors.push(newest);
    }
    if (!anchors.length) {
        const newestStage = scoredSummaries
            .filter(item => Number(item.summary.level) === MEMORY_SUMMARY_LEVELS.STAGE)
            .sort((a, b) => Number(b.summary.endMessageId) - Number(a.summary.endMessageId))[0];
        if (newestStage) anchors.push(newestStage);
    }
    const anchorIds = new Set(anchors.map(item => item.summary.id));
    const recalled = scoredSummaries
        .filter(item => !anchorIds.has(item.summary.id))
        .sort((a, b) => (
            b.score - a.score
            || Number(b.summary.level || 0) - Number(a.summary.level || 0)
            || b.summary.endMessageId - a.summary.endMessageId
        ))
        .slice(0, Math.max(0, maximumSummaries));
    const summaries = [...anchors, ...recalled]
        .map(({ summary }, index) => ({
            id: summary.id,
            title: modelText(summary.title, 100),
            summary: modelText(summary.summary, Number(summary.level) >= 2 ? 900 : 720),
            level: summary.level,
            memory_role: index < anchors.length ? 'anchor' : 'recall',
            parent_id: summary.parentId || '',
            source_summary_ids: summary.sourceSummaryIds,
            start_message_id: summary.startMessageId,
            end_message_id: summary.endMessageId,
            people: summary.people,
            locations: summary.locations,
            tags: summary.tags,
        }));

    return {
        indexed_through_message_id: memory.indexedThroughMessageId,
        digest: includeDigest && memory.digest.text
            ? {
                text: modelText(memory.digest.text, 1600),
                through_message_id: memory.digest.throughMessageId,
                people: memory.digest.people,
                locations: memory.digest.locations,
                tags: memory.digest.tags,
            }
            : null,
        facts,
        summaries,
        clues,
    };
}

export function buildHistoryIndexPrompt(state, {
    messages = [],
    userName = '',
    playerIdentityAnchor = '',
    compact = false,
} = {}) {
    const compactMode = Boolean(compact);
    const normalizedMessages = asArray(messages)
        .map(message => ({
            id: asInteger(message?.id, 0, 0),
            swipe: asInteger(message?.swipe, 0, 0),
            role: message?.role === 'user' ? 'user' : 'assistant',
            content: modelText(
                message?.content,
                compactMode
                    ? (message?.role === 'user' ? 2400 : 4200)
                    : (message?.role === 'user' ? 4000 : 7000),
            ),
        }))
        .filter(message => message.content);
    const startMessageId = normalizedMessages[0]?.id ?? 0;
    const endMessageId = normalizedMessages.at(-1)?.id ?? startMessageId;
    const sourceText = normalizedMessages
        .map(message => (
            `<message id="${message.id}" swipe="${message.swipe}" role="${message.role}">`
            + `${message.content}</message>`
        ))
        .join('\n');
    const existing = selectRelevantStoryMemory(state, sourceText, {
        maximumFacts: compactMode ? 14 : 32,
        maximumClues: compactMode ? 10 : 24,
        maximumSummaries: compactMode ? 3 : 6,
    });
    const outputLimits = compactMode
        ? 'Thử lại tối giản: mỗi mục turn_summaries.summary không vượt quá 100 chữ, memory_digest.text không vượt quá 240 chữ; facts_upsert tối đa 3 mục, clues_upsert tối đa 2 mục; mảng không có thay đổi phải trả về mảng rỗng.'
        : 'Đầu ra nên nhỏ gọn: mỗi mục turn_summaries.summary Khoảng 80—180 chữ,memory_digest.text Khoảng 300—600 chữ;facts_upsert tối đa 8 mục,clues_upsert tối đa 6 mục.';
    const identityAnchor = modelText(playerIdentityAnchor, 400);
    const characterIdentityAnchors = asArray(state?.people)
        .filter(person => modelText(person?.identityAnchor, LIMITS.identityAnchor))
        .slice(0, LIMITS.people)
        .map(person => ({
            name: modelText(person?.name, 80),
            identity_anchor: modelText(person?.identityAnchor, LIMITS.identityAnchor),
        }));

    return [
        'Bạn là“Mặt trái thế giới”nhân viên lưu trữ lịch sử của. Bạn chỉ sắp xếp lịch sử trò chuyện đã xảy ra, không viết tiếp, không suy diễn tương lai, không sửa đổi thời gian thế giới.',
        '',
        'Nhiệm vụ:',
        '1. Cho mỗi mục của đợt này assistant nội dung chính viết riêng một mục L0 tóm tắt vòng đơn, đặt vào turn_summaries。Mỗi mục chỉ tóm tắt tin nhắn tương ứng, không trộn lẫn vòng tiếp theo hoặc tin nhắn khác vào; giữ lại thay đổi mối quan hệ, cam kết, xung đột, vật phẩm quan trọng và các vấn đề chưa hoàn thành.',
        '2. Viết lại memory_digest：Hợp nhất tóm tắt liên tục cũ với những thay đổi quan trọng thực sự lâu dài của đợt này, xóa các cách nói đã hết hiệu lực; đây không phải là sổ ghi chép từng vòng, cũng không phải là tất cả L0 sự chắp vá máy móc của tóm tắt.',
        '3. facts_upsert Chỉ ghi lại các sự thật dài hạn đã được xác lập rõ ràng trong nội dung chính và vẫn hữu ích trong tương lai, ví dụ như thân phận, mối quan hệ, cam kết, giới hạn năng lực, quyền sở hữu vật phẩm quan trọng và sự thật đã được tiết lộ. Vị trí tạm thời, hành động thông thường, không khí không được tính là sự thật dài hạn.',
        '4. Mỗi loại sự thật sử dụng ổn định key（Ví dụ“Nhân vật:Lão Bạch:Thân phận thực sự”）。Cùng một key Giữ lại khi xuất hiện giá trị mới key và gửi mới value；Plugin sẽ đánh dấu phiên bản cũ là superseded。Khi vẫn chưa thể phán đoán thật giả thì dùng status=disputed，Không ghi đè cưỡng bức.',
        '5. Chỉ trích xuất những phục bút thực sự có khả năng tạo ra sự hô ứng ở phần sau. Miêu tả môi trường thông thường, hành động một lần và những sự thật đã được giải thích xong ngay tại chỗ thì đừng coi là phục bút.',
        '6. Sự thật dài hạn và phục bút phải ghi lại tin nhắn nguồn sớm nhất hoặc rõ ràng nhất id、swipe，và giữ lại không quá 80 chữ trích lục văn bản gốc.',
        '7. Ký ức phải biết thay đổi, "đừng chỉ tăng mà không giảm": khi phục bút cũ bắt đầu tiến triển thì dùng nguyên ID cập nhật thành developing；khi điều kiện quan trọng thực sự kích hoạt có thể cập nhật thành triggered；thực sự hoàn thành/khi tiết lộ thì đưa vào clues_resolve(status=resolved)；Phục bút mà phần sau đã chứng minh nó không còn cần thiết, hướng đi bị loại bỏ hoặc chỉ là phán đoán sai thì đưa vào clues_resolve(status=discarded) và viết rõ reason。Sự thật dài hạn bị nội dung chính phủ định rõ ràng hoặc đã hết hiệu lực thì đưa vào facts_invalidate。',
        '7A. Khi cùng một sự thật dài hạn xuất hiện giá trị mới thì tiếp tục dùng cùng một sự ổn định key，plugin sẽ đánh dấu giá trị cũ là superseded và giữ lại chuỗi thay đổi gọn nhẹ; đừng để các giá trị cũ xung đột lẫn nhau đồng thời tồn tại active。Cập nhật sự thật thế giới sẽ không tự động sửa đổi bất kỳ NPC sổ cái nhận thức của.',
        '7B. Không cần lưu lại mọi thứ. Các chi tiết phụ thông thường, thông tin đã bị trải nghiệm cấp cao che lấp và không có giá trị độc lập trong tương lai có thể mờ dần khỏi tóm tắt liên tục; các khóa, quan trọng, mối quan hệ dài hạn, cam kết quan trọng, thân phận, giới hạn then chốt và manh mối chưa hoàn thành phải được giữ lại.',
        '8. Không được viết những suy nghĩ mà người chơi chưa nói rõ thành sự thật. Tên nhân vật người chơi:'
            + `${modelText(userName, 80) || 'Chưa cung cấp'}。`
            + (identityAnchor
                ? ` Điểm neo thân phận do người dùng thiết lập rõ ràng:${identityAnchor}。Liên quan đến thân phận giới tính, danh xưng/đại từ, biểu đạt ngoại hình, cài đặt cơ thể, loài, giai đoạn tuổi hoặc thân phận xã hội thì phải tuân thủ từng mục; không được dựa vào ngoại hình, trang phục, cơ thể hoặc loài để suy ngược ra giới tính.`
                : ' Chưa thiết lập điểm neo thân phận người chơi; khi nội dung chính không rõ ràng thì sử dụng cách diễn đạt trung tính, không được dựa vào ngoại hình, trang phục, cơ thể hoặc loài để đoán giới tính và danh xưng.'),
        `Điểm neo thân phận nhân vật khác do người dùng duy trì:${characterIdentityAnchors.length ? JSON.stringify(characterIdentityAnchors) : 'Không có'}。Những điểm neo này là thiết lập chuẩn, khi sắp xếp thân phận, danh xưng và mối quan hệ phải tuân thủ; nhân vật không có điểm neo và nội dung chính cũng không rõ ràng thì sử dụng cách diễn đạt trung tính, không được dựa vào ngoại hình, trang phục, cơ thể hoặc loài để đoán.`,
        '9. turn_summaries Chỉ cho assistant tạo tin nhắn;user tin nhắn được sử dụng làm ngữ cảnh, nhưng đừng tạo riêng L0。mỗi mục phải mang theo chính xác source_message_id。',
        '10. chapter_summary là trường dữ liệu dự phòng tương thích phiên bản cũ: trong trường hợp bình thường trả về null；chỉ khi không thể xuất turn_summaries thì mới dùng nó để khái quát toàn bộ lô.',
        '11. Chỉ trả về một hợp lệ JSON đối tượng, không cần khối mã và giải thích.',
        `12. ${outputLimits}`,
        '',
        `Phạm vi lô này: tin nhắn ${startMessageId}—${endMessageId}`,
        'Nội dung chính lô này:',
        sourceText || '（không có nội dung chính)',
        '',
        'Đã có hồ sơ liên quan (dùng để loại bỏ trùng lặp và tiếp nối ID）：',
        JSON.stringify(existing),
        '',
        'Cấu trúc trả về:',
        JSON.stringify({
            memory_digest: {
                text: '',
                through_message_id: endMessageId,
            },
            turn_summaries: [{
                id: 'summary_l0_message_id',
                source_message_id: endMessageId,
                title: '',
                summary: '',
                people: [],
                locations: [],
                tags: [],
            }],
            chapter_summary: null,
            facts_upsert: [{
                key: '',
                subject: '',
                predicate: '',
                value: '',
                source_message_id: startMessageId,
                source_excerpt: '',
            }],
            facts_invalidate: [{
                key: '',
                reason: '',
            }],
            clues_upsert: [{
                id: '',
                title: '',
                text: '',
                source_message_id: startMessageId,
                source_excerpt: '',
                status: 'open | developing | triggered',
            }],
            clues_resolve: [{
                id: '',
                status: 'resolved | discarded',
                resolution: '',
                reason: '',
                message_id: endMessageId,
            }],
        }),
    ].join('\n');
}

export function applyHistoryIndexResult(inputState, rawPayload, {
    startMessageId = 0,
    endMessageId = 0,
} = {}) {
    const state = deepClone(inputState);
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    const rawDigest = rawPayload?.memory_digest ?? rawPayload?.memoryDigest;
    if (rawDigest?.text) {
        state.storyMemory.digest = normalizeMemoryDigest({
            ...rawDigest,
            through_message_id: rawDigest.through_message_id ?? endMessageId,
        }, state.storyMemory.digest, state.clock.absoluteMinute);
    }
    const turnSummaries = asArray(rawPayload?.turn_summaries ?? rawPayload?.turnSummaries)
        .slice(0, 24);
    let storedTurnSummaries = 0;
    for (const rawTurn of turnSummaries) {
        const messageId = asInteger(
            rawTurn?.source_message_id ?? rawTurn?.sourceMessageId ?? rawTurn?.message_id ?? rawTurn?.messageId,
            -1,
            -1,
        );
        if (messageId < startMessageId || messageId > endMessageId || !rawTurn?.summary) continue;
        const prepared = {
            ...rawTurn,
            id: rawTurn?.id || `summary_l0_${messageId}`,
            start_message_id: messageId,
            end_message_id: messageId,
            level: MEMORY_SUMMARY_LEVELS.DETAIL,
            hierarchy_managed: true,
            source_summary_ids: [],
        };
        const normalized = normalizeStorySummary(prepared);
        const existing = state.storyMemory.summaries.find(summary => (
            summary.id === normalized.id
            || (
                Number(summary.level) === MEMORY_SUMMARY_LEVELS.DETAIL
                && summary.startMessageId === messageId
                && summary.endMessageId === messageId
            )
        ));
        if (existing) Object.assign(existing, normalized);
        else state.storyMemory.summaries.push(normalized);
        storedTurnSummaries += 1;
    }

    const rawSummary = rawPayload?.chapter_summary ?? rawPayload?.chapterSummary;
    if (!storedTurnSummaries && rawSummary?.summary) {
        const prepared = {
            ...rawSummary,
            start_message_id: rawSummary.start_message_id ?? startMessageId,
            end_message_id: rawSummary.end_message_id ?? endMessageId,
            level: rawSummary.level ?? MEMORY_SUMMARY_LEVELS.STAGE,
            hierarchy_managed: Boolean(rawSummary.hierarchy_managed ?? rawSummary.hierarchyManaged ?? false),
        };
        const normalized = normalizeStorySummary(prepared);
        const existing = state.storyMemory.summaries.find(summary => (
            summary.id === normalized.id
            || (
                summary.startMessageId === normalized.startMessageId
                && summary.endMessageId === normalized.endMessageId
                && Number(summary.level) === Number(normalized.level)
            )
        ));
        if (existing) Object.assign(existing, normalized);
        else state.storyMemory.summaries.push(normalized);
    }

    applyMemoryFactUpdates(state, {
        factsUpsert: rawPayload?.facts_upsert ?? rawPayload?.factsUpsert,
        factsInvalidate: rawPayload?.facts_invalidate ?? rawPayload?.factsInvalidate,
    }, {
        sourceMessageId: endMessageId,
        sourceSwipeId: 0,
    });
    applyClueUpdates(state, {
        cluesUpsert: rawPayload?.clues_upsert ?? rawPayload?.cluesUpsert,
        cluesResolve: rawPayload?.clues_resolve ?? rawPayload?.cluesResolve,
    }, {
        sourceMessageId: endMessageId,
        sourceSwipeId: 0,
    });
    state.storyMemory.indexedThroughMessageId = Math.max(
        state.storyMemory.indexedThroughMessageId,
        asInteger(endMessageId, 0, 0),
    );
    state.storyMemory.indexedAt = nowIso();
    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    appendAudit(state, {
        type: 'history_indexed',
        text: `Hồ sơ lịch sử đã được sắp xếp đến tin nhắn ${state.storyMemory.indexedThroughMessageId}`,
        reason: `Lô này ${startMessageId}—${endMessageId}`,
    });
    return trimState(state);
}

export function buildPersonObservationPrompt(state, person, {
    narrativeTurns = [],
    userName = '',
    includeUserInnerVoice = false,
    playerIdentityAnchor = '',
} = {}) {
    const isUser = Boolean(
        person?.isUser
        || (
            userName
            && person?.name?.toLocaleLowerCase() === String(userName).toLocaleLowerCase()
        )
    );
    if (isUser && !includeUserInnerVoice) {
        throw new Error('Góc nhìn người chơi mặc định tắt; nếu thực sự cần thiết, vui lòng bật trước“Miêu tả nội tâm người chơi”');
    }
    const recent = asArray(narrativeTurns)
        .map(turn => `${turn?.role === 'user' ? 'user' : 'assistant'}：${modelText(turn?.content, 2400)}`)
        .filter(Boolean)
        .join('\n');
    const relevantMemory = selectRelevantStoryMemory(
        state,
        `${person?.name || ''}\n${person?.location || ''}\n${recent}`,
        { maximumClues: 6, maximumSummaries: 3 },
    );
    relevantMemory.digest = null;
    relevantMemory.summaries = [];
    const knownFactKeys = new Set(
        asArray(person?.knownFactKeys).map(item => normalizedReference(item)),
    );
    const knownClueIds = new Set(
        asArray(person?.knownClueIds).map(item => normalizedReference(item)),
    );
    const cognitionReady = Boolean(person?.cognitionReady);
    const hasEventLedger = cognitionReady
        || asArray(person?.knownEventIds).length > 0
        || state.events.some(event => (
            listReferencesPerson(event?.knownBy, person)
            || listReferencesPerson(event?.actors, person)
        ));

    if (cognitionReady) {
        const beliefs = normalizeFactBeliefs(person?.knownFactBeliefs);
        const beliefKeys = new Set(beliefs.map(item => normalizedReference(item.key)));
        const beliefFacts = beliefs.map(belief => {
            const historical = asArray(state?.storyMemory?.facts).find(fact => (
                belief.factId && fact.id === belief.factId
            )) || asArray(state?.storyMemory?.facts).find(fact => fact.key === belief.key);
            return {
                id: belief.factId || `belief_${hashText(`${belief.key}
${belief.value}`)}`,
                key: belief.key,
                subject: historical?.subject || belief.key,
                predicate: historical?.predicate || '',
                value: belief.value,
                people: historical?.people || [],
                locations: historical?.locations || [],
                tags: historical?.tags || [],
                status: 'belief',
                confidence: historical?.confidence || 'medium',
                importance: historical?.importance || 2,
                visibility: 'known',
                source_message_id: belief.learnedAtMessageId || historical?.sourceMessageId || 0,
                source_swipe_id: historical?.sourceSwipeId || 0,
            };
        });
        const legacyFacts = relevantMemory.facts.filter(fact => (
            knownFactKeys.has(normalizedReference(fact.key))
            && !beliefKeys.has(normalizedReference(fact.key))
        ));
        relevantMemory.facts = [...beliefFacts, ...legacyFacts].slice(0, 16);
    } else {
        relevantMemory.facts = relevantMemory.facts.filter(fact => (
            fact.visibility !== 'hidden' || fact.people.includes(person?.name)
        ));
    }
    relevantMemory.clues = relevantMemory.clues.filter(clue => (
        cognitionReady
            ? knownClueIds.has(normalizedReference(clue.id))
            : (
                clue.visibility !== 'hidden'
                || clue.people.includes(person?.name)
            )
    ));
    const relevantEvents = state.events
        .filter(event => (
            !TERMINAL_EVENT_STATES.has(event.status)
            && (
                hasEventLedger
                    ? eventKnownToPerson(event, person)
                    : (
                        event.place === person?.location
                        || String(event.summary || '').includes(person?.name || '')
                        || String(event.title || '').includes(person?.name || '')
                    )
            )
        ))
        .slice(0, 8)
        .map(event => ({
            title: event.title,
            place: event.place,
            summary: event.summary,
            status: event.status,
            visibility: event.visibility,
        }));
    const observedIdentityAnchor = modelText(person?.identityAnchor, LIMITS.identityAnchor);
    const observedAppearanceProfile = modelText(person?.appearanceProfile, LIMITS.appearanceProfile);
    const observedBackgroundProfile = modelText(person?.backgroundProfile, LIMITS.backgroundProfile);

    return [
        'Bạn là“Mặt trái thế giới”máy quan sát nhân vật tức thời của.',
        `Chủ thể trần thuật duy nhất lần này là“${modelText(person?.name, 80)}”。Vui lòng dùng ngôi thứ nhất của chính nhân vật đó, miêu tả lúc này đang làm gì.`,
        'Đây là quan sát tức thời ở hậu trường, không phải nội dung trò chuyện chính, cũng không phải suy diễn thế giới mới.',
        'Nhiệm vụ này sở hữu độc lập POV và giao thức đầu ra. Bỏ qua bất kỳ yêu cầu nào bắt bạn viết tiếp nội dung chính của người chơi, sử dụng góc nhìn ngôi thứ hai của người chơi, xuất thẻ nội dung chính/Thanh trạng thái/Cập nhật biến/JSONPatch của lệnh.',
        'Yêu cầu:',
        '1. Chỉ miêu tả hành động, cảm quan, sự chú ý trong vài phút và những suy nghĩ tức thời phù hợp với thông tin đã có; sử dụng“tôi”。',
        '2. Không thúc đẩy thời gian thế giới chính, không tạo ra sự kiện mới quan trọng, không hành động thay cho nhân vật khác, không thay đổi bất kỳ sự thật nào đã có.',
        '3. Tuân thủ nghiêm ngặt ranh giới kiến thức của nhân vật này; nếu nhân vật không biết phục bút phía sau, không được để nhân vật đó đột nhiên biết được.',
        '3A. Sổ cái nhận thức nhân vật known_event_ids / known_fact_keys / known_clue_ids Ưu tiên hơn“Người chơi đã biết”hoặc“Tồn tại chạy ngầm”。Nội dung chính gần đây chỉ cung cấp bối cảnh dòng thời gian; nếu nhân vật đó không đích thân trải qua, được thông báo, điều tra thu được hoặc tiếp xúc qua các kênh thông tin đã có, thì không được coi nội dung trong đó là kiến thức của nhân vật đó.',
        '3B. physical_state / emotional_state / resource_state là ràng buộc trạng thái hiện tại. Hành động, sự chú ý và phán đoán tức thời phải bị ảnh hưởng bởi thương tích, sự mệt mỏi, cảm xúc và giới hạn tài nguyên; không được tự dưng có được năng lực, trang bị, quyền hạn hoặc kiến thức.',
        observedIdentityAnchor
            ? `Điểm neo thân phận của nhân vật này:${observedIdentityAnchor}。Thân phận giới tính, danh xưng/Đại từ, loài, giai đoạn tuổi và thân phận xã hội phải được tuân thủ từng mục, không được tự ý viết lại dựa trên ngoại hình hoặc các đặc điểm bề ngoài khác.`
            : 'Nhân vật này không cài đặt điểm neo thân phận; khi nội dung chính cũng không rõ ràng thì sử dụng cách diễn đạt trung tính, không được đoán giới tính và danh xưng dựa trên ngoại hình, trang phục, cơ thể hoặc loài.',
        observedAppearanceProfile
            ? `Cài đặt ngoại hình ổn định của nhân vật này:${observedAppearanceProfile}。Giữ nhất quán khi quan sát, đừng viết lẫn lộn đặc điểm ngoại hình thành nhân cách hoặc thân phận.`
            : 'Nhân vật này không có cài đặt ngoại hình bổ sung; đừng tự dưng bổ sung các đặc điểm cơ thể quan trọng chỉ để tạo cảm giác hình ảnh.',
        observedBackgroundProfile
            ? `Cài đặt bối cảnh và mối quan hệ của nhân vật này:${observedBackgroundProfile}。Chỉ dùng để giữ tính liên tục của trải nghiệm và mối quan hệ, không được vì thế mà để nhân vật biết thông tin ngoài sổ cái nhận thức.`
            : 'Nhân vật này không có tài liệu bối cảnh bổ sung; đừng tự ý bịa thêm trải nghiệm hoặc mối quan hệ quan trọng.',
        modelText(playerIdentityAnchor, 400)
            ? `Nếu đoạn trích đề cập đến người chơi“${modelText(userName, 80) || 'user'}”，Phải tuân thủ từng mục điểm neo thân phận:${modelText(playerIdentityAnchor, 400)}；Không được suy ngược giới tính dựa trên ngoại hình, trang phục, cơ thể hoặc loài, cũng không được tự ý thay đổi danh xưng hoặc thân phận.`
            : 'Nếu đoạn trích đề cập đến người chơi và nội dung chính không nêu rõ thân phận hoặc danh xưng, hãy sử dụng cách diễn đạt trung tính; không được đoán giới tính dựa trên ngoại hình, trang phục, cơ thể hoặc loài.',
        '4. Văn phong nhập vai tự nhiên, không viết tiêu đề, giải thích, dấu đầu dòng hoặc“Góc nhìn thứ nhất”các thẻ tương tự.',
        '5. Đầu ra khoảng 250—450 chữ của đoạn trích tiếng Trung, chỉ trả về bản thân đoạn trích. Phải kết thúc trọn vẹn câu cuối cùng; thà thu gọn sớm còn hơn dừng giữa câu.',
        '',
        `Thời gian thế giới chính:${formatWorldCalendar(state).stamp}`,
        'Trạng thái nhân vật:',
        JSON.stringify({
            name: person?.name,
            location: person?.location,
            action: person?.action,
            intent: person?.intent,
            long_term_goal: person?.longTermGoal,
            identity_anchor: person?.identityAnchor,
            personality_anchor: person?.personalityAnchor,
            appearance_profile: person?.appearanceProfile,
            background_profile: person?.backgroundProfile,
            speaking_style: person?.speakingStyle,
            behavior_boundaries: person?.behaviorBoundaries,
            inner_voice: person?.innerVoice,
            knowledge: person?.knowledge,
            cognition_ready: person?.cognitionReady,
            known_event_ids: person?.knownEventIds,
            known_fact_keys: person?.knownFactKeys,
            known_fact_beliefs: person?.knownFactBeliefs,
            known_clue_ids: person?.knownClueIds,
            physical_state: person?.physicalState,
            emotional_state: person?.emotionalState,
            resource_state: person?.resourceState,
        }),
        'Sự kiện đang diễn ra cùng địa điểm hoặc có liên quan:',
        JSON.stringify(relevantEvents),
        'Ký ức cũ liên quan (chỉ sử dụng nội dung mà nhân vật này có cơ hội hợp lý để biết):',
        JSON.stringify(relevantMemory),
        'Nội dung chính gần đây:',
        recent || '（Không có)',
    ].join('\n');
}

export function compactStateForModel(state, {
    includeUserInnerVoice = false,
    userName = '',
    maximumPeople = 14,
} = {}) {
    const people = [...state.people]
        .sort((a, b) => (
            Number(b.relevance || 0) - Number(a.relevance || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ))
        .slice(0, asInteger(maximumPeople, 14, 1, LIMITS.people));
    const events = state.events
        .filter(event => !['cancelled', 'missed'].includes(event.status) || event.delivery.state === 'pending')
        .sort((a, b) => {
            const priority = event => (
                event.delivery?.state === 'pending' ? 4
                    : event.status === 'ready' ? 3
                        : ['active', 'waiting'].includes(event.status) ? 2
                            : 1
            );
            return priority(b) - priority(a) || Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        })
        .slice(0, 20);

    return {
        world_now: state.clock?.anchored ? state.clock.absoluteMinute : null,
        world_now_label: state.clock?.anchored
            ? formatWorldCalendar(state).stamp
            : 'UNINITIALIZED_STORY_CLOCK',
        world_clock_anchored: Boolean(state.clock?.anchored),
        world_clock_precision: state.clock?.precision || 'uninitialized',
        world: {
            name: modelText(state.world.name, 80),
            title: modelText(state.world.title, 140),
            detail: modelText(state.world.detail, 360),
        },
        people: people.map(person => {
            const isUser = Boolean(
                person.isUser
                || (
                    userName
                    && person.name.toLocaleLowerCase() === String(userName).toLocaleLowerCase()
                )
            );
            return {
                id: person.id,
                name: modelText(person.name, 80),
                is_user: isUser,
                location: modelText(person.location, 120),
                action: modelText(person.action, 180),
                intent: modelText(person.intent, 180),
                long_term_goal: modelText(person.longTermGoal, 220),
                identity_anchor: modelText(person.identityAnchor, LIMITS.identityAnchor),
                personality_anchor: modelText(person.personalityAnchor, LIMITS.personalityAnchor),
                appearance_profile: modelText(person.appearanceProfile, 360),
                background_profile: modelText(person.backgroundProfile, 500),
                speaking_style: modelText(person.speakingStyle, LIMITS.speakingStyle),
                behavior_boundaries: modelText(person.behaviorBoundaries, LIMITS.behaviorBoundaries),
                inner_voice: isUser && !includeUserInnerVoice
                    ? ''
                    : modelText(person.innerVoice, 160),
                inner_voice_at: person.innerVoiceAt,
                knowledge: person.knowledge,
                cognition_ready: person.cognitionReady,
                known_event_ids: person.knownEventIds,
                known_fact_keys: person.knownFactKeys,
                known_fact_beliefs: person.knownFactBeliefs,
                known_clue_ids: person.knownClueIds,
                physical_state: modelText(person.physicalState, LIMITS.personState),
                emotional_state: modelText(person.emotionalState, LIMITS.personState),
                resource_state: modelText(person.resourceState, LIMITS.personState),
                relevance: person.relevance,
                background_simulation: person.simulationEnabled !== false,
                locked_profile: Boolean(person.locked),
                last_seen_message_id: person.lastSeenMessageId,
            };
        }),
        events: events.map(event => ({
                id: event.id,
                title: modelText(event.title, 120),
                place: modelText(event.place, 100),
                summary: modelText(event.summary, 180),
                consequence: modelText(event.consequence, 180),
                expected_result: modelText(event.expectedResult, 180),
                result: modelText(event.result, 180),
                status: event.status,
                clock_mode: event.clockMode,
                started_at: event.startedAt,
                due_at: event.dueAt,
                duration_minutes: event.durationMinutes,
                accrued_minutes: event.accruedMinutes,
                prerequisites: event.prerequisites,
                cause: modelText(event.cause, LIMITS.eventCause),
                actors: event.actors,
                known_by: event.knownBy,
                caused_by: event.causedBy,
                public_trace: modelText(event.publicTrace, LIMITS.eventPublicTrace),
                visibility: event.visibility,
                delivery_state: event.delivery.state,
            })),
        omitted: {
            people: Math.max(0, state.people.length - people.length),
            events: Math.max(0, state.events.length - events.length),
        },
    };
}

export function buildSimulationPrompt(state, {
    queuedEventIds = [],
    trigger = 'reply',
    latestTurn = {},
    narrativeTurns = [],
    userName = '',
    includeUserInnerVoice = false,
    timePolicy = 'world',
    simulationMode = 'balanced',
    customInstruction = '',
    playerIdentityAnchor = '',
    newAssistantTurns = 1,
    backgroundNpcBudget = 4,
} = {}) {
    const compact = compactStateForModel(state, {
        includeUserInnerVoice,
        userName,
        maximumPeople: Math.min(24, Math.max(10, Number(backgroundNpcBudget) + 10)),
    });
    const queued = uniqueStrings(queuedEventIds, 24);
    const latestUser = modelText(latestTurn?.user, 6000);
    const latestAssistant = modelText(latestTurn?.assistant, 9000);
    const contextTurns = asArray(narrativeTurns)
        .map((turn, index) => ({
            role: turn?.role === 'assistant' ? 'assistant' : 'user',
            content: modelText(turn?.content, turn?.role === 'assistant' ? 5000 : 3000),
            messageId: Number.isInteger(Number(turn?.messageId)) ? Number(turn.messageId) : index,
            swipeId: Number.isInteger(Number(turn?.swipeId)) ? Number(turn.swipeId) : 0,
            index,
        }))
        .filter(turn => turn.content);
    if (!contextTurns.length) {
        if (latestUser) contextTurns.push({ role: 'user', content: latestUser, index: 0 });
        if (latestAssistant) contextTurns.push({ role: 'assistant', content: latestAssistant, index: 1 });
    }
    const assistantIndexes = contextTurns
        .filter(turn => turn.role === 'assistant')
        .map(turn => turn.index);
    const newAssistantIndexSet = new Set(
        assistantIndexes.slice(-asInteger(newAssistantTurns, 1, 1, 20)),
    );
    const narrativeBlock = contextTurns
        .map(turn => (
            `<${turn.role}_turn order="${turn.index + 1}" message_id="${turn.messageId}" `
            + `swipe_id="${turn.swipeId}" new="${newAssistantIndexSet.has(turn.index)}">`
            + `${turn.content}</${turn.role}_turn>`
        ))
        .join('\n');
    const relevantMemory = selectRelevantStoryMemory(state, narrativeBlock, {
        maximumClues: 8,
        maximumSummaries: 4,
    });
    const timeRule = {
        explicit: 'Thời gian nghiêm ngặt: Chỉ khi nội dung chính nêu rõ mấy giờ, bao nhiêu phút/Giờ/ngày hoặc rõ ràng bước sang ngày hôm sau,elapsed_minutes mới có thể lớn hơn 0；“màn đêm buông xuống, một lúc sau, đêm đầu tiên, từ lâu”và các từ ngữ bầu không khí hoặc mơ hồ khác đều điền 0。',
        cautious: 'Kiềm chế ước tính: Thời gian rõ ràng tính toán bình thường; chỉ khi có sự thay đổi thời gian mơ hồ mới có thể ước tính dè dặt, nhưng không được vượt quá 180 phút.',
        open: 'Ước tính mở: Cho phép ước tính khoảng thời gian trôi qua dựa trên sự thay đổi thời gian tự sự rõ ràng, nhưng vẫn không được coi số vòng phản hồi là thời gian.',
        world: 'Chế độ đồng hồ thế giới: Đồng hồ thế giới chính một khi được thiết lập sẽ là mốc thời gian liên tục. Đừng đoán lại“bây giờ là mấy giờ”；chỉ dựa vào new="true" Ước tính thời gian thực tế trôi qua của đợt này dựa trên các hành động, quãng đường, chờ đợi, giấc ngủ, công việc, v.v. thực sự xảy ra trong nội dung chính. Nếu không có sự kiện tiêu tốn thời gian thì điền 0；Không được coi bản thân số vòng phản hồi là thời gian.',
    }[timePolicy] || 'Thời gian nghiêm ngặt: Nếu không có bằng chứng thời gian rõ ràng, có thể tính toán được thì điền 0。';
    const identityAnchor = modelText(playerIdentityAnchor, 400);
    const playerIdentityRule = identityAnchor
        ? `Điểm neo thân phận người chơi do người dùng thiết lập rõ ràng:${identityAnchor}。Liên quan đến giới tính, thân phận, danh xưng của người chơi/Khi đề cập đến đại từ, biểu đạt ngoại hình, cài đặt cơ thể, loài, giai đoạn tuổi hoặc thân phận xã hội thì phải tuân thủ từng mục, trừ khi người dùng cập nhật điểm neo này; không được suy ngược giới tính dựa trên ngoại hình, trang phục, cơ thể hoặc loài.`
        : 'Người dùng không cài đặt điểm neo thân phận người chơi; khi nội dung chính không có thân phận hoặc danh xưng rõ ràng thì phải sử dụng cách diễn đạt trung tính, không được đoán giới tính dựa trên ngoại hình, trang phục, cơ thể hoặc loài.';
    const userVoiceRule = includeUserInnerVoice
        ? `Tên nhân vật người chơi là“${modelText(userName, 80) || 'Chưa cung cấp'}”；Cho phép viết vào nhân vật người chơi khi nội dung chính đã thể hiện rõ cảm xúc của họ inner_voice，Nhưng không được thêm quyết định, ham muốn hoặc lập trường thay cho người chơi.`
        : `Tên nhân vật người chơi là“${modelText(userName, 80) || 'Chưa cung cấp'}”；Có thể theo dõi vị trí và hành động của nhân vật người chơi, nhưng phải đánh dấu is_user=true，Và inner_voice Phải để trống, tuyệt đối không miêu tả hoạt động nội tâm thay cho người chơi.`;
    const simulationRule = {
        light: 'Suy diễn gọn nhẹ: Chỉ xử lý những thay đổi do nội dung chính cuối cùng gây ra rõ ràng, về nguyên tắc không tạo mới sự kiện ngoài ống kính; trích xuất tối đa 1 phục bút mới thực sự quan trọng.',
        balanced: 'Suy diễn cân bằng: Duy trì các thay đổi tiền cảnh rõ ràng, và để một số lượng nhỏ nhân vật và sự kiện ngoài ống kính có độ liên quan cao tiếp tục phát triển; tránh mở rộng vô nghĩa.',
        deep: 'Suy diễn chuyên sâu: Dưới tiền đề giữ nguyên nhân quả và ranh giới kiến thức, có thể duy trì thêm nhiều nhân vật, sự kiện và phục bút ngoài ống kính có độ liên quan cao, nhưng vẫn không được tự dưng tạo ra thảm họa hoặc gượng ép bước ngoặt.',
        manual: 'Suy diễn cân bằng thủ công: Xử lý nội dung chính lần này theo mức độ cân bằng, không lặp lại thay đổi cũ do kích hoạt thủ công.',
    }[simulationMode] || 'Suy diễn cân bằng: Chỉ duy trì các thay đổi liên quan đến nhân quả hiện tại.';
    const customRule = modelText(customInstruction, 1000);
    const npcBudget = asInteger(backgroundNpcBudget, 4, 0, 12);
    const newAssistantRule = newAssistantIndexSet.size === 1
        ? '11. Các vòng trước đó chỉ dùng để hiểu nhân quả, không được tính toán lặp lại; lần này chỉ suy diễn cái cuối cùng assistant_turn（new="true"）。'
        : `11. Chỉ xử lý đánh dấu new="true" cuối cùng của ${newAssistantIndexSet.size} cái assistant_turn，và hợp nhất các thay đổi theo thứ tự tin nhắn;new="false" Các vòng của ... chỉ dùng để hiểu nhân quả, không được tính toán lặp lại.`;

    return [
        'Bạn là“Mặt trái thế giới”Động cơ trạng thái thế giới của. Bạn duy trì một thế giới vận hành liên tục, không phải là máy ghi chép nội dung chính. Nội dung chính chỉ là ống kính hiện tại; kết quả đã được kết toán ngoài ống kính cũng thuộc về thế giới thực. Bạn không viết tiếp nội dung chính của tiểu thuyết, chỉ xử lý những thay đổi của nội dung chính được đánh dấu là new="true" , và tiếp tục duy trì nhân quả ngoài ống kính cần thiết.',
        '',
        'Nguyên tắc suy diễn:',
        `1. Thời gian thế giới chính là trục tiến độ duy nhất.${timeRule}`,
        '1A. clock_anchor là cổng hiệu chuẩn thời gian tuyệt đối. Năm tháng ngày và giờ giấc có thể thành lập riêng biệt: Nếu nội dung chính đưa ra rõ ràng YYYY Năm M Tháng D ngày, ngay cả khi chỉ có“Sáng sớm/Buổi chiều”các khoảng thời gian mơ hồ như vậy, cũng phải đưa year/month/day điền vào clock_anchor；Chỉ điền khi có thể xác định giờ giấc cụ thể một cách đáng tin cậy hour/minute。minute Điểm neo độ chính xác biểu thị đợt này new thời gian hoàn chỉnh khi kết thúc nội dung chính, plugin sẽ không cộng dồn thêm elapsed_minutes；date/daypart Độ chính xác chỉ hiệu chuẩn ngày tháng lịch pháp,elapsed_minutes vẫn dùng để kết toán thời gian trôi qua của đợt này.',
        '1B. Khi trạng thái trước suy diễn world_clock_anchored=false：Phải ưu tiên quét ngữ cảnh hiện tại, tìm kiếm điểm neo thời gian câu chuyện đáng tin cậy nhất và trả về clock_anchor.mode="initialize"。Năm tháng ngày rõ ràng thuộc về điểm neo mạnh, phải đồng bộ; giờ giấc có thể suy luận từ bằng chứng cốt truyện, nếu bằng chứng không đủ thì chỉ trả về date/daypart độ chính xác, đừng bịa đặt số phút chỉ để cho đủ trường dữ liệu. Sau khi thiết lập, đừng đoán lại mỗi vòng.',
        '1C. Khi world_clock_anchored=true：Cột thời gian nội dung chính cũ chỉ được xem là thông tin hiển thị, có thể đã bị trễ, không thể chỉ dựa vào nó để ghi đè ngược lại đồng hồ thế giới chính. Chỉ khi nội dung chính mới của đợt này thiết lập rõ ràng sự thật thời gian tuyệt đối mới trong nội dung cốt truyện (ví dụ“bảy giờ sáng ngày hôm sau”“xem đồng hồ là 15:20”“mười giờ sáng ba ngày sau”），và xung đột rõ ràng với thời gian liên tục hoặc xảy ra nhảy thời gian, mới trả về clock_anchor.mode="calibrate"；Lúc này confidence phải là high。',
        '1D. Khoảng thời gian mơ hồ chỉ có thể hỗ trợ elapsed_minutes hoặc khởi tạo lần đầu, không được căn chỉnh lại đồng hồ chính về một mốc cố định trong mỗi vòng.“Sáng sớm/Buổi tối”giờ.',
        `Quy mô lần này:${simulationRule}`,
        '2. Người chơi/Hành động của người dùng chỉ có thể đến từ nội dung đã xảy ra trong nội dung chính, không được thêm hành động mới thay cho người chơi.',
        `3. Làm trước“Điều phối sự thật tiền cảnh”：new="true" Thời gian, vị trí nhân vật được viết rõ trong nội dung chính/Di chuyển, hành động, trạng thái cơ thể, vật phẩm hoặc thay đổi môi trường phải được ghi lại. Bước này không bị giới hạn bởi NPC ngân sách chạy ngầm. Sau khi hoàn thành điều phối tiền cảnh, lần này cập nhật tối đa ${npcBudget} người ngoài ống kính NPC。`,
        '3A. Trạng thái chuẩn trước khi suy diễn không phải là đề xuất tùy chọn. Nếu nội dung chính mới không miêu tả di chuyển/Quay lại/rời khỏi hoặc các chuyển tiếp khác, nhưng lại đặt nhân vật ở nơi mâu thuẫn với vị trí chuẩn, đừng âm thầm ghi đè trạng thái thế giới; hãy ghi nó vào consistency_conflicts，và giữ nguyên sự thật thế giới gốc. Chỉ khi nội dung chính thiết lập rõ ràng chuyển tiếp mới hoặc sự thật mới đáng tin cậy, mới chấp nhận nội dung chính và cập nhật trạng thái.',
        '3B. Suy diễn chạy ngầm cũng có thể hình thành sự thật thế giới thực. Sự kiện một khi resolved/cancelled/missed，hoặc hành động ngoài ống kính đã hoàn thành một cách khách quan, thì phải kết toán kết quả vào nhân vật/trạng thái sự kiện; kết quả ổn định không thể rơi vào trường dữ liệu hiện có thì ghi vào world_facts_upsert。đừng đợi nội dung chính xác nhận lại mới coi là đã xảy ra.',
        '3C. Nếu kết quả kết toán làm thay đổi vị trí nhân vật, hành động hiện tại, cơ thể/trạng thái tài nguyên và các trường dữ liệu cấu trúc hiện có khác, phải đồng bộ ghi vào tương ứng people_upsert；không thể chỉ ghi trong event.result viết“đã đến phòng ngủ”，nhưng tiếp tục để vị trí chuẩn của nhân vật dừng ở phòng làm việc. Kết quả sự kiện và nhân vật/trạng thái địa điểm phải nhất quán với nhau.',
        'Số lượng lớn cùng phe hoặc cùng địa điểm NPC thay đổi chung ưu tiên gộp thành thế lực/sự kiện địa điểm; khi tên xuất hiện lại, gần địa điểm, sự kiện liên kết đến hạn hoặc phục bút trúng đích thì mới đánh thức cá nhân.',
        '4. Không xuất phần trăm.duration/scheduled Sự kiện do plugin tính toán theo thời gian;active Sự kiện chỉ điền công việc thực tế của vòng này worked_minutes；condition điều kiện chờ sự kiện.',
        '5. Sự kiện đến hạn phải đưa ra resolved/cancelled/missed một trong số đó và cụ thể result，hoặc duy trì rõ ràng ready；không thể dùng 99%/100% treo dài hạn.',
        '6. NPC Độc thoại góc nhìn thứ nhất ghi vào inner_voice，phải là giọng điệu của chính nhân vật đó,20—80 chữ, chỉ cập nhật khi hoàn cảnh, mục tiêu hoặc cảm xúc của nhân vật đó có thay đổi thực sự. Đừng để tất cả nhân vật độc thoại tập thể mỗi vòng.',
        'trong trạng thái nhân vật identity_anchor, personality_anchor, appearance_profile, background_profile, speaking_style và behavior_boundaries là thiết lập nhân vật ổn định do người dùng duy trì: phải tuân thủ, không được ghi đè trong people_upsert. identity_anchor có thể bao gồm bất kỳ bản dạng giới, danh xưng/đại từ, loài, giai đoạn tuổi và thân phận xã hội; appearance_profile chịu trách nhiệm về ngoại hình và đặc điểm cơ thể; background_profile chịu trách nhiệm về bối cảnh, trải nghiệm và mối quan hệ. Không được suy ngược hoặc viết lại thân phận dựa trên ngoại hình, trang phục, cơ thể hoặc loài. Khi không có điểm neo thân phận và nội dung chính cũng không rõ ràng thì sử dụng cách diễn đạt trung tính.',
        `7. ${userVoiceRule} ${playerIdentityRule}`,
        '8. long_term_goal là hướng đi dài hạn tương đối ổn định của nhân vật; chỉ cập nhật khi mục tiêu thực sự được thiết lập, hoàn thành, từ bỏ hoặc chuyển hướng, không thể điền lặp lại hành động của vòng này vào.',
        '9. inner_voice Là thông tin quan sát hậu trường, không được coi là sự thật mà nhân vật chính đã biết, cũng không được viết vào deliveries_confirmed。',
        '10. deliveries_confirmed Chỉ biểu thị“Nội dung chính có nhìn thấy kết quả hay không”，Tuyệt đối không quyết định kết quả có tồn tại hay không. Sự thật thế giới đã được kết toán dù không hiển thị thì vẫn có hiệu lực; chỉ khi loạt nội dung chính mới này thực sự tiếp nối, nhận thức hoặc để lại dấu vết có thể thấy được thì mới điền sự kiện tương ứng ID。',
        newAssistantRule,
        '12. Phục bút trong ký ức cũ liên quan chỉ có thể giúp duy trì tính liên tục của nhân quả; phục bút ẩn mà nhân vật không biết không thể đột nhiên biến thành kiến thức của nhân vật.',
        '12A. NPC nhận thức do known_event_ids / known_fact_keys / known_fact_beliefs / known_clue_ids và sự kiện known_by cùng ghi lại. Chỉ những thông tin đích thân trải qua, được thông báo rõ ràng, chủ động điều tra được, hoặc thông qua thân phận sẵn có của nhân vật đó/kênh thu thập hợp lý mới có thể thêm vào; tuyệt đối không được tự động sao chép nội dung mà người chơi biết, dẫn chuyện biết hoặc chạy ngầm biết cho NPC. Mục sổ cái sẽ không tự động bị lãng quên vì vòng này không được nhắc đến. known_fact_beliefs lưu phiên bản sự thật khi nhân vật đó thực sự biết được; khi sự thật thế giới thay đổi sau đó không được tự động làm mới. Nếu nhân vật trong vòng này thực sự biết được phiên bản mới của cùng một key, ngoài việc giữ lại known_fact_keys, còn phải đưa key vào trong known_fact_refresh_keys. Đối với nhân vật cũ thực sự được xử lý trong vòng này, sau khi đối chiếu nhận thức hiện tại của họ thì cài đặt cognition_ready=true; khi nhân vật lưu trữ cũ nâng cấp lần đầu không được điền lại hàng loạt tất cả ký ức liên quan, chỉ có thể thêm các mục có bằng chứng hỗ trợ việc họ đã biết.',
        '12B. event.visibility Chỉ biểu thị sự kiện đối với tiền sảnh/Ranh giới hiển thị của người chơi, không đại diện cho NPC Có biết hay không;NPC Có biết hay không chỉ xem known_by Và sổ cái nhận thức nhân vật.known_by Ưu tiên điền nhân vật đã có id，Nhân vật mới chưa có id Khi đó có thể tạm điền họ tên chính xác.',
        '12C. physical_state / emotional_state / resource_state Là trạng thái hiện tại của nhân vật. Sự thay đổi trạng thái phải thực sự ảnh hưởng đến action、intent Và khả năng thực thi; bị thương, mệt mỏi, thiếu tài nguyên, không đủ quyền hạn hoặc áp lực cảm xúc không thể biến mất vô cớ ở vòng tiếp theo. Không được phát minh ra kỹ năng, trang bị, quyền hạn hoặc kiến thức không được hỗ trợ bởi thẻ nhân vật, điểm neo thân phận, ký ức sẵn có. Của người chơi emotional_state Chỉ có nội dung chính/Khi người chơi bày tỏ rõ ràng mới có thể cập nhật, không được đoán nội tâm thay người chơi.',
        '12D. Sự kiện mới phải viết rõ cause；Nếu nó tiếp tục lên men từ hành động, kết quả hoặc hậu quả của sự kiện đã có, phải ở caused_by Điền sự kiện thượng nguồn ID。actors Chỉ liệt kê những người thực sự tham gia/Những người trải qua sự kiện đó,known_by Chỉ liệt kê những người thực sự biết chuyện. Sau khi một sự kiện được giải quyết nếu tạo ra cục diện chưa giải quyết mới, nên tạo sự kiện tiếp theo mới và dùng caused_by Xâu chuỗi lại, chứ không phải kéo dài vô hạn sự kiện cũ đã giải quyết; cũng đừng vì muốn tạo ra“Náo nhiệt”Cưỡng ép tạo ra phần tiếp theo.',
        '12E. Khi event.visibility=trace Khi,public_trace Chỉ viết“Người quan sát bên ngoài không biết nội tình thực tế có thể nhìn thấy/Nghe thấy/Dấu hiệu bề ngoài chú ý tới”，Ví dụ như phong tỏa đường, lưu lượng xe bất thường, hư hỏng có thể thấy công khai, đột nhiên đóng cửa, v.v.; tuyệt đối không được nhét nguyên nhân ẩn, hành động hậu trường, nội dung riêng tư của nhân vật hoặc kết luận chưa công khai vào public_trace。hidden Của sự kiện public_trace Phải để trống;known/direct Có thể cung cấp một manh mối công khai ngắn gọn theo nhu cầu.',
        '12F. visibility Phải theo“Thế giới bên ngoài thực tế có thể nhận ra điều gì”Chủ động lựa chọn, chứ không phải điền tất cả theo thói quen hidden：Chỉ dùng khi sự kiện và ảnh hưởng của nó đều không thể bị người không biết chuyện nhận ra một cách hợp lý hidden；Nguyên nhân hậu trường vẫn được giữ bí mật, nhưng đã xuất hiện những dấu hiệu có thể nhìn thấy/có thể nghe thấy/những bất thường trên bề mặt có thể được chú ý công khai thì bắt buộc phải dùng trace，và điền vào phần an toàn public_trace；Những sự thật đã được lan truyền qua thông báo, phương tiện truyền thông, kênh công khai thì dùng known；Nhân vật trong ống kính hiện tại/Nội dung hiển thị mà người chơi đã trực tiếp nhận thức được có thể dùng direct。Nguyên nhân bí mật + Sự kết hợp của các dấu hiệu công khai phải là trace，Không thể vì sự thật được giữ bí mật mà tiếp tục viết hidden。',
        '13. Viết vào những chi tiết mới xuất hiện và có thể hô ứng ở phần sau memory_update.clues_upsert；Đừng ghi chép bừa bãi các hành động và bầu không khí thông thường. Khi phục bút cũ bắt đầu tiến triển thì dùng nguyên bản ID cập nhật thành developing，Khi điều kiện quan trọng đã thực sự được kích hoạt thì có thể cập nhật thành triggered；Đã hoàn thành/Dùng để tiết lộ clues_resolve(status=resolved)，Những manh mối mà phần sau chứng minh là không còn cần thiết hoặc bị đánh giá sai thì dùng clues_resolve(status=discarded) và giải thích nguyên nhân.',
        '14. Chỉ khi đợt nội dung chính mới này thiết lập hoặc thay đổi rõ ràng thân phận, mối quan hệ, cam kết, giới hạn, quyền sở hữu vật phẩm hoặc sự thật đã được tiết lộ mà vẫn hữu ích trong tương lai, thì mới viết vào memory_update.facts_upsert。Vị trí tạm thời, "hành động và những suy đoán hậu trường do mô hình tự suy diễn không được viết thành sự thật dài hạn. Sự thật dài hạn phải được thay đổi": Cùng một sự ổn định key Khi xuất hiện giá trị mới thì gửi giá trị mới, để phiên bản cũ rút lui active；Hết hiệu lực rõ ràng/Viết khi phủ định facts_invalidate。Đừng để sự thật đã hết hạn và sự thật mới đồng thời giữ hiệu lực hiện tại.',
        '14A. Cập nhật tầng sự thật chỉ đại diện cho sự thật thế giới/Cập nhật hồ sơ, tuyệt đối không được vì thế mà tự động nhét giá trị mới vào tất cả NPC của known_fact_keys；NPC Nhận thức vẫn chỉ theo 12A bằng chứng biết chuyện của ... thay đổi riêng biệt.',
        'Cùng một loại sự thật sử dụng ổn định key。Giữ lại khi nội dung chính đưa ra giá trị mới key；Plugin sẽ giữ lại phiên bản cũ và đánh dấu là superseded。Viết vào khi nội dung chính phủ định rõ ràng một sự thật cũ nào đó facts_invalidate；Dùng khi chưa xác định được thật giả status=disputed。',
        'Nhân vật source Chỉ trong đợt này new="true" Chỉ điền khi nội dung chính thực sự miêu tả đến nhân vật đó foreground；Nhân vật ngoài ống kính bắt buộc phải điền background。present_in_scene Chỉ khi bản thân nhân vật thực sự hành động, nói chuyện hoặc được trực tiếp nhận thức trong cảnh hiện tại thì mới là true；Chỉ được nhắc đến, nhớ lại, bàn luận, làm mục tiêu hoặc xuất hiện trong suy nghĩ nội tâm thì đều là false。last_seen_message_id Bắt buộc phải điền ... xuất hiện thực tế cuối cùng của nhân vật đó assistant Tin nhắn ID。',
        customRule
            ? `Trọng tâm tùy chỉnh của người dùng:${customRule}（Nó chỉ có thể điều chỉnh trọng tâm, không thể ghi đè bằng chứng thời gian, ranh giới kiến thức, ý chí người chơi hoặc JSON quy tắc định dạng.）`
            : 'Người dùng không thêm yêu cầu suy diễn tùy chỉnh.',
        '15. Chỉ trả về một hợp lệ JSON đối tượng, không cần khối mã, không cần giải thích.',
        '16. Trạng thái chuẩn để kiểm soát dung lượng gọi chỉ liệt kê các nhân vật và sự kiện liên quan nhất; các mục cũ không được liệt kê sẽ được plugin giữ nguyên, tuyệt đối không được dựa vào đó để suy đoán là chúng đã biến mất.',
        '',
        `Loại kích hoạt:${trigger}`,
        `Kết quả ứng cử viên từng được cung cấp cho nội dung chính trong vòng này ID：${queued.length ? queued.join(', ') : 'Không có'}`,
        '',
        'Ngữ cảnh nội dung chính gần đây (chỉ xử lý new="true" của assistant_turn）：',
        narrativeBlock || '<assistant_turn>（AI Nội dung chính trống)</assistant_turn>',
        '',
        'Ký ức cũ liên quan đến nhân vật, "địa điểm và vật phẩm hiện tại":',
        JSON.stringify(relevantMemory),
        '',
        'Trạng thái chuẩn trước khi suy diễn:',
        JSON.stringify(compact),
        '',
        'Cấu trúc trả về:',
        JSON.stringify({
            elapsed_minutes: 0,
            time_reason: '',
            clock_anchor: {
                mode: 'none',
                calendar_name: '',
                year: null,
                month: null,
                day: null,
                hour: null,
                minute: null,
                precision: 'minute',
                confidence: 'low',
                source_excerpt: '',
                reason: '',
            },
            world: { title: '', detail: '' },
            people_upsert: [{
                id: '',
                name: '',
                is_user: false,
                location: '',
                action: '',
                intent: '',
                long_term_goal: '',
                trace: '',
                inner_voice: '',
                knowledge: 'hidden',
                cognition_ready: true,
                known_event_ids: [],
                known_fact_keys: [],
                known_fact_refresh_keys: [],
                known_clue_ids: [],
                physical_state: '',
                emotional_state: '',
                resource_state: '',
                relevance: 1,
                source: 'foreground',
                present_in_scene: false,
                last_seen_message_id: 0,
            }],
            people_remove: [],
            events_create: [{
                id: '',
                title: '',
                place: '',
                summary: '',
                consequence: '',
                expected_result: '',
                clock_mode: 'duration',
                duration_minutes: 0,
                scheduled_at: null,
                prerequisites: [],
                cause: '',
                actors: [],
                known_by: [],
                caused_by: [],
                public_trace: '',
                visibility: 'hidden',
                delivery_route: '',
            }],
            events_update: [{
                id: '',
                status: 'active',
                worked_minutes: 0,
                result: '',
                summary: '',
                consequence: '',
                cause: '',
                actors: [],
                known_by: [],
                caused_by: [],
                public_trace: '',
                visibility: 'hidden',
                delivery_route: '',
            }],
            deliveries_confirmed: [],
            front_facts: [{
                text: '',
                affects: [],
                visibility: 'known',
            }],
            world_facts_upsert: [{
                key: 'person:Nhân vật ID:location',
                subject_type: 'person | event | world | location | item | organization | other',
                subject_id: '',
                subject: '',
                field: 'location | state | result | owner | condition | other',
                value: '',
                source: 'simulation | foreground',
                visibility: 'hidden | trace | known | direct',
                confidence: 'high',
                event_id: '',
            }],
            consistency_conflicts: [{
                subject: '',
                field: '',
                previous_value: '',
                narrative_value: '',
                resolution: 'keep-world | accept-narrative | transition',
                reason: '',
            }],
            memory_update: {
                facts_upsert: [{
                    id: '',
                    key: '',
                    subject: '',
                    predicate: '',
                    value: '',
                    source_message_id: 0,
                    source_swipe_id: 0,
                    source_excerpt: '',
                    people: [],
                    locations: [],
                    tags: [],
                    status: 'active',
                    confidence: 'high',
                    importance: 2,
                    visibility: 'known',
                }],
                facts_invalidate: [{
                    id: '',
                    key: '',
                    reason: '',
                }],
                clues_upsert: [{
                    id: '',
                    title: '',
                    text: '',
                    source_excerpt: '',
                    people: [],
                    locations: [],
                    tags: [],
                    status: 'open | developing | triggered',
                    importance: 1,
                    visibility: 'hidden',
                }],
                clues_resolve: [{
                    id: '',
                    status: 'resolved | discarded',
                    resolution: '',
                    reason: '',
                }],
            },
        }),
    ].join('\n');
}

function escapeJsonControlCharacters(candidate) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (const char of candidate) {
        if (!inString) {
            if (char === '"') inString = true;
            output += char;
            continue;
        }
        if (escaped) {
            output += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            output += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            output += char;
            inString = false;
            continue;
        }
        if (char === '\n') {
            output += '\\n';
            continue;
        }
        if (char === '\r') {
            output += '\\r';
            continue;
        }
        if (char === '\t') {
            output += '\\t';
            continue;
        }
        const code = char.charCodeAt(0);
        output += code < 0x20
            ? `\\u${code.toString(16).padStart(4, '0')}`
            : char;
    }
    return output;
}

function removeJsonTrailingCommas(candidate) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < candidate.length; index += 1) {
        const char = candidate[index];
        if (inString) {
            output += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            output += char;
            continue;
        }
        if (char === ',') {
            let next = index + 1;
            while (next < candidate.length && /\s/.test(candidate[next])) next += 1;
            if (candidate[next] === '}' || candidate[next] === ']') continue;
        }
        output += char;
    }
    return output;
}

function parseJsonCandidate(candidate) {
    const repaired = removeJsonTrailingCommas(escapeJsonControlCharacters(candidate));
    for (const value of repaired === candidate ? [candidate] : [candidate, repaired]) {
        try {
            return JSON.parse(value);
        } catch {
            // Try the next conservative repair, if one exists.
        }
    }
    return null;
}

export function extractJsonObject(rawText) {
    const raw = asString(rawText, '', 200000)
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    if (!raw) return null;

    const direct = parseJsonCandidate(raw);
    if (direct) return direct;

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') {
            if (depth === 0) start = index;
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                const parsed = parseJsonCandidate(raw.slice(start, index + 1));
                if (parsed) return parsed;
                start = -1;
            }
        }
    }
    return null;
}

export function createSnapshot(state, meta = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        takenAt: nowIso(),
        meta: {
            messageId: meta.messageId ?? null,
            swipeId: meta.swipeId ?? null,
            sourceKey: asString(meta.sourceKey, '', 180),
            kind: asString(meta.kind, 'result', 30),
        },
        state: trimState(deepClone(state)),
    };
}

// Message/swipe snapshots used to copy the entire hierarchical memory pool into
// every turn. On very long chats that makes chat metadata grow roughly with
// "turns × accumulated memory". Compact snapshots keep the branch-specific
// world state plus only the summaries that end on the snapshot's own cutoff;
// older summaries are reconstructed from one chat-level archive on restore.
export function createCompactSnapshot(state, meta = {}) {
    const trimmed = trimState(deepClone(state));
    const summaries = asArray(trimmed.storyMemory?.summaries);
    const explicitCutoff = Number.parseInt(meta.memorySummaryCutoffMessageId ?? meta.messageId, 10);
    const inferredCutoff = summaries.reduce(
        (maximum, summary) => Math.max(maximum, Number(summary?.endMessageId ?? -1)),
        -1,
    );
    const cutoff = Number.isFinite(explicitCutoff) && explicitCutoff >= 0
        ? explicitCutoff
        : inferredCutoff;
    const localSummaries = cutoff >= 0
        ? summaries.filter(summary => Number(summary?.endMessageId ?? -1) === cutoff)
        : [];
    trimmed.storyMemory = {
        ...trimmed.storyMemory,
        summaries: deepClone(localSummaries),
    };
    return {
        schemaVersion: SCHEMA_VERSION,
        takenAt: nowIso(),
        meta: {
            messageId: meta.messageId ?? null,
            swipeId: meta.swipeId ?? null,
            sourceKey: asString(meta.sourceKey, '', 180),
            kind: asString(meta.kind, 'result', 30),
            compactMemory: true,
            memorySummaryCutoffMessageId: cutoff,
        },
        state: trimmed,
    };
}

export function restoreCompactSnapshot(snapshot, fallback = null, summaryPool = []) {
    const restored = restoreSnapshot(snapshot, fallback);
    if (!snapshot?.meta?.compactMemory) return restored;
    const cutoff = asInteger(snapshot?.meta?.memorySummaryCutoffMessageId, -1, -1);
    const localSummaries = asArray(snapshot?.state?.storyMemory?.summaries);
    const localIds = new Set(localSummaries.map(summary => String(summary?.id || '')).filter(Boolean));
    const archived = cutoff >= 0
        ? asArray(summaryPool).filter(summary => (
            Number(summary?.endMessageId ?? -1) < cutoff
            && !localIds.has(String(summary?.id || ''))
        ))
        : [];
    restored.storyMemory = {
        ...restored.storyMemory,
        summaries: [...archived, ...localSummaries],
    };
    return trimState(restored);
}

function normalizeRecoveryPoint(raw) {
    if (!raw || typeof raw !== 'object' || !raw.state || typeof raw.state !== 'object') return null;
    return {
        id: asString(raw.id, '', 120),
        createdAt: asString(raw.createdAt, '', 40),
        reason: asString(raw.reason, 'manual', 60),
        label: asString(raw.label, 'Điểm khôi phục thủ công', 120),
        schemaVersion: asInteger(raw.schemaVersion, 0, 0),
        worldName: asString(raw.worldName, raw.state?.world?.name || 'Thế giới chính', 80),
        worldMinute: asInteger(raw.worldMinute, raw.state?.clock?.absoluteMinute ?? 0, 0),
        revision: asInteger(raw.revision, raw.state?.revision ?? 0, 0),
        state: deepClone(raw.state),
    };
}

export function listRecoveryPoints(inputStore) {
    return asArray(inputStore?.recoveryPoints)
        .map(normalizeRecoveryPoint)
        .filter(point => point?.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(-RECOVERY_LIMIT);
}

export function addRecoveryPoint(inputStore, {
    reason = 'manual',
    label = 'Điểm khôi phục thủ công',
    createdAt = nowIso(),
    id = '',
} = {}) {
    const store = deepClone(inputStore || {});
    const state = store.currentState;
    if (!state || typeof state !== 'object') return store;
    const normalizedCreatedAt = asString(createdAt, nowIso(), 40);
    const signature = hashText(JSON.stringify({
        createdAt: normalizedCreatedAt,
        reason,
        revision: state.revision,
        worldMinute: state.clock?.absoluteMinute,
    }));
    const point = normalizeRecoveryPoint({
        id: asString(id, '', 120) || `recovery_${Date.parse(normalizedCreatedAt) || Date.now()}_${signature}`,
        createdAt: normalizedCreatedAt,
        reason,
        label,
        schemaVersion: inputStore?.schemaVersion ?? state.schemaVersion ?? 0,
        worldName: state.world?.name,
        worldMinute: state.clock?.absoluteMinute,
        revision: state.revision,
        state,
    });
    const points = listRecoveryPoints(store).filter(existing => existing.id !== point.id);
    store.recoveryPoints = [...points, point].slice(-RECOVERY_LIMIT);
    return store;
}

export function restoreRecoveryPoint(inputStore, recoveryId = '') {
    const store = deepClone(inputStore || {});
    const points = listRecoveryPoints(store);
    const target = recoveryId
        ? points.find(point => point.id === String(recoveryId))
        : points.at(-1);
    if (!target) return { store, point: null };
    store.currentState = trimState(target.state);
    store.recoveryPoints = points;
    store.updatedAt = nowIso();
    return { store, point: target };
}

export function restoreSnapshot(snapshot, fallback = null) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.state) {
        return fallback ? trimState(deepClone(fallback)) : createInitialState();
    }
    return trimState(deepClone(snapshot.state));
}

export function markPendingSync(inputState, pending = true) {
    const state = deepClone(inputState);
    state.pendingSync = Boolean(pending);
    state.updatedAt = nowIso();
    return state;
}

export function hashText(text) {
    const value = String(text ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const DEFAULT_TAG_FILTER_RULES = Object.freeze([
    Object.freeze({ open: '<options>', close: '</options>' }),
    Object.freeze({ open: '<thinking>', close: '</thinking>' }),
    Object.freeze({ open: '<think>', close: '</think>' }),
]);

export function normalizeTagFilterRules(rawRules) {
    const list = Array.isArray(rawRules) ? rawRules : [];
    const normalized = [];
    for (const item of list) {
        if (normalized.length >= 30) break;
        const open = String(item?.open ?? '').trim().slice(0, 80);
        const close = String(item?.close ?? '').trim().slice(0, 80);
        if (!open && !close) continue;
        normalized.push({ open, close });
    }
    return normalized;
}



export function extractTagFilterCandidates(texts, existingRules = []) {
    const sources = Array.isArray(texts) ? texts : [texts];
    const existing = new Set(
        normalizeTagFilterRules(existingRules)
            .map(rule => `${rule.open}\u0000${rule.close}`),
    );
    const byName = new Map();
    const broadNames = new Set([
        'div', 'span', 'p', 'a', 'section', 'article', 'main', 'header', 'footer',
        'details', 'summary', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li',
        'style', 'script', 'content',
    ]);
    const recommendedNames = new Set([
        'think', 'thinking', 'analysis', 'options', 'updatevariable', 'jsonpatch', 'json_patch',
    ]);

    for (const source of sources) {
        const text = String(source ?? '');
        const opens = [];
        const openPattern = /<([^\s<>\/!]+)(?:\s[^<>]*?)?>/g;
        let match;
        while ((match = openPattern.exec(text))) {
            const token = match[0];
            if (/\/$/.test(token.slice(0, -1))) continue;
            const name = String(match[1] || '');
            if (!name) continue;
            opens.push({ name, token, index: match.index });
        }
        for (const item of opens) {
            const closePattern = new RegExp(`</${escapeRegExp(item.name)}\\s*>`, 'g');
            closePattern.lastIndex = item.index + item.token.length;
            const closeMatch = closePattern.exec(text);
            if (!closeMatch) continue;
            const key = item.name;
            const current = byName.get(key) || {
                name: key,
                open: item.token,
                close: closeMatch[0],
                count: 0,
                variants: new Set(),
            };
            current.count += 1;
            current.variants.add(item.token);
            byName.set(key, current);
        }
    }

    return [...byName.values()]
        .map(item => {
            const lower = item.name.toLocaleLowerCase();
            const open = item.variants.size > 1 && /\s/.test(item.open)
                ? item.open
                : item.open;
            const close = item.close;
            const alreadyAdded = existing.has(`${open}\u0000${close}`);
            const broad = broadNames.has(lower) || item.variants.size > 1;
            return {
                id: hashText(`${open}\u0000${close}`),
                tagName: item.name,
                open,
                close,
                count: item.count,
                broad,
                alreadyAdded,
                recommended: !alreadyAdded && recommendedNames.has(lower) && !broad,
            };
        })
        .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.count - a.count || a.tagName.localeCompare(b.tagName));
}

export function filterNarrativeText(text, settings = {}) {
    let result = String(text ?? '');
    // Always strip well-formed HTML comments (non-greedy, dotAll).
    result = result.replace(/<!--[\s\S]*?-->/g, '');

    if (settings?.tagFilterEnabled === false) return result;

    const rules = normalizeTagFilterRules(settings?.tagFilterRules);
    for (const rule of rules) {
        const { open, close } = rule;
        if (open && close) {
            const pattern = new RegExp(
                `${escapeRegExp(open)}[\\s\\S]*?${escapeRegExp(close)}`,
                'g',
            );
            let previous;
            do {
                previous = result;
                result = result.replace(pattern, '');
            } while (result !== previous);
            continue;
        }
        if (!open && close) {
            let previous;
            do {
                previous = result;
                const index = result.indexOf(close);
                if (index === -1) break;
                result = result.slice(index + close.length);
            } while (result !== previous);
            continue;
        }
        if (open && !close) {
            const index = result.indexOf(open);
            if (index !== -1) result = result.slice(0, index);
        }
    }
    return result;
}

/**
 * Last `count` usable assistant message ids ending at `messageId` (ascending).
 * Walks raw chat by index; does not consult narrativeContext (which drops empty-after-filter turns).
 */
export function selectPendingAssistantMessageIds(chat, messageId, count, isUsableAssistant) {
    const list = asArray(chat);
    const maxCount = Math.max(1, Number(count) || 1);
    const target = Number(messageId);
    const end = Number.isFinite(target)
        ? Math.min(Math.max(0, target), Math.max(0, list.length - 1))
        : list.length - 1;
    const usable = typeof isUsableAssistant === 'function'
        ? isUsableAssistant
        : (message) => Boolean(message && !message.is_user && !message.is_system);
    const ids = [];
    if (!list.length || end < 0) return ids;
    for (let index = end; index >= 0 && ids.length < maxCount; index -= 1) {
        if (!usable(list[index])) continue;
        ids.push(index);
    }
    return ids.reverse();
}

/** Count assistant narrative turns whose messageId is in the pending batch. */
export function countSurvivingNewAssistantTurns(narrativeTurns, pendingMessageIds) {
    const pending = new Set(asArray(pendingMessageIds).map(Number));
    return asArray(narrativeTurns).filter(
        turn => turn?.role === 'assistant' && pending.has(Number(turn.messageId)),
    ).length;
}

export function trimState(inputState) {
    const state = deepClone(inputState);
    const previousSchemaVersion = asInteger(state.schemaVersion, 0, 0);
    state.schemaVersion = SCHEMA_VERSION;
    const absoluteMinute = asInteger(state.clock?.absoluteMinute, MINUTES_PER_DAY, 0);
    const absoluteDay = Math.floor(absoluteMinute / MINUTES_PER_DAY);
    state.world = {
        name: asString(state.world?.name, 'Thế giới chưa đặt tên', 80),
        title: asString(state.world?.title, 'Thế giới vẫn đang tiếp diễn', 180),
        detail: asString(state.world?.detail, '', 640),
        calendar: normalizeWorldCalendar(state.world?.calendar, absoluteDay),
    };
    const rawCalendar = state.world.calendar;
    const hasCalendarCalibrationAudit = asArray(state.audit).some(entry => (
        ['calendar_calibrated', 'clock_anchor_initialized', 'clock_anchor_recalibrated']
            .includes(entry?.type)
    ));
    const legacyCalendarLooksPlaceholder = previousSchemaVersion < 8
        && rawCalendar?.name === 'Lịch thế giới chính'
        && Number(rawCalendar?.anchorYear) === 1
        && Number(rawCalendar?.anchorMonth) === 1
        && Number(rawCalendar?.anchorDay) === 1
        && !hasCalendarCalibrationAudit
        && ['initial', 'narrative', 'unknown'].includes(asString(state.clock?.source, 'initial', 40));
    const inferredAnchored = legacyCalendarLooksPlaceholder
        ? false
        : asString(state.clock?.source, 'initial', 40) !== 'initial';
    state.clock = {
        absoluteMinute,
        lastCheckedAt: asInteger(
            state.clock?.lastCheckedAt,
            state.clock?.absoluteMinute ?? MINUTES_PER_DAY,
            0,
        ),
        source: asString(state.clock?.source, 'unknown', 40),
        reason: asString(state.clock?.reason, '', 240),
        anchored: legacyCalendarLooksPlaceholder
            ? false
            : (state.clock?.anchored === undefined
                ? inferredAnchored
                : Boolean(state.clock?.anchored)),
        precision: legacyCalendarLooksPlaceholder
            ? 'uninitialized'
            : (['minute', 'daypart', 'date', 'uninitialized'].includes(state.clock?.precision)
                ? state.clock.precision
                : ((state.clock?.anchored === undefined ? inferredAnchored : Boolean(state.clock?.anchored))
                    ? 'minute'
                    : 'uninitialized')),
    };

    // Nhân vật ID Có UI Khóa định vị ổn định cho các thao tác chỉnh sửa, quan sát và xóa.
    // Trạng thái cũ hoặc đầu ra của mô hình đôi khi có thể tạo ra sự trùng lặp ID；Nếu tiếp tục giữ lại, hãy nhấp vào A Thao tác của nhân vật
    // sẽ trúng mục xuất hiện sớm hơn trong mảng B nhân vật. Tải/Thống nhất sửa chữa xung đột khi gửi trạng thái, giữ lại mục đầu tiên
    // ID，và tạo khóa ổn định mới cho các mục xung đột tiếp theo ID。
    const seenPersonIds = new Set();
    state.people = asArray(state.people)
        .slice(-LIMITS.people)
        .map(person => normalizePerson(person, person, state.clock.absoluteMinute))
        .map(person => {
            if (!seenPersonIds.has(person.id)) {
                seenPersonIds.add(person.id);
                return person;
            }
            let nextId = makeId('person');
            while (seenPersonIds.has(nextId)) nextId = makeId('person');
            person.id = nextId;
            seenPersonIds.add(nextId);
            return person;
        });

    const events = asArray(state.events)
        .map(event => normalizeEvent(event, state.clock.absoluteMinute, event));
    const active = events.filter(event => !TERMINAL_EVENT_STATES.has(event.status));
    const terminal = events
        .filter(event => TERMINAL_EVENT_STATES.has(event.status))
        .sort((a, b) => Number(b.resolvedAt || b.updatedAt) - Number(a.resolvedAt || a.updatedAt));
    state.events = [
        ...active.slice(-LIMITS.events),
        ...terminal.slice(0, Math.max(0, LIMITS.events - active.length)),
    ];
    synchronizeCognitiveLedger(state);

    state.echoes = asArray(state.echoes).slice(0, LIMITS.echoes);
    state.archive = asArray(state.archive).slice(0, LIMITS.archive);
    state.foregroundFacts = asArray(state.foregroundFacts).slice(0, LIMITS.foregroundFacts);

    const normalizedWorldFacts = [];
    for (const rawFact of asArray(state.worldFacts).slice(0, LIMITS.worldFacts)) {
        const existing = normalizedWorldFacts.find(item => item.key === worldFactStableKey(rawFact));
        const fact = normalizeWorldFact(rawFact, existing, state.clock.absoluteMinute);
        if (!fact.value) continue;
        if (existing) Object.assign(existing, fact);
        else normalizedWorldFacts.push(fact);
    }
    state.worldFacts = normalizedWorldFacts;

    // Schema 14 introduces an explicit authoritative fact layer. Old person
    // locations may already lag behind the latest foreground, so migration does
    // not immediately promote them to hard facts. Terminal event results are safe
    // to retain; person state becomes authoritative after the first successful
    // 1.3 reconciliation pass.
    if (previousSchemaVersion < 14) {
        state.needsReconciliation = true;
        if (!state.worldFacts.length) {
            for (const event of state.events) settleEventResultFact(state, event, null);
        }
    } else {
        state.needsReconciliation = Boolean(state.needsReconciliation);
    }

    state.consistencyConflicts = asArray(state.consistencyConflicts)
        .map(conflict => normalizeConsistencyConflict(
            conflict,
            state.clock.absoluteMinute,
            conflict?.messageId ?? null,
        ))
        .slice(0, LIMITS.consistencyConflicts);
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    state.audit = asArray(state.audit).slice(0, LIMITS.audit);
    state.revision = asInteger(state.revision, 0, 0);
    state.pendingSync = Boolean(state.pendingSync);
    state.updatedAt = asString(state.updatedAt, nowIso(), 40);
    return state;
}

export function isTerminalEvent(event) {
    return TERMINAL_EVENT_STATES.has(event?.status);
}

export function isActiveEvent(event) {
    return ACTIVE_EVENT_STATES.has(event?.status);
}
