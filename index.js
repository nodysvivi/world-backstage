import {
    MODULE_ID,
    SCHEMA_VERSION,
    SNAPSHOT_KEY,
    STATE_KEY,
    addRecoveryPoint,
    addManualEvent,
    advanceWorldClock,
    applySimulationResult,
    applyHistoryIndexResult,
    applyMemoryRollupResult,
    buildInjectionPackage,
    buildHistoryIndexPrompt,
    buildMemoryRollupPrompt,
    buildPersonObservationPrompt,
    buildSimulationPrompt,
    createInitialState,
    createCompactSnapshot,
    DEFAULT_TAG_FILTER_RULES,
    extractJsonObject,
    extractTagFilterCandidates,
    extractNarrativeTimeAnchor,
    filterNarrativeText,
    formatWorldCalendar,
    countSurvivingNewAssistantTurns,
    hashText,
    selectPendingAssistantMessageIds,
    listRecoveryPoints,
    markPendingSync,
    normalizeTagFilterRules,
    planMemoryRollup,
    recordDeliveryOffers,
    restoreCompactSnapshot,
    restoreRecoveryPoint,
    setWorldCalendar,
    settlePersonWorldState,
    trimState,
} from './core.js';
import {
    getLastCustomApiOperation,
    isAbortError,
    requestCustomCompletion,
    requestCustomModels,
    resetLastCustomApiOperation,
    runWithRetries,
} from './api.js';
import { createWorldBackstageUI } from './ui.js';
import { buildBackstageMessages } from './prompt-bridge.js';
import { INTERNAL_COMPAT_SYSTEM_PROMPT } from './internal-compat.js';
import { detectWorldbookCharacter, extractWorldbookCharacterProfile } from './worldbook.js';
import {
    buildPublicOpinionPrompt,
    buildPublicOpinionSandboxPrompt,
    eligiblePublicOpinionEvents,
    emptyPublicOpinionCache,
    emptyPublicOpinionSandbox,
    normalizePublicOpinionCache,
    normalizePublicOpinionPayload,
    normalizePublicOpinionSandbox,
    normalizePublicOpinionSandboxPayload,
} from './public-opinion.js';

const PROMPT_KEY = 'world_backstage_authoritative_state';
const PLUGIN_VERSION = '1.3.0';
const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: 19,
    enabled: true,
    promptInjection: true,
    worldSimulationEnabled: true,
    worldPromptInjection: true,
    memorySystemEnabled: true,
    memoryPromptInjection: true,
    autoSync: true,
    worldAutoEnabled: true,
    autoSimulationMode: 'balanced',
    autoSimulationInterval: 1,
    autoRetryCount: 1,
    memoryAutoIndexInterval: 10,
    backgroundNpcBudget: 4,
    customSimulationInstruction: '',
    playerIdentityAnchor: '',
    theme: 'auto',
    deliveryDensity: 'restrained',
    sceneTiming: 'strict',
    orbPosition: null,
    includeUserInnerVoice: false,
    uiScale: 'comfortable',
    contextTurns: 5,
    customContextTurns: 8,
    timePolicy: 'world',
    apiMode: 'tavern',
    customApiUrl: '',
    customApiKey: '',
    customApiModel: '',
    customApiTransport: 'proxy',
    customApiTimeoutMs: 120000,
    apiProfiles: [],
    apiModuleRoutes: {
        simulation: 'default',
        observation: 'default',
        history: 'default',
        opinion: 'default',
    },
    publicOpinionRevealMode: 'observe',
    publicOpinionAutoEnabled: true,
    maxOutputTokens: 0,
    tagFilterEnabled: true,
    tagFilterRules: DEFAULT_TAG_FILTER_RULES.map(rule => ({ ...rule })),
});

const runtime = {
    initialized: false,
    ui: null,
    transientStore: null,
    injection: { text: '', eventIds: [] },
    generationOffer: { eventIds: [], at: 0 },
    simulationChain: Promise.resolve(),
    simulationCount: 0,
    activeSimulation: null,
    activeHistoryScan: null,
    activePublicOpinion: null,
    activePublicOpinionSandbox: null,
    pendingPublicOpinion: false,
    activeObservation: null,
    inBackgroundGeneration: false,
    activeChatToken: '',
    queuedSimulations: new Map(),
    autoMemoryTimer: null,
    manualUndo: null,
    manualUndoTimer: null,
    editDecision: null,
    customModels: [],
    modelPullStatus: { phase: 'idle', message: '' },
    lastPromptBridge: null,
    lastTaskConnection: null,
    publicOpinionStatus: {
        phase: 'idle',
        message: 'Dư luận vẫn chưa mở cửa đâu～',
        error: '',
    },
    worldbookScan: {
        phase: 'idle',
        message: '',
        bookName: '',
        entries: [],
    },
    historyProgress: {
        phase: 'idle',
        processed: 0,
        total: 0,
        message: '',
    },
    syncStatus: {
        phase: 'idle',
        message: 'Vẫn chưa suy diễn qua～ Thế giới đang đợi bạn ở đây trước',
        error: '',
        attemptedAt: '',
        succeededAt: '',
        method: '',
        summary: null,
    },
};

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function getContext() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function getWorldbookNames() {
    const names = getContext()?.getWorldInfoNames?.();
    return Array.isArray(names)
        ? [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        : [];
}

function worldbookEntryLabel(entry) {
    const keys = Array.isArray(entry?.key)
        ? entry.key
        : typeof entry?.key === 'string' ? [entry.key] : [];
    return String(entry?.comment || keys[0] || `Mục ${entry?.uid ?? ''}`)
        .trim()
        .slice(0, 80);
}

async function scanWorldbook(bookName) {
    const name = String(bookName || '').trim();
    const context = getContext();
    if (!name) throw new Error('Chọn trước một cuốn Worldbook cho tôi xem đi mà～');
    if (typeof context?.loadWorldInfo !== 'function') {
        throw new Error('Phiên bản Tavern hiện tại chưa mở giao diện đọc Worldbook');
    }
    runtime.worldbookScan = {
        phase: 'running',
        message: `Đang lật 《${name}》～Đợi một chút nhé`,
        bookName: name,
        entries: [],
    };
    runtime.ui?.render();
    try {
        const data = await context.loadWorldInfo(name);
        const entries = Object.values(data?.entries || {})
            .filter(entry => entry && String(entry.content || '').trim())
            .map(entry => {
                const name = worldbookEntryLabel(entry);
                const content = String(entry.content || '').trim().slice(0, 4000);
                const keys = [...new Set([
                    ...(Array.isArray(entry.key) ? entry.key : [entry.key]),
                    ...(Array.isArray(entry.keysecondary) ? entry.keysecondary : [entry.keysecondary]),
                ].map(key => String(key || '').trim()).filter(Boolean))].slice(0, 12);
                const tags = [...new Set([
                    entry.group,
                    entry.position,
                    entry.role,
                ].map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, 8);
                const formatHints = [...new Set(
                    [...content.matchAll(/<\s*([a-zA-Z][\w:-]*)\b/g)]
                        .map(match => String(match[1] || '').toLocaleLowerCase())
                        .filter(Boolean),
                )].slice(0, 12);
                const profile = extractWorldbookCharacterProfile(content, name);
                const detection = detectWorldbookCharacter({ name, content, keys, tags, formatHints }, profile);
                return {
                    uid: String(entry.uid ?? ''),
                    name,
                    parsedName: profile.explicitName ? profile.name : '',
                    content,
                    keys,
                    tags,
                    formatHints,
                    disabled: Boolean(entry.disable),
                    order: Number(entry.order) || 0,
                    profile,
                    ...detection,
                };
            })
            .sort((a, b) => Number(a.disabled) - Number(b.disabled) || b.order - a.order)
            .slice(0, 1000);
        runtime.worldbookScan = {
            phase: 'success',
            message: entries.length
                ? `Lật đến ${entries.length}  mục nội dung rồi～ Trong đó có ${entries.filter(entry => entry.likelyPerson).length}  mục trông giống nhân vật, xác nhận một chút rồi nhập là được`
                : 'Trong cuốn Worldbook này tạm thời chưa lật được nội dung nào có thể đọc đâu～',
            bookName: name,
            entries,
        };
        return runtime.worldbookScan;
    } catch (error) {
        runtime.worldbookScan = {
            phase: 'error',
            message: `Đọc không thành công QAQ：${describeError(error)}`,
            bookName: name,
            entries: [],
        };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

function looksLikeLegacyWorldbookPersonalityDump(value, candidateContent = '') {
    const text = String(value || '').trim();
    const raw = String(candidateContent || '').trim();
    if (!text) return false;
    if (raw && text === raw.slice(0, 600)) return true;
    const markerHits = (text.match(/(?:<\/?(?:info|character)\b|Tên tiếng Trung|Họ tên|Biệt danh|gender|Giới tính|age|Tuổi tác|birthday|Sinh nhật|identity|Thân phận|background|Bối cảnh|appearance|Ngoại hình|height|Chiều cao)/giu) || []).length;
    return markerHits >= 3;
}

function importWorldbookPeople(bookName, entryIds = []) {
    const name = String(bookName || '').trim();
    if (runtime.worldbookScan.bookName !== name) {
        throw new Error('Bản xem trước Worldbook đã thay đổi, vui lòng quét lại');
    }
    const wanted = new Set((Array.isArray(entryIds) ? entryIds : [entryIds]).map(String));
    const selected = runtime.worldbookScan.entries.filter(entry => wanted.has(String(entry.uid)));
    if (!selected.length) throw new Error('Vui lòng chọn ít nhất một mục nhân vật');

    const next = clone(getState());
    let created = 0;
    let updated = 0;
    for (const candidate of selected) {
        const reference = `${name}::${candidate.uid}`;
        const profile = candidate.profile || extractWorldbookCharacterProfile(candidate.content, candidate.name);
        const importedName = String(profile.name || candidate.parsedName || candidate.name || '').trim().slice(0, 80);
        if (!importedName) continue;
        const existing = next.people.find(person => (
            person.worldbookRef === reference
            || person.name.toLocaleLowerCase() === importedName.toLocaleLowerCase()
            || person.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase()
        ));
        if (existing) {
            const fillIfBlank = (field, value) => {
                if (value && !String(existing[field] || '').trim()) existing[field] = value;
            };
            fillIfBlank('identityAnchor', profile.identityAnchor);
            if (
                profile.personalityAnchor
                && (
                    !String(existing.personalityAnchor || '').trim()
                    || looksLikeLegacyWorldbookPersonalityDump(existing.personalityAnchor, candidate.content)
                )
            ) {
                existing.personalityAnchor = profile.personalityAnchor;
            }
            fillIfBlank('appearanceProfile', profile.appearanceProfile);
            fillIfBlank('backgroundProfile', profile.backgroundProfile);
            fillIfBlank('speakingStyle', profile.speakingStyle);
            fillIfBlank('behaviorBoundaries', profile.behaviorBoundaries);
            existing.worldbookRaw = profile.worldbookRaw || existing.worldbookRaw || '';
            existing.worldbookRef = reference;
            existing.manual = true;
            existing.updatedAt = next.clock.absoluteMinute;
            updated += 1;
            continue;
        }
        next.people.push({
            id: `person_worldbook_${hashText(reference)}`,
            name: importedName,
            monogram: importedName.slice(0, 1),
            location: 'Vị trí chờ xác nhận',
            action: 'Hành động hiện tại chờ xác nhận',
            intent: 'Ý định ngắn hạn chờ xác nhận',
            longTermGoal: '',
            identityAnchor: profile.identityAnchor,
            personalityAnchor: profile.personalityAnchor,
            appearanceProfile: profile.appearanceProfile,
            backgroundProfile: profile.backgroundProfile,
            worldbookRaw: profile.worldbookRaw,
            speakingStyle: profile.speakingStyle,
            behaviorBoundaries: profile.behaviorBoundaries,
            trace: '',
            innerVoice: '',
            innerVoiceAt: next.clock.absoluteMinute,
            knowledge: 'hidden',
            relevance: 1,
            simulationEnabled: true,
            locked: false,
            manual: true,
            source: 'manual',
            isUser: false,
            lastSeenMessageId: -1,
            worldbookRef: reference,
            updatedAt: next.clock.absoluteMinute,
        });
        created += 1;
    }
    commitManualState(next, `Nhân vật Worldbook đã nhập: Thêm mới  ${created}  người, cập nhật  ${updated}  người.`);
    return { created, updated };
}

function toast(message, tone = 'info') {
    if (runtime.ui?.notify) {
        runtime.ui.notify(message, tone);
        return;
    }
    if (!globalThis.toastr) return;
    const method = ['success', 'warning', 'error', 'info'].includes(tone) ? tone : 'info';
    globalThis.toastr[method](message, 'Mặt trái thế giới', { preventDuplicates: true });
}

function normalizeOrbPosition(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
    };
}

function normalizeApiProfiles(value) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(value) ? value : []) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id || '').trim().slice(0, 80);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const name = String(raw.name || 'Phương án chưa đặt tên').trim().slice(0, 80) || 'Phương án chưa đặt tên';
        const url = String(raw.url || raw.customApiUrl || '').trim().slice(0, 500);
        const key = String(raw.key || raw.customApiKey || '').trim().slice(0, 1000);
        const model = String(raw.model || raw.customApiModel || '').trim().slice(0, 180);
        const transport = ['proxy', 'direct'].includes(raw.transport || raw.customApiTransport)
            ? (raw.transport || raw.customApiTransport)
            : 'proxy';
        result.push({ id, name, url, key, model, transport });
        if (result.length >= 20) break;
    }
    return result;
}

function normalizeApiModuleRoutes(value, profiles = []) {
    const validProfiles = new Set(profiles.map(profile => `profile:${profile.id}`));
    const normalizeRoute = route => {
        const text = String(route || 'default');
        if (text === 'default' || text === 'tavern') return text;
        return validProfiles.has(text) ? text : 'default';
    };
    const raw = value && typeof value === 'object' ? value : {};
    return {
        simulation: normalizeRoute(raw.simulation),
        observation: normalizeRoute(raw.observation),
        history: normalizeRoute(raw.history),
        opinion: normalizeRoute(raw.opinion),
    };
}

function makeApiProfileId() {
    return `api_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSettings() {
    const context = getContext();
    if (!context?.extensionSettings) return { ...DEFAULT_SETTINGS };

    const previous = context.extensionSettings[MODULE_ID];
    const previousSettingsVersion = Number(previous?.settingsVersion) || 0;
    const legacySimulationPaused = previousSettingsVersion < 11
        && Boolean(previous?.simulationPaused);
    const settings = {
        ...DEFAULT_SETTINGS,
        ...(previous && typeof previous === 'object' ? previous : {}),
    };
    settings.enabled = Boolean(settings.enabled);
    if (previousSettingsVersion < 9) {
        settings.worldPromptInjection = previous?.promptInjection !== false;
        settings.memoryPromptInjection = previous?.promptInjection !== false;
    }
    // Kept only as a migration field. World continuity is mandatory while the world engine is enabled;
    // worldPromptInjection now controls proactive reveal candidates only.
    settings.promptInjection = true;
    settings.worldSimulationEnabled = Boolean(settings.worldSimulationEnabled);
    settings.worldPromptInjection = Boolean(settings.worldPromptInjection);
    settings.memorySystemEnabled = Boolean(settings.memorySystemEnabled);
    settings.memoryPromptInjection = Boolean(settings.memoryPromptInjection);
    settings.autoSync = Boolean(settings.autoSync);
    settings.worldAutoEnabled = previousSettingsVersion < 19
        ? (
            previous?.worldAutoEnabled !== undefined
                ? Boolean(previous.worldAutoEnabled)
                : previous?.autoSync !== false && previous?.autoSimulationMode !== 'manual'
        )
        : settings.worldAutoEnabled !== false;
    settings.includeUserInnerVoice = Boolean(settings.includeUserInnerVoice);
    if (!['auto', 'day', 'night'].includes(settings.theme)) settings.theme = 'auto';
    if (!['restrained', 'balanced', 'active'].includes(settings.deliveryDensity)) {
        settings.deliveryDensity = 'restrained';
    }
    if (!['strict', 'smart', 'open'].includes(settings.sceneTiming)) settings.sceneTiming = 'strict';
    if (!['compact', 'comfortable', 'large'].includes(settings.uiScale)) {
        settings.uiScale = 'comfortable';
    }
    settings.contextTurns = Math.min(
        30,
        Math.max(1, Number.parseInt(settings.contextTurns, 10) || 5),
    );
    settings.customContextTurns = Math.min(
        30,
        Math.max(1, Number.parseInt(settings.customContextTurns, 10) || 8),
    );
    if (![1, 3, 5].includes(settings.contextTurns)) {
        settings.customContextTurns = settings.contextTurns;
    }
    if (previousSettingsVersion < 4) settings.contextTurns = 5;
    if (previousSettingsVersion < 8) settings.orbPosition = null;
    if (previousSettingsVersion < 5) {
        settings.autoSimulationMode = 'balanced';
    }
    if (settings.autoSimulationMode === 'manual') {
        settings.worldAutoEnabled = false;
        settings.autoSimulationMode = 'balanced';
    }
    if (!['light', 'balanced', 'deep'].includes(settings.autoSimulationMode)) {
        settings.autoSimulationMode = 'balanced';
    }
    if (legacySimulationPaused) {
        settings.worldAutoEnabled = false;
    }
    delete settings.simulationPaused;
    settings.autoSync = settings.worldAutoEnabled; // legacy alias
    settings.autoSimulationInterval = Math.min(
        20,
        Math.max(1, Number.parseInt(settings.autoSimulationInterval, 10) || 1),
    );
    settings.autoRetryCount = Math.min(
        5,
        Math.max(0, Number.parseInt(settings.autoRetryCount, 10) || 0),
    );
    settings.memoryAutoIndexInterval = Math.min(
        50,
        Math.max(0, Number.parseInt(settings.memoryAutoIndexInterval, 10) || 0),
    );
    settings.backgroundNpcBudget = Math.min(
        12,
        Math.max(0, Number.parseInt(settings.backgroundNpcBudget, 10) || 0),
    );
    settings.customSimulationInstruction = String(
        settings.customSimulationInstruction || '',
    ).trim().slice(0, 1000);
    // 0.9.6 removes foreground preset bridging entirely. World Backstage now
    // always uses its own internal compatibility layer plus task-specific system.
    delete settings.presetBridgeEnabled;
    delete settings.presetBridgeAdditionalPrompt;
    settings.playerIdentityAnchor = String(
        settings.playerIdentityAnchor || '',
    ).trim().slice(0, 400);
    settings.tagFilterEnabled = settings.tagFilterEnabled !== false;
    if (!Array.isArray(settings.tagFilterRules)) {
        settings.tagFilterRules = DEFAULT_TAG_FILTER_RULES.map(rule => ({ ...rule }));
    } else {
        settings.tagFilterRules = normalizeTagFilterRules(settings.tagFilterRules);
    }
    if (previousSettingsVersion < 15) {
        settings.timePolicy = 'world';
    }
    settings.settingsVersion = 19;
    if (!['world', 'explicit', 'cautious', 'open'].includes(settings.timePolicy)) {
        settings.timePolicy = 'world';
    }
    if (!['tavern', 'custom'].includes(settings.apiMode)) settings.apiMode = 'tavern';
    settings.customApiUrl = String(settings.customApiUrl || '').trim().slice(0, 500);
    settings.customApiKey = String(settings.customApiKey || '').trim().slice(0, 1000);
    settings.customApiModel = String(settings.customApiModel || '').trim().slice(0, 180);
    if (!['proxy', 'direct'].includes(settings.customApiTransport)) {
        settings.customApiTransport = 'proxy';
    }
    settings.customApiTimeoutMs = Math.min(
        300000,
        Math.max(15000, Number(settings.customApiTimeoutMs) || 120000),
    );
    settings.apiProfiles = normalizeApiProfiles(settings.apiProfiles);
    settings.apiModuleRoutes = normalizeApiModuleRoutes(settings.apiModuleRoutes, settings.apiProfiles);
    if (!['observe', 'relevant'].includes(settings.publicOpinionRevealMode)) {
        settings.publicOpinionRevealMode = 'observe';
    }
    settings.publicOpinionAutoEnabled = settings.publicOpinionAutoEnabled !== false;
    settings.maxOutputTokens = Math.min(
        16000,
        Math.max(0, Number.parseInt(settings.maxOutputTokens, 10) || 0),
    );
    settings.orbPosition = normalizeOrbPosition(settings.orbPosition);
    context.extensionSettings[MODULE_ID] = settings;
    if (previousSettingsVersion < 19) context.saveSettingsDebounced?.();
    return settings;
}

function saveSettings() {
    const context = getContext();
    context?.saveSettingsDebounced?.();
}

function makeStore() {
    const initialState = createInitialState({ worldName: 'Thế giới chính' });
    return {
        schemaVersion: SCHEMA_VERSION,
        initialState,
        currentState: clone(initialState),
        branchOverrides: {},
        memorySummaryArchive: [],
        personObservations: {},
        publicOpinion: emptyPublicOpinionCache(),
        publicOpinionSandbox: emptyPublicOpinionSandbox(),
        recoveryPoints: [],
        updatedAt: new Date().toISOString(),
    };
}

function mergeMemorySummaryArchive(store, state = store?.currentState) {
    if (!store || typeof store !== 'object') return [];
    const existing = Array.isArray(store.memorySummaryArchive) ? store.memorySummaryArchive : [];
    const current = Array.isArray(state?.storyMemory?.summaries) ? state.storyMemory.summaries : [];
    const byId = new Map();
    for (const summary of [...existing, ...current]) {
        const id = String(summary?.id || '').trim();
        if (!id) continue;
        byId.set(id, clone(summary));
    }
    const merged = [...byId.values()]
        .sort((a, b) => Number(a?.endMessageId || 0) - Number(b?.endMessageId || 0));
    // Keep one chat-level reservoir instead of duplicating the whole hierarchy
    // in every message/swipe snapshot. The live state already applies its own
    // retention policy; this extra headroom mainly preserves alternate swipes.
    if (merged.length > 3600) {
        const protectedItems = merged.filter(item => (
            item?.locked || item?.important || item?.manual || Number(item?.level || 0) >= 2
        ));
        const protectedIds = new Set(protectedItems.map(item => item.id));
        const remainder = merged.filter(item => !protectedIds.has(item.id)).slice(-Math.max(0, 3600 - protectedItems.length));
        store.memorySummaryArchive = [...protectedItems, ...remainder]
            .sort((a, b) => Number(a?.endMessageId || 0) - Number(b?.endMessageId || 0));
    } else {
        store.memorySummaryArchive = merged;
    }
    return store.memorySummaryArchive;
}

function createBranchSnapshot(state, meta = {}, store = getStore()) {
    mergeMemorySummaryArchive(store, state);
    return createCompactSnapshot(state, meta);
}

function restoreBranchSnapshot(snapshot, fallback = null, store = getStore()) {
    return restoreCompactSnapshot(
        snapshot,
        fallback || store?.initialState || null,
        store?.memorySummaryArchive || [],
    );
}

function currentChatToken() {
    const context = getContext();
    if (!context) return 'no-context';
    return String(context.chatId ?? context.groupId ?? context.characterId ?? 'no-chat');
}

function hasChatContext() {
    const context = getContext();
    return Boolean(
        context
        && Array.isArray(context.chat)
        && (
            context.chatId
            || context.groupId
            || context.characterId !== undefined
        )
    );
}

function findPlayerPerson(state, userName = getContext()?.name1 || '') {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalizedUserName = String(userName || '').trim().toLocaleLowerCase();
    return people.find(person => person?.isUser)
        || people.find(person => (
            normalizedUserName
            && String(person?.name || '').trim().toLocaleLowerCase() === normalizedUserName
        ))
        || null;
}

function getPlayerIdentityAnchor(state = null) {
    const resolvedState = state || getState();
    const player = findPlayerPerson(resolvedState);
    if (player) return String(player.identityAnchor || '').trim().slice(0, 500);
    return String(getSettings().playerIdentityAnchor || '').trim().slice(0, 400);
}

function getStore({ create = true } = {}) {
    const context = getContext();
    const metadata = context?.chatMetadata;

    if (!metadata || typeof metadata !== 'object' || !hasChatContext()) {
        runtime.transientStore ||= makeStore();
        return runtime.transientStore;
    }

    if (!metadata[STATE_KEY] && create) {
        metadata[STATE_KEY] = makeStore();
        context.saveMetadataDebounced?.();
    }

    let store = metadata[STATE_KEY] || runtime.transientStore || makeStore();
    const previousSchemaVersion = Number(
        store.schemaVersion
        ?? store.currentState?.schemaVersion
        ?? 0,
    );
    const migrationReason = `before-schema-${SCHEMA_VERSION}`;
    let createdMigrationRecovery = false;
    store.recoveryPoints = listRecoveryPoints(store);
    if (
        previousSchemaVersion > 0
        && previousSchemaVersion < SCHEMA_VERSION
        && store.currentState
        && !store.recoveryPoints.some(point => point.reason === migrationReason)
    ) {
        store = addRecoveryPoint(store, {
            reason: migrationReason,
            label: `Nâng cấp lên cấu trúc dữ liệu ${SCHEMA_VERSION} Tự động lưu trước khi`,
        });
        createdMigrationRecovery = true;
    }
    store.schemaVersion = SCHEMA_VERSION;
    store.initialState = trimState(store.initialState || createInitialState({ worldName: 'Thế giới chính' }));
    store.currentState = trimState(store.currentState || store.initialState);
    store.memorySummaryArchive = Array.isArray(store.memorySummaryArchive)
        ? store.memorySummaryArchive
        : [];
    mergeMemorySummaryArchive(store, store.currentState);
    const settings = getSettings();
    const legacyPlayerIdentityAnchor = String(settings.playerIdentityAnchor || '').trim().slice(0, 400);
    const player = findPlayerPerson(store.currentState, context?.name1 || '');
    let migratedLegacyPlayerIdentity = false;
    if (player && legacyPlayerIdentityAnchor) {
        if (!String(player.identityAnchor || '').trim()) {
            player.identityAnchor = legacyPlayerIdentityAnchor;
        }
        settings.playerIdentityAnchor = '';
        saveSettings();
        migratedLegacyPlayerIdentity = true;
    }
    store.branchOverrides = store.branchOverrides && typeof store.branchOverrides === 'object'
        ? store.branchOverrides
        : {};
    store.personObservations = store.personObservations && typeof store.personObservations === 'object'
        ? store.personObservations
        : {};
    store.publicOpinion = normalizePublicOpinionCache(store.publicOpinion || emptyPublicOpinionCache());
    store.publicOpinionSandbox = normalizePublicOpinionSandbox(store.publicOpinionSandbox || emptyPublicOpinionSandbox());
    store.recoveryPoints = listRecoveryPoints(store);
    if ((createdMigrationRecovery || migratedLegacyPlayerIdentity) && context?.chatMetadata && hasChatContext()) {
        context.chatMetadata[STATE_KEY] = store;
        context.saveMetadataDebounced?.();
    }
    return store;
}

function saveStore(store, { immediate = false } = {}) {
    const context = getContext();
    mergeMemorySummaryArchive(store, store.currentState);
    store.updatedAt = new Date().toISOString();

    if (!context?.chatMetadata || !hasChatContext()) {
        runtime.transientStore = store;
        return;
    }

    context.chatMetadata[STATE_KEY] = store;
    if (immediate && typeof context.saveMetadata === 'function') {
        void context.saveMetadata();
    } else {
        context.saveMetadataDebounced?.();
    }
}

function getState() {
    return getStore().currentState;
}

function branchSourceKey(messageId, message, swipeId = message?.swipe_id ?? 0) {
    const text = message?.swipes?.[swipeId] ?? message?.mes ?? '';
    return `${messageId}:${swipeId}:${hashText(text)}`;
}

function branchDataFromMessage(message, swipeId = message?.swipe_id ?? 0) {
    const currentData = message?.extra?.[SNAPSHOT_KEY];
    if (currentData && typeof currentData === 'object') return currentData;
    return message?.swipe_info?.[swipeId]?.extra?.[SNAPSHOT_KEY] || null;
}

function latestAssistantEntry() {
    const chat = getContext()?.chat || [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (hasUsableAssistantText(message)) return { message, index };
    }
    return null;
}

function taskRouteKey(taskKind = 'simulation') {
    if (taskKind === 'person-observation') return 'observation';
    if (taskKind === 'public-opinion') return 'opinion';
    if (taskKind === 'history' || taskKind === 'history-index' || taskKind === 'memory') return 'history';
    return 'simulation';
}

function settingsForApiProfile(baseSettings, profile) {
    return {
        ...baseSettings,
        apiMode: 'custom',
        customApiUrl: String(profile?.url || ''),
        customApiKey: String(profile?.key || ''),
        customApiModel: String(profile?.model || ''),
        customApiTransport: ['proxy', 'direct'].includes(profile?.transport) ? profile.transport : 'proxy',
    };
}

function resolveTaskConnection(settings, taskKind = 'simulation') {
    const routeKey = taskRouteKey(taskKind);
    const route = String(settings.apiModuleRoutes?.[routeKey] || 'default');
    if (route === 'tavern') {
        return { mode: 'tavern', route, routeKey, label: 'Theo Tavern hiện tại', settings };
    }
    if (route.startsWith('profile:')) {
        const id = route.slice('profile:'.length);
        const profile = settings.apiProfiles?.find(item => item.id === id);
        if (profile) {
            return {
                mode: 'custom',
                route,
                routeKey,
                label: profile.name || 'Phương án đã lưu',
                profile,
                settings: settingsForApiProfile(settings, profile),
            };
        }
    }
    if (settings.apiMode === 'custom') {
        return {
            mode: 'custom',
            route: 'default',
            routeKey,
            label: 'Giao diện độc lập mặc định',
            settings,
        };
    }
    return { mode: 'tavern', route: 'default', routeKey, label: 'Theo Tavern hiện tại', settings };
}

function getConnectionInfo() {
    const context = getContext();
    const pluginSettings = getSettings();
    if (pluginSettings.apiMode === 'custom') {
        let host = '';
        try {
            host = new URL(pluginSettings.customApiUrl).host;
        } catch {
            host = pluginSettings.customApiUrl;
        }
        return {
            mainApi: 'custom-independent',
            source: 'custom-independent',
            apiLabel: 'Độc lập OpenAI Giao diện tương thích',
            model: pluginSettings.customApiModel || 'Mô hình chưa được cấu hình',
            profile: host || 'Địa chỉ API chưa được cấu hình',
            online: '',
            method: pluginSettings.customApiTransport === 'direct'
                ? 'Trình duyệt kết nối trực tiếp (Không kế thừa mô hình Tavern)'
                : 'Chuyển tiếp qua Tavern (Không kế thừa mô hình Tavern)',
            configured: Boolean(
                pluginSettings.customApiUrl
                && pluginSettings.customApiKey
                && pluginSettings.customApiModel
            ),
        };
    }

    const settings = context?.chatCompletionSettings || {};
    const mainApi = String(context?.mainApi || 'unknown');
    const source = mainApi === 'openai'
        ? String(settings.chat_completion_source || 'openai')
        : mainApi;
    const latest = latestAssistantEntry()?.message;
    const modelKeys = [
        `${source}_model`,
        'custom_model',
        'openrouter_model',
        'google_model',
        'claude_model',
        'openai_model',
        'model',
    ];
    const configuredModel = modelKeys
        .map(key => settings?.[key])
        .find(value => typeof value === 'string' && value.trim());
    const messageModel = latest?.extra?.model || latest?.model;
    const manager = context?.extensionSettings?.connectionManager || {};
    const selectedProfile = (manager.profiles || []).find(profile => (
        profile?.id === manager.selectedProfile
        || profile?.name === manager.selectedProfile
    ));
    const apiLabels = {
        openai: 'Chat Completion',
        textgenerationwebui: 'Text Completion',
        kobold: 'KoboldAI',
        koboldhorde: 'AI Horde',
        novel: 'NovelAI',
        custom: 'Giao diện tương thích tùy chỉnh',
        google: 'Google AI Studio',
        makersuite: 'Google AI Studio',
        openrouter: 'OpenRouter',
        claude: 'Anthropic Claude',
    };

    return {
        mainApi,
        source,
        apiLabel: apiLabels[source] || apiLabels[mainApi] || source || 'Chưa nhận diện',
        model: String(configuredModel || selectedProfile?.model || messageModel || 'Theo mô hình hiện tại của Tavern'),
        profile: String(selectedProfile?.name || ''),
        online: String(context?.onlineStatus || ''),
        method: typeof context?.generateRaw === 'function' ? 'Suy diễn ngữ cảnh độc lập' : 'Chế độ tương thích suy diễn yên tĩnh',
        configured: true,
    };
}

function getSyncStatus() {
    const latest = latestAssistantEntry();
    const branch = latest ? branchDataFromMessage(latest.message) : null;
    const recoveryPoints = listRecoveryPoints(getStore());
    const latestRecovery = recoveryPoints.at(-1) || null;
    const chatToken = currentChatToken();
    const pendingTurns = latest ? pendingAssistantEntriesThrough(latest.index).length : 0;
    const activeForCurrentChat = runtime.activeSimulation?.chatToken === chatToken
        ? runtime.activeSimulation
        : null;
    const activeTurns = activeForCurrentChat
        ? Math.max(1, Number(activeForCurrentChat.newAssistantCount) || 1)
        : 0;
    let derived = {};

    if (runtime.syncStatus.phase === 'idle' && branch) {
        if (branch.status === 'error') {
            derived = {
                phase: 'error',
                message: 'Suy diễn thế giới lần trước thất bại',
                error: branch.error || 'Giao diện suy diễn không cung cấp lỗi cụ thể',
            };
        } else if (branch.status === 'pending') {
            derived = {
                phase: 'pending',
                message: 'Nội dung chính mới nhất vẫn đang chờ suy diễn',
                error: '',
            };
        } else if (branch.status === 'committed') {
            derived = {
                phase: 'success',
                message: 'Nội dung chính mới nhất đã hoàn thành suy diễn',
                error: '',
                summary: branch.summary || null,
            };
        }
    }

    return {
        ...runtime.syncStatus,
        ...derived,
        connection: getConnectionInfo(),
        lastConnection: runtime.lastTaskConnection ? { ...runtime.lastTaskConnection } : null,
        pluginVersion: PLUGIN_VERSION,
        userName: String(getContext()?.name1 || ''),
        memory: {
            indexedThroughMessageId: Number(getState().storyMemory?.indexedThroughMessageId ?? -1),
            facts: getState().storyMemory?.facts?.length || 0,
            summaries: getState().storyMemory?.summaries?.length || 0,
            summaryLevels: [0, 1, 2, 3].map(level => (
                (getState().storyMemory?.summaries || []).filter(summary => (
                    summary?.hierarchyManaged && Number(summary?.level || 0) === level
                )).length
            )),
            pendingRollup: Boolean(planMemoryRollup(getState())),
            clues: getState().storyMemory?.clues?.length || 0,
            hasDigest: Boolean(getState().storyMemory?.digest?.text),
            pendingAssistantResponses: unindexedAssistantCount(),
            totalMessages: getContext()?.chat?.length || 0,
            ...runtime.historyProgress,
        },
        manualUndo: {
            available: Boolean(
                runtime.manualUndo
                && runtime.manualUndo.expiresAt > Date.now()
                && runtime.manualUndo.chatToken === currentChatToken()
                && runtime.manualUndo.key === currentAnchorKey()
            ),
            label: runtime.manualUndo?.label || 'Hoàn tác thay đổi thủ công vừa rồi',
        },
        editDecision: {
            available: Boolean(
                runtime.editDecision
                && runtime.editDecision.chatToken === currentChatToken()
                && runtime.editDecision.messageId === latestAssistantEntry()?.index
            ),
            messageId: runtime.editDecision?.messageId ?? null,
        },
        presentPersonIds: currentTurnPresentPersonIds(),
        availableModels: runtime.customModels,
        modelPull: runtime.modelPullStatus,
        promptBridge: runtime.lastPromptBridge || {
            enabled: false,
            promptCount: 0,
            available: false,
            truncated: false,
            internalCompatChars: String(INTERNAL_COMPAT_SYSTEM_PROMPT || '').trim().length,
            at: '',
        },
        publicOpinion: {
            ...getStore().publicOpinion,
            ...runtime.publicOpinionStatus,
            sandbox: getStore().publicOpinionSandbox || emptyPublicOpinionSandbox(),
            canonRunning: Boolean(runtime.activePublicOpinion && !runtime.activePublicOpinion?.controller?.signal?.aborted),
            sandboxRunning: Boolean(runtime.activePublicOpinionSandbox && !runtime.activePublicOpinionSandbox?.controller?.signal?.aborted),
            stale: String(getStore().publicOpinion?.sourceEventSignature || '') !== publicOpinionEventSignature(getState()),
        },
        worldbook: {
            ...runtime.worldbookScan,
            books: getWorldbookNames(),
        },
        recovery: {
            count: recoveryPoints.length,
            latest: latestRecovery ? {
                id: latestRecovery.id,
                createdAt: latestRecovery.createdAt,
                label: latestRecovery.label,
                worldName: latestRecovery.worldName,
                worldMinute: latestRecovery.worldMinute,
                revision: latestRecovery.revision,
            } : null,
        },
        queue: {
            pendingTurns,
            waitingTurns: Math.max(0, pendingTurns - activeTurns),
            activeMessageId: activeForCurrentChat?.messageId ?? null,
        },
        canCancelSimulation: Boolean(
            activeForCurrentChat
            && !activeForCurrentChat.controller.signal.aborted
        ),
    };
}

function setSyncStatus(patch) {
    const phaseChanged = Object.hasOwn(patch || {}, 'phase');
    runtime.syncStatus = {
        ...runtime.syncStatus,
        ...patch,
        ...(phaseChanged && !Object.hasOwn(patch || {}, 'summary') ? { summary: null } : {}),
    };
    runtime.ui?.render();
}

function describeError(error) {
    const candidates = [
        error?.message,
        error?.error?.message,
        error?.response,
        typeof error === 'string' ? error : '',
    ];
    let message = candidates
        .map(value => String(value || '').trim())
        .find(Boolean) || '';

    if (!message || message === '<none>' || message === '[object Object]') {
        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== '{}' && serialized !== '"<none>"') message = serialized;
        } catch {
            // Ignore serialization errors and use the actionable fallback below.
        }
    }
    if (!message || message === '<none>' || message === '[object Object]') {
        return 'Giao diện suy diễn không trả về lỗi cụ thể; vui lòng kiểm tra kết nối của mặt trái thế giới trước, sau đó thử lại nội dung chính mới nhất';
    }
    return message.slice(0, 420);
}

function retryJsonPrompt(prompt, attempt) {
    if (!(attempt > 0)) return prompt;
    return `${prompt}\n\n<json_retry>\n Đây là lần thứ  ${attempt}  lần thử lại định dạng. Lần trả về trước không thể phân tích cú pháp hoặc đã đạt giới hạn đầu ra. Vui lòng tạo lại một  JSON đối tượng; đừng tiếp tục sử dụng các câu bị cắt bớt, không dùng khối mã hoặc giải thích. Ưu tiên bỏ qua các mục tùy chọn không có thay đổi, tuyệt đối không được bỏ qua dấu ngoặc kết thúc.\n</json_retry>`;
}

function retryTokenBudget(base, attempt) {
    return Math.min(16000, Math.max(64, Number(base) || 3200) + Math.max(0, attempt) * 1800);
}

function approximateTokens(text) {
    return Math.max(0, Math.ceil(String(text || '').length / 2));
}

function changedItems(beforeItems = [], afterItems = [], fields = []) {
    const beforeById = new Map(beforeItems.map(item => [item.id, item]));
    const added = [];
    const updated = [];
    for (const item of afterItems) {
        const previous = beforeById.get(item.id);
        if (!previous) {
            added.push(item);
            continue;
        }
        const beforeShape = fields.map(field => previous?.[field]);
        const afterShape = fields.map(field => item?.[field]);
        if (JSON.stringify(beforeShape) !== JSON.stringify(afterShape)) updated.push(item);
    }
    return { added, updated };
}

function simulationSummary(before, after, {
    prompt = '',
    raw = '',
    attempts = 1,
    tokenBudget = 0,
    injection = { text: '', eventIds: [], omittedLines: 0 },
} = {}) {
    const people = changedItems(before.people, after.people, [
        'name', 'location', 'action', 'intent', 'longTermGoal', 'trace', 'innerVoice',
    ]);
    const events = changedItems(before.events, after.events, [
        'title', 'summary', 'status', 'result', 'consequence', 'visibility', 'delivery',
    ]);
    const beforeMemory = before.storyMemory || {};
    const afterMemory = after.storyMemory || {};
    const facts = changedItems(beforeMemory.facts, afterMemory.facts, [
        'subject', 'predicate', 'value', 'status', 'importance', 'locked', 'important',
    ]);
    const clues = changedItems(beforeMemory.clues, afterMemory.clues, [
        'title', 'text', 'status', 'importance', 'locked', 'important',
    ]);
    const summaries = changedItems(beforeMemory.summaries, afterMemory.summaries, [
        'title', 'summary', 'startMessageId', 'endMessageId',
    ]);
    return {
        elapsedMinutes: Math.max(0, Number(after.clock?.absoluteMinute) - Number(before.clock?.absoluteMinute)),
        peopleChanged: people.added.length + people.updated.length,
        peopleNames: [...people.added, ...people.updated].map(item => item.name).filter(Boolean).slice(0, 6),
        eventsAdded: events.added.length,
        eventsUpdated: events.updated.length,
        eventTitles: [...events.added, ...events.updated].map(item => item.title).filter(Boolean).slice(0, 6),
        memoryAdded: facts.added.length + clues.added.length + summaries.added.length,
        memoryUpdated: facts.updated.length + clues.updated.length + summaries.updated.length,
        promptCharacters: String(prompt || '').length,
        promptTokens: approximateTokens(prompt),
        outputCharacters: String(raw || '').length,
        outputTokens: approximateTokens(raw),
        outputBudget: Number(tokenBudget) || 0,
        attempts: Math.max(1, Number(attempts) || 1),
        injectionCharacters: String(injection.text || '').length,
        injectionLines: String(injection.text || '').split('\n').filter(Boolean).length,
        injectionEvents: injection.eventIds?.length || 0,
        omittedInjectionLines: Number(injection.omittedLines) || 0,
    };
}

function unreadableJsonError(raw, subject = 'Mô hình') {
    const text = String(raw || '').trim();
    if (!text) return new Error(`${subject}không trả về dữ liệu có thể đọc của  JSON Trạng thái`);
    const compact = text.replace(/\s+/g, ' ');
    const beginning = compact.slice(0, 90);
    const ending = compact.length > 140 ? compact.slice(-70) : '';
    const likelyTruncated = /^[\[{]/.test(compact) && !/[}\]]\s*(?:```)?$/.test(compact);
    const detail = ending ? `Phần đầu:${beginning}；Phần cuối:${ending}` : beginning;
    return new Error(
        `${subject}Dữ liệu trả về của  JSON ${likelyTruncated ? 'không khép kín, nghi ngờ bị cắt bớt do giới hạn đầu ra' : 'Định dạng không hợp lệ'}`
        + `（${text.length} ký tự):${detail}`,
    );
}

function attachBranchData(message, swipeId, data) {
    if (!message || typeof message !== 'object') return;
    message.extra ||= {};

    if (Number(message.swipe_id ?? 0) === Number(swipeId)) {
        message.extra[SNAPSHOT_KEY] = clone(data);
    }

    const swipeInfo = message.swipe_info?.[swipeId];
    if (swipeInfo && typeof swipeInfo === 'object') {
        swipeInfo.extra ||= {};
        swipeInfo.extra[SNAPSHOT_KEY] = clone(data);
    }
}

function findLatestResultSnapshot(beforeIndex = Infinity) {
    const context = getContext();
    const chat = context?.chat || [];
    const start = Math.min(chat.length - 1, Number(beforeIndex) - 1);

    for (let index = start; index >= 0; index -= 1) {
        const message = chat[index];
        if (!message || message.is_user) continue;
        const data = branchDataFromMessage(message);
        if (data?.status === 'committed' && data.result && !data.stale) {
            return { snapshot: data.result, messageId: index, data };
        }
    }
    return null;
}

function stateWithBranchOverride(snapshot, store = getStore()) {
    const restored = restoreBranchSnapshot(snapshot, store.initialState);
    const sourceKey = snapshot?.meta?.sourceKey || '';
    const override = sourceKey ? store.branchOverrides[sourceKey] : null;
    return override ? restoreBranchSnapshot(override, restored) : restored;
}

function currentAnchorKey() {
    const state = getState();
    return state.lastCommit?.sourceKey || 'root';
}

function setCurrentState(nextState, {
    save = true,
    overrideKey = null,
    immediate = false,
} = {}) {
    const store = getStore();
    store.currentState = trimState(nextState);

    if (overrideKey) {
        store.branchOverrides[overrideKey] = createBranchSnapshot(store.currentState, {
            sourceKey: overrideKey,
            kind: 'manual-override',
        });
        const entries = Object.entries(store.branchOverrides);
        if (entries.length > 48) {
            store.branchOverrides = Object.fromEntries(entries.slice(-48));
        }
    }

    if (save) saveStore(store, { immediate });
    refreshInjection();
    runtime.ui?.render();
    return store.currentState;
}

function restoreLatestBranch({ pending = false } = {}) {
    const store = getStore();
    const latest = findLatestResultSnapshot();
    let state = latest
        ? stateWithBranchOverride(latest.snapshot, store)
        : (
            store.branchOverrides.root
                ? restoreBranchSnapshot(store.branchOverrides.root, store.initialState)
                : clone(store.initialState)
        );
    if (pending) state = markPendingSync(state, true);
    store.currentState = trimState(state);
    saveStore(store);
    refreshInjection();
    runtime.ui?.render();
    return store.currentState;
}

function recentChatText(maximum = 8) {
    const chat = getContext()?.chat || [];
    return chat
        .slice(-maximum)
        .map(message => narrativeMessageText(message))
        .join('\n')
        .slice(-9000);
}

function selectedMessageText(message) {
    if (!message) return '';
    if (message.is_user) return String(message.mes || '');
    const swipeId = Number(message.swipe_id ?? 0);
    return String(message.swipes?.[swipeId] ?? message.mes ?? '');
}

function narrativeMessageText(message) {
    return filterNarrativeText(selectedMessageText(message), getSettings());
}

function hasUsableAssistantText(message) {
    if (!message || message.is_user || message.is_system) return false;
    if (message.is_error || message.error || message.extra?.generation_error || message.extra?.api_error) {
        return false;
    }
    const text = selectedMessageText(message).trim();
    return Boolean(text && !/^(?:\.{3}|…+|（?Phản hồi trống）?)$/u.test(text));
}

function narrativeContext(messageId, maximumTurns = 3) {
    const chat = getContext()?.chat || [];
    const assistant = chat[Number(messageId)];
    let userText = '';
    for (let index = Number(messageId) - 1; index >= 0; index -= 1) {
        if (chat[index]?.is_user) {
            userText = narrativeMessageText(chat[index]);
            break;
        }
    }
    const assistantText = narrativeMessageText(assistant);

    let startIndex = 0;
    let userTurns = 0;
    for (let index = Number(messageId); index >= 0; index -= 1) {
        if (chat[index]?.is_user) {
            userTurns += 1;
            if (userTurns >= maximumTurns) {
                startIndex = index;
                break;
            }
        }
    }
    const turns = chat
        .slice(startIndex, Number(messageId) + 1)
        .map((message, offset) => ({ message, messageId: startIndex + offset }))
        .filter(entry => entry.message && !entry.message.is_system)
        .map(({ message, messageId: turnMessageId }) => ({
            messageId: turnMessageId,
            swipeId: message.is_user ? 0 : Number(message.swipe_id ?? 0),
            role: message.is_user ? 'user' : 'assistant',
            content: narrativeMessageText(message),
        }))
        .filter(turn => turn.content);

    return {
        latestTurn: {
            user: userText,
            assistant: assistantText,
        },
        turns,
        assistant: String(assistantText),
    };
}

function currentTurnPresentPersonIds() {
    const latest = latestAssistantEntry();
    if (!latest) return [];
    return getState().people
        .filter(person => Number(person.presentInSceneMessageId) === Number(latest.index))
        .map(person => person.id);
}

function pendingAssistantEntriesThrough(messageId) {
    const target = Number(messageId);
    const chat = getContext()?.chat || [];
    const previous = findLatestResultSnapshot(target + 1);
    const start = previous ? previous.messageId + 1 : 0;
    const entries = [];
    for (let index = start; index <= target; index += 1) {
        const message = chat[index];
        if (!hasUsableAssistantText(message)) continue;
        const branch = branchDataFromMessage(message);
        if (!branch) continue;
        if (branch?.status === 'committed' && !branch.stale) continue;
        entries.push({ message, index });
    }
    return entries;
}

function nextHistoryBatch(cursor, {
    maximumCharacters = 24000,
    maximumUserTurns = 8,
    maximumAssistantTurns = 6,
} = {}) {
    const chat = getContext()?.chat || [];
    const messages = [];
    let characters = 0;
    let userTurns = 0;
    let assistantTurns = 0;
    let endMessageId = Math.max(-1, Number(cursor) - 1);

    for (let index = Math.max(0, Number(cursor) || 0); index < chat.length; index += 1) {
        if (messages.length && assistantTurns >= maximumAssistantTurns) {
            endMessageId = index - 1;
            break;
        }
        const message = chat[index];
        endMessageId = index;
        if (!message || message.is_system) continue;
        const role = message.is_user ? 'user' : 'assistant';
        const maximum = role === 'user' ? 4000 : 7000;
        const content = narrativeMessageText(message).slice(0, maximum);
        if (!content) continue;
        const nextCharacters = characters + content.length;
        const nextUserTurns = userTurns + (role === 'user' ? 1 : 0);
        if (
            messages.length
            && (
                nextCharacters > maximumCharacters
                || nextUserTurns > maximumUserTurns
            )
        ) {
            endMessageId = index - 1;
            break;
        }
        messages.push({
            id: index,
            swipe: message.is_user ? 0 : Number(message.swipe_id ?? 0),
            role,
            content,
        });
        characters = nextCharacters;
        userTurns = nextUserTurns;
        if (role === 'assistant') assistantTurns += 1;
    }

    return {
        messages,
        startMessageId: messages[0]?.id ?? Math.max(0, Number(cursor) || 0),
        endMessageId: messages.at(-1)?.id ?? endMessageId,
        nextCursor: Math.max(Number(cursor) + 1, endMessageId + 1),
        totalMessages: chat.length,
    };
}


function publicOpinionEventSignature(state) {
    // Dư luận chỉ hết hiệu lực khi nguồn thông tin công khai của nó thực sự thay đổi. Sắp xếp ký ức, UI chỉnh sửa v.v. không liên quan revision
    // Không nên để cùng một sự thật thế giới công khai chạy lại nhiều lần API。
    return hashText(JSON.stringify(eligiblePublicOpinionEvents(state)));
}

function scheduleAutoPublicOpinion(state = getState(), delay = 260) {
    const settings = getSettings();
    if (!settings.enabled || !settings.publicOpinionAutoEnabled) return false;
    const events = eligiblePublicOpinionEvents(state);
    if (!events.length) return false;
    const signature = publicOpinionEventSignature(state);
    const cachedSignature = String(getStore().publicOpinion?.sourceEventSignature || '');
    if (signature && signature === cachedSignature) return false;
    runtime.pendingPublicOpinion = true;
    window.setTimeout(scheduleDeferredPublicOpinion, Math.max(120, Number(delay) || 260));
    return true;
}

function publicOpinionRevealInjection(state, cache, settings, recentText = '') {
    if (settings.publicOpinionRevealMode !== 'relevant') return '';
    const opinion = normalizePublicOpinionCache(cache || {});
    const stale = String(opinion.sourceEventSignature || '') !== publicOpinionEventSignature(state);
    if (!opinion.generatedAt || stale) return '';
    const text = String(recentText || '').toLocaleLowerCase();
    const events = new Map((state.events || []).map(event => [String(event.id), event]));
    const peopleNames = (state.people || []).map(person => String(person.name || '').trim()).filter(Boolean);
    const isRelevant = item => {
        const event = events.get(String(item.relatedEventId || ''));
        if (!event) return false;
        const terms = [
            event.title,
            event.place,
            ...(item.audienceTags || []),
            ...peopleNames.filter(name => (
                String(event.summary || '').includes(name)
                || String(event.expectedResult || '').includes(name)
                || String(event.result || '').includes(name)
            )),
        ]
            .map(value => String(value || '').trim().toLocaleLowerCase())
            .filter(value => value.length >= 2);
        return terms.some(term => text.includes(term));
    };
    const news = (opinion.news || []).filter(isRelevant).slice(0, 2);
    const forums = (opinion.forums || []).filter(isRelevant).slice(0, 2);
    if (!news.length && !forums.length) return '';
    const lines = [
        '<world_public_opinion>',
        'Dưới đây là các ứng cử viên dư luận công khai thực sự liên quan đến ống kính hiện tại. Chỉ khi nhân vật có kênh tiếp xúc tự nhiên (điện thoại, TV, người qua đường thảo luận, tin nhắn công việc, v.v.) mới được phép thuận tay hiển thị; không được vì thông báo mà làm gián đoạn cốt truyện hiện tại, cũng không được coi suy đoán trên diễn đàn là sự thật thế giới.',
    ];
    for (const item of news) {
        const audience = (item.audienceTags || []).slice(0, 4).join('、');
        lines.push(`Tin tức｜${item.headline}｜${item.summary}｜Nguồn:${item.source || 'Thông tin công khai'}｜Cấp độ nguồn:${item.sourceType || 'official'}${audience ? `｜Có thể quan tâm:${audience}` : ''}`);
    }
    for (const item of forums) {
        const audience = (item.audienceTags || []).slice(0, 4).join('、');
        lines.push(`Diễn đàn｜${item.title}｜${item.summary}｜Tính chất:${item.claimStatus || 'mixed'}｜Cấp độ nguồn:${item.sourceType || 'unofficial'}${audience ? `｜Có thể quan tâm:${audience}` : ''}`);
    }
    lines.push('</world_public_opinion>');
    return lines.join('\n');
}

function refreshInjection() {
    const context = getContext();
    if (!context?.setExtensionPrompt) return;

    const settings = getSettings();
    const state = getState();
    const recentText = recentChatText();
    const packet = buildInjectionPackage(state, settings, recentText);
    const opinionInjection = publicOpinionRevealInjection(
        state,
        getStore().publicOpinion,
        settings,
        recentText,
    );
    const text = [packet.text, opinionInjection].filter(Boolean).join('\n\n');
    runtime.injection = { ...packet, text };

    context.setExtensionPrompt(
        PROMPT_KEY,
        text,
        1,
        0,
        false,
        0,
    );
}

function clearOwnInjection() {
    const context = getContext();
    context?.setExtensionPrompt?.(PROMPT_KEY, '', 1, 0, false, 0);
}

function setBusy(value) {
    runtime.simulationCount += value ? 1 : -1;
    runtime.simulationCount = Math.max(0, runtime.simulationCount);
    runtime.ui?.setBusy(runtime.simulationCount > 0);
}

function coreSimulationBusy() {
    return Boolean(runtime.activeSimulation || runtime.queuedSimulations.size > 0);
}

function latestAssistantSourceStamp() {
    const latest = latestAssistantEntry();
    if (!latest) return '';
    const swipeId = Number(latest.message?.swipe_id ?? 0);
    return branchSourceKey(latest.index, latest.message, swipeId);
}

function preemptLowPriorityTasksForCore() {
    if (runtime.activePublicOpinion && !runtime.activePublicOpinion.controller.signal.aborted) {
        runtime.pendingPublicOpinion = true;
        runtime.activePublicOpinion.controller.abort();
    }
    if (runtime.activePublicOpinionSandbox && !runtime.activePublicOpinionSandbox.controller.signal.aborted) {
        runtime.activePublicOpinionSandbox.controller.abort();
    }
    if (runtime.activeObservation && !runtime.activeObservation.controller.signal.aborted) {
        runtime.activeObservation.controller.abort();
    }
    if (runtime.activeHistoryScan && !runtime.activeHistoryScan.signal.aborted) {
        runtime.activeHistoryScan.abort();
        runtime.historyProgress = {
            ...runtime.historyProgress,
            message: 'Nội dung chính mới đến rồi~ Trước tiên hãy theo kịp tuyến truyện chính của thế giới, ký ức sẽ tiếp tục được sắp xếp từ đợt đã lưu',
        };
        runtime.ui?.render();
    }
}

function scheduleDeferredPublicOpinion(delay = 220) {
    if (!runtime.pendingPublicOpinion) return;
    window.setTimeout(() => {
        if (!runtime.pendingPublicOpinion || coreSimulationBusy()) return;
        runtime.pendingPublicOpinion = false;
        void generatePublicOpinionSnapshot({ allowDefer: true }).catch(error => {
            if (!isAbortError(error)) console.warn('[Mặt trái thế giới] Trì hoãn tạo dư luận thất bại', error);
        });
    }, delay);
}

function hasNewerAssistantReply(messageId) {
    const latest = latestAssistantEntry();
    return Boolean(latest && Number(latest.index) > Number(messageId));
}

function cancelActiveSimulation() {
    const active = runtime.activeSimulation;
    if (!active || active.controller.signal.aborted) return false;
    active.cancelled = true;
    active.controller.abort();
    if (active.apiMode !== 'custom') {
        try {
            getContext()?.stopGeneration?.();
        } catch (error) {
            console.warn('[Mặt trái thế giới] Không thể yêu cầu Tavern dừng tạo im lặng', error);
        }
    }
    setSyncStatus({
        phase: 'cancelling',
        message: 'Đang dừng lần suy diễn này, sẽ không gửi bất kỳ thay đổi thế giới nào',
        error: '',
    });
    return true;
}

function markMessagePending(messageId, {
    trigger = 'reply',
    offeredEventIds = runtime.generationOffer.eventIds,
    deferBase = false,
} = {}) {
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!hasUsableAssistantText(message)) return null;
    const swipeId = Number(message.swipe_id ?? 0);
    const sourceKey = branchSourceKey(messageId, message, swipeId);
    const existing = branchDataFromMessage(message, swipeId);

    let baseState = null;
    if (!deferBase) {
        if (existing?.base && !existing.stale) {
            baseState = restoreBranchSnapshot(existing.base, getStore().initialState);
        } else {
            const previous = findLatestResultSnapshot(messageId);
            baseState = previous
                ? stateWithBranchOverride(previous.snapshot)
                : clone(getState());
        }
    }

    const data = {
        schemaVersion: SCHEMA_VERSION,
        status: 'pending',
        sourceKey,
        trigger,
        offeredEventIds: [...new Set(offeredEventIds || [])],
        base: baseState ? createBranchSnapshot(baseState, {
            messageId,
            swipeId,
            sourceKey,
            kind: 'base',
        }) : null,
        result: null,
        error: '',
        stale: false,
    };

    attachBranchData(message, swipeId, data);
    void context?.saveChat?.();
    const store = getStore();
    if (baseState && currentChatToken() === runtime.activeChatToken) {
        store.currentState = markPendingSync(baseState, true);
        saveStore(store);
        refreshInjection();
        runtime.ui?.render();
    }
    return { data, message, messageId, swipeId, sourceKey, baseState };
}

function locateTargetBranch(messageId, swipeId, expectedHash) {
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!message) return null;
    const text = message.swipes?.[swipeId] ?? (
        Number(message.swipe_id ?? 0) === Number(swipeId) ? message.mes : ''
    );
    if (hashText(text) !== expectedHash) return null;
    return { context, message };
}

function backgroundRequestMessages(prompt, settings = getSettings(), {
    taskKind = 'simulation',
    rejectTruncated = false,
} = {}) {
    const messages = buildBackstageMessages(prompt);
    runtime.lastPromptBridge = {
        enabled: false,
        removed: true,
        taskKind,
        promptCount: 0,
        available: false,
        truncated: false,
        internalCompatChars: String(INTERNAL_COMPAT_SYSTEM_PROMPT || '').trim().length,
        systemChars: String(messages[0]?.content || '').length,
        userChars: String(messages[1]?.content || '').length,
        at: new Date().toISOString(),
    };
    return messages;
}

async function backgroundSimulation(prompt, {
    maxTokens = 2200,
    temperature = 0.2,
    signal = null,
    taskKind = 'simulation',
    rejectTruncated = false,
} = {}) {
    const context = getContext();
    const settings = getSettings();
    const route = resolveTaskConnection(settings, taskKind);
    const requestSettings = route.settings;
    const tavernConnection = route.mode === 'tavern' ? getConnectionInfo() : null;
    runtime.lastTaskConnection = {
        taskKind,
        routeKey: route.routeKey,
        route: route.route,
        apiLabel: route.mode === 'custom' ? route.label : 'Theo Tavern hiện tại',
        model: route.mode === 'custom'
            ? String(requestSettings.customApiModel || 'Mô hình chưa được cấu hình')
            : String(tavernConnection?.model || 'Theo mô hình hiện tại của Tavern'),
        method: route.mode === 'custom'
            ? (requestSettings.customApiTransport === 'direct' ? 'Trình duyệt kết nối trực tiếp' : 'Tavern chuyển tiếp')
            : 'Ngữ cảnh độc lập của Tavern',
        source: route.mode === 'custom' ? 'custom-independent' : tavernConnection?.source || 'tavern',
    };
    const messages = backgroundRequestMessages(prompt, settings, { taskKind });
    if (signal?.aborted) {
        const error = new Error('Suy diễn đã bị người dùng hủy');
        error.name = 'AbortError';
        throw error;
    }
    if (route.mode === 'custom') {
        runtime.inBackgroundGeneration = true;
        try {
            runtime.syncStatus.method = requestSettings.customApiTransport === 'direct'
                ? `${route.label} · Trình duyệt kết nối trực tiếp`
                : `${route.label} · Tavern chuyển tiếp`;
            return await requestCustomCompletion(requestSettings, messages, {
                fetchImpl: globalThis.fetch.bind(globalThis),
                getRequestHeaders: () => context?.getRequestHeaders?.() || {},
                maxTokens,
                temperature,
                signal,
                rejectTruncated,
                operation: taskKind,
                routeLabel: route.label,
            });
        } finally {
            runtime.inBackgroundGeneration = false;
            refreshInjection();
        }
    }

    if (
        typeof context?.generateRaw !== 'function'
        && typeof context?.generateQuietPrompt !== 'function'
    ) {
        throw new Error('Phiên bản Tavern hiện tại không cung cấp giao diện tạo im lặng');
    }
    if (taskKind === 'person-observation' && typeof context?.generateRaw !== 'function') {
        throw new Error('Phiên bản Tavern hiện tại không cung cấp giao diện quan sát nhân vật ngữ cảnh độc lập; vui lòng cập nhật SillyTavern hoặc cấu hình độc lập cho mặt trái thế giới API');
    }

    runtime.inBackgroundGeneration = true;
    clearOwnInjection();
    const stopNativeGeneration = () => {
        try {
            context?.stopGeneration?.();
        } catch (error) {
            console.warn('[Mặt trái thế giới] Yêu cầu dừng tạo im lặng của Tavern không trả về bình thường', error);
        }
    };
    signal?.addEventListener?.('abort', stopNativeGeneration, { once: true });
    try {
        let request;
        if (typeof context.generateRaw === 'function') {
            runtime.syncStatus.method = 'Suy diễn ngữ cảnh độc lập';
            request = context.generateRaw({
                prompt: messages,
                responseLength: maxTokens,
                trimNames: false,
                signal,
            });
        } else {
            runtime.syncStatus.method = 'Chế độ tương thích tạo im lặng';
            request = context.generateQuietPrompt({
                quietPrompt: `${messages[0]?.content || ''}\n\n${messages[1]?.content || ''}`.trim(),
                skipWIAN: true,
                responseLength: maxTokens,
                removeReasoning: true,
                signal,
            });
        }
        // The background request has captured its own prompt. Restore the
        // foreground injection before waiting so a newly sent user turn never
        // sees an empty World Backstage prompt.
        refreshInjection();
        return await request;
    } finally {
        signal?.removeEventListener?.('abort', stopNativeGeneration);
        runtime.inBackgroundGeneration = false;
        refreshInjection();
    }
}

async function runSimulationForMessage(messageId, {
    force = false,
    trigger = 'reply',
    newAssistantCount = 1,
    job = null,
} = {}) {
    const chatTokenAtStart = currentChatToken();
    if (job?.chatToken && job.chatToken !== chatTokenAtStart) return null;

    const beforeContext = getContext();
    const beforeMessage = beforeContext?.chat?.[messageId];
    const initialSettings = getSettings();
    if (!initialSettings.enabled || !initialSettings.worldSimulationEnabled) {
        throw new Error('Mô-đun suy diễn thế giới hiện đã bị vô hiệu hóa');
    }
    if (!hasUsableAssistantText(beforeMessage)) {
        throw new Error('Không tìm thấy nội dung có thể suy diễn của  AI Nội dung chính');
    }
    const beforeSwipeId = Number(beforeMessage.swipe_id ?? 0);
    const beforeSourceKey = branchSourceKey(messageId, beforeMessage, beforeSwipeId);
    if (
        job
        && (job.swipeId !== beforeSwipeId || job.sourceKey !== beforeSourceKey)
    ) {
        setSyncStatus({
            phase: 'pending',
            message: 'Nội dung chính đã thay đổi, nhiệm vụ xếp hàng cũ đã bị bỏ qua; đang chờ suy diễn theo nội dung chính mới nhất',
            error: '',
        });
        return null;
    }
    const beforeData = branchDataFromMessage(beforeMessage, beforeSwipeId);
    if (
        !force
        && beforeData?.status === 'committed'
        && beforeData.sourceKey === beforeSourceKey
        && beforeData.result
        && !beforeData.stale
    ) {
        return stateWithBranchOverride(beforeData.result);
    }

    const prepared = markMessagePending(messageId, {
        trigger,
        offeredEventIds: job?.offeredEventIds ?? beforeData?.offeredEventIds,
    });
    if (!prepared) {
        throw new Error('Không tìm thấy nội dung có thể suy diễn của  AI Nội dung chính');
    }

    const {
        message,
        swipeId,
        sourceKey,
        baseState,
    } = prepared;
    const expectedHash = sourceKey.split(':').at(-1);
    const offeredEventIds = prepared.data.offeredEventIds;
    const settings = getSettings();
    const assistantTurnsToApply = Math.min(
        20,
        Math.max(1, Number.parseInt(newAssistantCount, 10) || 1),
    );
    const anchorContextTurns = baseState?.clock?.anchored ? 0 : 20;
    const narrative = narrativeContext(
        messageId,
        Math.max(settings.contextTurns, assistantTurnsToApply, anchorContextTurns),
    );
    // Pending batch must come from raw chat ids (hasUsableAssistantText), not
    // narrative.turns — narrativeContext already drops empty-after-filter turns,
    // which would otherwise pull older assistants into the "new" slice.
    const chatForPending = beforeContext?.chat || [];
    const pendingMessageIds = selectPendingAssistantMessageIds(
        chatForPending,
        messageId,
        assistantTurnsToApply,
        hasUsableAssistantText,
    );
    const pendingFilteredTexts = pendingMessageIds.map(
        id => narrativeMessageText(chatForPending[id]),
    );
    const survivingNewCount = countSurvivingNewAssistantTurns(
        narrative.turns,
        pendingMessageIds,
    );
    const newAssistantTexts = pendingFilteredTexts
        .map(text => String(text || '').trim())
        .filter(Boolean);
    const simulationModeLabel = {
        light: 'Gọn nhẹ',
        balanced: 'Cân bằng',
        deep: 'Chuyên sâu',
        manual: 'Thủ công',
    }[settings.autoSimulationMode] || 'Cân bằng';
    const generationMetrics = {
        raw: '',
        attempts: 1,
        tokenBudget: 0,
    };
    const controller = new AbortController();
    const activeSimulation = {
        controller,
        messageId,
        trigger,
        chatToken: chatTokenAtStart,
        sourceKey,
        newAssistantCount: assistantTurnsToApply,
        apiMode: resolveTaskConnection(settings, 'simulation').mode,
        cancelled: false,
    };
    runtime.activeSimulation = activeSimulation;

    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: assistantTurnsToApply > 1
            ? `Đang hợp nhất gần đây ${assistantTurnsToApply} vòng nội dung chính mới và tiến hành${simulationModeLabel}Suy diễn`
            : `Đang đọc gần đây ${settings.contextTurns} vòng nội dung chính và tiến hành${simulationModeLabel}Suy diễn`,
        error: '',
        attemptedAt: new Date().toISOString(),
    });
    try {
        // Short-circuit when every pending (queued) assistant filters to empty —
        // not when narrative.turns' last-N assistants happen to be non-empty older turns.
        if (!newAssistantTexts.length) {
            // No valid narrative after filtering: do not consume delivery attempts
            // or expire candidates via recordDeliveryOffers.
            const resultState = markPendingSync(clone(baseState), false);
            const nextInjection = buildInjectionPackage(resultState, settings, recentChatText());
            const summary = simulationSummary(baseState, resultState, {
                prompt: '',
                raw: '',
                attempts: 0,
                tokenBudget: 0,
                injection: nextInjection,
            });
            const target = locateTargetBranch(messageId, swipeId, expectedHash);
            if (!target || currentChatToken() !== chatTokenAtStart) {
                if (currentChatToken() === chatTokenAtStart) {
                    setSyncStatus({
                        phase: 'pending',
                        message: 'Nhánh nội dung chính đã thay đổi, kết quả cũ chưa được gửi; nội dung chính mới nhất vẫn đang chờ suy diễn',
                        error: '',
                    });
                }
                return resultState;
            }
            const committed = {
                ...prepared.data,
                status: 'committed',
                result: createBranchSnapshot(resultState, {
                    messageId,
                    swipeId,
                    sourceKey,
                    kind: 'result',
                }),
                error: '',
                summary,
            };
            attachBranchData(target.message, swipeId, committed);
            const branchIsCurrent = (
                Number(target.message.swipe_id ?? 0) === swipeId
                && hashText(target.message.mes) === expectedHash
            );
            const supersededByNewerReply = hasNewerAssistantReply(messageId);
            if (branchIsCurrent && !supersededByNewerReply) {
                const store = getStore();
                store.currentState = trimState(resultState);
                saveStore(store, { immediate: true });
                refreshInjection();
                runtime.ui?.render();
            }
            await target.context.saveChat?.();
            setSyncStatus({
                phase: supersededByNewerReply ? 'pending' : 'success',
                message: supersededByNewerReply
                    ? 'Kết quả vòng này đã được lưu trữ an toàn, nhưng nội dung chính cập nhật đã xuất hiện~ Tạm thời không ghi vào trạng thái hiện tại, đang bắt kịp vòng mới nhất'
                    : 'Sau khi lọc không có nội dung chính hợp lệ, vòng này không thúc đẩy thế giới',
                error: '',
                succeededAt: supersededByNewerReply ? '' : new Date().toISOString(),
                method: runtime.syncStatus.method,
                summary,
            });
            return resultState;
        }

        const prompt = buildSimulationPrompt(baseState, {
            queuedEventIds: offeredEventIds,
            trigger,
            latestTurn: narrative.latestTurn,
            narrativeTurns: narrative.turns,
            userName: beforeContext?.name1 || '',
            includeUserInnerVoice: settings.includeUserInnerVoice,
            timePolicy: settings.timePolicy,
            worldAuto: settings.worldAutoEnabled,
            simulationMode: settings.autoSimulationMode,
            customInstruction: settings.customSimulationInstruction,
            playerIdentityAnchor: getPlayerIdentityAnchor(baseState),
            newAssistantTurns: Math.max(1, survivingNewCount),
            backgroundNpcBudget: settings.backgroundNpcBudget,
        });

        const automaticMaxTokens = settings.autoSimulationMode === 'deep'
            ? 4600
            : settings.autoSimulationMode === 'light'
                ? 2400
                : 3400;
        const baseMaxTokens = settings.maxOutputTokens > 0
            ? settings.maxOutputTokens
            : automaticMaxTokens;
        const payload = await runWithRetries(async attempt => {
            generationMetrics.attempts = attempt + 1;
            generationMetrics.tokenBudget = retryTokenBudget(baseMaxTokens, attempt);
            const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                maxTokens: generationMetrics.tokenBudget,
                temperature: attempt > 0
                    ? 0.08
                    : settings.autoSimulationMode === 'deep' ? 0.28 : 0.18,
                signal: controller.signal,
            });
            generationMetrics.raw = String(raw || '');
            const parsed = extractJsonObject(raw);
            if (parsed) return parsed;
            throw unreadableJsonError(raw);
        }, {
            retries: settings.autoRetryCount,
            shouldRetry: error => !(
                /Vui lòng điền độc lập trước API|HTTP 40[0134]|Không tìm thấy có thể suy diễn|Không cung cấp giao diện tạo im lặng/
                    .test(describeError(error))
            ),
            onRetry: ({ attempt, total, delayMs, error }) => {
                setSyncStatus({
                    phase: 'running',
                    message: `Suy diễn thất bại, chuẩn bị lần thứ ${attempt}/${total} tự động thử lại`,
                    error: `${describeError(error)}；${Math.ceil(delayMs / 100) / 10} giây sau thử lại`,
                });
            },
            signal: controller.signal,
        });

        if (controller.signal.aborted) {
            const error = new Error('Suy diễn đã bị người dùng hủy');
            error.name = 'AbortError';
            throw error;
        }

        // Settings may have changed while the API request was in flight. The
        // commit decision must use the current switch value, not the snapshot
        // captured when generation started.
        const memoryEnabledAtCommit = getSettings().memorySystemEnabled;
        const applicablePayload = memoryEnabledAtCommit
            ? payload
            : {
                ...payload,
                memory_update: {
                    facts_upsert: [],
                    facts_invalidate: [],
                    clues_upsert: [],
                    clues_resolve: [],
                },
                memoryUpdate: {
                    factsUpsert: [],
                    factsInvalidate: [],
                    cluesUpsert: [],
                    cluesResolve: [],
                },
            };
        let resultState = applySimulationResult(baseState, applicablePayload, {
            messageId,
            swipeId,
            sourceKey,
            userName: beforeContext?.name1 || '',
            allowUserInnerVoice: settings.includeUserInnerVoice,
            timePolicy: settings.timePolicy,
            narrativeText: newAssistantTexts.join('\n'),
            backgroundNpcBudget: settings.backgroundNpcBudget,
        });
        resultState = recordDeliveryOffers(resultState, offeredEventIds, {
            messageId,
            expireAfter: 3,
        });
        const nextInjection = buildInjectionPackage(resultState, settings, recentChatText());
        const summary = simulationSummary(baseState, resultState, {
            prompt,
            raw: generationMetrics.raw,
            attempts: generationMetrics.attempts,
            tokenBudget: generationMetrics.tokenBudget,
            injection: nextInjection,
        });

        const target = locateTargetBranch(messageId, swipeId, expectedHash);
        if (!target || currentChatToken() !== chatTokenAtStart) {
            if (currentChatToken() === chatTokenAtStart) {
                setSyncStatus({
                    phase: 'pending',
                    message: 'Nhánh nội dung chính đã thay đổi, kết quả cũ chưa được gửi; nội dung chính mới nhất vẫn đang chờ suy diễn',
                    error: '',
                });
            }
            return resultState;
        }

        const committed = {
            ...prepared.data,
            status: 'committed',
            result: createBranchSnapshot(resultState, {
                messageId,
                swipeId,
                sourceKey,
                kind: 'result',
            }),
            error: '',
            summary,
        };
        attachBranchData(target.message, swipeId, committed);

        const branchIsCurrent = (
            Number(target.message.swipe_id ?? 0) === swipeId
            && hashText(target.message.mes) === expectedHash
        );
        const supersededByNewerReply = hasNewerAssistantReply(messageId);
        if (branchIsCurrent && !supersededByNewerReply) {
            const store = getStore();
            store.currentState = trimState(resultState);
            saveStore(store, { immediate: true });
            refreshInjection();
            runtime.ui?.render();
            scheduleAutoPublicOpinion(resultState);
        }

        await target.context.saveChat?.();
        setSyncStatus({
            phase: supersededByNewerReply ? 'pending' : 'success',
            message: supersededByNewerReply
                ? 'Suy diễn vòng này đã được lưu trữ an toàn~ Nhưng bạn đã đi đến nội dung chính cập nhật rồi, kết quả cũ sẽ không ghi đè trạng thái hiện tại, tiếp theo sẽ trực tiếp bắt kịp vòng mới nhất'
                : 'Nội dung chính mới nhất đã hoàn thành suy diễn',
            error: '',
            succeededAt: supersededByNewerReply ? '' : new Date().toISOString(),
            method: runtime.syncStatus.method,
            summary,
        });
        return resultState;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            const target = currentChatToken() === chatTokenAtStart
                ? locateTargetBranch(messageId, swipeId, expectedHash)
                : null;
            if (target) {
                attachBranchData(target.message, swipeId, {
                    ...prepared.data,
                    status: 'pending',
                    error: '',
                });
                await target.context.saveChat?.();
            }
            if (currentChatToken() === chatTokenAtStart) {
                const store = getStore();
                store.currentState = markPendingSync(baseState, true);
                saveStore(store);
                refreshInjection();
                runtime.ui?.render();
            }
            if (currentChatToken() === chatTokenAtStart) {
                setSyncStatus({
                    phase: 'pending',
                    message: 'Suy diễn lần này đã bị hủy, nội dung chính vẫn giữ trạng thái chờ đồng bộ',
                    error: '',
                });
                toast('Đã dừng suy diễn; thời gian, nhân vật, sự kiện và ký ức đều chưa được gửi.', 'info');
            }
            throw error;
        }
        const errorMessage = describeError(error);
        const target = currentChatToken() === chatTokenAtStart
            ? locateTargetBranch(messageId, swipeId, expectedHash)
            : null;
        if (target) {
            const failed = {
                ...prepared.data,
                status: 'error',
                error: errorMessage,
            };
            attachBranchData(target.message, swipeId, failed);
            await target.context.saveChat?.();
        }

        if (currentChatToken() === chatTokenAtStart) {
            const store = getStore();
            store.currentState = markPendingSync(baseState, true);
            saveStore(store);
            refreshInjection();
            runtime.ui?.render();
        }

        if (currentChatToken() === chatTokenAtStart) {
            setSyncStatus({
                phase: 'error',
                message: 'Suy diễn thế giới chưa hoàn thành',
                error: errorMessage,
                method: runtime.syncStatus.method,
            });
            toast(`Suy diễn thế giới chưa hoàn thành:${errorMessage}`, 'warning');
        }
        throw error;
    } finally {
        if (runtime.activeSimulation === activeSimulation) {
            runtime.activeSimulation = null;
        }
        setBusy(false);
    }
}

function queueSimulation(messageId, options = {}) {
    const context = getContext();
    const numericMessageId = Number(messageId);
    const message = context?.chat?.[numericMessageId];
    const swipeId = Number(message?.swipe_id ?? 0);
    const sourceKey = message
        ? branchSourceKey(numericMessageId, message, swipeId)
        : `${numericMessageId}:${swipeId}:missing`;
    const branch = message ? branchDataFromMessage(message, swipeId) : null;
    const chatToken = currentChatToken();
    const queueKey = `${chatToken}:${sourceKey}`;
    const job = Object.freeze({
        chatToken,
        messageId: numericMessageId,
        swipeId,
        sourceKey,
        queueKey,
        trigger: options.trigger || 'reply',
        force: Boolean(options.force),
        newAssistantCount: Math.max(1, Number(options.newAssistantCount) || 1),
        offeredEventIds: clone(
            options.offeredEventIds
            ?? branch?.offeredEventIds
            ?? runtime.generationOffer.eventIds
            ?? [],
        ),
    });
    const existing = runtime.queuedSimulations.get(queueKey);
    if (existing) return existing;

    setSyncStatus({
        phase: 'queued',
        message: 'Đã xếp vào hàng đợi suy diễn thế giới',
        error: '',
    });
    const task = runtime.simulationChain
        .catch(() => undefined)
        .then(() => runSimulationForMessage(numericMessageId, {
            ...options,
            trigger: job.trigger,
            force: job.force,
            newAssistantCount: job.newAssistantCount,
            job,
        }));
    runtime.simulationChain = task;
    runtime.queuedSimulations.set(queueKey, task);
    void task.then(
        () => {
            if (runtime.queuedSimulations.get(queueKey) === task) {
                runtime.queuedSimulations.delete(queueKey);
            }
            window.setTimeout(schedulePendingCatchUp, 40);
            window.setTimeout(scheduleDeferredPublicOpinion, 180);
            window.setTimeout(scheduleAutoMemoryIndex, 700);
        },
        error => {
            if (runtime.queuedSimulations.get(queueKey) === task) {
                runtime.queuedSimulations.delete(queueKey);
            }
            if (!isAbortError(error)) {
                window.setTimeout(
                    () => schedulePendingCatchUp({ afterMessageId: job.messageId }),
                    40,
                );
            }
            window.setTimeout(scheduleDeferredPublicOpinion, 180);
        },
    );
    return task;
}

function scheduleAutoSync(messageId, type) {
    const settings = getSettings();
    const numericMessageId = Number(messageId);
    const message = getContext()?.chat?.[numericMessageId];
    if (!hasUsableAssistantText(message)) {
        setSyncStatus({
            phase: 'idle',
            message: 'Không phát hiện thấy hợp lệ AI nội dung chính, vòng này không thúc đẩy thế giới',
            error: '',
        });
        return;
    }
    if (!settings.enabled || !settings.worldSimulationEnabled) {
        setSyncStatus({
            phase: 'idle',
            message: settings.enabled ? 'Mô-đun suy diễn thế giới đã ngừng hoạt động' : 'Mặt trái thế giới hiện chưa được bật',
            error: '',
        });
        return;
    }
    const sourceKey = branchSourceKey(numericMessageId, message);
    const chatToken = currentChatToken();
    const queueKey = `${chatToken}:${sourceKey}`;
    const duplicateTask = Boolean(
        (
            runtime.activeSimulation?.chatToken === chatToken
            && runtime.activeSimulation?.sourceKey === sourceKey
        )
        || runtime.queuedSimulations.has(queueKey)
    );
    if (duplicateTask) {
        setSyncStatus({
            phase: runtime.activeSimulation?.sourceKey === sourceKey ? 'running' : 'queued',
            message: 'Nội dung chính vòng này đã ở trong hàng đợi suy diễn, không cần xử lý lặp lại',
            error: '',
        });
        return;
    }
    const workAlreadyRunning = Boolean(
        runtime.activeSimulation
        || runtime.queuedSimulations.size > 0
    );
    markMessagePending(messageId, {
        trigger: type || 'reply',
        deferBase: workAlreadyRunning,
    });
    if (!settings.worldAutoEnabled) {
        setSyncStatus({
            phase: 'pending',
            message: 'Tự động suy diễn được đặt thành thủ công; có thể suy diễn nội dung chính tích lũy bất cứ lúc nào',
            error: '',
        });
        return;
    }
    if (workAlreadyRunning) {
        preemptLowPriorityTasksForCore();
        const activeForCurrentChat = runtime.activeSimulation?.chatToken === chatToken
            ? runtime.activeSimulation
            : null;
        const activeTurns = activeForCurrentChat
            ? Math.max(1, Number(activeForCurrentChat.newAssistantCount) || 1)
            : 0;
        const waitingTurns = Math.max(
            1,
            pendingAssistantEntriesThrough(messageId).length - activeTurns,
        );
        setSyncStatus({
            phase: activeForCurrentChat ? 'running' : 'queued',
            message: `Nội dung chính mới đã vào hàng đợi an toàn, sẽ tiếp tục sau khi suy diễn hiện tại hoàn thành (chờ xử lý ${waitingTurns} vòng)`,
            error: '',
        });
        return;
    }

    const pending = pendingAssistantEntriesThrough(messageId);
    const interval = settings.autoSimulationInterval;
    if (pending.length < interval) {
        setSyncStatus({
            phase: 'pending',
            message: `Đã tích lũy ${pending.length}/${interval} vòng nội dung chính mới, đạt đến tần suất sẽ tự động suy diễn`,
            error: '',
        });
        return;
    }

    preemptLowPriorityTasksForCore();
    void queueSimulation(messageId, {
        trigger: type || 'reply',
        newAssistantCount: pending.length,
    }).catch(() => undefined);
}

function schedulePendingCatchUp({ afterMessageId = -1 } = {}) {
    const settings = getSettings();
    if (
        !settings.enabled
        || !settings.worldSimulationEnabled
        || !settings.worldAutoEnabled
        || runtime.simulationCount > 0
        || runtime.queuedSimulations.size > 0
    ) {
        return;
    }
    const latest = latestAssistantEntry();
    if (!latest) return;
    if (latest.index <= Number(afterMessageId)) return;
    const pending = pendingAssistantEntriesThrough(latest.index);
    if (pending.length < settings.autoSimulationInterval) return;
    void queueSimulation(latest.index, {
        trigger: 'interval-catch-up',
        newAssistantCount: pending.length,
    }).catch(() => undefined);
}

function unindexedAssistantCount() {
    const state = getState();
    const cursor = Math.max(
        0,
        Number(state.storyMemory?.indexedThroughMessageId ?? -1) + 1,
    );
    return (getContext()?.chat || [])
        .slice(cursor)
        .filter(hasUsableAssistantText)
        .length;
}

function scheduleAutoMemoryIndex() {
    const settings = getSettings();
    const interval = settings.memoryAutoIndexInterval;
    if (!settings.enabled || !settings.memorySystemEnabled || interval <= 0) return;
    const hasNewHistory = unindexedAssistantCount() >= interval;
    const hasPendingRollup = Boolean(planMemoryRollup(getState()));
    if (!hasNewHistory && !hasPendingRollup) return;
    if (runtime.autoMemoryTimer !== null) return;

    runtime.autoMemoryTimer = window.setTimeout(() => {
        runtime.autoMemoryTimer = null;
        if (
            runtime.historyProgress.phase === 'running'
            || runtime.simulationCount > 0
            || runtime.queuedSimulations.size > 0
        ) {
            scheduleAutoMemoryIndex();
            return;
        }
        void scanStoryMemoryHistory({
            automatic: true,
            maximumBatches: 1,
        }).catch(() => undefined);
    }, hasNewHistory ? 900 : 1600);
}

function onMessageReceived(messageId, type) {
    if (['quiet', 'impersonate', 'first_message'].includes(type)) return;
    const message = getContext()?.chat?.[Number(messageId)];
    if (!hasUsableAssistantText(message)) {
        if (!runtime.inBackgroundGeneration) {
            setSyncStatus({
                phase: 'idle',
                message: 'Phản hồi trống hoặc tạo thất bại, đã bỏ qua suy diễn và ghi ký ức',
                error: '',
            });
        }
        return;
    }
    scheduleAutoSync(Number(messageId), type);
    scheduleAutoMemoryIndex();
}

function onGenerationStarted(type, _options, dryRun) {
    if (dryRun || ['quiet', 'impersonate'].includes(type)) return;
    refreshInjection();
    runtime.generationOffer = {
        eventIds: clone(runtime.injection.eventIds || []),
        at: Date.now(),
    };
}

function restoreExistingSwipe(messageId) {
    const context = getContext();
    const message = context?.chat?.[Number(messageId)];
    if (!message) return;
    const swipeId = Number(message.swipe_id ?? 0);
    const swipesLength = Array.isArray(message.swipes) ? message.swipes.length : 0;
    const data = branchDataFromMessage(message, swipeId);
    const store = getStore();

    if (swipeId >= swipesLength) {
        const previous = findLatestResultSnapshot(Number(messageId));
        const base = data?.base && !data.stale
            ? restoreBranchSnapshot(data.base, store.initialState)
            : (previous
                ? stateWithBranchOverride(previous.snapshot, store)
                : clone(store.initialState));
        store.currentState = markPendingSync(base, true);
        const pending = {
            schemaVersion: SCHEMA_VERSION,
            status: 'pending',
            sourceKey: `${messageId}:${swipeId}:pending`,
            trigger: 'swipe',
            offeredEventIds: clone(runtime.injection.eventIds || []),
            base: createBranchSnapshot(base, {
                messageId: Number(messageId),
                swipeId,
                sourceKey: `${messageId}:${swipeId}:pending`,
                kind: 'base',
            }),
            result: null,
            error: '',
            stale: false,
        };
        message.extra ||= {};
        message.extra[SNAPSHOT_KEY] = pending;
    } else if (data?.status === 'committed' && data.result && !data.stale) {
        store.currentState = stateWithBranchOverride(data.result, store);
    } else if (data?.base && !data.stale) {
        store.currentState = markPendingSync(
            restoreBranchSnapshot(data.base, store.initialState),
            true,
        );
        if (message.mes && message.mes !== '...' && getSettings().worldAutoEnabled) {
            scheduleAutoSync(Number(messageId), 'swipe');
        }
    } else {
        const previous = findLatestResultSnapshot(Number(messageId));
        store.currentState = markPendingSync(
            previous ? stateWithBranchOverride(previous.snapshot, store) : clone(store.initialState),
            true,
        );
    }

    saveStore(store);
    refreshInjection();
    runtime.ui?.render();
}

function markSnapshotsStaleFrom(messageId) {
    const context = getContext();
    const chat = context?.chat || [];
    for (let index = Number(messageId); index < chat.length; index += 1) {
        const message = chat[index];
        const current = message?.extra?.[SNAPSHOT_KEY];
        if (current) current.stale = true;
        for (const swipeInfo of message?.swipe_info || []) {
            const data = swipeInfo?.extra?.[SNAPSHOT_KEY];
            if (data) data.stale = true;
        }
    }
    void context?.saveChat?.();
}

function onMessageEdited(messageId) {
    const context = getContext();
    const index = Number(messageId);
    const message = context?.chat?.[index];
    const swipeId = Number(message?.swipe_id ?? 0);
    const existing = message ? branchDataFromMessage(message, swipeId) : null;

    if (
        message
        && !message.is_user
        && index === context.chat.length - 1
        && existing?.status === 'committed'
        && existing.result
        && existing.base
        && !existing.stale
    ) {
        runtime.editDecision = {
            chatToken: currentChatToken(),
            messageId: index,
        };
        setSyncStatus({
            phase: 'pending',
            message: 'Phát hiện nội dung chính đã suy diễn bị chỉnh sửa, đang chờ bạn chọn có suy diễn lại hay không',
            error: '',
        });
        runtime.ui?.render();
        return;
    }

    markSnapshotsStaleFrom(index);

    const previous = findLatestResultSnapshot(index);
    const store = getStore();
    store.currentState = markPendingSync(
        previous ? stateWithBranchOverride(previous.snapshot, store) : clone(store.initialState),
        true,
    );
    saveStore(store);
    refreshInjection();
    runtime.ui?.render();

    if (message && !message.is_user && index === context.chat.length - 1) {
        setSyncStatus({
            phase: 'pending',
            message: 'Nội dung chính đã chỉnh sửa, trạng thái thế giới chưa thay đổi; sau khi xác nhận nội dung vui lòng đồng bộ thủ công',
            error: '',
        });
        toast('Sửa đổi nội dung chính đã được lưu, nhưng sẽ không tự động suy diễn lại; sau khi xác nhận hài lòng hãy nhấp vào“Đồng bộ nội dung chính mới nhất”。', 'info');
        return;
    }
    toast('Đã quay lại bản ghi nhanh thế giới trước điểm chỉnh sửa; nội dung chính tiếp theo cần tạo lại hoặc đồng bộ thủ công.', 'info');
}

async function resolveMessageEdit(mode) {
    const decision = runtime.editDecision;
    if (!decision || decision.chatToken !== currentChatToken()) {
        runtime.editDecision = null;
        throw new Error('Sửa đổi nội dung chính lần này đã không còn trong nhánh trò chuyện hiện tại');
    }
    const context = getContext();
    const message = context?.chat?.[decision.messageId];
    if (!message || message.is_user || decision.messageId !== context.chat.length - 1) {
        runtime.editDecision = null;
        throw new Error('Vị trí nội dung chính đã thay đổi, vui lòng chuyển sang dùng“Suy diễn nội dung chính mới nhất”Đồng bộ');
    }

    if (mode === 'keep') {
        runtime.editDecision = null;
        setSyncStatus({
            phase: 'success',
            message: 'Đã giữ lại kết quả suy diễn thế giới trước khi chỉnh sửa',
            error: '',
        });
        runtime.ui?.render();
        toast('Đã giữ lại suy diễn gốc, phù hợp cho trường hợp chỉ sửa lỗi chính tả, dấu câu hoặc cách dùng từ.', 'success');
        return;
    }

    if (!getSettings().worldSimulationEnabled) {
        throw new Error('Mô-đun suy diễn thế giới hiện đã ngừng hoạt động, không thể suy diễn lại theo nội dung chính đã sửa đổi');
    }
    runtime.editDecision = null;
    markSnapshotsStaleFrom(decision.messageId);
    const store = getStore();
    const previous = findLatestResultSnapshot(decision.messageId);
    store.currentState = markPendingSync(
        previous ? stateWithBranchOverride(previous.snapshot, store) : clone(store.initialState),
        true,
    );
    saveStore(store);
    refreshInjection();
    runtime.ui?.render();
    await queueSimulation(decision.messageId, {
        force: true,
        trigger: 'edited-reply',
        newAssistantCount: 1,
    });
    toast('Đã hoàn thành lại suy diễn thế giới theo nội dung chính đã sửa đổi.', 'success');
}

function onMessageDeleted() {
    restoreLatestBranch();
}

function onChatChanged() {
    runtime.activePublicOpinion?.controller?.abort?.();
    runtime.activePublicOpinionSandbox?.controller?.abort?.();
    runtime.activeObservation?.controller?.abort?.();
    runtime.activeHistoryScan?.abort?.();
    runtime.activePublicOpinion = null;
    runtime.activePublicOpinionSandbox = null;
    runtime.activeObservation = null;
    runtime.pendingPublicOpinion = false;
    runtime.lastTaskConnection = null;
    resetLastCustomApiOperation();
    runtime.ui?.ensureMounted?.();
    installSettingsEntry();
    if (runtime.autoMemoryTimer !== null) {
        window.clearTimeout(runtime.autoMemoryTimer);
        runtime.autoMemoryTimer = null;
    }
    if (runtime.manualUndoTimer !== null) {
        window.clearTimeout(runtime.manualUndoTimer);
        runtime.manualUndoTimer = null;
    }
    runtime.manualUndo = null;
    runtime.editDecision = null;
    runtime.activeChatToken = currentChatToken();
    runtime.historyProgress = {
        phase: 'idle',
        processed: 0,
        total: getContext()?.chat?.length || 0,
        message: '',
    };
    runtime.publicOpinionStatus = {
        phase: 'idle',
        message: 'Chưa tạo bản ghi nhanh dư luận',
        error: '',
    };
    runtime.syncStatus = {
        phase: 'idle',
        message: 'Đang đọc trạng thái suy diễn của cuộc trò chuyện hiện tại',
        error: '',
        attemptedAt: '',
        succeededAt: '',
        method: '',
    };
    window.setTimeout(() => {
        runtime.activeChatToken = currentChatToken();
        restoreLatestBranch();
        syncSettingsEntry();
        schedulePendingCatchUp();
    }, 80);
}

function armManualUndo(previousState, {
    key = currentAnchorKey(),
    label = 'Hoàn tác thay đổi thủ công vừa rồi',
    previousInitialState = null,
} = {}) {
    if (runtime.manualUndoTimer !== null) window.clearTimeout(runtime.manualUndoTimer);
    runtime.manualUndo = {
        state: clone(previousState),
        previousInitialState: previousInitialState ? clone(previousInitialState) : null,
        key,
        label,
        chatToken: currentChatToken(),
        expiresAt: Date.now() + 9000,
    };
    runtime.manualUndoTimer = window.setTimeout(() => {
        runtime.manualUndo = null;
        runtime.manualUndoTimer = null;
        runtime.ui?.render();
    }, 9000);
    runtime.ui?.render();
}

function undoManualChange() {
    const undo = runtime.manualUndo;
    if (
        !undo
        || undo.expiresAt <= Date.now()
        || undo.chatToken !== currentChatToken()
        || undo.key !== currentAnchorKey()
    ) {
        throw new Error('Thời gian có thể hoàn tác đã kết thúc, hoặc nhánh nội dung chính đã thay đổi');
    }
    if (runtime.manualUndoTimer !== null) window.clearTimeout(runtime.manualUndoTimer);
    runtime.manualUndo = null;
    runtime.manualUndoTimer = null;

    const store = getStore();
    store.currentState = trimState(undo.state);
    if (undo.previousInitialState) store.initialState = trimState(undo.previousInitialState);
    store.branchOverrides[undo.key] = createBranchSnapshot(store.currentState, {
        sourceKey: undo.key,
        kind: 'manual-undo',
    });
    saveStore(store, { immediate: true });
    refreshInjection();
    runtime.ui?.render();
    toast('Thay đổi thủ công vừa rồi đã được hoàn tác.', 'success');
}

function commitManualState(nextState, message = 'Trạng thái thế giới đã cập nhật') {
    const key = currentAnchorKey();
    const previousState = getState();
    const committed = setCurrentState(nextState, { overrideKey: key });
    armManualUndo(previousState, { key });
    scheduleAutoPublicOpinion(committed);
    toast(message, 'success');
}

function createManualRecoveryPoint() {
    const store = addRecoveryPoint(getStore(), {
        reason: 'manual',
        label: 'Điểm khôi phục được tạo thủ công',
    });
    saveStore(store, { immediate: true });
    runtime.ui?.render();
    toast('Điểm khôi phục đã được lưu~ Cứ yên tâm tiếp tục vọc vạch nhé `(｡•̀ᴗ-)✧`', 'success');
    return listRecoveryPoints(store).at(-1) || null;
}

function restoreLatestSavedRecovery() {
    const currentStore = getStore();
    const target = listRecoveryPoints(currentStore).at(-1);
    if (!target) throw new Error('Cuộc trò chuyện hiện tại chưa có điểm lưu nào có thể khôi phục');
    const confirmed = globalThis.confirm?.(
        `(・_・;)  Khôi phục thế giới hiện tại về:${target.label}\n${target.createdAt}\n\n Trước khi khôi phục cũng sẽ tự động lưu trạng thái hiện tại.`,
    );
    if (confirmed === false) return null;

    let store = addRecoveryPoint(currentStore, {
        reason: 'before-restore',
        label: 'Tự động lưu trước thao tác khôi phục',
    });
    const restored = restoreRecoveryPoint(store, target.id);
    if (!restored.point) throw new Error('Điểm khôi phục đã hết hiệu lực, vui lòng mở lại cài đặt rồi thử lại');
    store = restored.store;
    const key = currentAnchorKey();
    store.branchOverrides ||= {};
    store.branchOverrides[key] = createBranchSnapshot(store.currentState, {
        sourceKey: key,
        kind: 'recovery-restore',
    });
    saveStore(store, { immediate: true });
    refreshInjection();
    runtime.ui?.render();
    toast('Thế giới đã được khôi phục về điểm lưu, có thể tiếp tục rồi.', 'success');
    return restored.point;
}

function redactDiagnosticText(value) {
    let text = String(value || '');
    const settings = getSettings();
    const keys = [
        String(settings.customApiKey || ''),
        ...(settings.apiProfiles || []).map(profile => String(profile.key || '')),
    ].filter(key => key.length >= 4);
    for (const key of keys) text = text.split(key).join('[API Key Đã ẩn]');
    return text
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [Đã ẩn]')
        .replace(/https?:\/\/[^\s"'<>]+/gi, '[Địa chỉ API đã ẩn]')
        .replace(/(api[-_ ]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[Đã ẩn]')
        .slice(0, 600);
}

function classifyDiagnosticIssue(value) {
    const text = String(value || '').toLocaleLowerCase();
    if (!text) return 'none';
    if (/abort|cancel|Hủy|Dừng/.test(text)) return 'cancelled';
    if (/401|403|unauthorized|forbidden|Xác thực|Khóa bí mật|api.?key/.test(text)) return 'authorization';
    if (/insufficient[_\s-]*quota|quota\s*(?:exceeded|exhausted|depleted)|credits?\s*(?:exhausted|depleted)|Hạn mức(?:Không đủ|Cạn kiệt)|Số dư không đủ/.test(text)) return 'quota-exhausted';
    if (/429|too many requests|rate[_\s-]*limit|Yêu cầu quá thường xuyên|Giới hạn tần suất|Giới hạn lưu lượng/.test(text)) return 'rate-limit';
    if (/timeout|timed out|Hết thời gian/.test(text)) return 'timeout';
    if (/network|fetch|connection|econn|Mạng|Kết nối/.test(text)) return 'network';
    if (/no message|empty|Phản hồi trống|Không tạo ra|Chưa tạo/.test(text)) return 'empty-response';
    if (/length|max[_\s-]*tokens?|token[_\s-]*limit|Giới hạn đầu ra|Giới hạn độ dài|Quá dài/.test(text)) return 'output-limit';
    if (/json|Phân tích cú pháp|parse|Định dạng/.test(text)) return 'invalid-json';
    return 'other';
}

function buildDiagnosticReport() {
    const context = getContext();
    const settings = getSettings();
    const state = getState();
    const store = getStore();
    const connection = getConnectionInfo();
    const recoveryPoints = listRecoveryPoints(store);
    const activeEvents = state.events.filter(event => ['active', 'waiting', 'ready'].includes(event.status));
    const viewport = globalThis.visualViewport;
    const report = {
        plugin: {
            name: 'World Backstage',
            version: PLUGIN_VERSION,
            stateSchema: SCHEMA_VERSION,
        },
        sillyTavern: {
            version: String(
                context?.version
                || globalThis.SillyTavern?.version
                || document.querySelector?.('#version_display')?.textContent
                || 'Chưa nhận diện',
            ).trim().slice(0, 120),
        },
        device: {
            userAgent: String(globalThis.navigator?.userAgent || 'Chưa nhận diện').slice(0, 240),
            viewport: `${Math.round(Number(viewport?.width || globalThis.innerWidth || 0))}x${Math.round(Number(viewport?.height || globalThis.innerHeight || 0))}`,
            touchPoints: Number(globalThis.navigator?.maxTouchPoints || 0),
        },
        connection: {
            mode: settings.apiMode,
            api: connection.apiLabel,
            source: connection.source,
            model: redactDiagnosticText(connection.model),
            transport: settings.apiMode === 'custom' ? settings.customApiTransport : 'tavern',
            configured: connection.configured,
            method: connection.method,
            internalCompatChars: Number(runtime.lastPromptBridge?.internalCompatChars
                ?? String(INTERNAL_COMPAT_SYSTEM_PROMPT || '').trim().length),
        },
        features: {
            worldSimulation: settings.worldSimulationEnabled,
            worldAuto: settings.worldAutoEnabled,
            worldContinuityInjection: settings.worldSimulationEnabled,
            worldRevealInjection: settings.worldPromptInjection,
            memorySystem: settings.memorySystemEnabled,
            memoryInjection: settings.memoryPromptInjection,
            simulationMode: settings.autoSimulationMode,
            simulationInterval: settings.autoSimulationInterval,
            retryCount: settings.autoRetryCount,
            contextTurns: settings.contextTurns,
            npcBudget: settings.backgroundNpcBudget,
            uiScale: settings.uiScale,
            publicOpinionAuto: settings.publicOpinionAutoEnabled,
            publicOpinionRevealMode: settings.publicOpinionRevealMode,
            apiProfileCount: settings.apiProfiles?.length || 0,
            apiModuleRoutes: { ...(settings.apiModuleRoutes || {}) },
        },
        state: {
            revision: state.revision,
            worldMinute: state.clock?.absoluteMinute,
            pendingSync: state.pendingSync,
            people: state.people.length,
            events: state.events.length,
            activeEvents: activeEvents.length,
            echoes: state.echoes.length,
            archive: state.archive.length,
            memoryFacts: state.storyMemory?.facts?.length || 0,
            memorySummaries: state.storyMemory?.summaries?.length || 0,
            memoryClues: state.storyMemory?.clues?.length || 0,
            worldFacts: state.worldFacts?.length || 0,
            consistencyConflicts: state.consistencyConflicts?.length || 0,
            needsReconciliation: Boolean(state.needsReconciliation),
            indexedThroughMessageId: state.storyMemory?.indexedThroughMessageId ?? -1,
            chatMessages: context?.chat?.length || 0,
            recoveryPoints: recoveryPoints.length,
            latestSnapshot: Boolean(findLatestResultSnapshot()),
        },
        lastWorldTask: {
            phase: runtime.syncStatus.phase,
            messageType: classifyDiagnosticIssue(runtime.syncStatus.message),
            errorType: classifyDiagnosticIssue(runtime.syncStatus.error),
            attemptedAt: runtime.syncStatus.attemptedAt,
            succeededAt: runtime.syncStatus.succeededAt,
            method: runtime.syncStatus.method,
            route: runtime.lastTaskConnection?.apiLabel || '',
            model: redactDiagnosticText(runtime.lastTaskConnection?.model || ''),
            taskKind: runtime.lastTaskConnection?.taskKind || '',
            memoryPhase: runtime.historyProgress.phase,
            memoryMessageType: classifyDiagnosticIssue(runtime.historyProgress.message),
        },
        lastApiOperation: (() => {
            const operation = getLastCustomApiOperation();
            if (!operation) return null;
            return {
                phase: operation.phase,
                operation: operation.operation,
                source: operation.source,
                route: redactDiagnosticText(operation.route || ''),
                model: redactDiagnosticText(operation.model || ''),
                transport: operation.transport,
                transportStatus: operation.transportStatus,
                upstreamStatus: operation.upstreamStatus,
                errorType: operation.errorType,
                errorSummary: redactDiagnosticText(operation.errorSummary || ''),
                attemptedAt: operation.attemptedAt,
                succeededAt: operation.succeededAt,
                failedAt: operation.failedAt,
            };
        })(),
        privacy: 'Không bao gồm API Key、Địa chỉ API, nội dung trò chuyện, điểm neo thân phận nhân vật hoặc từ nhắc tùy chỉnh.',
        generatedAt: new Date().toISOString(),
    };
    return `Thông tin chẩn đoán mặt trái thế giới (có thể chia sẻ an toàn)\n${JSON.stringify(report, null, 2)}`;
}

async function copyDiagnosticReport() {
    const report = buildDiagnosticReport();
    try {
        if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') {
            throw new Error('Clipboard API unavailable');
        }
        await globalThis.navigator.clipboard.writeText(report);
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = report;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand?.('copy');
        textarea.remove();
        if (!copied) throw new Error('Trình duyệt không cho phép sao chép, vui lòng kiểm tra quyền khay nhớ tạm');
    }
    toast('Đã sao chép thông tin chẩn đoán, nội dung nhạy cảm không được đưa vào.', 'success');
    return report;
}

function exportState() {
    const payload = {
        format: 'world-backstage-state',
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        state: getState(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeWorldName = String(getState().world.name || 'Thế giới')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .slice(0, 60);
    link.href = url;
    link.download = `Mặt trái thế giới_${safeWorldName}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('Trạng thái thế giới hiện tại đã được xuất.', 'success');
}

function importState(text) {
    const parsed = JSON.parse(String(text || ''));
    const imported = trimState(parsed?.state || parsed);
    const confirmed = globalThis.confirm?.(
        `(・_・;)  Nhập sẽ thay thế trạng thái thế giới hiện tại của cuộc trò chuyện này.\n\n Nhập:${imported.world.name}`,
    );
    if (confirmed === false) return;

    let store = addRecoveryPoint(getStore(), {
        reason: 'before-import',
        label: 'Tự động lưu trước khi nhập trạng thái thế giới',
    });
    const previousState = clone(store.currentState);
    const previousInitialState = clone(store.initialState);
    const key = currentAnchorKey();
    store.currentState = imported;
    if (!findLatestResultSnapshot()) store.initialState = clone(imported);
    store.branchOverrides[key] = createBranchSnapshot(imported, {
        sourceKey: key,
        kind: 'import',
    });
    saveStore(store, { immediate: true });
    refreshInjection();
    runtime.ui?.render();
    armManualUndo(previousState, {
        key,
        label: 'Hoàn tác nhập trạng thái',
        previousInitialState,
    });
    toast('Trạng thái thế giới đã được chuyển vào~ Mọi thứ đều ở đúng vị trí.', 'success');
}

function saveApiProfile(payload = {}) {
    const context = getContext();
    const settings = getSettings();
    const id = String(payload.id || '').trim() || makeApiProfileId();
    const existing = settings.apiProfiles.find(item => item.id === id);
    const name = String(payload.name || existing?.name || 'Độc lập của tôi API').trim().slice(0, 80) || 'Độc lập của tôi API';
    const url = String(payload.url || payload.customApiUrl || existing?.url || '').trim().slice(0, 500);
    const replacementKey = String(payload.key || payload.customApiKey || '').trim();
    const key = (replacementKey || existing?.key || '').slice(0, 1000);
    const model = String(payload.model || payload.customApiModel || existing?.model || '').trim().slice(0, 180);
    const transportValue = payload.transport || payload.customApiTransport || existing?.transport || 'proxy';
    const transport = ['proxy', 'direct'].includes(transportValue) ? transportValue : 'proxy';
    if (!url) throw new Error('Hãy điền địa chỉ API trước nhé~');
    if (!key) throw new Error('Phương án này vẫn thiếu API Key Ồ');
    if (!model) throw new Error('Vẫn chưa chọn mô hình mà~');
    const profile = { id, name, url, key, model, transport };
    const next = settings.apiProfiles.filter(item => item.id !== id);
    next.push(profile);
    settings.apiProfiles = normalizeApiProfiles(next);
    settings.apiModuleRoutes = normalizeApiModuleRoutes(settings.apiModuleRoutes, settings.apiProfiles);
    context.extensionSettings[MODULE_ID] = settings;
    saveSettings();
    runtime.ui?.render();
    toast(`“${name}”Đã ngoan ngoãn lưu lại rồi nhé~`, 'success');
    return { ...profile, key: '' };
}

function deleteApiProfile(profileId) {
    const context = getContext();
    const settings = getSettings();
    const id = String(profileId || '').trim();
    const existing = settings.apiProfiles.find(item => item.id === id);
    if (!existing) throw new Error('Không tìm thấy cái này API Phương án');
    settings.apiProfiles = settings.apiProfiles.filter(item => item.id !== id);
    settings.apiModuleRoutes = normalizeApiModuleRoutes(settings.apiModuleRoutes, settings.apiProfiles);
    context.extensionSettings[MODULE_ID] = settings;
    saveSettings();
    runtime.ui?.render();
    toast(`“${existing.name}”Đã xóa rồi~`, 'success');
    return true;
}

function duplicateApiProfile(profileId) {
    const settings = getSettings();
    const existing = settings.apiProfiles.find(item => item.id === String(profileId || ''));
    if (!existing) throw new Error('Không tìm thấy cái này API Phương án');
    return saveApiProfile({
        ...existing,
        id: '',
        name: `${existing.name} · Bản sao`.slice(0, 80),
    });
}

function profileRequestSettings(profileId) {
    const settings = getSettings();
    const profile = settings.apiProfiles.find(item => item.id === String(profileId || ''));
    if (!profile) throw new Error('Không tìm thấy cái này API Phương án');
    return { settings, profile, requestSettings: settingsForApiProfile(settings, profile) };
}

async function testApiProfileConnection(profileId) {
    const { profile, requestSettings } = profileRequestSettings(profileId);
    const context = getContext();
    setBusy(true);
    try {
        const reply = await requestCustomCompletion(requestSettings, buildBackstageMessages('Đây là bài kiểm tra kết nối. Vui lòng chỉ trả lời: Kết nối thành công'), {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            maxTokens: 80,
            temperature: 0,
            operation: 'connection-test',
            routeLabel: profile.name || 'Phương án đã lưu',
        });
        if (!String(reply || '').trim()) throw new Error('API không trả về nội dung');
        toast(`“${profile.name}”Kết nối thành công rồi~`, 'success');
        return true;
    } finally {
        setBusy(false);
    }
}

async function pullApiProfileModels(profileId) {
    const { profile, requestSettings } = profileRequestSettings(profileId);
    runtime.modelPullStatus = { phase: 'running', message: `Đang đọc“${profile.name}” danh sách mô hình` };
    runtime.ui?.render();
    try {
        const context = getContext();
        const models = await requestCustomModels(requestSettings, {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            routeLabel: profile.name || 'Phương án đã lưu',
        });
        runtime.customModels = models;
        runtime.modelPullStatus = {
            phase: 'success',
            message: `Tìm thấy  ${models.length}  mô hình rồi~ vẫn có thể điền thủ công nhé`,
        };
        return models;
    } catch (error) {
        runtime.modelPullStatus = { phase: 'error', message: describeError(error) };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

function settingsFromApiDraft(payload = {}, { requireModel = true } = {}) {
    const base = getSettings();
    const url = String(payload.url || payload.customApiUrl || '').trim().slice(0, 500);
    const key = String(payload.key || payload.customApiKey || '').trim().slice(0, 1000);
    const model = String(payload.model || payload.customApiModel || '').trim().slice(0, 180);
    const transport = ['proxy', 'direct'].includes(payload.transport || payload.customApiTransport)
        ? (payload.transport || payload.customApiTransport)
        : 'proxy';
    if (!url) throw new Error('Vẫn chưa điền địa chỉ API đâu~');
    if (!key) throw new Error('Vẫn thiếu  API Key  đó~');
    if (requireModel && !model) throw new Error('Vẫn chưa chọn mô hình mà~');
    return {
        ...base,
        apiMode: 'custom',
        customApiUrl: url,
        customApiKey: key,
        customApiModel: model,
        customApiTransport: transport,
    };
}

async function testApiDraftConnection(payload = {}) {
    const requestSettings = settingsFromApiDraft(payload, { requireModel: true });
    const context = getContext();
    setBusy(true);
    try {
        const reply = await requestCustomCompletion(requestSettings, buildBackstageMessages('Đây là bài kiểm tra kết nối. Vui lòng chỉ trả lời: Kết nối thành công'), {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            maxTokens: 80,
            temperature: 0,
            operation: 'connection-test',
            routeLabel: String(payload.label || 'Giao diện độc lập tạm thời').slice(0, 80),
        });
        if (!String(reply || '').trim()) throw new Error('API không trả về nội dung');
        toast(`${String(payload.label || 'Giao diện này').slice(0, 80)}Kết nối thành công rồi~`, 'success');
        return true;
    } finally {
        setBusy(false);
    }
}

async function pullApiDraftModels(payload = {}) {
    const requestSettings = settingsFromApiDraft(payload, { requireModel: false });
    const label = String(payload.label || 'Giao diện này').slice(0, 80);
    runtime.modelPullStatus = { phase: 'running', message: `Đang tìm ${label} danh sách mô hình~` };
    runtime.ui?.render();
    try {
        const context = getContext();
        const models = await requestCustomModels(requestSettings, {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            routeLabel: label,
        });
        runtime.customModels = models;
        runtime.modelPullStatus = {
            phase: 'success',
            message: `Tìm thấy  ${models.length}  mô hình rồi~ sẽ không thay đổi giao diện mặc định`,
        };
        toast(`Tìm thấy  ${models.length}  mô hình khả dụng rồi~`, 'success');
        return models;
    } catch (error) {
        runtime.modelPullStatus = { phase: 'error', message: describeError(error) };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

async function testCustomApiConnection() {
    const settings = getSettings();
    if (settings.apiMode !== 'custom') {
        throw new Error('Vui lòng chuyển kết nối suy diễn thế giới thành “Giao diện độc lập”');
    }
    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: 'Đang chọc thử giao diện độc lập  API， xem nó có tỉnh không~',
        error: '',
        attemptedAt: new Date().toISOString(),
    });
    try {
        const context = getContext();
        runtime.syncStatus.method = settings.customApiTransport === 'direct'
            ? 'Giao diện độc lập mặc định · Trình duyệt kết nối trực tiếp'
            : 'Giao diện độc lập mặc định · Tavern chuyển tiếp';
        const reply = await requestCustomCompletion(
            settings,
            buildBackstageMessages('Đây là bài kiểm tra kết nối. Vui lòng chỉ trả lời: Kết nối thành công'),
            {
                fetchImpl: globalThis.fetch.bind(globalThis),
                getRequestHeaders: () => context?.getRequestHeaders?.() || {},
                maxTokens: 80,
                temperature: 0,
                operation: 'connection-test',
                routeLabel: 'Giao diện độc lập mặc định',
            },
        );
        if (!String(reply || '').trim()) throw new Error('API không trả về nội dung');
        setSyncStatus({
            phase: 'success',
            message: 'Độc lập API Kết nối thành công rồi~',
            error: '',
            succeededAt: new Date().toISOString(),
            method: runtime.syncStatus.method,
        });
        toast('Độc lập API Thông rồi~ có thể bắt đầu làm việc `(•̀ᴗ•́)و`', 'success');
        return true;
    } catch (error) {
        const errorMessage = describeError(error);
        setSyncStatus({
            phase: 'error',
            message: 'Độc lập API Không kết nối được QAQ',
            error: errorMessage,
            method: runtime.syncStatus.method,
        });
        throw error;
    } finally {
        setBusy(false);
    }
}

async function pullCustomApiModels() {
    const settings = getSettings();
    if (settings.apiMode !== 'custom') {
        throw new Error('Vui lòng chuyển kết nối suy diễn thế giới thành “Giao diện độc lập”');
    }
    runtime.modelPullStatus = { phase: 'running', message: 'Đang tìm danh sách mô hình~' };
    runtime.ui?.render();
    try {
        const context = getContext();
        const models = await requestCustomModels(settings, {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            routeLabel: 'Giao diện độc lập mặc định',
        });
        runtime.customModels = models;
        runtime.modelPullStatus = {
            phase: 'success',
            message: `Tìm thấy  ${models.length}  mô hình rồi~ vẫn có thể điền thủ công`,
        };
        toast(`Tìm thấy  ${models.length}  mô hình khả dụng rồi~`, 'success');
        return models;
    } catch (error) {
        runtime.modelPullStatus = {
            phase: 'error',
            message: describeError(error),
        };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

async function runOneMemoryRollup(state, controller) {
    const plan = planMemoryRollup(state);
    if (!plan) return { state, rolledUp: false };
    if (controller?.signal?.aborted) {
        const error = new Error('Sắp xếp ký ức đã dừng');
        error.name = 'AbortError';
        throw error;
    }
    runtime.historyProgress = {
        ...runtime.historyProgress,
        phase: 'running',
        message: `Đang đem  ${plan.sourceSummaryIds.length}  mục  L${plan.sourceLevel}  ký ức nén thành  L${plan.targetLevel}～`,
    };
    runtime.ui?.render();
    const payload = await runWithRetries(async attempt => {
        const prompt = buildMemoryRollupPrompt(state, plan, { compact: attempt > 0 });
        const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
            maxTokens: retryTokenBudget(2400, attempt),
            temperature: attempt > 0 ? 0.03 : 0.08,
            signal: controller?.signal,
            taskKind: 'history',
        });
        const parsed = extractJsonObject(raw);
        if (parsed) return parsed;
        throw unreadableJsonError(raw, 'Mô hình nén ký ức');
    }, {
        retries: getSettings().autoRetryCount,
        shouldRetry: error => !(
            /Vui lòng điền độc lập trước API|HTTP 40[0134]|Không cung cấp giao diện tạo im lặng/
                .test(describeError(error))
        ),
        onRetry: ({ attempt, total }) => {
            runtime.historyProgress.message = `Nén ký ức chưa hoàn tất, đang thử lại với định dạng nhỏ gọn hơn ${attempt}/${total}`;
            runtime.ui?.render();
        },
        signal: controller?.signal,
    });
    if (controller?.signal?.aborted) {
        const error = new Error('Sắp xếp ký ức đã dừng');
        error.name = 'AbortError';
        throw error;
    }
    return {
        state: applyMemoryRollupResult(state, payload, plan),
        rolledUp: true,
    };
}

async function scanStoryMemoryHistory({
    automatic = false,
    maximumBatches = Number.POSITIVE_INFINITY,
} = {}) {
    if (!getSettings().memorySystemEnabled) {
        if (automatic) return false;
        throw new Error('Hệ thống ký ức hiện đã bị vô hiệu hóa');
    }
    if (runtime.historyProgress.phase === 'running') {
        if (automatic) return false;
        throw new Error('Việc lưu trữ lịch sử đang được tiến hành');
    }
    const context = getContext();
    const chatToken = currentChatToken();
    const chatLength = context?.chat?.length || 0;
    if (!chatLength) throw new Error('Cuộc trò chuyện hiện tại chưa có nội dung chính nào có thể quét');

    let state = getState();
    let cursor = Math.max(0, Number(state.storyMemory?.indexedThroughMessageId ?? -1) + 1);
    const initialRollupPlan = planMemoryRollup(state);
    if (cursor >= chatLength && !initialRollupPlan) {
        if (!automatic) toast('Hồ sơ lịch sử đã theo kịp đến tầng mới nhất rồi~', 'info');
        return true;
    }
    if (!automatic && cursor < chatLength) {
        const confirmed = globalThis.confirm?.(
            `( •ᴗ• )  Sẽ bắt đầu từ tầng thứ  ${cursor}  đọc theo đợt nhánh hiện tại, tổng cộng khoảng  ${chatLength - cursor}  tin nhắn.\n`
            + 'Điều này sẽ tạo ra thêm  API  lần gọi, nhưng sau mỗi đợt thành công sẽ lập tức lưu tiến độ. Có tiếp tục không?',
        );
        if (confirmed === false) return false;
        const protectedStore = addRecoveryPoint(getStore(), {
            reason: 'before-memory-maintenance',
            label: 'Tự động lưu trước khi sắp xếp ký ức thủ công',
        });
        saveStore(protectedStore, { immediate: true });
    }

    runtime.historyProgress = {
        phase: 'running',
        processed: cursor,
        total: chatLength,
        message: cursor < chatLength
            ? (automatic ? 'Đang âm thầm sắp xếp ký ức mới thêm~' : 'Đang lưu trữ hồ sơ lịch sử~')
            : 'Nội dung chính đã theo kịp rồi~ tiện tay nén thêm một tầng trải nghiệm cũ',
    };
    const controller = new AbortController();
    runtime.activeHistoryScan = controller;
    setBusy(true);
    runtime.ui?.render();

    try {
        let completedBatches = 0;
        let assistantBatchLimit = automatic
            ? Math.min(6, Math.max(1, getSettings().memoryAutoIndexInterval))
            : 6;
        const batchLimit = Number.isFinite(Number(maximumBatches))
            ? Math.max(1, Number.parseInt(maximumBatches, 10) || 1)
            : Number.POSITIVE_INFINITY;
        while (cursor < chatLength && completedBatches < batchLimit) {
            if (!getSettings().memorySystemEnabled || controller.signal.aborted) {
                const error = new Error('Hệ thống ký ức đã đóng, lần sắp xếp này đã dừng');
                error.name = 'AbortError';
                throw error;
            }
            if (currentChatToken() !== chatToken) {
                throw new Error('Đã chuyển đổi cuộc trò chuyện trong lúc quét, lần này đã dừng ở đợt hoàn thành trước đó');
            }
            const batch = nextHistoryBatch(cursor, {
                maximumAssistantTurns: assistantBatchLimit,
            });
            if (!batch.messages.length) {
                cursor = batch.nextCursor;
                continue;
            }
            runtime.historyProgress = {
                phase: 'running',
                processed: batch.startMessageId,
                total: chatLength,
                message: `Đang dọn dẹp tin nhắn ${batch.startMessageId}—${batch.endMessageId}～`,
            };
            runtime.ui?.render();

            let payload;
            try {
                payload = await runWithRetries(async attempt => {
                    const prompt = buildHistoryIndexPrompt(state, {
                        messages: batch.messages,
                        userName: context?.name1 || '',
                        playerIdentityAnchor: getPlayerIdentityAnchor(state),
                        compact: attempt > 0,
                    });
                    const historyBaseTokens = getSettings().maxOutputTokens > 0
                        ? Math.max(3200, getSettings().maxOutputTokens)
                        : 3200;
                    const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                        maxTokens: retryTokenBudget(historyBaseTokens, attempt),
                        temperature: attempt > 0 ? 0.05 : 0.1,
                        signal: controller.signal,
                        taskKind: 'history',
                    });
                    const parsed = extractJsonObject(raw);
                    if (parsed) {
                        const assistantIds = batch.messages
                            .filter(message => message.role === 'assistant')
                            .map(message => Number(message.id));
                        const summarizedIds = new Set(
                            (Array.isArray(parsed.turn_summaries) ? parsed.turn_summaries : parsed.turnSummaries || [])
                                .map(item => Number(item?.source_message_id ?? item?.sourceMessageId ?? item?.message_id ?? item?.messageId))
                                .filter(Number.isFinite),
                        );
                        const missingIds = assistantIds.filter(id => !summarizedIds.has(id));
                        const fallbackSummary = parsed?.chapter_summary ?? parsed?.chapterSummary;
                        if (missingIds.length && !(assistantIds.length === 1 && fallbackSummary?.summary)) {
                            const error = new Error(`L0 Thiếu tóm tắt: Tin nhắn ${missingIds.join(', ')}`);
                            error.code = 'MEMORY_L0_MISSING';
                            throw error;
                        }
                        return parsed;
                    }
                    throw unreadableJsonError(raw, 'Mô hình sắp xếp ký ức');
                }, {
                    retries: getSettings().autoRetryCount,
                    shouldRetry: error => !(
                        /Vui lòng điền độc lập trước API|HTTP 40[0134]|Không cung cấp giao diện tạo im lặng/
                            .test(describeError(error))
                    ),
                    onRetry: ({ attempt, total }) => {
                        runtime.historyProgress.message = `Sắp xếp ký ức thất bại, đang thử lại bằng định dạng nhỏ gọn ${attempt}/${total}`;
                        runtime.ui?.render();
                    },
                    signal: controller.signal,
                });
            } catch (error) {
                const assistantTurns = batch.messages.filter(message => message.role === 'assistant').length;
                const canSplit = assistantTurns > 1 && (
                    /JSON|L0 Thiếu tóm tắt|Cắt bớt|Giới hạn độ dài|No message generated|Không trả về nội dung chính cuối cùng|Không có nội dung chính cuối cùng có thể đọc/i
                        .test(describeError(error))
                );
                if (canSplit) {
                    assistantBatchLimit = Math.max(1, Math.floor(assistantTurns / 2));
                    runtime.historyProgress.message = `Đầu ra quá dài hoặc trống, đã tự động thu nhỏ thành mỗi lô ${assistantBatchLimit} vòng sau thử lại`;
                    runtime.ui?.render();
                    continue;
                }
                throw error;
            }
            if (!getSettings().memorySystemEnabled || controller.signal.aborted) {
                const error = new Error('Hệ thống ký ức đã đóng, lần sắp xếp này đã dừng');
                error.name = 'AbortError';
                throw error;
            }
            state = applyHistoryIndexResult(state, payload, {
                startMessageId: batch.startMessageId,
                endMessageId: batch.endMessageId,
            });
            cursor = batch.nextCursor;
            completedBatches += 1;

            const store = getStore();
            store.currentState = state;
            store.branchOverrides[currentAnchorKey()] = createBranchSnapshot(state, {
                sourceKey: currentAnchorKey(),
                kind: 'history-index',
            });
            saveStore(store);
            runtime.historyProgress.processed = Math.min(chatLength, cursor);
            refreshInjection();
            runtime.ui?.render();
        }

        let rolledUp = false;
        const rollup = await runOneMemoryRollup(state, controller);
        state = rollup.state;
        rolledUp = rollup.rolledUp;
        if (rolledUp) {
            const store = getStore();
            store.currentState = state;
            store.branchOverrides[currentAnchorKey()] = createBranchSnapshot(state, {
                sourceKey: currentAnchorKey(),
                kind: 'memory-rollup',
            });
            saveStore(store, { immediate: true });
            refreshInjection();
            runtime.ui?.render();
        }

        const caughtUp = cursor >= chatLength;
        if (caughtUp) {
            state.storyMemory.indexedThroughMessageId = Math.max(
                state.storyMemory.indexedThroughMessageId,
                chatLength - 1,
            );
        }
        const store = getStore();
        store.currentState = trimState(state);
        saveStore(store, { immediate: true });
        runtime.historyProgress = {
            phase: 'success',
            processed: Math.min(chatLength, cursor),
            total: chatLength,
            message: caughtUp
                ? (rolledUp
                    ? 'Ký ức nội dung chính đã bắt kịp, trải nghiệm tầng trên cũng tiện tay sắp xếp xong một tầng~'
                    : (automatic ? 'Ký ức mới thêm đã tự động sắp xếp' : 'Hồ sơ lịch sử của nhánh hiện tại đã được thiết lập'))
                : `Đã sắp xếp đến tin nhắn ${state.storyMemory.indexedThroughMessageId}`,
        };
        refreshInjection();
        runtime.ui?.render();
        if (!automatic) {
            toast(
                `Thiết lập hồ sơ ký ức hoàn tất:${state.storyMemory.facts.length} mục sự thật dài hạn,`
                + `${state.storyMemory.clues.length} mục phục bút,`
                + `${state.storyMemory.summaries.length} đoạn trải nghiệm phân tầng.`,
                'success',
            );
        } else {
            scheduleAutoMemoryIndex();
        }
        return true;
    } catch (error) {
        if (error?.name === 'AbortError') {
            runtime.historyProgress = {
                ...runtime.historyProgress,
                phase: 'idle',
                message: 'Sắp xếp ký ức đã dừng, chưa gửi lô đang tạo',
            };
            runtime.ui?.render();
            return false;
        }
        runtime.historyProgress = {
            ...runtime.historyProgress,
            phase: 'error',
            message: describeError(error),
        };
        runtime.ui?.render();
        throw error;
    } finally {
        if (runtime.activeHistoryScan === controller) runtime.activeHistoryScan = null;
        setBusy(false);
    }
}

function personObservationCacheKey(state, person) {
    const latest = latestAssistantEntry();
    const source = latest
        ? branchSourceKey(latest.index, latest.message)
        : 'no-assistant';
    const stateFingerprint = hashText(JSON.stringify({
        clock: state.clock.absoluteMinute,
        world: state.world,
        person: {
            id: person.id,
            location: person.location,
            action: person.action,
            intent: person.intent,
            goal: person.longTermGoal,
            updatedAt: person.updatedAt,
        },
    }));
    return `${person.id}:${source}:${stateFingerprint}`;
}

function cachedPersonObservation(personId) {
    const state = getState();
    const person = state.people.find(item => item.id === personId);
    if (!person) return null;
    const cached = getStore().personObservations?.[personObservationCacheKey(state, person)];
    if (!cached) return null;
    const queuedEvent = cached.queuedEventId
        ? state.events.find(event => event.id === cached.queuedEventId)
        : null;
    const revealState = queuedEvent?.delivery?.state === 'delivered'
        ? 'delivered'
        : queuedEvent?.delivery?.state === 'expired'
            ? 'expired'
            : (
                queuedEvent
                && (cached.revealEnabled ?? (
                    queuedEvent.delivery?.manualQueued
                    || queuedEvent.delivery?.state === 'pending'
                ))
            )
                ? 'enabled'
                : 'off';
    return {
        ...cached,
        queued: revealState === 'enabled',
        revealState,
    };
}

function queuePersonObservation(personId) {
    const state = getState();
    const person = state.people.find(item => item.id === personId);
    if (!person) throw new Error('Không tìm thấy nhân vật này');
    const cacheKey = personObservationCacheKey(state, person);
    const store = getStore();
    const observation = store.personObservations?.[cacheKey];
    if (!observation?.text) throw new Error('Vui lòng tạo quan sát nhân vật một lần trước');
    const existing = state.events.find(event => event.id === observation.queuedEventId);
    if (existing?.delivery?.state === 'delivered') {
        throw new Error('Đoạn quan sát này đã được tiếp nối tự nhiên bởi nội dung chính, không thể thu hồi');
    }

    if (existing) {
        const enabled = !['delivered', 'expired', 'none'].includes(existing.delivery?.state)
            && (observation.revealEnabled ?? (
                existing.delivery?.manualQueued
                || existing.delivery?.state === 'pending'
            ));
        const next = clone(state);
        const event = next.events.find(item => item.id === existing.id);
        event.delivery ||= { state: 'none' };
        event.delivery.manualQueued = !enabled;
        event.delivery.state = enabled ? 'none' : 'pending';
        if (!enabled) event.delivery.attempts = 0;
        observation.revealEnabled = !enabled;
        store.personObservations[cacheKey] = observation;
        commitManualState(
            next,
            enabled
                ? `Đã chuyển ${person.name} quan sát hậu trường thu hồi thành chỉ xem.`
                : `Đã cho phép ${person.name} quan sát hậu trường hiển thị tự nhiên khi thích hợp.`,
        );
        saveStore(store);
        return cachedPersonObservation(personId);
    }

    const previousIds = new Set(state.events.map(event => event.id));
    const next = addManualEvent(state, {
        title: `${person.name}đoạn ngoài ống kính của`,
        place: person.location,
        summary: observation.text,
        expected_result: observation.text,
        result: observation.text,
        consequence: observation.text,
        status: 'ready',
        clock_mode: 'condition',
        visibility: 'trace',
        delivery_queued: true,
        delivery_route: observation.text,
    });
    const created = next.events.find(event => !previousIds.has(event.id));
    if (!created) throw new Error('Không thiết lập thành công ứng cử viên hiển thị tự nhiên');
    commitManualState(next, `Đã cho phép ${person.name} quan sát hậu trường hiển thị tự nhiên khi thích hợp.`);
    observation.queuedEventId = created.id;
    observation.revealEnabled = true;
    store.personObservations[cacheKey] = observation;
    saveStore(store);
    return cachedPersonObservation(personId);
}

function personObservationPollutionReason(text, person) {
    const value = String(text || '').trim();
    if (!value) return 'Nội dung trả về trống';
    if (/<\/?content\b|<UpdateVariable\b|<JSONPatch\b|JSONPatch|<details\b/i.test(value)) {
        return 'Nội dung trả về bị lẫn vào nội dung chính của trò chuyện chính / Giao thức cập nhật biến';
    }
    const playerCentricHits = (value.match(/(?:^|[。！？\n])\s*Bạn(?:Đang|Lại|Vẫn|Đã|Dọc theo|Đi|Ngồi|Đứng|Nâng|Cúi|Duỗi|Đem|Nhìn|Nghe|Ngửi|Cảm thấy|Phát hiện|Đến|Trở về|Mặc|Cầm|Ăn|Uống|Nói|Hỏi|Dừng|Chuyển)/g) || []).length;
    const firstPersonHits = (value.match(/(?:^|[。！？\n，,])\s*Tôi(?:Đang|Lại|Vẫn|Đã|Đang|Đem|Nhìn|Nghe|Ngửi|Nghĩ|Cảm thấy|Phát hiện|Đi|Ngồi|Đứng|Nâng|Cúi|Duỗi|Cầm|Ăn|Uống|Nói|Hỏi|Dừng|Chuyển|Không|Có)/g) || []).length;
    if (playerCentricHits >= 3 && firstPersonHits === 0) {
        return `Nội dung trả về nghi ngờ coi người chơi là chủ thể trần thuật, chứ không phải ${person?.name || 'nhân vật được quan sát'} Ngôi thứ nhất`;
    }
    return '';
}

function personObservationLooksComplete(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    // Character observations are prose-only. A result that ends mid-word or
    // mid-sentence is overwhelmingly likely to be a max-token truncation on
    // tavern-backed generation, where finish_reason is not exposed to plugins.
    return /[。！？!?…」』”’）)\]】]$/.test(value);
}

async function generateIndependentPersonObservation(prompt, person, settings, { signal } = {}) {
    runtime.syncStatus.method = settings.apiMode === 'custom'
        ? 'Quan sát nhân vật · Giao diện độc lập mặt trái thế giới'
        : 'Quan sát nhân vật · Ngữ cảnh độc lập mặt trái thế giới';

    const attempts = [
        { maxTokens: 4096, temperature: 0.75 },
        { maxTokens: 8192, temperature: 0.65 },
    ];
    let lastTruncation = null;

    for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        try {
            const raw = String(await backgroundSimulation(prompt, {
                maxTokens: attempt.maxTokens,
                temperature: attempt.temperature,
                // Person observation must never inherit the foreground preset. It has
                // its own POV/output contract.
                taskKind: 'person-observation',
                // Custom APIs expose finish_reason, so reject MAX_TOKENS/length
                // immediately instead of accepting a visibly cut-off paragraph.
                rejectTruncated: true,
                signal,
            }) || '');
            const filtered = filterNarrativeText(raw, settings).trim();
            if (!filtered) {
                throw new Error('Nội dung trả về của quan sát nhân vật trống sau khi lọc thẻ');
            }
            const pollution = personObservationPollutionReason(filtered, person);
            if (pollution) {
                throw new Error(`Đầu ra quan sát nhân vật bị ô nhiễm:${pollution}`);
            }
            if (!personObservationLooksComplete(filtered)) {
                const error = new Error('Quan sát nhân vật nghi ngờ bị cắt bớt do độ dài đầu ra, không lưu nội dung bị cắt dở');
                error.code = 'OUTPUT_TRUNCATED';
                error.partialText = filtered;
                throw error;
            }
            return filtered;
        } catch (error) {
            if (isAbortError(error)) throw error;
            const truncated = error?.code === 'OUTPUT_TRUNCATED'
                || /Đầu ra đạt giới hạn độ dài|Độ dài đầu ra bị cắt bớt|MAX_TOKENS|finish_reason.?length/i.test(String(error?.message || error));
            if (!truncated) throw error;
            lastTruncation = error;
            if (index >= attempts.length - 1) break;
            console.warn(`[Mặt trái thế giới] Quan sát nhân vật nghi ngờ bị cắt bớt, tự động tăng hạn mức đầu ra để thử lại (${attempt.maxTokens} → ${attempts[index + 1].maxTokens}）`);
        }
    }

    const reason = String(lastTruncation?.finishReason || '').trim();
    throw new Error(
        `Quan sát nhân vật đạt giới hạn đầu ra hai lần liên tiếp${reason ? `（${reason}）` : ''}，Không lưu nội dung bị cắt dở; vui lòng quan sát lại hoặc kiểm tra giới hạn đầu ra của mô hình hiện tại`,
    );
}

async function observePerson(personId, { force = false } = {}) {
    const state = getState();
    const baselineRevision = Number(state.revision || 0);
    const baselineChatToken = currentChatToken();
    const baselineAssistantStamp = latestAssistantSourceStamp();
    const person = state.people.find(item => item.id === personId);
    if (!person) throw new Error('Không tìm thấy nhân vật này');
    if (person.isUser) throw new Error('Nhân vật người chơi không sử dụng quan sát nhân vật ngoài ống kính');
    if (currentTurnPresentPersonIds().includes(person.id)) {
        throw new Error('Nhân vật này đã ở trong ống kính vòng này, không cần quan sát riêng');
    }
    const cacheKey = personObservationCacheKey(state, person);
    const cached = getStore().personObservations?.[cacheKey];
    if (cached && !force) return cached;
    const settings = getSettings();
    const latest = latestAssistantEntry();
    const narrative = latest
        ? narrativeContext(latest.index, settings.contextTurns)
        : { turns: [] };
    const prompt = buildPersonObservationPrompt(state, person, {
        narrativeTurns: narrative.turns,
        userName: getContext()?.name1 || '',
        includeUserInnerVoice: settings.includeUserInnerVoice,
        playerIdentityAnchor: getPlayerIdentityAnchor(state),
    });

    const controller = new AbortController();
    const activeObservation = {
        controller,
        personId: person.id,
        chatToken: baselineChatToken,
        revision: baselineRevision,
        assistantStamp: baselineAssistantStamp,
    };
    runtime.activeObservation = activeObservation;
    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: `Đang xem ${person.name} lúc này đang làm gì`,
        error: '',
        attemptedAt: new Date().toISOString(),
    });
    try {
        const text = await generateIndependentPersonObservation(prompt, person, settings, { signal: controller.signal });
        const stale = (
            currentChatToken() !== baselineChatToken
            || Number(getState().revision || 0) !== baselineRevision
            || latestAssistantSourceStamp() !== baselineAssistantStamp
        );
        if (stale) {
            const error = new Error('Trong thời gian quan sát thế giới đã tiến về phía trước rồi～Kết quả cũ không được lưu, xem lại lần nữa sẽ lấy trạng thái mới nhất làm chuẩn');
            error.code = 'STALE_BACKGROUND_TASK';
            throw error;
        }
        setSyncStatus({
            phase: 'success',
            message: `${person.name} quan sát tức thời đã được tạo`,
            error: '',
            succeededAt: new Date().toISOString(),
            method: runtime.syncStatus.method,
        });
        const result = {
            personId: person.id,
            text,
            worldMinute: state.clock.absoluteMinute,
            cacheKey,
        };
        const store = getStore();
        store.personObservations[cacheKey] = result;
        const cacheEntries = Object.entries(store.personObservations);
        if (cacheEntries.length > 30) {
            store.personObservations = Object.fromEntries(cacheEntries.slice(-30));
        }
        saveStore(store);
        return result;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            setSyncStatus({
                phase: 'pending',
                message: 'Nội dung chính mới đến rồi～Quan sát nhân vật cũ tạm dừng trước, sẽ không lưu kết quả hết hạn',
                error: '',
                method: runtime.syncStatus.method,
            });
            throw error;
        }
        const errorMessage = describeError(error);
        setSyncStatus({
            phase: error?.code === 'STALE_BACKGROUND_TASK' ? 'pending' : 'error',
            message: error?.code === 'STALE_BACKGROUND_TASK'
                ? 'Quan sát nhân vật đã hết hạn, không ghi vào bộ nhớ cache'
                : 'Quan sát nhân vật tức thời chưa hoàn thành',
            error: errorMessage,
            method: runtime.syncStatus.method,
        });
        throw error;
    } finally {
        if (runtime.activeObservation === activeObservation) runtime.activeObservation = null;
        setBusy(false);
    }
}



async function generatePublicOpinionSnapshot({ allowDefer = true } = {}) {
    const chatTokenAtStart = currentChatToken();
    if (allowDefer && coreSimulationBusy()) {
        runtime.pendingPublicOpinion = true;
        runtime.publicOpinionStatus = {
            phase: 'queued',
            message: 'Tuyến truyện chính của thế giới vẫn đang suy diễn～Dư luận xếp ra sau trước, đợi trạng thái cốt lõi theo kịp sẽ tự động tiếp tục `(•̀ᴗ•́)و`',
            error: '',
        };
        runtime.ui?.render();
        return null;
    }

    const state = getState();
    const sourceRevision = Number(state.revision || 0);
    const sourceAssistantStamp = latestAssistantSourceStamp();
    const sourceEventSignature = publicOpinionEventSignature(state);
    const candidates = eligiblePublicOpinionEvents(state);
    const store = getStore();
    const generatedAt = new Date().toISOString();

    if (!candidates.length) {
        const visibilityCounts = (state.events || []).reduce((counts, event) => {
            const key = ['hidden', 'trace', 'known', 'direct'].includes(String(event?.visibility || ''))
                ? String(event.visibility)
                : 'hidden';
            counts[key] += 1;
            return counts;
        }, { hidden: 0, trace: 0, known: 0, direct: 0 });
        store.publicOpinion = emptyPublicOpinionCache({
            generatedAt,
            sourceRevision: state.revision,
            sourceWorldMinute: state.clock?.absoluteMinute ?? -1,
            sourceEventSignature: publicOpinionEventSignature(state),
        });
        saveStore(store);
        refreshInjection();
        runtime.publicOpinionStatus = {
            phase: 'running',
            message: `Chính sử vòng này không có gì có thể lan truyền～Công khai ${visibilityCounts.known + visibilityCounts.direct} · Dấu vết ${visibilityCounts.trace} · Ẩn ${visibilityCounts.hidden}。Vậy thì tiện tay ra phố hóng chút chuyện phiếm không liên quan đến tuyến truyện chính nhé (ﾉ◕ヮ◕)ﾉ`,
            error: '',
        };
        runtime.ui?.render();
        const sandbox = await generatePublicOpinionSandbox();
        return sandbox ? { kind: 'sandbox', sandbox, fallback: 'no-candidates' } : null;
    }

    const controller = new AbortController();
    const activePublicOpinion = {
        controller,
        chatToken: chatTokenAtStart,
        sourceRevision,
        assistantStamp: sourceAssistantStamp,
    };
    runtime.activePublicOpinion = activePublicOpinion;
    runtime.pendingPublicOpinion = false;
    runtime.publicOpinionStatus = {
        phase: 'running',
        message: 'Đang lướt tin tức và diễn đàn～Xem bên ngoài đang bàn tán chuyện gì',
        error: '',
    };
    runtime.ui?.render();

    const prompt = buildPublicOpinionPrompt(state, {
        clockLabel: formatWorldCalendar(state)?.stamp || '',
    });
    const settings = getSettings();
    const baseTokens = settings.maxOutputTokens > 0
        ? Math.max(2800, Math.min(6000, settings.maxOutputTokens))
        : 3600;

    try {
        const raw = await runWithRetries(
            () => backgroundSimulation(prompt, {
                maxTokens: baseTokens,
                temperature: 0.65,
                taskKind: 'public-opinion',
                rejectTruncated: true,
                signal: controller.signal,
            }),
            {
                retries: Math.min(1, settings.autoRetryCount),
                delayMs: 650,
                shouldRetry: error => /JSON|Cắt bớt|Giới hạn độ dài|empty|No message generated|Không trả về nội dung chính cuối cùng/i.test(String(error?.message || error || '')),
                signal: controller.signal,
            },
        );
        const parsed = extractJsonObject(raw);
        if (!parsed) throw new Error('Giao diện dư luận không trả về dữ liệu có thể phân tích JSON');
        if (controller.signal.aborted) {
            const error = new Error('Nhiệm vụ dư luận đã bị hủy');
            error.name = 'AbortError';
            throw error;
        }

        const stale = (
            currentChatToken() !== chatTokenAtStart
            || publicOpinionEventSignature(getState()) !== sourceEventSignature
            || latestAssistantSourceStamp() !== sourceAssistantStamp
        );
        if (stale) {
            runtime.pendingPublicOpinion = currentChatToken() === chatTokenAtStart;
            runtime.publicOpinionStatus = {
                phase: 'pending',
                message: 'Thế giới đã tiến về phía trước rồi～Bản dư luận cũ vừa nãy vứt bỏ luôn, không lấy tin tức hết hạn chạy theo cốt truyện mới `(｡•̀ᴗ-)✧`',
                error: '',
            };
            runtime.ui?.render();
            scheduleDeferredPublicOpinion(260);
            return null;
        }

        const cache = normalizePublicOpinionPayload(parsed, {
            validEventIds: candidates.map(item => item.id),
            eventVisibilityById: Object.fromEntries(candidates.map(item => [item.id, item.visibility])),
            sourceRevision: state.revision,
            sourceWorldMinute: state.clock?.absoluteMinute ?? -1,
            sourceEventSignature,
            generatedAt,
        });
        const latestStore = getStore();
        latestStore.publicOpinion = cache;
        saveStore(latestStore);
        refreshInjection();
        if (!cache.news.length && !cache.forums.length) {
            runtime.publicOpinionStatus = {
                phase: 'running',
                message: 'Ứng cử viên chính sử rõ ràng là có, nhưng lần này không đào ra được dư luận đạt chuẩn～Không để bạn về tay không, tiện tay chuyển sang đi dạo hóng chút chuyện phiếm `(•̀ᴗ•́)و`',
                error: '',
            };
            runtime.ui?.render();
            const sandbox = await generatePublicOpinionSandbox();
            return sandbox ? { kind: 'sandbox', sandbox, fallback: 'empty-canon-result' } : cache;
        }
        runtime.publicOpinionStatus = {
            phase: 'success',
            message: `Đào được ${cache.news.length} tin tức · ${cache.forums.length} chủ đề diễn đàn～`,
            error: '',
        };
        runtime.ui?.render();
        return cache;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            if (currentChatToken() === chatTokenAtStart) {
                runtime.pendingPublicOpinion = true;
                runtime.publicOpinionStatus = {
                    phase: 'queued',
                    message: 'Nội dung chính mới đã đến trước rồi~ Dư luận cũ tạm dừng, đợi suy diễn thế giới đuổi kịp rồi xem cái mới nhé',
                    error: '',
                };
                runtime.ui?.render();
                scheduleDeferredPublicOpinion(260);
            }
            return null;
        }
        if (currentChatToken() === chatTokenAtStart) {
            runtime.publicOpinionStatus = {
                phase: 'error',
                message: 'Dư luận lần này chưa đào xong QAQ',
                error: describeError(error),
            };
            runtime.ui?.render();
        }
        throw error;
    } finally {
        if (runtime.activePublicOpinion === activePublicOpinion) {
            runtime.activePublicOpinion = null;
        }
    }
}

async function generatePublicOpinionSandbox() {
    const chatTokenAtStart = currentChatToken();
    if (coreSimulationBusy()) throw new Error('Tuyến truyện chính của thế giới vẫn đang suy diễn~ Hãy đợi trạng thái cốt lõi ổn định rồi hẵng đi dạo nhé');
    const state = getState();
    const controller = new AbortController();
    const activeSandbox = { controller, chatToken: chatTokenAtStart };
    runtime.activePublicOpinionSandbox = activeSandbox;
    const generatedAt = new Date().toISOString();
    runtime.publicOpinionStatus = { phase: 'running', message: 'Đang đi dạo trên phố~ Xem hôm nay có chuyện gì náo nhiệt không quan trọng không `(ﾉ◕ヮ◕)ﾉ`', error: '' };
    runtime.ui?.render();
    try {
        const prompt = buildPublicOpinionSandboxPrompt(state, { clockLabel: formatWorldCalendar(state)?.stamp || '' });
        const settings = getSettings();
        const sandbox = await runWithRetries(
            async () => {
                const raw = await backgroundSimulation(prompt, {
                    maxTokens: 2800,
                    temperature: 0.9,
                    taskKind: 'public-opinion',
                    rejectTruncated: true,
                    signal: controller.signal,
                });
                const parsed = extractJsonObject(raw);
                if (!parsed) throw new Error('Dư luận đi dạo không trả về nội dung có thể phân tích JSON');
                const normalized = normalizePublicOpinionSandboxPayload(parsed, { generatedAt });
                if (!normalized.news.length && !normalized.forums.length) {
                    throw new Error('Dư luận đi dạo trả về nội dung trống');
                }
                return normalized;
            },
            {
                retries: Math.min(1, settings.autoRetryCount),
                delayMs: 520,
                shouldRetry: error => /JSON|Nội dung trống|Cắt bớt|Giới hạn độ dài|empty|No message generated/i.test(String(error?.message || error || '')),
                signal: controller.signal,
            },
        );
        if (currentChatToken() !== chatTokenAtStart) return null;
        const store = getStore();
        store.publicOpinionSandbox = sandbox;
        saveStore(store);
        runtime.publicOpinionStatus = {
            phase: 'success',
            message: `Tình cờ đi dạo đến ${sandbox.news.length} tin tức nhỏ · ${sandbox.forums.length} chủ đề tán gẫu~ Những cái này không tính là chính sử đâu nhé`,
            error: '',
        };
        runtime.ui?.render();
        return sandbox;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            if (currentChatToken() === chatTokenAtStart) {
                runtime.publicOpinionStatus = { phase: 'idle', message: 'Tuyến truyện chính có động tĩnh mới rồi~ Đi dạo tạm nghỉ, không giành đường với suy diễn cốt lõi `(｡•̀ᴗ-)✧`', error: '' };
                runtime.ui?.render();
            }
            return null;
        }
        if (currentChatToken() === chatTokenAtStart) {
            runtime.publicOpinionStatus = { phase: 'error', message: 'Hôm nay đi dạo không thu hoạch được gì QAQ', error: describeError(error) };
            runtime.ui?.render();
        }
        throw error;
    } finally {
        if (runtime.activePublicOpinionSandbox === activeSandbox) runtime.activePublicOpinionSandbox = null;
    }
}

function clearPublicOpinionSandbox() {
    runtime.activePublicOpinionSandbox?.controller?.abort?.();
    runtime.activePublicOpinionSandbox = null;
    const store = getStore();
    store.publicOpinionSandbox = emptyPublicOpinionSandbox();
    saveStore(store);
    runtime.publicOpinionStatus = { phase: 'idle', message: 'Báo nhỏ đi dạo đã cất đi rồi~', error: '' };
    runtime.ui?.render();
    return true;
}

function clearPublicOpinionSnapshot() {
    runtime.activePublicOpinion?.controller?.abort?.();
    runtime.activePublicOpinion = null;
    runtime.pendingPublicOpinion = false;
    const store = getStore();
    store.publicOpinion = emptyPublicOpinionCache();
    saveStore(store);
    refreshInjection();
    runtime.publicOpinionStatus = {
        phase: 'idle',
        message: 'Bản ghi nhanh dư luận đã xóa sạch rồi~',
        error: '',
    };
    runtime.ui?.render();
    return true;
}

function recentRawAssistantTexts(count = 1) {
    const chat = getContext()?.chat || [];
    const limit = Math.max(1, Math.min(20, Number(count) || 1));
    const result = [];
    for (let index = chat.length - 1; index >= 0 && result.length < limit; index -= 1) {
        const message = chat[index];
        if (!message || message.is_user || message.is_system) continue;
        const swipeId = Number(message.swipe_id ?? 0);
        const text = String(message.swipes?.[swipeId] ?? message.mes ?? '');
        if (!text.trim()) continue;
        result.unshift(text);
    }
    return result;
}

async function handleUiAction(action, payload = {}) {
    if (action === 'undo-manual') {
        undoManualChange();
        return;
    }

    if (action === 'create-recovery-point') {
        return createManualRecoveryPoint();
    }

    if (action === 'restore-latest-recovery') {
        return restoreLatestSavedRecovery();
    }

    if (action === 'copy-diagnostics') {
        return copyDiagnosticReport();
    }

    if (action === 'preview-notice') {
        toast('Việc lưu, khôi phục, suy diễn và báo lỗi sau này đều sẽ dùng thông báo như thế này để cho bạn biết.', 'success');
        return null;
    }

    if (action === 'update-settings') {
        const context = getContext();
        const settings = getSettings();
        Object.assign(settings, payload);
        if (payload.memorySystemEnabled === false) {
            if (runtime.autoMemoryTimer !== null) {
                window.clearTimeout(runtime.autoMemoryTimer);
                runtime.autoMemoryTimer = null;
            }
            runtime.activeHistoryScan?.abort();
        }
        if (payload.publicOpinionAutoEnabled === false) {
            runtime.pendingPublicOpinion = false;
        }
        context.extensionSettings[MODULE_ID] = settings;
        saveSettings();
        refreshInjection();
        syncSettingsEntry();
        runtime.ui?.render();
        if (payload.publicOpinionAutoEnabled === true) {
            scheduleAutoPublicOpinion(getState(), 120);
        }
        if (
            (payload.worldAutoEnabled === true)
            || (payload.autoSimulationMode && getSettings().worldAutoEnabled)
        ) {
            window.setTimeout(schedulePendingCatchUp, 40);
        }
        return;
    }

    if (action === 'test-api') {
        return testCustomApiConnection();
    }

    if (action === 'pull-api-models') {
        return pullCustomApiModels();
    }

    if (action === 'save-api-profile') {
        return saveApiProfile(payload);
    }

    if (action === 'delete-api-profile') {
        return deleteApiProfile(payload.profileId);
    }

    if (action === 'duplicate-api-profile') {
        return duplicateApiProfile(payload.profileId);
    }

    if (action === 'test-api-profile') {
        return await testApiProfileConnection(payload.profileId);
    }

    if (action === 'pull-api-profile-models') {
        return await pullApiProfileModels(payload.profileId);
    }

    if (action === 'test-api-draft') {
        return await testApiDraftConnection(payload);
    }

    if (action === 'pull-api-draft-models') {
        return await pullApiDraftModels(payload);
    }

    if (action === 'scan-history') {
        return scanStoryMemoryHistory();
    }

    if (action === 'generate-public-opinion-sandbox') {
        return generatePublicOpinionSandbox();
    }

    if (action === 'clear-public-opinion-sandbox') {
        return clearPublicOpinionSandbox();
    }

    if (action === 'observe-person') {
        return observePerson(String(payload.personId || ''), { force: Boolean(payload.force) });
    }

    if (action === 'get-person-observation') {
        return cachedPersonObservation(String(payload.personId || ''));
    }

    if (action === 'queue-person-observation') {
        return queuePersonObservation(String(payload.personId || ''));
    }

    if (action === 'save-world-summary') {
        const title = String(payload.title || '').trim();
        const detail = String(payload.detail || '').trim();
        if (!title || !detail) throw new Error('Tiêu đề và khái quát thế giới không được để trống');
        const next = clone(getState());
        next.world ||= {};
        next.world.title = title.slice(0, 140);
        next.world.detail = detail.slice(0, 900);
        commitManualState(next, 'Khái quát thế giới đã được cập nhật.');
        return next.world;
    }

    if (action === 'save-record') {
        const kind = payload.kind === 'archive' ? 'archive' : 'echo';
        const id = String(payload.id || '');
        const title = String(payload.title || '').trim();
        const text = String(payload.text || '').trim();
        if (!title || !text) throw new Error('Tiêu đề và nội dung không được để trống');
        const next = clone(getState());
        const visibility = ['hidden', 'trace', 'known', 'direct'].includes(payload.visibility)
            ? payload.visibility
            : 'hidden';

        if (kind === 'echo') {
            const event = next.events.find(item => item.id === id);
            if (!event) throw new Error('Không tìm thấy tiếng vang này');
            event.title = title.slice(0, 140);
            event.result = text.slice(0, 900);
            event.consequence = event.result;
            event.place = String(payload.place || event.place || '').trim().slice(0, 160);
            event.visibility = visibility;
            event.delivery ||= { state: 'none' };
            event.delivery.state = ['none', 'pending', 'delivered', 'expired'].includes(payload.deliveryState)
                ? payload.deliveryState
                : event.delivery.state;
            event.updatedAt = next.clock.absoluteMinute;
            for (const echo of next.echoes || []) {
                if (echo.eventId !== event.id) continue;
                echo.title = event.title;
                echo.route = event.result;
            }
            for (const entry of next.archive || []) {
                if (entry.eventId !== event.id) continue;
                entry.title = event.title;
                entry.text = event.result;
                entry.visibility = event.visibility;
                entry.deliveryState = event.delivery.state;
            }
            commitManualState(next, `Tiếng vang“${event.title}”đã được cập nhật.`);
            return event;
        }

        const entry = next.archive.find(item => item.id === id);
        if (!entry) throw new Error('Không tìm thấy biên niên sử này');
        entry.title = title.slice(0, 140);
        entry.text = text.slice(0, 900);
        entry.visibility = visibility;
        entry.manual = true;
        commitManualState(next, `Biên niên sử“${entry.title}”đã được cập nhật.`);
        return entry;
    }

    if (action === 'delete-record') {
        const kind = payload.kind === 'archive' ? 'archive' : 'echo';
        const id = String(payload.id || '');
        const next = clone(getState());
        if (kind === 'echo') {
            const index = next.events.findIndex(item => item.id === id);
            if (index < 0) throw new Error('Không tìm thấy tiếng vang này');
            const [removed] = next.events.splice(index, 1);
            next.echoes = (next.echoes || []).filter(item => item.eventId !== removed.id);
            next.archive = (next.archive || []).filter(item => item.eventId !== removed.id);
            commitManualState(next, `Tiếng vang“${removed.title}”đã bị xóa.`);
            return;
        }
        const index = next.archive.findIndex(item => item.id === id);
        if (index < 0) throw new Error('Không tìm thấy biên niên sử này');
        const [removed] = next.archive.splice(index, 1);
        commitManualState(next, `Biên niên sử“${removed.title || 'Bản ghi chưa đặt tên'}”đã bị xóa.`);
        return;
    }

    if (action === 'save-memory-item') {
        const kind = ['fact', 'clue', 'summary'].includes(payload.kind) ? payload.kind : 'fact';
        const id = String(payload.id || '');
        const title = String(payload.title || '').trim();
        const relation = String(payload.relation || '').trim();
        const content = String(payload.content || '').trim();
        if (!title || !content) throw new Error('Tiêu đề và nội dung không được để trống');

        const next = clone(getState());
        next.storyMemory ||= { facts: [], clues: [], summaries: [] };
        const collection = kind === 'fact'
            ? next.storyMemory.facts
            : kind === 'clue'
                ? next.storyMemory.clues
                : next.storyMemory.summaries;
        const existing = collection.find(item => item.id === id);
        if (existing?.locked && payload.locked === false) {
            throw new Error('Vui lòng dùng nút khóa trên thẻ để mở khóa trước, sau đó mới chỉnh sửa ký ức này');
        }
        const itemId = existing?.id || `${kind}_manual_${Date.now().toString(36)}`;
        const common = {
            ...(existing || {}),
            id: itemId,
            locked: Boolean(payload.locked),
            important: Boolean(payload.important),
            manual: true,
        };
        let updated;
        if (kind === 'fact') {
            updated = {
                ...common,
                key: existing?.key || `manual:${hashText(`${title}\n${relation}`)}`,
                subject: title.slice(0, 100),
                predicate: relation.slice(0, 100),
                value: content.slice(0, 520),
                status: existing?.status || 'active',
                confidence: existing?.confidence || 'high',
                importance: payload.important ? 3 : (existing?.importance || 2),
                visibility: existing?.visibility || 'known',
                updatedAt: next.clock.absoluteMinute,
            };
        } else if (kind === 'clue') {
            updated = {
                ...common,
                title: title.slice(0, 120),
                text: content.slice(0, 620),
                status: existing?.status || 'open',
                importance: payload.important ? 3 : (existing?.importance || 1),
                visibility: existing?.visibility || 'hidden',
                updatedAt: next.clock.absoluteMinute,
                createdAt: existing?.createdAt ?? next.clock.absoluteMinute,
            };
        } else {
            const anchor = latestAssistantEntry()?.index ?? 0;
            updated = {
                ...common,
                title: title.slice(0, 120),
                summary: content.slice(0, 1400),
                startMessageId: existing?.startMessageId ?? anchor,
                endMessageId: existing?.endMessageId ?? anchor,
                level: existing?.level ?? 1,
                hierarchyManaged: existing?.hierarchyManaged ?? false,
                parentId: existing?.parentId || '',
                sourceSummaryIds: existing?.sourceSummaryIds || [],
                createdAt: existing?.createdAt || new Date().toISOString(),
            };
        }
        if (existing) Object.assign(existing, updated);
        else collection.unshift(updated);
        commitManualState(next, existing ? 'Ký ức đã được cập nhật.' : 'Ký ức thủ công đã được thêm vào.');
        return updated;
    }

    if (action === 'toggle-memory-flag') {
        const kind = ['fact', 'clue', 'summary'].includes(payload.kind) ? payload.kind : 'fact';
        const field = payload.field === 'locked' ? 'locked' : 'important';
        const next = clone(getState());
        const collection = kind === 'fact'
            ? next.storyMemory?.facts
            : kind === 'clue'
                ? next.storyMemory?.clues
                : next.storyMemory?.summaries;
        const item = collection?.find(entry => entry.id === String(payload.id || ''));
        if (!item) throw new Error('Không tìm thấy ký ức này');
        item[field] = !item[field];
        if (field === 'important' && item.important && 'importance' in item) item.importance = 3;
        commitManualState(next, field === 'locked'
            ? (item.locked ? 'Ký ức đã bị khóa, sẽ không bị ghi đè bởi sắp xếp tự động.' : 'Ký ức đã được mở khóa.')
            : (item.important ? 'Đã đánh dấu là ký ức quan trọng.' : 'Đã hủy đánh dấu quan trọng.'));
        return;
    }

    if (action === 'delete-memory-item') {
        const kind = ['fact', 'clue', 'summary'].includes(payload.kind) ? payload.kind : 'fact';
        const next = clone(getState());
        const collection = kind === 'fact'
            ? next.storyMemory?.facts
            : kind === 'clue'
                ? next.storyMemory?.clues
                : next.storyMemory?.summaries;
        const index = collection?.findIndex(entry => entry.id === String(payload.id || '')) ?? -1;
        if (index < 0) throw new Error('Không tìm thấy ký ức này');
        if (collection[index].locked) throw new Error('Ký ức đã khóa không thể xóa, vui lòng mở khóa trước');
        const removed = collection[index];
        if (kind === 'summary') {
            const summaries = next.storyMemory?.summaries || [];
            for (const summary of summaries) {
                if (summary.parentId === removed.id) summary.parentId = '';
                if (Array.isArray(summary.sourceSummaryIds) && summary.sourceSummaryIds.includes(removed.id)) {
                    summary.sourceSummaryIds = summary.sourceSummaryIds.filter(id => id !== removed.id);
                }
            }
        }
        collection.splice(index, 1);
        commitManualState(next, 'Ký ức đã bị xóa.');
        return;
    }

    if (action === 'save-manual-person') {
        const id = String(payload.id || '');
        const originalName = String(payload.originalName || '').trim();
        const name = String(payload.name || '').trim();
        if (!name) throw new Error('Họ tên nhân vật không được để trống');
        const next = clone(getState());
        const existing = next.people.find(person => (
            person.id === id
            && (!originalName || person.name === originalName)
        )) || next.people.find(person => person.id === id);
        if (existing?.locked && payload.locked === false) {
            throw new Error('Vui lòng mở khóa thẻ nhân vật trước, sau đó mới sửa đổi thiết lập cốt lõi');
        }
        const person = {
            ...(existing || {}),
            id: existing?.id || `person_manual_${hashText(`${name}\n${Date.now()}`)}`,
            name: name.slice(0, 80),
            monogram: name.slice(0, 1),
            location: String(payload.location || 'Vị trí chờ xác nhận').trim().slice(0, 160),
            action: String(payload.action || 'Hành động hiện tại chờ xác nhận').trim().slice(0, 280),
            intent: String(payload.intent || 'Ý định ngắn hạn chờ xác nhận').trim().slice(0, 320),
            longTermGoal: String(payload.longTermGoal || '').trim().slice(0, 420),
            identityAnchor: String(payload.identityAnchor || '').trim().slice(0, 500),
            personalityAnchor: String(payload.personalityAnchor || '').trim().slice(0, 600),
            appearanceProfile: String(payload.appearanceProfile || '').trim().slice(0, 700),
            backgroundProfile: String(payload.backgroundProfile || '').trim().slice(0, 900),
            speakingStyle: String(payload.speakingStyle || '').trim().slice(0, 360),
            behaviorBoundaries: String(payload.behaviorBoundaries || '').trim().slice(0, 500),
            knowledge: payload.knowledge === 'known' ? 'known' : 'backstage',
            relevance: Math.min(3, Math.max(0, Number(payload.relevance) || 2)),
            simulationEnabled: Boolean(payload.simulationEnabled),
            locked: Boolean(payload.locked),
            manual: true,
            source: 'manual',
            isUser: Boolean(existing?.isUser),
            updatedAt: next.clock.absoluteMinute,
        };
        if (existing) Object.assign(existing, person);
        else next.people.push(person);
        const reconciled = settlePersonWorldState(next, person.id, { source: 'manual' });
        commitManualState(reconciled, existing ? 'Thẻ nhân vật chạy ngầm đã được cập nhật.' : `Đã chuyển ${person.name} Thêm nhân vật chạy ngầm.`);
        return person;
    }

    if (action === 'delete-manual-person') {
        const next = clone(getState());
        const index = next.people.findIndex(person => person.id === String(payload.id || ''));
        if (index < 0) throw new Error('Không tìm thấy nhân vật này');
        if (next.people[index].locked) throw new Error('Thẻ nhân vật đã khóa không thể xóa, vui lòng mở khóa trước');
        const [removed] = next.people.splice(index, 1);
        commitManualState(next, `Đã xóa nhân vật chạy ngầm ${removed.name}。`);
        return;
    }

    if (action === 'sync-clock-from-story') {
        const latest = latestAssistantEntry();
        if (!latest?.message) {
            toast('Không nhận diện được thời gian nội dung chính.', 'warning');
            return false;
        }
        const anchor = extractNarrativeTimeAnchor(selectedMessageText(latest.message));
        if (!anchor) {
            toast('Không nhận diện được thời gian nội dung chính.', 'warning');
            return false;
        }

        const current = getState();
        const clock = formatWorldCalendar(current);
        const hasDate = Number.isFinite(anchor.year) && Number.isFinite(anchor.month) && Number.isFinite(anchor.day);
        const hasMinute = Number.isFinite(anchor.hour) && Number.isFinite(anchor.minute);
        const next = setWorldCalendar(current, {
            calendarName: clock.calendarName,
            year: hasDate ? anchor.year : clock.year,
            month: hasDate ? anchor.month : clock.month,
            day: hasDate ? anchor.day : clock.dayOfMonth,
            hour: hasMinute ? anchor.hour : clock.hour,
            minute: hasMinute ? anchor.minute : clock.minute,
            reason: `Hiệu chuẩn với nội dung chính mới nhất${anchor.excerpt ? `：${anchor.excerpt}` : ''}`,
        });
        next.clock.precision = hasMinute ? 'minute' : (anchor.daypart ? 'daypart' : 'date');
        next.clock.source = 'narrative-manual-sync';
        next.clock.reason = `Hiệu chuẩn thủ công với nội dung chính mới nhất${anchor.excerpt ? `：${anchor.excerpt}` : ''}`.slice(0, 240);
        commitManualState(
            next,
            hasDate && hasMinute
                ? `Đã hiệu chuẩn với nội dung chính đến ${anchor.year}Năm${anchor.month}Tháng${anchor.day}Ngày ${String(anchor.hour).padStart(2, '0')}:${String(anchor.minute).padStart(2, '0')}。`
                : hasDate
                    ? `Đã đồng bộ ngày tháng nội dung chính:${anchor.year}Năm${anchor.month}Tháng${anchor.day}Ngày${anchor.daypart ? ` · ${anchor.daypart}` : ''}；Nội dung chính không đưa ra giờ giấc chính xác, giữ nguyên giờ phút hiện tại.`
                    : `Đã đồng bộ giờ giấc nội dung chính:${String(anchor.hour).padStart(2, '0')}:${String(anchor.minute).padStart(2, '0')}。`,
        );
        return true;
    }

    if (action === 'set-clock') {
        const next = setWorldCalendar(getState(), {
            calendarName: payload.calendarName,
            year: payload.year,
            month: payload.month,
            day: payload.day,
            hour: payload.hour,
            minute: payload.minute,
            reason: 'Hiệu chuẩn ở mặt trái thế giới',
        });
        commitManualState(next, 'Thời gian thế giới chính đã được hiệu chuẩn.');
        return;
    }

    if (action === 'advance-clock') {
        const minutes = Number(payload.minutes) || 0;
        const next = advanceWorldClock(getState(), minutes, 'Tiến hành thủ công ở mặt trái thế giới');
        commitManualState(next, `Thời gian thế giới chính đã tiến hành ${minutes} phút.`);
        return;
    }

    if (action === 'add-event') {
        const durationHours = Number(payload.durationHours) || 0;
        const durationMinutes = Math.max(0, Math.round(durationHours * 60));
        const clockMode = payload.clockMode;
        const next = addManualEvent(getState(), {
            title: payload.title,
            place: payload.place,
            summary: payload.summary,
            expected_result: payload.expectedResult,
            consequence: payload.expectedResult,
            clock_mode: clockMode,
            duration_minutes: durationMinutes,
            scheduled_at: clockMode === 'scheduled'
                ? getState().clock.absoluteMinute + durationMinutes
                : null,
            visibility: payload.visibility,
            delivery_route: '',
        });
        commitManualState(next, `Dòng chảy ngầm“${payload.title}”đã bắt đầu phát triển.`);
        return;
    }

    if (action === 'update-event') {
        const eventId = String(payload.id || payload.eventId || '');
        const title = String(payload.title || '').trim();
        if (!title) throw new Error('Tên sự kiện không được để trống');

        const next = clone(getState());
        const event = next.events.find(item => item.id === eventId);
        if (!event) throw new Error('Không tìm thấy dòng chảy ngầm này');
        if (['resolved', 'cancelled', 'missed'].includes(event.status)) {
            throw new Error('Sự kiện đã hình thành kết quả vui lòng xem trong“Tiếng vang” để xem, không thể sửa đổi dưới dạng dòng chảy ngầm nữa');
        }

        const previousClockMode = event.clockMode;
        const previousDuration = Number(event.durationMinutes) || 0;
        const clockMode = ['duration', 'active', 'scheduled', 'condition'].includes(payload.clockMode)
            ? payload.clockMode
            : event.clockMode;
        const durationHours = Math.max(0, Number(payload.durationHours) || 0);
        const durationMinutes = Math.round(durationHours * 60);
        const timingChanged = previousClockMode !== clockMode || previousDuration !== durationMinutes;

        event.title = title.slice(0, 140);
        event.place = String(payload.place || 'Địa điểm chờ xác nhận').trim().slice(0, 140) || 'Địa điểm chờ xác nhận';
        event.summary = String(payload.summary || '').trim().slice(0, 420);
        event.expectedResult = String(payload.expectedResult || '').trim().slice(0, 420);
        event.consequence = event.expectedResult;
        event.visibility = ['hidden', 'trace', 'known', 'direct'].includes(payload.visibility)
            ? payload.visibility
            : event.visibility;
        event.clockMode = clockMode;
        event.durationMinutes = durationMinutes;

        if (timingChanged) {
            if (clockMode === 'duration' || clockMode === 'scheduled') {
                event.dueAt = Number(event.startedAt || next.clock.absoluteMinute) + durationMinutes;
                event.accruedMinutes = 0;
                if (event.dueAt <= next.clock.absoluteMinute) {
                    event.status = 'ready';
                } else if (event.status === 'ready') {
                    event.status = 'active';
                    event.result = '';
                }
            } else if (clockMode === 'active') {
                event.dueAt = null;
                event.accruedMinutes = Math.min(Number(event.accruedMinutes) || 0, durationMinutes || Number.MAX_SAFE_INTEGER);
                if (durationMinutes > 0 && event.accruedMinutes >= durationMinutes) {
                    event.status = 'ready';
                } else if (event.status === 'ready') {
                    event.status = 'active';
                    event.result = '';
                }
            } else {
                event.dueAt = null;
                event.accruedMinutes = 0;
                if (event.status === 'ready') {
                    event.status = 'active';
                    event.result = '';
                }
            }
        }

        event.updatedAt = next.clock.absoluteMinute;
        event.resolvedAt = null;
        commitManualState(next, `Dòng chảy ngầm“${event.title}”đã được cập nhật.`);
        return event;
    }

    if (action === 'delete-event') {
        const eventId = String(payload.eventId || payload.id || '');
        const next = clone(getState());
        const index = next.events.findIndex(item => item.id === eventId);
        if (index < 0) throw new Error('Không tìm thấy dòng chảy ngầm này');
        const [removed] = next.events.splice(index, 1);
        next.echoes = (next.echoes || []).filter(echo => echo.eventId !== eventId);
        commitManualState(next, `Dòng chảy ngầm“${removed.title}”đã bị xóa.`);
        return;
    }

    if (action === 'toggle-event-delivery') {
        const eventId = String(payload.eventId || '');
        const next = clone(getState());
        const event = next.events.find(item => item.id === eventId);
        if (!event) throw new Error('Không tìm thấy sự kiện này');
        if (event.visibility === 'hidden') {
            throw new Error('Sự kiện bị ẩn hoàn toàn không thể chèn vào nội dung chính; vui lòng điều chỉnh mức độ hiển thị trước');
        }
        event.delivery ||= { state: 'none' };
        event.delivery.manualQueued = !event.delivery.manualQueued;
        commitManualState(
            next,
            event.delivery.manualQueued
                ? `“${event.title}”Sẽ ưu tiên tìm kiếm thời cơ hiển thị tự nhiên trong vòng tiếp theo.`
                : `Đã hủy“${event.title}” hiển thị vòng tiếp theo.`,
        );
        return;
    }

    if (action === 'generate-public-opinion') {
        return await generatePublicOpinionSnapshot();
    }

    if (action === 'clear-public-opinion') {
        return clearPublicOpinionSnapshot();
    }

    if (action === 'scan-tag-candidates') {
        const texts = recentRawAssistantTexts(payload.count || 1);
        return extractTagFilterCandidates(texts, getSettings().tagFilterRules || []);
    }

    if (action === 'scan-worldbook') {
        return await scanWorldbook(payload.bookName);
    }

    if (action === 'import-worldbook-people') {
        return importWorldbookPeople(payload.bookName, payload.entryIds);
    }

    if (action === 'cancel-simulation') {
        if (!cancelActiveSimulation()) {
            toast('Hiện tại không có suy diễn thế giới nào đang chạy.', 'info');
        }
        return;
    }

    if (action === 'resolve-message-edit') {
        await resolveMessageEdit(payload.mode === 'keep' ? 'keep' : 'rerun');
        return;
    }

    if (action === 'manual-sync') {
        if (!getSettings().worldSimulationEnabled) {
            toast('Mô-đun suy diễn thế giới hiện đã bị vô hiệu hóa.', 'warning');
            return;
        }
        const lastAssistantIndex = latestAssistantEntry()?.index;
        if (!Number.isInteger(lastAssistantIndex)) {
            toast('Cuộc trò chuyện hiện tại vẫn chưa có gì để suy diễn AI nội dung chính.', 'warning');
            return;
        }
        try {
            const pendingCount = Math.max(
                1,
                pendingAssistantEntriesThrough(lastAssistantIndex).length,
            );
            await queueSimulation(lastAssistantIndex, {
                force: true,
                trigger: 'manual',
                newAssistantCount: pendingCount,
            });
            toast(
                pendingCount > 1
                    ? `Tích lũy ${pendingCount} vòng nội dung chính đã hoàn thành suy diễn.`
                    : 'Nội dung chính mới nhất đã được suy diễn lại.',
                'success',
            );
        } catch {
            // runSimulationForMessage has already recorded and displayed the detailed error.
        }
        return;
    }

    if (action === 'export-state') {
        exportState();
        return;
    }

    if (action === 'import-state-data') {
        try {
            importState(payload.text);
        } catch (error) {
            toast(`Nhập thất bại:${error?.message || error}`, 'error');
        }
    }
}

function installSettingsEntry() {
    if (document.getElementById('world-backstage-settings-entry')) return;
    const host = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!host) return;

    const entry = document.createElement('div');
    entry.id = 'world-backstage-settings-entry';
    entry.className = 'world-backstage-settings-entry';
    entry.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Mặt trái thế giới</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="world-backstage-enabled" type="checkbox">
                    <span>Bật mặt trái thế giới</span>
                </label>
                <p class="notes">Những nơi ngoài ống kính cũng sẽ tiếp tục sống~ Thời gian, nhân vật và sự kiện đều sẽ tự tiến về phía trước (｡•̀ᴗ-)✧</p>
                <button id="world-backstage-open" class="menu_button" type="button">
                    Mở mặt trái thế giới
                </button>
            </div>
        </div>
    `;
    host.appendChild(entry);

    entry.querySelector('#world-backstage-enabled')?.addEventListener('change', event => {
        void handleUiAction('update-settings', { enabled: event.target.checked });
    });
    entry.querySelector('#world-backstage-open')?.addEventListener('click', () => {
        const settings = getSettings();
        if (!settings.enabled) {
            void handleUiAction('update-settings', { enabled: true });
        }
        runtime.ui?.open();
    });
    syncSettingsEntry();
}

function syncSettingsEntry() {
    const checkbox = document.getElementById('world-backstage-enabled');
    if (checkbox) checkbox.checked = getSettings().enabled;
}

function registerEvents() {
    const context = getContext();
    const source = context?.eventSource;
    const events = context?.eventTypes || context?.event_types;
    if (!source || !events) return;

    const on = (eventName, handler) => {
        const event = events[eventName];
        if (event) source.on(event, handler);
    };

    on('GENERATION_STARTED', onGenerationStarted);
    on('MESSAGE_RECEIVED', onMessageReceived);
    on('MESSAGE_SWIPED', restoreExistingSwipe);
    on('MESSAGE_EDITED', onMessageEdited);
    on('MESSAGE_DELETED', onMessageDeleted);
    on('CHAT_CHANGED', onChatChanged);
    on('CHAT_LOADED', onChatChanged);
}

function registerDebugCheck() {
    const context = getContext();
    context?.registerDebugFunction?.(
        'world_backstage_state_check',
        'Kiểm tra trạng thái mặt trái thế giới',
        'Kiểm tra xem đồng hồ thế giới hiện tại, sự kiện hoạt động và bản ghi nhanh nhánh có thể đọc được không',
        () => {
            const state = getState();
            const result = {
                ok: true,
                clock: state.clock.absoluteMinute,
                people: state.people.length,
                activeEvents: state.events.filter(event => ['active', 'waiting'].includes(event.status)).length,
                pendingSync: state.pendingSync,
                latestSnapshot: Boolean(findLatestResultSnapshot()),
            };
            console.info('[Mặt trái thế giới] Kiểm tra trạng thái', result);
            toast('Kiểm tra trạng thái hoàn tất, kết quả chi tiết đã được ghi vào bảng điều khiển trình duyệt.', 'success');
            return result;
        },
    );
}

function initialize() {
    if (runtime.initialized || globalThis.__worldBackstageLoaded) return;
    runtime.initialized = true;
    globalThis.__worldBackstageLoaded = true;
    runtime.activeChatToken = currentChatToken();

    getSettings();
    getStore();
    runtime.ui = createWorldBackstageUI({
        getState,
        getSettings,
        getSyncStatus,
        onAction: handleUiAction,
        pluginVersion: PLUGIN_VERSION,
    });

    installSettingsEntry();
    registerEvents();
    registerDebugCheck();
    restoreLatestBranch();
    console.info('[Mặt trái thế giới] Công cụ trạng thái thế giới đã được tải');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
    initialize();
}
