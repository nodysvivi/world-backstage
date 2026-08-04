import {
    eventProgress,
    formatDuration,
    formatWorldCalendar,
    formatWorldMinute,
    isActiveEvent,
    isTerminalEvent,
} from './core.js';
import { filterWorldbookEntries } from './worldbook.js';

const VIEWS = [
    { id: 'now', label: 'Lúc này', eyebrow: 'NOW' },
    { id: 'people', label: 'Nhân vật', eyebrow: 'PEOPLE' },
    { id: 'currents', label: 'Dòng chảy ngầm', eyebrow: 'CURRENTS' },
    { id: 'echoes', label: 'Tiếng vang', eyebrow: 'ECHOES' },
    { id: 'opinion', label: 'Dư luận', eyebrow: 'PUBLIC' },
    { id: 'memory', label: 'Ký ức', eyebrow: 'MEMORY' },
    { id: 'archive', label: 'Biên niên sử', eyebrow: 'ARCHIVE' },
];

const TOAST_FACES = {
    success: '(｡•̀ᴗ-)✧',
    busy: '( •̀ ω •́ )',
    info: '( •ᴗ• )',
    normal: '( •ᴗ• )',
    warning: '(・_・;)',
    error: '(；′⌒`)',
};

const TOAST_LABELS = {
    success: 'Được rồi',
    busy: 'Đang xử lý',
    info: 'Mẹo nhỏ',
    normal: 'Mẹo nhỏ',
    warning: 'Đợi một chút',
    error: 'Đã xảy ra lỗi',
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
    return escapeHtml(value).replaceAll('`', '&#096;');
}


function foldOpenAttr(openFolds, key, defaultOpen = false) {
    const isOpen = openFolds instanceof Set ? openFolds.has(key) : defaultOpen;
    return isOpen ? 'open' : '';
}

function renderFoldToolbar(prefix) {
    return `
        <div class="wb-fold-toolbar" aria-label="Điều khiển thu gọn">
            <button type="button" data-wb-action="expand-folds" data-fold-prefix="${escapeAttr(prefix)}">Mở rộng tất cả</button>
            <button type="button" data-wb-action="collapse-folds" data-fold-prefix="${escapeAttr(prefix)}">Thu gọn tất cả</button>
        </div>
    `;
}

function compactText(value, maximum = 64) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maximum) return text;
    return `${text.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function normalizeGroupLabel(value, fallback = 'Khác') {
    const label = String(value || '').trim();
    return label || fallback;
}

function groupItems(items, getGroup) {
    const groups = new Map();
    for (const item of items) {
        const descriptor = getGroup(item);
        const rawLabel = typeof descriptor === 'object' && descriptor
            ? descriptor.label
            : descriptor;
        const label = normalizeGroupLabel(rawLabel);
        const rawKey = typeof descriptor === 'object' && descriptor
            ? descriptor.key
            : label;
        const key = normalizeGroupLabel(rawKey, label).toLocaleLowerCase();
        if (!groups.has(key)) groups.set(key, { key, label, items: [] });
        groups.get(key).items.push(item);
    }
    return [...groups.values()];
}
function formatLocalTimestamp(value) {
    const date = new Date(String(value || ''));
    if (!Number.isFinite(date.getTime())) return 'Thời gian không xác định';
    return date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function worldClockLabel(state, clock = formatWorldCalendar(state)) {
    return state.clock?.anchored ? clock.stamp : 'Chờ thiết lập điểm neo thời gian từ nội dung chính';
}

function themeFor(state, settings) {
    if (settings.theme === 'day' || settings.theme === 'night') return settings.theme;
    const hour = formatWorldMinute(state.clock.absoluteMinute).hour;
    return hour >= 6 && hour < 18 ? 'day' : 'night';
}

function eventStatusLabel(event) {
    return {
        active: 'Đang phát triển',
        waiting: 'Chờ điều kiện',
        ready: 'Chờ xác nhận khi đến lúc',
        resolved: 'Kết quả đã hình thành',
        cancelled: 'Đã hủy',
        missed: 'Đã bỏ lỡ',
    }[event.status] || event.status;
}

function visibilityLabel(value) {
    return {
        hidden: 'Nhân vật vẫn chưa rõ',
        trace: 'Có thể nhận biết qua dấu vết',
        known: 'Có thể biết được qua tin tức',
        direct: 'Có thể cảm nhận trực tiếp',
    }[value] || 'Nhân vật vẫn chưa rõ';
}

function deliveryLabel(event) {
    if (event.status === 'ready') return 'Đến lúc đó chờ chạy ngầm xác nhận';
    return {
        none: 'Chỉ có hiệu lực khi chạy ngầm',
        pending: 'Chờ hiển thị tự nhiên',
        delivered: 'Đã được tiếp nối bởi nội dung chính',
        expired: 'Chưa hiển thị, chuyển vào biên niên sử',
    }[event.delivery?.state] || 'Chỉ có hiệu lực khi chạy ngầm';
}

function clockModeLabel(value) {
    return {
        duration: 'Trôi qua tự nhiên',
        active: 'Giờ làm việc hiệu quả',
        scheduled: 'Thời gian dự định',
        condition: 'Chờ điều kiện',
    }[value] || 'Trôi qua tự nhiên';
}

function renderBrandMark() {
    return `
        <span class="wb-brand-mark" aria-hidden="true">
            <i class="wb-orbit wb-orbit-a"></i>
            <i class="wb-orbit wb-orbit-b"></i>
            <i class="wb-brand-core"></i>
        </span>
    `;
}

function renderEmpty(label, detail = '') {
    return `
        <div class="wb-empty">
            <span class="wb-empty-eye"></span>
            <strong>${escapeHtml(label)}</strong>
            ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
        </div>
    `;
}

function renderPersonAvatar(person, size = '') {
    const glyph = person.monogram || person.name?.slice(0, 1) || '·';
    return `
        <span class="wb-person-avatar ${size}">
            ${escapeHtml(glyph)}
            <i></i>
        </span>
    `;
}

export function renderInnerVoice(person, worldMinute, compact = false) {
    if (!person.innerVoice) return '';
    return `
        <blockquote class="wb-inner-voice ${compact ? 'is-compact' : ''}">
            <p>“${escapeHtml(person.innerVoice)}”</p>
        </blockquote>
    `;
}

function renderPersonRow(person, observerMode, worldMinute) {
    return `
        <article class="wb-person-row" role="button" tabindex="0"
            data-wb-action="select-person" data-person-id="${escapeAttr(person.id)}">
            ${renderPersonAvatar(person)}
            <span class="wb-person-row-main">
                <span class="wb-person-name-line">
                    <strong>${escapeHtml(person.name)}</strong>
                    <small>${escapeHtml(person.location)}</small>
                </span>
                <span class="wb-person-action">${escapeHtml(person.action)}</span>
                ${observerMode === 'backstage' ? renderInnerVoice(person, worldMinute, true) : ''}
            </span>
            <span class="wb-row-arrow">↗</span>
        </article>
    `;
}

export function renderPersonCard(person, observerMode, worldMinute, openFolds = new Set()) {
    const foldKey = `people:${person.id}`;
    return `
        <details class="wb-fold wb-person-card" data-fold-key="${escapeAttr(foldKey)}"
            ${foldOpenAttr(openFolds, foldKey)}>
            <summary class="wb-person-card-summary">
                <span class="wb-person-summary-main">
                    ${renderPersonAvatar(person, 'is-large')}
                    <span class="wb-person-summary-copy">
                        <span class="wb-person-summary-heading">
                            <strong>${escapeHtml(person.name)}</strong>
                            <small>${escapeHtml(person.location)}</small>
                        </span>
                        <span class="wb-person-summary-action">${escapeHtml(compactText(person.action, 72) || 'Tạm thời không có hành động mới.')}</span>
                    </span>
                </span>
                <span class="wb-fold-meta">
                    <span class="wb-person-sim-state ${person.simulationEnabled === false ? 'is-sleeping' : ''}">
                        ${person.simulationEnabled === false ? 'Ngủ ngầm' : 'Hoạt động ngầm'}
                    </span>
                    <i class="wb-fold-chevron" aria-hidden="true"></i>
                </span>
            </summary>
            <div class="wb-fold-body wb-person-card-body">
                <span class="wb-person-thread is-current-action">
                    <small>Đang làm</small>
                    <strong>${escapeHtml(person.action || 'Tạm thời không có hành động mới.')}</strong>
                </span>
                <span class="wb-person-thread">
                    <small>Ý định ngắn hạn</small>
                    <strong>${escapeHtml(person.intent || 'Tạm thời không có ý định ngắn hạn rõ ràng.')}</strong>
                </span>
                ${person.longTermGoal ? `
                    <span class="wb-person-thread is-long-term">
                        <small>Mục tiêu dài hạn</small>
                        <strong>${escapeHtml(person.longTermGoal)}</strong>
                    </span>
                ` : ''}
                ${observerMode === 'backstage'
                    ? renderInnerVoice(person, worldMinute)
                    : '<span class="wb-known-boundary">Độc thoại hậu trường đã bị ẩn</span>'}
                <div class="wb-person-card-actions">
                    <button class="wb-card-action-button is-primary" type="button"
                        data-wb-action="select-person" data-person-id="${escapeAttr(person.id)}">Xem chi tiết nhân vật</button>
                    <button class="wb-card-action-button is-edit" type="button" data-wb-action="open-person-editor"
                        data-person-id="${escapeAttr(person.id)}" data-person-name="${escapeAttr(person.name)}">Chỉnh sửa</button>
                </div>
            </div>
        </details>
    `;
}

function renderProgress(event, state, wide = false) {
    const progress = eventProgress(event, state.clock.absoluteMinute);
    const started = formatWorldCalendar(state, event.startedAt);
    const due = Number.isFinite(Number(event.dueAt))
        ? formatWorldCalendar(state, event.dueAt)
        : null;
    const remaining = progress.remaining === null
        ? progress.phase
        : progress.remaining === 0
            ? eventStatusLabel(event)
            : `Còn lại ${formatDuration(progress.remaining)}`;

    if (progress.percent === null) {
        return `
            <div class="wb-condition-progress">
                <span>${escapeHtml(clockModeLabel(event.clockMode))}</span>
                <strong>${escapeHtml(progress.phase)}</strong>
            </div>
        `;
    }

    return `
        <div class="wb-time-progress ${wide ? 'is-wide' : ''}">
            ${wide ? `
                <div class="wb-time-progress-copy">
                    <span>${escapeHtml(started.stamp)}</span>
                    <strong>${escapeHtml(clockModeLabel(event.clockMode))}</strong>
                    <span>${due ? escapeHtml(due.stamp) : 'Thời gian hoàn thành chờ xác nhận'}</span>
                </div>
            ` : ''}
            <span class="wb-time-track">
                <i style="width:${progress.percent}%"></i>
                <b style="left:${progress.percent}%"></b>
            </span>
            <span class="wb-time-foot">
                <small>${escapeHtml(progress.phase)}</small>
                <strong>${escapeHtml(remaining)}</strong>
            </span>
        </div>
    `;
}

function renderEventCard(event, state, wide = false, openFolds = new Set()) {
    if (!wide) {
        return `
            <article class="wb-event-card">
                <div class="wb-event-topline">
                    <span class="wb-phase phase-${escapeAttr(event.status)}">${escapeHtml(eventStatusLabel(event))}</span>
                    <span>${escapeHtml(event.place)}</span>
                </div>
                <h3>${escapeHtml(event.title)}</h3>
                <p>${escapeHtml(event.summary || event.consequence || 'Sự kiện vẫn đang hình thành.')}</p>
                ${renderProgress(event, state, false)}
                <div class="wb-route">
                    <i></i>
                    ${escapeHtml(visibilityLabel(event.visibility))}
                </div>
                <div class="wb-event-card-actions">
                    <button class="wb-card-action-button is-primary wb-event-delivery-toggle ${event.delivery?.manualQueued ? 'is-queued' : ''}"
                        type="button" data-wb-action="toggle-event-delivery"
                        data-event-id="${escapeAttr(event.id)}"
                        ${event.visibility === 'hidden' ? 'disabled' : ''}>
                        ${event.delivery?.manualQueued ? '✓ Hiển thị vòng tiếp theo' : 'Hiển thị vòng tiếp theo'}
                    </button>
                </div>
            </article>
        `;
    }

    const progress = eventProgress(event, state.clock.absoluteMinute);
    const remaining = progress.remaining === null
        ? progress.phase
        : progress.remaining === 0
            ? eventStatusLabel(event)
            : `Còn lại ${formatDuration(progress.remaining)}`;
    const foldKey = `currents:${event.id}`;
    return `
        <details class="wb-fold wb-event-card is-wide" data-fold-key="${escapeAttr(foldKey)}"
            ${foldOpenAttr(openFolds, foldKey)}>
            <summary class="wb-event-summary">
                <span class="wb-event-summary-copy">
                    <span class="wb-event-topline">
                        <span class="wb-phase phase-${escapeAttr(event.status)}">${escapeHtml(eventStatusLabel(event))}</span>
                        <span>${escapeHtml(event.place)}</span>
                    </span>
                    <strong>${escapeHtml(event.title)}</strong>
                    <small>${escapeHtml(compactText(event.summary || event.consequence || 'Sự kiện vẫn đang hình thành.', 90))}</small>
                </span>
                <span class="wb-fold-meta">
                    <span class="wb-fold-status">${escapeHtml(remaining)}</span>
                    <i class="wb-fold-chevron" aria-hidden="true"></i>
                </span>
            </summary>
            <div class="wb-fold-body wb-event-card-body">
                <p>${escapeHtml(event.summary || event.consequence || 'Sự kiện vẫn đang hình thành.')}</p>
                ${event.consequence ? `
                    <div class="wb-consequence">
                        <span>Hậu quả có thể xảy ra</span>
                        <strong>${escapeHtml(event.consequence)}</strong>
                    </div>
                ` : ''}
                ${renderProgress(event, state, true)}
                <div class="wb-route">
                    <i></i>
                    ${escapeHtml(visibilityLabel(event.visibility))}
                </div>
                <div class="wb-event-card-actions">
                    <button class="wb-card-action-button is-primary wb-event-delivery-toggle ${event.delivery?.manualQueued ? 'is-queued' : ''}"
                        type="button" data-wb-action="toggle-event-delivery"
                        data-event-id="${escapeAttr(event.id)}"
                        ${event.visibility === 'hidden' ? 'disabled' : ''}>
                        ${event.delivery?.manualQueued ? '✓ Hiển thị vòng tiếp theo' : 'Hiển thị vòng tiếp theo'}
                    </button>
                    <button class="wb-card-action-button is-edit" type="button" data-wb-action="open-event-editor"
                        data-event-id="${escapeAttr(event.id)}">Chỉnh sửa</button>
                    <button class="wb-card-action-button is-danger" type="button" data-wb-action="delete-event"
                        data-event-id="${escapeAttr(event.id)}">Xóa</button>
                </div>
            </div>
        </details>
    `;
}

function renderOutcome(event, state, openFolds = new Set()) {
    const time = formatWorldCalendar(
        state,
        event.resolvedAt ?? event.updatedAt ?? event.dueAt ?? 0,
    );
    const result = event.result || event.expectedResult || event.consequence || 'Kết quả đang chờ xác nhận.';
    const foldKey = `echoes:${event.id}`;
    return `
        <article class="wb-echo-item">
            <time>${escapeHtml(`${time.shortDate} ${time.time}`)}</time>
            <span class="wb-timeline-node state-${escapeAttr(event.delivery?.state || 'none')}"></span>
            <details class="wb-fold wb-echo-card" data-fold-key="${escapeAttr(foldKey)}"
                ${foldOpenAttr(openFolds, foldKey)}>
                <summary class="wb-echo-summary">
                    <span class="wb-echo-copy">
                        <strong>${escapeHtml(event.title)}</strong>
                        <small>${escapeHtml(compactText(result, 96))}</small>
                    </span>
                    <span class="wb-fold-meta">
                        <span class="wb-record-state">${escapeHtml(deliveryLabel(event))}</span>
                        <i class="wb-fold-chevron" aria-hidden="true"></i>
                    </span>
                </summary>
                <div class="wb-fold-body wb-echo-body">
                    <p>${escapeHtml(result)}</p>
                    <div class="wb-record-actions">
                        <button class="wb-card-action-button is-edit" type="button" data-wb-action="open-record-editor"
                            data-record-kind="echo" data-record-id="${escapeAttr(event.id)}">Chỉnh sửa</button>
                        <button class="wb-card-action-button is-danger" type="button" data-wb-action="delete-record"
                            data-record-kind="echo" data-record-id="${escapeAttr(event.id)}">Xóa</button>
                    </div>
                </div>
            </details>
        </article>
    `;
}

function renderArchiveEntry(entry, state, recordKind = 'archive', openFolds = new Set()) {
    const time = Number.isFinite(Number(entry.resolvedAt ?? entry.at))
        ? formatWorldCalendar(state, entry.resolvedAt ?? entry.at)
        : null;
    const title = entry.title || 'Bản ghi chưa đặt tên';
    const text = entry.result || entry.text || entry.consequence || entry.route || '';
    const tags = [
        entry.visibility ? visibilityLabel(entry.visibility) : '',
        entry.delivery?.state ? deliveryLabel(entry) : '',
        entry.deliveryState === 'expired' ? 'Chưa hiển thị, chuyển vào biên niên sử' : '',
    ].filter(Boolean);
    const foldKey = `archive:${recordKind}:${entry.id}`;

    return `
        <article class="wb-archive-entry">
            <div class="wb-archive-date">
                <strong>${time ? time.date : 'Chưa định ngày'}</strong>
                <span>${time ? time.time : '—'}</span>
            </div>
            <span class="wb-archive-rule"></span>
            <details class="wb-fold wb-archive-copy" data-fold-key="${escapeAttr(foldKey)}"
                ${foldOpenAttr(openFolds, foldKey)}>
                <summary class="wb-archive-summary">
                    <span>
                        <strong>${escapeHtml(title)}</strong>
                        <small>${escapeHtml(compactText(text || 'Việc này đã trở thành sự thật thế giới.', 100))}</small>
                    </span>
                    <i class="wb-fold-chevron" aria-hidden="true"></i>
                </summary>
                <div class="wb-fold-body wb-archive-body">
                    <p>${escapeHtml(text || 'Việc này đã trở thành sự thật thế giới.')}</p>
                    <div class="wb-archive-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
                    <div class="wb-record-actions">
                        <button class="wb-card-action-button is-edit" type="button" data-wb-action="open-record-editor"
                            data-record-kind="${escapeAttr(recordKind)}" data-record-id="${escapeAttr(entry.id)}">Chỉnh sửa</button>
                        <button class="wb-card-action-button is-danger" type="button" data-wb-action="delete-record"
                            data-record-kind="${escapeAttr(recordKind)}" data-record-id="${escapeAttr(entry.id)}">Xóa</button>
                    </div>
                </div>
            </details>
        </article>
    `;
}

function syncPhaseLabel(phase) {
    return {
        idle: 'Chờ nội dung chính',
        queued: 'Đang xếp hàng',
        running: 'Đang suy diễn',
        cancelling: 'Đang dừng',
        success: 'Suy diễn hoàn tất',
        error: 'Suy diễn thất bại',
        pending: 'Chờ suy diễn',
    }[phase] || 'Chờ nội dung chính';
}

function renderSyncStrip(syncStatus) {
    const status = syncStatus || {};
    const connection = status.lastConnection || status.connection || {};
    const memoryPhase = status.memory?.phase;
    const memoryTakesFocus = ['running', 'error'].includes(memoryPhase);
    const phase = memoryTakesFocus ? memoryPhase : (status.phase || 'idle');
    const baseDetail = memoryTakesFocus
        ? status.memory?.message || (memoryPhase === 'error' ? 'Sắp xếp ký ức chưa hoàn thành' : 'Đang sắp xếp ký ức dài hạn')
        : status.error || status.message || 'Chưa tiến hành suy diễn thế giới';
    const waitingTurns = Math.max(0, Number(status.queue?.waitingTurns) || 0);
    const detail = !memoryTakesFocus && waitingTurns > 0 && !String(baseDetail).includes('Chờ xử lý')
        ? `${baseDetail} · Phía sau vẫn còn ${waitingTurns} vòng chờ xử lý`
        : baseDetail;
    const title = memoryTakesFocus
        ? (memoryPhase === 'error' ? 'Sắp xếp ký ức thất bại' : 'Đang sắp xếp ký ức')
        : syncPhaseLabel(phase);
    const connectionText = [
        connection.apiLabel,
        connection.model,
    ].filter(Boolean).join(' · ');
    const summary = !memoryTakesFocus && phase === 'success' ? status.summary : null;
    const changedNames = summary?.peopleNames?.length
        ? `（${summary.peopleNames.map(escapeHtml).join('、')}）`
        : '';
    const eventNames = summary?.eventTitles?.length
        ? `（${summary.eventTitles.map(escapeHtml).join('、')}）`
        : '';
    const summaryHtml = summary ? `
        <details class="wb-sync-summary">
            <summary>Thay đổi lần này</summary>
            <div>
                <span>Thời gian thế giới</span><strong>${summary.elapsedMinutes > 0 ? `+${escapeHtml(formatDuration(summary.elapsedMinutes))}` : 'Chưa tiến hành'}</strong>
                <span>Thay đổi nhân vật</span><strong>${summary.peopleChanged || 0} Người ${changedNames}</strong>
                <span>Thay đổi sự kiện</span><strong>Thêm mới ${summary.eventsAdded || 0} · Cập nhật ${summary.eventsUpdated || 0} ${eventNames}</strong>
                <span>Thay đổi ký ức</span><strong>Thêm mới ${summary.memoryAdded || 0} · Cập nhật ${summary.memoryUpdated || 0}</strong>
                <span>Hiển thị nội dung chính</span><strong>${summary.injectionEvents || 0} sự kiện</strong>
            </div>
        </details>
    ` : '';

    return `
        <div class="wb-sync-strip is-${escapeAttr(phase)}" role="${phase === 'error' ? 'alert' : 'status'}">
            <i class="wb-sync-indicator"></i>
            <div class="wb-sync-copy">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(detail)}</span>
            </div>
            <span class="wb-sync-connection">${escapeHtml(connectionText || 'Theo chính hiện tại của Tavern API')}</span>
            ${summaryHtml}
        </div>
    `;
}

function renderSettings(state, settings, syncStatus, openGroups = new Set(), openSubgroups = new Set(), apiDraft = null, tagFilterRules = null, tagCandidates = [], worldbookUi = {}) {
    const clock = formatWorldCalendar(state);
    const clockLabel = worldClockLabel(state, clock);
    const connection = syncStatus?.connection || {};
    const memory = syncStatus?.memory || {};
    const phase = syncStatus?.phase || 'idle';
    const historyRunning = memory.phase === 'running';
    const availableModels = Array.isArray(syncStatus?.availableModels)
        ? syncStatus.availableModels
        : [];
    const modelPull = syncStatus?.modelPull || { phase: 'idle', message: '' };
    const worldbook = syncStatus?.worldbook || { books: [], entries: [], phase: 'idle' };
    const recovery = syncStatus?.recovery || { count: 0, latest: null };
    const latestRecovery = recovery.latest || null;
    const worldbookBooks = Array.isArray(worldbook.books) ? worldbook.books : [];
    const worldbookEntries = Array.isArray(worldbook.entries) ? worldbook.entries : [];
    const worldbookQuery = String(worldbookUi.query || '').slice(0, 120);
    const worldbookOnlyPeople = Boolean(worldbookUi.onlyPeople);
    const worldbookOnlyEnabled = Boolean(worldbookUi.onlyEnabled);
    const worldbookSelectedIds = worldbookUi.selectedIds instanceof Set
        ? worldbookUi.selectedIds
        : new Set(Array.isArray(worldbookUi.selectedIds) ? worldbookUi.selectedIds.map(String) : []);
    const filteredWorldbookEntries = filterWorldbookEntries(worldbookEntries, {
        query: worldbookQuery,
        onlyPeople: worldbookOnlyPeople,
        onlyEnabled: worldbookOnlyEnabled,
    });
    const worldbookSelectedCount = worldbookSelectedIds.size;
    const rules = Array.isArray(tagFilterRules)
        ? tagFilterRules
        : (settings.tagFilterRules || []);
    const hasSavedApiKey = Boolean(settings.customApiKey);
    const apiValues = {
        customApiUrl: apiDraft?.customApiUrl ?? settings.customApiUrl,
        customApiCredential: apiDraft?.customApiCredential ?? '',
        customApiModel: apiDraft?.customApiModel ?? settings.customApiModel,
        customApiTransport: apiDraft?.customApiTransport ?? settings.customApiTransport,
        profileName: apiDraft?.profileName ?? '',
        profileId: apiDraft?.profileId ?? '',
    };
    const apiProfiles = Array.isArray(settings.apiProfiles) ? settings.apiProfiles : [];
    const apiModuleRoutes = settings.apiModuleRoutes && typeof settings.apiModuleRoutes === 'object'
        ? settings.apiModuleRoutes
        : {};
    const routeOptions = (current = 'default') => [
        `<option value="default" ${current === 'default' ? 'selected' : ''}>Theo kết nối mặc định của mặt trái thế giới</option>`,
        `<option value="tavern" ${current === 'tavern' ? 'selected' : ''}>Theo Tavern hiện tại</option>`,
        ...apiProfiles.map(profile => {
            const value = `profile:${profile.id}`;
            return `<option value="${escapeAttr(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(profile.model || 'Chưa chọn mô hình')}</option>`;
        }),
    ].join('');
    const settingExplanation = (setting, value) => {
        const key = String(value);
        const maps = {
            apiMode: {
                tavern: 'Cứ theo kết nối hiện tại của Tavern là được nha~ Trò chuyện chính đổi mô hình, bên này cũng sẽ đổi theo (｡•̀ᴗ-)✧',
                custom: 'Mặt trái thế giới tự chạy giao diện độc lập~ Sẽ không đụng đến kết nối trò chuyện chính.',
            },
            theme: {
                auto: 'Để giao diện tự thay đồ theo ngày đêm của thế giới~',
                day: 'Cố định phối màu ban ngày, sáng sủa (◕ᴗ◕✿)',
                night: 'Cố định phối màu ban đêm, thích hợp để lén nhìn thế giới vào đêm khuya (chằm chằm)',
            },
            uiScale: {
                compact: 'Thông tin ép chặt một chút~ Thích hợp khi muốn nhìn nhiều thứ cùng lúc.',
                comfortable: 'Đề xuất mặc định~ Không chật cũng không trống, nhìn vừa vặn.',
                large: 'Chữ lớn hơn một chút~ Sẽ thoải mái hơn cho phiên bản di động và khi nhìn chạy ngầm trong thời gian dài.',
            },
            deliveryDensity: {
                restrained: 'Chạy ngầm vẫn sinh hoạt bình thường, chỉ là ít giành ống kính hơn~',
                balanced: 'Kết quả quan trọng sẽ tự nhiên tiến lại gần ống kính~ Khi nào cần xuất hiện thì mới xuất hiện.',
                active: 'Sẽ tích cực tìm cơ hội lộ mặt hơn, cảm giác tồn tại của thế giới mạnh mẽ hơn một chút ( •̀ ω •́ )✧',
            },
            autoSimulationMode: {

                light: 'Nhẹ nhàng bảo trì những thay đổi cần thiết~ Yên tĩnh hơn một chút, cũng tiết kiệm gọi hơn.',
                balanced: 'Đề xuất mặc định~ Nhân vật và sự kiện đều sẽ sống những ngày bình thường của mình.',
                deep: 'Sẽ chăm sóc cẩn thận hơn những người và nhân quả ngoài ống kính~ Cốt truyện phức tạp phù hợp với cái này hơn.',
            },
            timePolicy: {
                world: 'Đồng hồ thế giới chịu trách nhiệm theo dõi thời gian liên tục~ Khi nội dung chính đưa ra thời gian đáng tin cậy sẽ tự động theo kịp.',
                explicit: 'Chỉ khi thời gian có thể tính toán rõ ràng mới tiến hành~ Cẩn thận nhất.',
                cautious: 'Cho phép ước lượng một chút, nhưng sẽ rất kiềm chế~',
                open: 'Những việc tốn nhiều thời gian như du lịch, chờ đợi, làm việc cũng có thể tiến về phía trước một cách tự nhiên~',
            },
            publicOpinionRevealMode: {
                observe: 'Cứ yên tâm hóng hớt thôi~ Tin tức và diễn đàn chỉ ở trang dư luận. (˘▾˘)',
                relevant: 'Chỉ khi thực sự liên quan đến ống kính hiện tại, mới để nó hiển thị tự nhiên~ Sẽ không chèn ép vào.',
            },
        };
        return maps[setting]?.[key] || '';
    };
    const historyPercent = memory.total > 0
        ? Math.min(100, Math.round((Number(memory.processed) || 0) / memory.total * 100))
        : 0;
    const themeButton = (id, label) => `
        <button type="button" data-wb-action="setting-button"
            data-setting="theme" data-value="${id}"
            class="${settings.theme === id ? 'is-active' : ''}">${label}</button>
    `;
    const densityButton = (id, label) => `
        <button type="button" data-wb-action="setting-button"
            data-setting="deliveryDensity" data-value="${id}"
            class="${settings.deliveryDensity === id ? 'is-active' : ''}">${label}</button>
    `;
    const settingButton = (setting, current, id, label) => `
        <button type="button" data-wb-action="setting-button"
            data-setting="${setting}" data-value="${id}"
            class="${String(current) === String(id) ? 'is-active' : ''}">${label}</button>
    `;
    const groupOpen = id => openGroups.has(id) ? 'open' : '';
    const subgroupOpen = id => openSubgroups.has(id) ? 'open' : '';

    return `
        <div class="wb-settings-popover" role="dialog" aria-modal="true" aria-label="Cài đặt mặt trái thế giới">
            <div class="wb-popover-heading">
                <div><span>OBSERVATION</span><h3>Cài đặt quan sát</h3></div>
                <button type="button" data-wb-action="toggle-settings" aria-label="Đóng cài đặt">×</button>
            </div>

            <details class="wb-settings-group" data-settings-group="connection" ${groupOpen('connection')}>
                <summary><span>Kết nối</span><small>API Và mô hình</small></summary>
                <div class="wb-settings-group-body wb-settings-subgroup-stack">
                    <div class="wb-settings-flat-section">
            <div class="wb-connection-card is-${escapeAttr(phase)}">
                <div>
                    <span>Kết nối suy diễn thế giới</span>
                    <strong>${escapeHtml(connection.apiLabel || 'Theo chính hiện tại của Tavern API')}</strong>
                </div>
                <dl>
                    <dt>Mô hình</dt><dd>${escapeHtml(connection.model || 'Theo mô hình hiện tại của Tavern')}</dd>
                    ${connection.profile ? `<dt>Hồ sơ kết nối</dt><dd>${escapeHtml(connection.profile)}</dd>` : ''}
                    <dt>Phương thức</dt><dd>${escapeHtml(connection.method || 'Suy diễn ngữ cảnh độc lập')}</dd>
                    <dt>Trạng thái</dt><dd>${escapeHtml(syncPhaseLabel(phase))}</dd>
                </dl>
                ${syncStatus?.error ? `<p>${escapeHtml(syncStatus.error)}</p>` : ''}
                <small>${settings.apiMode === 'custom'
                    ? 'Mặt trái thế giới chạy giao diện riêng~ Bên trò chuyện chính sẽ không bị làm phiền.'
                    : 'Cứ theo kết nối hiện tại của Tavern là được~'}</small>
            </div>

            <div class="wb-setting-block">
                <label>Kết nối suy diễn thế giới</label>
                <div class="wb-option-row">
                    ${settingButton('apiMode', settings.apiMode, 'tavern', 'Theo Tavern')}
                    ${settingButton('apiMode', settings.apiMode, 'custom', 'Giao diện độc lập')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('apiMode', settings.apiMode))}</p>
            </div>
                    </div>
                    <details class="wb-settings-subgroup" data-settings-subgroup="connection-custom" ${subgroupOpen('connection-custom')}>
                        <summary><span>Cấu hình giao diện độc lập</span><small>Địa chỉ,Key、Mô hình và phương thức kết nối</small></summary>
                        <div class="wb-settings-subgroup-body">
                <form class="wb-api-form" data-wb-form="api" autocomplete="off">
                    <input type="hidden" name="profileId" value="${escapeAttr(apiValues.profileId)}">
                    <div class="wb-api-draft-heading">
                        <span>${apiValues.profileId ? 'Đang chỉnh sửa phương án đã lưu~Key Để trống thì tiếp tục sử dụng cái cũ.' : (hasSavedApiKey ? 'Đã lưu giao diện độc lập mặc định; cũ Key Sẽ không hiển thị lại.' : 'Ở đây có thể cấu hình giao diện tạm thời, cũng có thể lưu thành phương án để các mô-đun khác nhau tái sử dụng~')}</span>
                        <button type="button" data-wb-action="reset-api-draft">Xóa và điền lại</button>
                    </div>
                    <label>Địa chỉ API
                        <input name="customApiUrl" type="url" required
                            value="${escapeAttr(apiValues.customApiUrl)}"
                            autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false"
                            placeholder="https://example.com/v1">
                    </label>
                    <p>Vui lòng điền đến cấp phiên bản, ví dụ <code>/v1</code>；Plugin sẽ chỉ tự động bổ sung <code>/chat/completions</code>。</p>
                    <label>API Key
                        <span class="wb-api-secret-field">
                            <input class="wb-secret-input" name="customApiCredential" type="text"
                                value="${escapeAttr(apiValues.customApiCredential)}"
                                placeholder="${hasSavedApiKey ? 'Để trống thì tiếp tục sử dụng cái đã lưu Key' : 'Vui lòng nhập API Key'}"
                                autocomplete="one-time-code" autocapitalize="none" spellcheck="false"
                                data-lpignore="true" data-1p-ignore data-form-type="other"
                                ${hasSavedApiKey ? '' : 'required'}>
                            <button type="button" data-wb-action="toggle-api-key-visibility"
                                aria-pressed="false">Hiển thị</button>
                        </span>
                    </label>
                    <p>${hasSavedApiKey
                        ? 'Nhập mới Key Sẽ thay thế cũ Key；Để trống thì tiếp tục sử dụng. Để tránh điện thoại tự động điền lại, cũ Key Sẽ không đưa lại vào ô nhập.'
                        : 'Key Chỉ lưu trên máy cục bộ SillyTavern Trong cài đặt tiện ích mở rộng, sẽ không ghi vào trạng thái thế giới được xuất.'}</p>
                    <label>Tên mô hình
                        <input name="customApiModel" required list="wb-custom-model-list"
                            value="${escapeAttr(apiValues.customApiModel)}"
                            autocomplete="off" autocapitalize="none" spellcheck="false"
                            placeholder="gemini-2.5-flash">
                        <datalist id="wb-custom-model-list">
                            ${availableModels.map(model => `<option value="${escapeAttr(model)}"></option>`).join('')}
                        </datalist>
                    </label>
                    <label>Phương thức kết nối
                        <select name="customApiTransport">
                            <option value="proxy" ${apiValues.customApiTransport === 'proxy' ? 'selected' : ''}>
                                Chuyển tiếp qua máy chủ Tavern (khuyên dùng)
                            </option>
                            <option value="direct" ${apiValues.customApiTransport === 'direct' ? 'selected' : ''}>
                                Trình duyệt kết nối trực tiếp
                            </option>
                        </select>
                    </label>
                    <label>Tên phương án (tùy chọn)
                        <input name="profileName" maxlength="80"
                            value="${escapeAttr(apiValues.profileName)}"
                            autocomplete="off" placeholder="Ví dụ: Chủ lực Pro / Trạm công ích Flash">
                    </label>
                    <p>Nếu chỉ tạm thời thử nghiệm giao diện thì không cần quan tâm chỗ này～ Muốn sau này tái sử dụng trực tiếp, hãy điền một cái tên rồi nhấp vào 「Lưu thành phương án」.</p>
                    <div class="wb-api-actions">
                        <button class="wb-api-action is-primary" type="submit">Lưu giao diện độc lập mặc định</button>
                        <button class="wb-api-action is-accent" type="button" data-wb-action="save-api-profile-from-form">${apiValues.profileId ? 'Lưu sửa đổi phương án' : 'Lưu thành phương án'}</button>
                        <button class="wb-api-action" type="button" data-wb-action="test-api">Kiểm tra kết nối</button>
                        <button class="wb-api-action" type="button" data-wb-action="pull-api-models"
                            ${modelPull.phase === 'running' ? 'disabled' : ''}>
                            ${modelPull.phase === 'running' ? 'Đang lấy…' : 'Lấy danh sách mô hình'}
                        </button>
                    </div>
                    ${modelPull.message ? `<p class="wb-api-model-status is-${escapeAttr(modelPull.phase)}">${escapeHtml(modelPull.message)}</p>` : ''}
                </form>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="connection-profiles" ${subgroupOpen('connection-profiles')}>
                        <summary><span>Đã lưu API Phương án</span><small>${apiProfiles.length ? `${apiProfiles.length} phương án` : 'Vẫn chưa lưu phương án'}</small></summary>
                        <div class="wb-settings-subgroup-body">
                            ${apiProfiles.length ? `
                                <div class="wb-api-profile-list">
                                    ${apiProfiles.map(profile => `
                                        <article class="wb-api-profile-card">
                                            <div>
                                                <strong>${escapeHtml(profile.name)}</strong>
                                                <span>${escapeHtml(profile.model || 'Chưa chọn mô hình')} · ${escapeHtml(profile.transport === 'direct' ? 'Trình duyệt kết nối trực tiếp' : 'Chuyển tiếp Tavern')}</span>
                                            </div>
                                            <div class="wb-api-profile-actions">
                                                <button class="wb-api-profile-chip is-accent" type="button" data-wb-action="edit-api-profile" data-profile-id="${escapeAttr(profile.id)}">Chỉnh sửa</button>
                                                <button class="wb-api-profile-chip" type="button" data-wb-action="test-api-profile" data-profile-id="${escapeAttr(profile.id)}">Kiểm tra</button>
                                                <button class="wb-api-profile-chip" type="button" data-wb-action="pull-api-profile-models" data-profile-id="${escapeAttr(profile.id)}">Mô hình</button>
                                                <button class="wb-api-profile-chip" type="button" data-wb-action="duplicate-api-profile" data-profile-id="${escapeAttr(profile.id)}">Sao chép</button>
                                                <button class="wb-api-profile-chip is-danger" type="button" data-wb-action="delete-api-profile" data-profile-id="${escapeAttr(profile.id)}">Xóa</button>
                                            </div>
                                        </article>
                                    `).join('')}
                                </div>
                            ` : '<p>Giao diện thường dùng có thể lưu bằng một cú nhấp chuột từ biểu mẫu giao diện độc lập ở trên～ Sau này khi phân luồng cho các mô-đun khác nhau sẽ không cần điền lại URL Và Key rồi `(｡•̀ᴗ-)✧`</p>'}
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="connection-routing" ${subgroupOpen('connection-routing')}>
                        <summary><span>Mô-đun API Phân luồng</span><small>Mặc định đều theo kết nối mặc định của mặt trái thế giới</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <p>Các mô-đun cần chạy mô hình riêng biệt có thể đi theo đường riêng～ Nếu không cài đặt thì tiếp tục theo kết nối mặc định, người dùng bình thường hoàn toàn không cần quan tâm chỗ này.</p>
                            <div class="wb-api-route-grid">
                                <label>Suy diễn thế giới
                                    <select data-wb-api-route="simulation">${routeOptions(apiModuleRoutes.simulation || 'default')}</select>
                                </label>
                                <label>Quan sát nhân vật tức thời
                                    <select data-wb-api-route="observation">${routeOptions(apiModuleRoutes.observation || 'default')}</select>
                                </label>
                                <label>Ký ức dài hạn / Sắp xếp lịch sử
                                    <select data-wb-api-route="history">${routeOptions(apiModuleRoutes.history || 'default')}</select>
                                </label>
                                <label>Dư luận thế giới
                                    <select data-wb-api-route="opinion">${routeOptions(apiModuleRoutes.opinion || 'default')}</select>
                                </label>
                            </div>
                        </div>
                    </details>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="appearance" ${groupOpen('appearance')}>
                <summary><span>Giao diện và hiển thị</span><small>Chủ đề, cỡ chữ, chèn nội dung chính</small></summary>
                <div class="wb-settings-group-body wb-settings-subgroup-stack">
                    <details class="wb-settings-subgroup" data-settings-subgroup="appearance-ui" ${subgroupOpen('appearance-ui')}>
                        <summary><span>Giao diện</span><small>Sáng tối và cỡ chữ đọc</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>Sáng tối giao diện</label>
                <div class="wb-option-row">
                    ${themeButton('auto', 'Tự động')}
                    ${themeButton('day', 'Ban ngày')}
                    ${themeButton('night', 'Ban đêm')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('theme', settings.theme))}</p>
            </div>

            <div class="wb-setting-block">
                <label>Cỡ chữ giao diện</label>
                <div class="wb-option-row">
                    ${settingButton('uiScale', settings.uiScale, 'compact', 'Nhỏ gọn')}
                    ${settingButton('uiScale', settings.uiScale, 'comfortable', 'Tiêu chuẩn')}
                    ${settingButton('uiScale', settings.uiScale, 'large', 'Chữ lớn')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('uiScale', settings.uiScale))}</p>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="appearance-reveal" ${subgroupOpen('appearance-reveal')}>
                        <summary><span>Hiển thị</span><small>Mật độ và thời điểm vào nội dung chính</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>Độ hiển thị nội dung chính</label>
                <div class="wb-option-row">
                    ${densityButton('restrained', 'Kiềm chế')}
                    ${densityButton('balanced', 'Cân bằng')}
                    ${densityButton('active', 'Sôi nổi')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('deliveryDensity', settings.deliveryDensity))}</p>
            </div>

            <div class="wb-setting-block">
                <label for="wb-scene-timing">Thời điểm hiển thị</label>
                <select id="wb-scene-timing" data-wb-setting="sceneTiming">
                    <option value="strict" ${settings.sceneTiming === 'strict' ? 'selected' : ''}>Nghiêm ngặt: Chỉ khi chuyển cảnh hoặc khoảng trống</option>
                    <option value="smart" ${settings.sceneTiming === 'smart' ? 'selected' : ''}>Thông minh: Trì hoãn cảnh quan trọng</option>
                    <option value="open" ${settings.sceneTiming === 'open' ? 'selected' : ''}>Mở: Cho phép thay đổi tự nhiên ngắn gọn</option>
                </select>
            </div>

            <div class="wb-setting-toggle">
                <div><strong>Kết quả chạy ngầm hiển thị tự nhiên</strong><span>Tắt đi cũng không làm thế giới mất trí nhớ~ Chỉ là không chủ động đưa kết quả chạy ngầm vào nội dung chính; sự thật thế giới đã thành lập luôn được sử dụng để duy trì tính liên tục.</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="worldPromptInjection"
                        ${settings.worldPromptInjection ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>

            <div class="wb-setting-block">
                <label>Dư luận có gần với tuyến truyện chính không</label>
                <div class="wb-option-row">
                    ${settingButton('publicOpinionRevealMode', settings.publicOpinionRevealMode, 'observe', 'Chỉ quan sát')}
                    ${settingButton('publicOpinionRevealMode', settings.publicOpinionRevealMode, 'relevant', 'Hiển thị khi liên quan')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('publicOpinionRevealMode', settings.publicOpinionRevealMode))}</p>
            </div>
                        </div>
                    </details>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="simulation" ${groupOpen('simulation')}>
                <summary><span>Thế giới vận hành</span><small>Để thế giới ngoài ống kính tiếp tục tự bước đi~</small></summary>
                <div class="wb-settings-group-body wb-settings-subgroup-stack">
                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-switches" ${subgroupOpen('simulation-switches')}>
                        <summary><span>Công tắc cơ bản</span><small>Có muốn để chạy ngầm tiếp tục hoạt động không</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-toggle">
                <div><strong>Bật engine thế giới</strong><span>Tắt đi thì để chạy ngầm nghỉ ngơi một lát~ Thế giới hiện tại sẽ không bị mất</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="worldSimulationEnabled"
                        ${settings.worldSimulationEnabled ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-trigger" ${subgroupOpen('simulation-trigger')}>
                        <summary><span>Phương thức vận hành</span><small>Mặt trái thế giới cần chăm chỉ thế nào~</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>Cường độ vận hành thế giới</label>
                <div class="wb-option-row">
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'light', 'Gọn nhẹ')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'balanced', 'Cân bằng')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'deep', 'Chuyên sâu')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('autoSimulationMode', settings.autoSimulationMode))}</p>
                <label>Tần suất kích hoạt tự động</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 1, 'Mỗi vòng')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 2, 'Mỗi 2 Vòng')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 3, 'Mỗi 3 Vòng')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 5, 'Mỗi 5 Vòng')}
                </div>
                <label class="wb-number-setting">
                    Tùy chỉnh số vòng tích lũy
                    <input type="number" min="1" max="20" step="1"
                        data-wb-setting="autoSimulationInterval"
                        value="${escapeAttr(settings.autoSimulationInterval)}">
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-output" ${subgroupOpen('simulation-output')}>
                        <summary><span>Thất bại và đầu ra</span><small>Thử lại, ngân sách đầu ra và yêu cầu bổ sung</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>Tự động thử lại khi suy diễn thất bại</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('autoRetryCount', settings.autoRetryCount, 0, 'Không thử lại')}
                    ${settingButton('autoRetryCount', settings.autoRetryCount, 1, 'Thử lại 1 Lần')}
                    ${settingButton('autoRetryCount', settings.autoRetryCount, 2, 'Thử lại 2 Lần')}
                    ${settingButton('autoRetryCount', settings.autoRetryCount, 3, 'Thử lại 3 Lần')}
                </div>
                <label class="wb-number-setting">
                    Tùy chỉnh số lần thử lại
                    <input type="number" min="0" max="5" step="1"
                        data-wb-setting="autoRetryCount"
                        value="${escapeAttr(settings.autoRetryCount)}">
                </label>
                <label>Đầu ra tối đa mỗi lần</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 0, 'Tự động')}
                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 4000, '4K')}
                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 8000, '8K')}
                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 12000, '12K')}
                </div>
                <label class="wb-number-setting">
                    Tùy chỉnh đầu ra token
                    <input type="number" min="0" max="16000" step="500"
                        data-wb-setting="maxOutputTokens"
                        value="${escapeAttr(settings.maxOutputTokens)}">
                </label>
                <label class="wb-custom-instruction">
                    Tùy chỉnh yêu cầu suy diễn
                    <textarea data-wb-setting="customSimulationInstruction" maxlength="1000" rows="3"
                        placeholder="Ví dụ: Ít tạo sự kiện mới; chú ý hơn đến sự thay đổi của thương hội và bến cảng.">${escapeHtml(settings.customSimulationInstruction)}</textarea>
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-npc" ${subgroupOpen('simulation-npc')}>
                        <summary><span>NPC Và ranh giới người chơi</span><small>Số người chạy ngầm và nội tâm người chơi</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>Chạy ngầm NPC Ngân sách</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 0, 'Không chủ động suy diễn')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 2, 'Tối đa 2 Người')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 4, 'Tối đa 4 Người')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 8, 'Tối đa 8 Người')}
                </div>
                <label class="wb-number-setting">
                    Tùy chỉnh giới hạn số người
                    <input type="number" min="0" max="12" step="1"
                        data-wb-setting="backgroundNpcBudget"
                        value="${escapeAttr(settings.backgroundNpcBudget)}">
                </label>
            </div>

            <div class="wb-setting-toggle">
                <div><strong>Miêu tả nội tâm người chơi</strong><span>Mặc định tắt, tránh để plugin quyết định suy nghĩ và lập trường thay bạn</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="includeUserInnerVoice"
                        ${settings.includeUserInnerVoice ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-context" ${subgroupOpen('simulation-context')}>
                        <summary><span>Ngữ cảnh và thời gian</span><small>Phạm vi đọc và chiến lược đồng hồ thế giới</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>Phạm vi đọc nội dung chính</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('contextTurns', settings.contextTurns, 1, 'Gần đây 1 Vòng')}
                    ${settingButton('contextTurns', settings.contextTurns, 3, 'Gần đây 3 Vòng')}
                    ${settingButton('contextTurns', settings.contextTurns, 5, 'Gần đây 5 Vòng')}
                    <button type="button" data-wb-action="setting-button"
                        data-setting="contextTurns" data-value="${escapeAttr(settings.customContextTurns || 8)}"
                        class="${![1, 3, 5].includes(Number(settings.contextTurns)) ? 'is-active' : ''}">Tùy chỉnh</button>
                </div>
                ${![1, 3, 5].includes(Number(settings.contextTurns)) ? `
                    <label class="wb-number-setting wb-context-custom">
                        Đọc vài vòng gần đây
                        <input type="number" min="1" max="30" step="1"
                            data-wb-setting="contextTurns" value="${escapeAttr(settings.contextTurns)}">
                    </label>
                ` : ''}
                <p class="wb-setting-explanation">${escapeHtml(
                    [1, 3, 5].includes(Number(settings.contextTurns))
                        ? ({1: 'Chỉ xem vòng mới nhất, nhẹ nhất và tiết kiệm nhất~ Phù hợp với cốt truyện mà thông tin hiện tại đã rất rõ ràng.', 3: 'Đọc gần đây 3 vòng, tính liên tục và tiêu hao đều khá nhẹ nhàng, phù hợp với hầu hết các cảnh hàng ngày.', 5: 'Mặc định đề xuất~ Gần đây 5 vòng thường đủ để nắm bắt nhân vật và sự kiện, lại không dễ làm ngữ cảnh phình to.'}[Number(settings.contextTurns)])
                        : `Bây giờ sẽ đọc gần đây ${settings.contextTurns} vòng ~ sự kiện dài và cốt truyện nhiều người sẽ ổn định hơn, nhưng số vòng càng cao,Token cũng sẽ béo lên theo.`
                )}</p>
            </div>

            <div class="wb-setting-block">
                <label>Thời gian trôi qua</label>
                <div class="wb-option-row">
                    ${settingButton('timePolicy', settings.timePolicy, 'world', 'Đồng hồ thế giới')}
                    ${settingButton('timePolicy', settings.timePolicy, 'explicit', 'Nghiêm ngặt')}
                    ${settingButton('timePolicy', settings.timePolicy, 'cautious', 'Kiềm chế')}
                    ${settingButton('timePolicy', settings.timePolicy, 'open', 'Mở')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('timePolicy', settings.timePolicy))}</p>
            </div>
                        </div>
                    </details>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="worldbook" ${groupOpen('worldbook')}>
                <summary><span>Nhân vật Worldbook</span><small>Tìm kiếm, nhận dạng và nhập hàng loạt</small></summary>
                <div class="wb-settings-group-body">
                    <div class="wb-settings-flat-section">
                    <form class="wb-worldbook-import" data-wb-form="worldbook">
                        <label>Chọn Worldbook
                            <select name="bookName" ${worldbookBooks.length ? '' : 'disabled'}>
                                ${worldbookBooks.length
                                    ? worldbookBooks.map(book => `<option value="${escapeAttr(book)}"
                                        ${book === worldbook.bookName ? 'selected' : ''}>${escapeHtml(book)}</option>`).join('')
                                    : '<option value="">Tavern hiện không có Worldbook nào có thể đọc</option>'}
                            </select>
                        </label>
                        <button class="wb-worldbook-scan-button" type="button" data-wb-action="scan-worldbook"
                            ${worldbook.phase === 'running' || !worldbookBooks.length ? 'disabled' : ''}>
                            ${worldbook.phase === 'running' ? 'Đang đọc…' : 'Đọc và nhận dạng nhân vật'}
                        </button>
                        ${worldbook.message ? `<div class="wb-worldbook-status is-${escapeAttr(worldbook.phase)}">${escapeHtml(worldbook.message)}</div>` : ''}
                        ${worldbookEntries.length ? `
                            <div class="wb-worldbook-browser">
                                <label class="wb-worldbook-search">
                                    <span>Tìm kiếm mục</span>
                                    <input type="search" name="worldbookSearch" data-wb-worldbook-search value="${escapeAttr(worldbookQuery)}"
                                        placeholder="Tìm tên nhân vật, tên mục, từ khóa hoặc nội dung chính">
                                </label>
                                <div class="wb-worldbook-filter-row">
                                    <label class="wb-worldbook-filter-chip ${worldbookOnlyPeople ? 'is-active' : ''}">
                                        <input type="checkbox" data-wb-worldbook-filter="people" ${worldbookOnlyPeople ? 'checked' : ''}>
                                        <span>Chỉ xem nhân vật nghi ngờ</span>
                                    </label>
                                    <label class="wb-worldbook-filter-chip ${worldbookOnlyEnabled ? 'is-active' : ''}">
                                        <input type="checkbox" data-wb-worldbook-filter="enabled" ${worldbookOnlyEnabled ? 'checked' : ''}>
                                        <span>Chỉ xem mục đã bật</span>
                                    </label>
                                </div>
                                <div class="wb-worldbook-toolbar">
                                    <span>Tổng cộng ${worldbookEntries.length} mục · Hiện tại ${filteredWorldbookEntries.length} mục · Đã chọn ${worldbookSelectedCount} mục</span>
                                    <div>
                                        <button type="button" data-wb-action="select-worldbook-visible" ${filteredWorldbookEntries.length ? '' : 'disabled'}>Chọn tất cả hiện tại</button>
                                        <button type="button" data-wb-action="clear-worldbook-visible" ${filteredWorldbookEntries.length ? '' : 'disabled'}>Hủy hiện tại</button>
                                    </div>
                                </div>
                                <div class="wb-worldbook-entry-list">
                                    ${filteredWorldbookEntries.length ? filteredWorldbookEntries.map(entry => `
                                        <label class="wb-worldbook-entry ${entry.disabled ? 'is-disabled-entry' : ''} ${entry.likelyPerson ? 'is-person-candidate' : ''}">
                                            <input id="wb-worldbook-entry-${escapeAttr(entry.uid)}" type="checkbox" name="entryIds" data-wb-worldbook-entry-id="${escapeAttr(entry.uid)}"
                                                value="${escapeAttr(entry.uid)}" ${worldbookSelectedIds.has(String(entry.uid)) ? 'checked' : ''}>
                                            <span>
                                                <span class="wb-worldbook-entry-heading">
                                                    <strong>${escapeHtml(entry.parsedName || entry.name)}</strong>
                                                    ${entry.likelyPerson ? '<em>Nhân vật nghi ngờ</em>' : ''}
                                                    ${entry.disabled ? '<em class="is-muted">Đã vô hiệu hóa</em>' : ''}
                                                </span>
                                                ${entry.parsedName && entry.parsedName !== entry.name
                                                    ? `<small>Mục:${escapeHtml(entry.name)} · ${escapeHtml((entry.keys || []).join('、') || `UID ${entry.uid}`)}</small>`
                                                    : `<small>${escapeHtml((entry.keys || []).join('、') || `UID ${entry.uid}`)}</small>`}
                                                ${entry.profile?.matchedFields?.length
                                                    ? `<div class="wb-worldbook-profile-hints">Đã nhận dạng:${escapeHtml(entry.profile.matchedFields.slice(0, 6).map(field => ({
                                                        name: 'Họ tên', nickname: 'Biệt danh', gender: 'Giới tính', age: 'Tuổi tác', birthday: 'Sinh nhật', species: 'Chủng tộc', identity: 'Thân phận', personality: 'Nhân cách', values: 'Sở thích', mbti: 'MBTI', appearance: 'Ngoại hình', height: 'Chiều cao', body: 'Thể hình', clothing: 'Trang phục', background: 'Bối cảnh', relations: 'Mối quan hệ', speech: 'Nói chuyện', behavior: 'Ranh giới hành vi',
                                                    }[field] || field)).join('、'))}</div>`
                                                    : ''}
                                                <p>${escapeHtml(entry.content.slice(0, 220))}${entry.content.length > 220 ? '…' : ''}</p>
                                            </span>
                                        </label>
                                    `).join('') : `<div class="wb-worldbook-empty">Không có mục nào dưới bộ lọc hiện tại. Có thể hủy bộ lọc hoặc đổi từ khóa khác.</div>`}
                                </div>
                                <button class="wb-primary-button wb-worldbook-import-button" type="submit" ${worldbookSelectedCount ? '' : 'disabled'}>
                                    ${worldbookSelectedCount ? `Nhập nhân vật đã chọn (${worldbookSelectedCount}）` : 'Vui lòng chọn nhân vật muốn nhập'}
                                </button>
                            </div>
                        ` : ''}
                    </form>
                    </div>
                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="memory" ${groupOpen('memory')}>
                <summary><span>Ký ức dài hạn</span><small>Tự động sắp xếp và lưu trữ lịch sử</small></summary>
                <div class="wb-settings-group-body wb-settings-subgroup-stack">
                    <details class="wb-settings-subgroup" data-settings-subgroup="memory-switches" ${subgroupOpen('memory-switches')}>
                        <summary><span>Công tắc ký ức</span><small>Sắp xếp và chèn nội dung chính</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-toggle">
                <div><strong>Bật hệ thống ký ức</strong><span>Sau khi tắt sẽ dừng sắp xếp và ghi, nhưng giữ lại ký ức đã có</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="memorySystemEnabled"
                        ${settings.memorySystemEnabled ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
            <div class="wb-setting-toggle">
                <div><strong>Chèn ký ức vào nội dung chính</strong><span>Sau khi tắt vẫn sẽ sắp xếp và lưu, chỉ là không tham gia tạo cuộc trò chuyện chính</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="memoryPromptInjection"
                        ${settings.memoryPromptInjection ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="memory-history" ${subgroupOpen('memory-history')}>
                        <summary><span>Tự động sắp xếp</span><small>Tiến độ và sắp xếp thủ công</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-history-settings">
                <div class="wb-history-heading">
                    <div>
                        <label>Sắp xếp ký ức</label>
                        <strong>${escapeHtml(
                            historyRunning
                                ? memory.message || 'Đang dọn dẹp ký ức～'
                                : 'Sẽ tự dọn dẹp ký ức dài hạn～',
                        )}</strong>
                    </div>
                    <span>${historyRunning ? `${historyPercent}%` : (Number(memory.pendingAssistantResponses || 0) > 0 ? 'Có nội dung chính mới chờ dọn dẹp～' : 'Đã theo kịp nội dung chính rồi～')}</span>
                </div>
                ${historyRunning ? `
                    <div class="wb-history-progress"><i style="width:${historyPercent}%"></i></div>
                ` : ''}
                <p>Sẽ tự động sắp xếp nội dung chính mới～Sự thật quan trọng, mối quan hệ, cam kết và phục bút chưa kết thúc sẽ được giữ lại ngoan ngoãn (｡•̀ᴗ-)✧</p>
                <div class="wb-memory-queue">
                    <span>Chờ sắp xếp ${Math.max(0, Number(memory.pendingAssistantResponses || 0))} mục nội dung chính</span>
                    <strong>${settings.memoryAutoIndexInterval > 0
                        ? `Tự động · Mỗi ${settings.memoryAutoIndexInterval} Vòng`
                        : 'Sắp xếp thủ công'}</strong>
                </div>
                <label>Phương thức sắp xếp</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 0, 'Thủ công')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 5, 'Mỗi 5 Vòng')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 10, 'Mỗi 10 Vòng')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 20, 'Mỗi 20 Vòng')}
                </div>
                <label class="wb-number-setting">
                    Khoảng thời gian tùy chỉnh (vòng)
                    <input type="number" min="0" max="50" step="1"
                        data-wb-setting="memoryAutoIndexInterval"
                        value="${escapeAttr(settings.memoryAutoIndexInterval)}">
                </label>
                <button type="button" data-wb-action="scan-history"
                    ${historyRunning || !settings.memorySystemEnabled ? 'disabled' : ''}>
                    ${Number(memory.indexedThroughMessageId ?? -1) < 0 ? 'Sắp xếp ký ức hiện tại' : 'Sắp xếp ngay'}
                </button>
            </div>
                        </div>
                    </details>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="calendar" ${groupOpen('calendar')}>
                <summary><span>Lịch</span><small>Thời gian thế giới chính, hiệu chuẩn và tua nhanh</small></summary>
                <div class="wb-settings-group-body">
                    <form class="wb-clock-form" data-wb-form="clock">
                        <div class="wb-clock-form-heading">
                            <div><label>Lịch thế giới chính</label><strong>${escapeHtml(clockLabel)}</strong></div>
                            <span>Mỗi cuộc trò chuyện lưu độc lập</span>
                        </div>
                        <label class="wb-calendar-name-field">
                            Tên lịch pháp
                            <input name="calendarName" maxlength="40"
                                value="${escapeAttr(clock.calendarName)}" placeholder="Ví dụ: Đế quốc lịch">
                        </label>
                        <div class="wb-calendar-date-fields">
                            <label><input name="year" type="number" min="1" max="9999"
                                value="${clock.year}"> Năm</label>
                            <label><input name="month" type="number" min="1" max="12"
                                value="${clock.month}"> Tháng</label>
                            <label><input name="day" type="number" min="1" max="31"
                                value="${clock.dayOfMonth}"> Ngày</label>
                        </div>
                        <div class="wb-clock-fields">
                            <label><input name="hour" type="number" min="0" max="23" value="${clock.hour}"> Giờ</label>
                            <label><input name="minute" type="number" min="0" max="59" value="${clock.minute}"> Phút</label>
                            <button type="button" data-wb-action="sync-clock-from-story">Hiệu chuẩn với nội dung chính</button>
                            <button type="submit" class="wb-clock-manual-save">Cài đặt thủ công</button>
                        </div>
                        <p class="wb-clock-sync-note">Khi nội dung chính đưa ra thời gian đáng tin cậy, đồng hồ thế giới sẽ tự theo kịp～Ở đây cũng có thể hiệu chuẩn thủ công hoặc tua nhanh.</p>
                        <div class="wb-time-actions">
                            <button type="button" data-wb-action="advance-clock" data-minutes="60">+ 1 Giờ</button>
                            <button type="button" data-wb-action="advance-clock" data-minutes="360">+ 6 Giờ</button>
                            <button type="button" data-wb-action="advance-clock" data-minutes="1440">+ 1 Ngày</button>
                        </div>
                    </form>
                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="advanced" ${groupOpen('advanced')}>
                <summary><span>Nâng cao và bảo trì</span><small>Lọc, khôi phục và chẩn đoán</small></summary>
                <div class="wb-settings-group-body wb-advanced-settings-body wb-settings-subgroup-stack">
                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-data" ${subgroupOpen('advanced-data')}>
                        <summary><span>Sao lưu dữ liệu</span><small>Xuất và nhập thế giới hiện tại</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <div class="wb-setting-actions">
                                <button type="button" data-wb-action="export-state">Xuất thế giới hiện tại</button>
                                <button type="button" data-wb-action="import-state">Nhập trạng thái thế giới</button>
                                <input class="wb-import-input" type="file" accept=".json,application/json">
                            </div>
                            <p>Trước khi chuyển nhà, thử nghiệm hoặc sửa đổi lớn, hãy để lại một bản sao lưu cho thế giới hiện tại nhé～ (｡•̀ᴗ-)✧</p>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-tagfilter" ${subgroupOpen('advanced-tagfilter')}>
                        <summary><span>Lọc thẻ</span><small>Dọn dẹp thẻ rác và HTML Chú thích</small></summary>
                        <div class="wb-settings-subgroup-body">
                    <div class="wb-setting-toggle">
                        <div><strong>Bật lọc thẻ</strong><span>Vẫn sẽ xóa sau khi đóng HTML Chú thích &lt;!-- --&gt;</span></div>
                        <label class="wb-switch">
                            <input type="checkbox" data-wb-setting="tagFilterEnabled"
                                ${settings.tagFilterEnabled !== false ? 'checked' : ''}>
                            <i></i>
                        </label>
                    </div>
                    <div class="wb-setting-block">
                        <p>HTML Chú thích <code>&lt;!-- ... --&gt;</code> Sẽ lấy đi toàn bộ khối～Ở đây khớp chính xác theo nghĩa đen (phân biệt chữ hoa chữ thường). Khi chỉ điền phần cuối sẽ xóa nó và nội dung trước đó; khi chỉ điền phần đầu sẽ xóa từ đó cho đến cuối mục này.</p>
                        <div class="wb-tag-filter-list">
                            ${rules.map((rule, index) => `
                                <div class="wb-tag-filter-rule" data-tag-filter-index="${index}">
                                    <div class="wb-tag-filter-rule-head">
                                        <strong>Quy tắc ${index + 1}</strong>
                                        <button type="button" class="wb-tag-filter-remove is-delete"
                                            data-wb-action="remove-tag-filter-rule"
                                            data-index="${index}">Xóa</button>
                                    </div>
                                    <label>Thẻ mở đầu <span>（Có thể để trống）</span>
                                        <input type="text" maxlength="80"
                                            data-wb-tag-filter-field="open" data-index="${index}"
                                            value="${escapeAttr(rule.open || '')}"
                                            placeholder="Ví dụ &lt;options&gt;"
                                            autocomplete="off" spellcheck="false">
                                    </label>
                                    <label>Thẻ kết thúc <span>（Có thể để trống）</span>
                                        <input type="text" maxlength="80"
                                            data-wb-tag-filter-field="close" data-index="${index}"
                                            value="${escapeAttr(rule.close || '')}"
                                            placeholder="Ví dụ &lt;/options&gt;"
                                            autocomplete="off" spellcheck="false">
                                    </label>
                                </div>
                            `).join('')}
                        </div>
                        <div class="wb-tag-auto-tools">
                            <div class="wb-tag-auto-head">
                                <div><strong>Tự động trích xuất ứng viên</strong><span>Chỉ quét, sẽ không tự động thêm vào quy tắc</span></div>
                                <div class="wb-tag-auto-actions">
                                    <button type="button" data-wb-action="scan-tag-candidates" data-count="1">Quét nội dung chính mới nhất</button>
                                    <button type="button" data-wb-action="scan-tag-candidates" data-count="5">Quét gần đây 5 mục</button>
                                </div>
                            </div>
                            ${tagCandidates.length ? `
                                <div class="wb-tag-candidate-list">
                                    ${tagCandidates.map((item, index) => `
                                        <label class="wb-tag-candidate ${item.broad ? 'is-risky' : ''} ${item.alreadyAdded ? 'is-added' : ''}">
                                            <input type="checkbox" data-wb-tag-candidate-index="${index}"
                                                ${item.recommended ? 'checked' : ''} ${item.alreadyAdded ? 'disabled' : ''}>
                                            <span>
                                                <strong>&lt;${escapeHtml(item.tagName)}&gt;${item.alreadyAdded ? ' · Đã thêm' : ''}</strong>
                                                <small>${item.count} Lần${item.broad ? ' · Phạm vi khá rộng, khuyên bạn nên xác nhận trước khi thêm' : ''}</small>
                                                <code>${escapeHtml(item.open)} … ${escapeHtml(item.close)}</code>
                                            </span>
                                        </label>
                                    `).join('')}
                                </div>
                                <button type="button" class="wb-tag-filter-add" data-wb-action="apply-tag-candidates">Thêm ứng viên đã chọn</button>
                            ` : '<p class="wb-tag-auto-empty">Sau khi nhấp vào quét, plugin sẽ liệt kê các thẻ nghi ngờ có cặp để bạn xác nhận.</p>'}
                        </div>

                        <button type="button" class="wb-tag-filter-add"
                            data-wb-action="add-tag-filter-rule"
                            ${rules.filter(rule => String(rule.open || '').trim() || String(rule.close || '').trim()).length >= 30 ? 'disabled' : ''}>
                            ＋ Thêm quy tắc
                        </button>
                    </div>

                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-recovery" ${subgroupOpen('advanced-recovery')}>
                        <summary><span>Khôi phục an toàn</span><small>${latestRecovery ? escapeHtml(latestRecovery.label) : 'Điểm khôi phục và quay lại'}</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <div class="wb-maintenance-status">
                                <strong>${latestRecovery ? escapeHtml(latestRecovery.label) : 'Chưa có điểm khôi phục'}</strong>
                                <span>${latestRecovery ? escapeHtml(formatLocalTimestamp(latestRecovery.createdAt)) : 'Mỗi cuộc trò chuyện độc lập'}</span>
                            </div>
                            <p>${latestRecovery
                                ? `Lưu hiện tại ${Math.max(1, Number(recovery.count) || 1)} điểm khôi phục, sau khi khôi phục vẫn sẽ lưu lại một bản bảo hiểm cho trạng thái hiện tại trước.`
                                : 'Khi nâng cấp dữ liệu cũ, nhập trạng thái thế giới sẽ tự động lưu trữ, cũng có thể lưu thủ công một bản ngay bây giờ.'}</p>
                            <div class="wb-setting-actions">
                                <button type="button" data-wb-action="create-recovery-point">Lưu điểm khôi phục ngay lập tức</button>
                                <button type="button" data-wb-action="restore-latest-recovery" ${latestRecovery ? '' : 'disabled'}>Khôi phục bản lưu gần nhất</button>
                            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-diagnostics" ${subgroupOpen('advanced-diagnostics')}>
                        <summary><span>Chẩn đoán sự cố</span><small>Sao chép thông tin chẩn đoán an toàn</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <p>Sẽ mang theo phiên bản, thiết bị, chế độ giao diện và trạng thái lỗi, thuận tiện cho việc bắt lỗi~API Key、Địa chỉ API, nội dung chính và thiết lập nhân vật đều sẽ không bị lộ ra ngoài.</p>
                            <div class="wb-setting-actions">
                                <button type="button" data-wb-action="copy-diagnostics">Sao chép thông tin chẩn đoán</button>
                                <button type="button" data-wb-action="preview-notice">Xem kiểu nhắc nhở</button>
                            </div>
                        </div>
                    </details>
                </div>
            </details>

        </div>
    `;
}

function renderEventModal(state, editorId = '') {
    const event = editorId
        ? state.events.find(item => item.id === editorId) || null
        : null;
    const isEdit = Boolean(event);
    const durationHours = Math.max(0, Number(event?.durationMinutes || 0) / 60);
    const durationValue = Number.isInteger(durationHours)
        ? String(durationHours)
        : String(Number(durationHours.toFixed(2)));
    const startedStamp = event
        ? formatWorldCalendar(state, event.startedAt).stamp
        : formatWorldCalendar(state).stamp;
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-event-form">
            <form class="wb-event-form" data-wb-form="event">
                <div class="wb-form-heading">
                    <div><span>${isEdit ? 'EDIT CURRENT' : 'NEW CURRENT'}</span><h3>${isEdit ? 'Sửa đổi dòng chảy ngầm này' : 'Đưa vào một dòng chảy ngầm'}</h3></div>
                    <button type="button" data-wb-action="close-event-form">×</button>
                </div>
                <input type="hidden" name="id" value="${escapeAttr(event?.id || '')}">
                <label>Tên sự kiện<input name="title" required maxlength="140"
                    value="${escapeAttr(event?.title || '')}" placeholder="Ví dụ: Sửa chữa một máy liên lạc cũ"></label>
                <label>Địa điểm<input name="place" maxlength="140"
                    value="${escapeAttr(event?.place || '')}" placeholder="Trạm bảo trì Nam Ngạn"></label>
                <label>Chuyện gì đang xảy ra<textarea name="summary" maxlength="420" rows="3">${escapeHtml(event?.summary || '')}</textarea></label>
                <label>Kết quả dự kiến<textarea name="expectedResult" maxlength="420" rows="2">${escapeHtml(event?.expectedResult || event?.consequence || '')}</textarea></label>
                <div class="wb-form-grid">
                    <label>Phương thức tính giờ
                        <select name="clockMode">
                            <option value="duration" ${event?.clockMode === 'duration' || !event ? 'selected' : ''}>Trôi qua tự nhiên</option>
                            <option value="active" ${event?.clockMode === 'active' ? 'selected' : ''}>Giờ làm việc hiệu quả</option>
                            <option value="scheduled" ${event?.clockMode === 'scheduled' ? 'selected' : ''}>Thời gian dự định</option>
                            <option value="condition" ${event?.clockMode === 'condition' ? 'selected' : ''}>Chờ điều kiện</option>
                        </select>
                    </label>
                    <label>Thời gian dự kiến (giờ)
                        <input name="durationHours" type="number" min="0" step="0.5"
                            value="${isEdit ? escapeAttr(durationValue) : '12'}">
                    </label>
                </div>
                <label>Ranh giới có thể nhìn thấy
                    <select name="visibility">
                        <option value="hidden" ${event?.visibility === 'hidden' || !event ? 'selected' : ''}>Nhân vật vẫn chưa rõ</option>
                        <option value="trace" ${event?.visibility === 'trace' ? 'selected' : ''}>Có thể nhận biết qua dấu vết</option>
                        <option value="known" ${event?.visibility === 'known' ? 'selected' : ''}>Có thể biết được qua tin tức</option>
                        <option value="direct" ${event?.visibility === 'direct' ? 'selected' : ''}>Có thể cảm nhận trực tiếp</option>
                    </select>
                </label>
                <div class="wb-form-note">
                    ${isEdit
                        ? `Dòng chảy ngầm này từ ${escapeHtml(startedStamp)} bắt đầu. Sau khi sửa đổi phương thức tính giờ hoặc thời gian tiêu hao, sẽ tiếp tục sử dụng thời gian bắt đầu ban đầu để tính toán lại; chỉ sửa đổi văn bản sẽ không thay đổi tiến độ hiện có.`
                        : `Từ ${escapeHtml(formatWorldCalendar(state).stamp)} bắt đầu tính giờ. Số vòng phản hồi sẽ không làm tăng tiến độ.`}
                </div>
                <button class="wb-primary-button" type="submit">${isEdit ? 'Lưu sửa đổi dòng chảy ngầm' : 'Bắt đầu phát triển chạy ngầm'}</button>
            </form>
        </div>
    `;
}

function renderPersonDrawer(person, observerMode, worldMinute, {
    canObserve = false,
    observation = null,
    busy = false,
} = {}) {
    if (!person) return '';
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-person">
            <div class="wb-person-drawer" role="dialog" aria-modal="true" aria-label="Chi tiết nhân vật">
                <button class="wb-drawer-close" type="button" data-wb-action="close-person">×</button>
                ${renderPersonAvatar(person, 'is-feature')}
                <span class="wb-drawer-overline">LIVING TRACE</span>
                <h3>${escapeHtml(person.name)}</h3>
                <p class="wb-drawer-place">${escapeHtml(person.location)}</p>
                <button class="wb-person-edit-button" type="button" data-wb-action="open-person-editor"
                    data-person-id="${escapeAttr(person.id)}" data-person-name="${escapeAttr(person.name)}">Chỉnh sửa thẻ nhân vật</button>
                <div class="wb-drawer-section"><span>Đang làm</span><strong>${escapeHtml(person.action)}</strong></div>
                <div class="wb-drawer-section"><span>Ý định ngắn hạn</span><strong>${escapeHtml(person.intent)}</strong></div>
                ${person.longTermGoal ? `
                    <div class="wb-drawer-section"><span>Mục tiêu dài hạn</span><strong>${escapeHtml(person.longTermGoal)}</strong></div>
                ` : ''}
                ${person.identityAnchor ? `
                    <div class="wb-drawer-section is-character-anchor"><span>Điểm neo thân phận</span><strong>${escapeHtml(person.identityAnchor)}</strong></div>
                ` : ''}
                ${person.appearanceProfile ? `
                    <div class="wb-drawer-section is-character-anchor"><span>Cài đặt ngoại hình</span><strong>${escapeHtml(person.appearanceProfile)}</strong></div>
                ` : ''}
                ${person.personalityAnchor ? `
                    <div class="wb-drawer-section is-character-anchor"><span>Điểm neo nhân cách</span><strong>${escapeHtml(person.personalityAnchor)}</strong></div>
                ` : ''}
                ${person.backgroundProfile ? `
                    <div class="wb-drawer-section is-character-anchor"><span>Bối cảnh và mối quan hệ</span><strong>${escapeHtml(person.backgroundProfile)}</strong></div>
                ` : ''}
                ${person.speakingStyle ? `
                    <div class="wb-drawer-section is-character-anchor"><span>Thói quen nói chuyện</span><strong>${escapeHtml(person.speakingStyle)}</strong></div>
                ` : ''}
                ${person.behaviorBoundaries ? `
                    <div class="wb-drawer-section is-character-anchor"><span>Ranh giới hành vi</span><strong>${escapeHtml(person.behaviorBoundaries)}</strong></div>
                ` : ''}
                ${person.worldbookRaw ? `
                    <details class="wb-worldbook-source-profile">
                        <summary><span>Thiết lập gốc của Worldbook</span><small>${String(person.worldbookRaw).length} Chữ · Nhấp để xem</small></summary>
                        <pre>${escapeHtml(person.worldbookRaw)}</pre>
                    </details>
                ` : ''}
                ${person.trace ? `
                    <div class="wb-drawer-section"><span>Hành tung gần đây</span><strong>${escapeHtml(person.trace)}</strong></div>
                ` : ''}
                ${observerMode === 'backstage'
                    ? renderInnerVoice(person, worldMinute)
                    : `
                        <div class="wb-knowledge-boundary">
                            <i></i><div><strong>Ranh giới kiến thức</strong><p>Góc nhìn những gì nhân vật biết sẽ không đọc độc thoại hậu trường của cô ấy.</p></div>
                        </div>
                    `}
                <div class="wb-person-observation ${observation?.personId === person.id ? 'has-result' : ''}">
                    ${observation?.personId === person.id ? `
                        <article>
                            <span>Quan sát hậu trường · ${escapeHtml(formatWorldMinute(observation.worldMinute).time)}</span>
                            <p>${escapeHtml(observation.text)}</p>
                        </article>
                    ` : ''}
                    ${canObserve ? `
                        <div class="wb-observation-primary">
                            ${observation?.personId === person.id
                                ? '<span>Đã lưu trong nội dung chính và trạng thái thế giới hiện tại</span>'
                                : '<span>Không thúc đẩy thời gian, cũng không ghi trực tiếp vào nội dung chính</span>'}
                            <button type="button" data-wb-action="observe-person"
                                data-person-id="${escapeAttr(person.id)}"
                                data-force="${observation?.personId === person.id ? 'true' : 'false'}"
                                ${busy ? 'disabled' : ''}>
                                ${busy
                                    ? 'Đang quan sát……'
                                    : observation?.personId === person.id
                                        ? 'Quan sát lại'
                                        : `Xem thử ${escapeHtml(person.name)} Đang làm gì`}
                            </button>
                        </div>
                    ` : `
                        <p>${person.isUser
                            ? 'Nhân vật người chơi không sử dụng quan sát nhân vật ngoài ống kính.'
                            : observerMode !== 'backstage'
                                ? 'Sau khi chuyển về góc nhìn hậu trường có thể quan sát nhân vật ngoài ống kính.'
                                : 'Nhân vật này đang trong ống kính vòng này, không cần quan sát riêng.'}</p>
                    `}
                </div>
                <div class="wb-knowledge-boundary wb-observation-boundary ${observation?.queued ? 'is-enabled' : ''} ${observation?.revealState === 'delivered' ? 'is-delivered' : ''}">
                    <i></i>
                    <div>
                        <strong>${observation?.revealState === 'delivered' ? 'Đã hiển thị' : 'Hiển thị tự nhiên'}</strong>
                        <p>${observation?.revealState === 'delivered'
                            ? 'Đoạn quan sát này đã được nội dung chính tiếp theo tiếp nối tự nhiên; đóng cửa sổ quan sát sẽ không xóa nội dung chính đã tạo.'
                            : observation?.revealState === 'expired'
                                ? 'Trước đó không gặp thời điểm hiển thị phù hợp, đã ngừng tiếp tục cung cấp; bạn có thể bật lại.'
                                : observation?.queued
                                    ? 'Đã cho phép: Đoạn quan sát này sẽ làm ứng cử viên cho nội dung chính khi ngữ cảnh tiếp theo phù hợp; sẽ không chèn ép buộc, cũng không đảm bảo xuất hiện ngay vòng tiếp theo.'
                                    : 'Mặc định tắt: Chỉ dành cho xem hậu trường, không vào nội dung chính, không thúc đẩy thời gian, cũng không sửa đổi ký ức.'}</p>
                    </div>
                    ${observation?.personId === person.id ? `
                        <button type="button" role="switch"
                            aria-checked="${observation.queued || observation.revealState === 'delivered' ? 'true' : 'false'}"
                            aria-label="Cho phép đoạn quan sát này hiển thị tự nhiên"
                            data-wb-action="queue-person-observation"
                            data-person-id="${escapeAttr(person.id)}"
                            ${observation.revealState === 'delivered' ? 'disabled' : ''}>
                            <span></span>
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

function renderNowView(state, observerMode, people, activeEvents) {
    const clock = formatWorldCalendar(state);
    const clockLabel = worldClockLabel(state, clock);
    return `
        <div class="wb-overview">
            <section class="wb-world-card">
                <div class="wb-world-card-copy">
                    <div class="wb-world-card-heading-row">
                        <span class="wb-section-kicker">WORLD STATE · ${escapeHtml(clockLabel)}</span>
                        <button class="wb-card-action-button is-edit" type="button"
                            data-wb-action="open-world-editor" aria-label="Chỉnh sửa tổng quan thế giới">Chỉnh sửa</button>
                    </div>
                    <h3>${escapeHtml(state.world.title)}</h3>
                    <p>${escapeHtml(state.world.detail)}</p>
                </div>
                <div class="wb-world-pulse" aria-hidden="true">
                    <i></i><i></i><span></span>
                    <strong>${state.needsReconciliation ? 'Chờ hiệu chuẩn' : state.pendingSync ? 'Chờ suy diễn' : 'Đang tiếp diễn'}</strong>
                </div>
            </section>

            <div class="wb-overview-grid">
                <section class="wb-overview-section">
                    <div class="wb-section-heading">
                        <div><span>Đang hình thành</span><h3>Dòng chảy ngầm</h3></div>
                        <button type="button" data-wb-action="set-view" data-view="currents">Xem tất cả →</button>
                    </div>
                    <div class="wb-event-list is-compact">
                        ${activeEvents.slice(0, 2).map(event => renderEventCard(event, state)).join('')
                            || renderEmpty('Dòng chảy ngầm hôm nay rất yên tĩnh～', 'Không có sự kiện đang phát triển cũng không sao, các nhân vật vẫn sẽ sống cuộc sống của riêng mình (˘ω˘)')}
                    </div>
                </section>

                <section class="wb-overview-section">
                    <div class="wb-section-heading">
                        <div><span>Đang tiếp tục sống</span><h3>Hành tung nhân vật</h3></div>
                        <button type="button" data-wb-action="set-view" data-view="people">Xem tất cả →</button>
                    </div>
                    <div class="wb-person-list">
                        ${people.slice(0, 3).map(person => renderPersonRow(
                            person,
                            observerMode,
                            state.clock.absoluteMinute,
                        )).join('') || renderEmpty('Hành tung nhân vật vẫn chưa mở～', 'Chạy suy diễn thế giới một lần, họ sẽ dần để lại dấu vết cuộc sống của mình.')}
                    </div>
                </section>
            </div>
        </div>
    `;
}

function renderPeopleView(state, observerMode, people, openFolds = new Set()) {
    return `
        <div class="wb-view-intro">
            <p>Mỗi người đều sẽ tiếp tục sống cuộc sống của mình ngoài ống kính nha～ Vị trí và hành động sẽ thay đổi theo thế giới, tiếng lòng chưa nói ra vẫn ngoan ngoãn ở lại hậu trường (｡•̀ᴗ-)✧</p>
            <div class="wb-memory-intro-actions">
                <span>${people.length} quỹ đạo có thể quan sát</span>
                <button type="button" data-wb-action="open-person-editor">＋ Thêm chạy ngầm NPC</button>
            </div>
        </div>
        <div class="wb-view-fold-head">
            <span>Trước tiên cứ xem họ hiện đang ở đâu, làm gì là được～ Muốn đào sâu thì từ từ mở rộng sau.</span>
            ${renderFoldToolbar('people:')}
        </div>
        <div class="wb-people-grid">
            ${people.map(person => renderPersonCard(
                person,
                observerMode,
                state.clock.absoluteMinute,
                openFolds,
            )).join('') || renderEmpty(
                observerMode === 'known' ? 'Nhân vật hiện tại không có hành tung nhân vật có thể xác nhận' : 'Nhân vật chạy ngầm chưa được thiết lập',
                observerMode === 'known' ? 'Chuyển về góc nhìn hậu trường có thể xem hành tung chưa biết.' : 'Tự động suy diễn sau khi phản hồi hoặc suy diễn thủ công một lần.',
            )}
        </div>
    `;
}

function renderPersonEditorModal(state, editor) {
    const editorId = String(editor?.id || '');
    const editorName = String(editor?.name || '');
    const person = state.people.find(item => (
        item.id === editorId
        && (!editorName || item.name === editorName)
    )) || state.people.find(item => item.id === editorId) || null;
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-person-editor">
            <form class="wb-event-form wb-person-editor" data-wb-form="person">
                <div class="wb-form-heading">
                    <div><span>BACKSTAGE CAST</span><h3>${person ? 'Chỉnh sửa nhân vật chạy ngầm' : 'Thêm chạy ngầm NPC'}</h3></div>
                    <button type="button" data-wb-action="close-person-editor">×</button>
                </div>
                <input type="hidden" name="id" value="${escapeAttr(person?.id || '')}">
                <input type="hidden" name="originalName" value="${escapeAttr(person?.name || '')}">
                <label>Họ tên<input name="name" required maxlength="80" value="${escapeAttr(person?.name || '')}"></label>
                <label>Vị trí hiện tại<input name="location" maxlength="160" value="${escapeAttr(person?.location || '')}"></label>
                <label>Đang làm<textarea name="action" maxlength="280" rows="2">${escapeHtml(person?.action || '')}</textarea></label>
                <label>Ý định ngắn hạn<textarea name="intent" maxlength="320" rows="2">${escapeHtml(person?.intent || '')}</textarea></label>
                <label>Mục tiêu dài hạn<textarea name="longTermGoal" maxlength="420" rows="3">${escapeHtml(person?.longTermGoal || '')}</textarea></label>
                <fieldset class="wb-character-anchor-fields">
                    <legend><span>Ràng buộc nhân vật</span><small>Suy diễn và quan sát tức thời đều sẽ tuân thủ,AI Sẽ không tự động viết lại</small></legend>
                    <label>Điểm neo thân phận nhân vật<textarea name="identityAnchor" maxlength="500" rows="3"
                        placeholder="Ví dụ: Nam giới, ngoại hình thiên về nữ giới, sử dụng“anh ấy”và danh xưng nam giới; dị nhân tộc cáo. Cũng có thể điền phi nhị nguyên giới, phi giới tính hoặc danh xưng tùy chỉnh.">${escapeHtml(person?.identityAnchor || '')}</textarea>
                        <small>Tự do điền bản dạng giới, danh xưng/Đại từ, loài, giai đoạn tuổi và thân phận xã hội; ngoại hình vui lòng viết riêng ở“Cài đặt ngoại hình”。Không giới hạn chỉ chọn một trong hai nam hoặc nữ.</small>
                    </label>
                    <label>Cài đặt ngoại hình<textarea name="appearanceProfile" maxlength="700" rows="3"
                        placeholder="Ví dụ: Tóc ngắn màu đen, chiều cao 185cm，thường mặc áo sơ mi tối màu.">${escapeHtml(person?.appearanceProfile || '')}</textarea></label>
                    <label>Điểm neo nhân cách<textarea name="personalityAnchor" maxlength="600" rows="3"
                        placeholder="Ví dụ: Ngoài lạnh trong nóng, cảnh giác với chính quyền; coi trọng lời hứa, nhưng không dễ dàng tỏ ra yếu đuối.">${escapeHtml(person?.personalityAnchor || '')}</textarea></label>
                    <label>Bối cảnh và mối quan hệ<textarea name="backgroundProfile" maxlength="900" rows="4"
                        placeholder="Ví dụ: Quá trình trưởng thành, mối quan hệ gia đình, mối quan hệ xã hội và những trải nghiệm quan trọng đã có.">${escapeHtml(person?.backgroundProfile || '')}</textarea></label>
                    <label>Thói quen nói chuyện<textarea name="speakingStyle" maxlength="360" rows="2"
                        placeholder="Ví dụ: Câu từ ngắn gọn, rất ít sử dụng dấu chấm than; khi căng thẳng sẽ chuyển chủ đề.">${escapeHtml(person?.speakingStyle || '')}</textarea></label>
                    <label>Ranh giới hành vi<textarea name="behaviorBoundaries" maxlength="500" rows="3"
                        placeholder="Ví dụ: Sẽ không phản bội đồng đội khi không có chứng cứ; không thay người chơi đưa ra quyết định; không được nói ra những thông tin hậu trường mà bản thân không biết.">${escapeHtml(person?.behaviorBoundaries || '')}</textarea></label>
                </fieldset>
                <div class="wb-form-grid">
                    <label>Ranh giới kiến thức
                        <select name="knowledge">
                            <option value="backstage" ${person?.knowledge !== 'known' ? 'selected' : ''}>Hậu trường chưa biết</option>
                            <option value="known" ${person?.knowledge === 'known' ? 'selected' : ''}>Nhân vật có thể biết</option>
                        </select>
                    </label>
                    <label>Mức độ quan trọng
                        <select name="relevance">
                            <option value="1" ${Number(person?.relevance || 2) === 1 ? 'selected' : ''}>Bình thường</option>
                            <option value="2" ${Number(person?.relevance || 2) === 2 ? 'selected' : ''}>Quan trọng</option>
                            <option value="3" ${Number(person?.relevance || 2) === 3 ? 'selected' : ''}>Cốt lõi</option>
                        </select>
                    </label>
                </div>
                <div class="wb-memory-editor-flags">
                    <label><input name="simulationEnabled" type="checkbox"
                        ${person?.simulationEnabled !== false ? 'checked' : ''}> Tham gia suy diễn ngoài ống kính</label>
                    <label><input name="locked" type="checkbox" ${person?.locked ? 'checked' : ''}> Khóa thiết lập cốt lõi</label>
                </div>
                <div class="wb-form-note">Đóng“Tham gia suy diễn ngoài ống kính”sau đó, nhân vật vẫn được lưu trong danh sách; chỉ cập nhật khi nội dung chính cho phép xuất hiện.</div>
                <div class="wb-person-editor-actions">
                    ${person ? `<button class="wb-person-delete-button" type="button" data-wb-action="delete-manual-person"
                        data-person-id="${escapeAttr(person.id)}" ${person.locked ? 'disabled' : ''}>Xóa nhân vật</button>` : ''}
                    <button class="wb-primary-button" type="submit">${person ? 'Lưu thẻ nhân vật' : 'Thêm vào danh sách chạy ngầm'}</button>
                </div>
            </form>
        </div>
    `;
}

function renderCurrentsView(state, activeEvents, openFolds = new Set(), settings = {}) {
    return `
        <div class="wb-view-intro">
            <p>Ở đây chứa những sự việc chưa kết thúc～ Chúng sẽ tiếp tục phát triển theo thế giới, một khi có kết quả thì mới thực sự được tính nha ( •̀ ω •́ )✧</p>
            <div class="wb-view-inline-actions">
                <label class="wb-view-toggle">
                    <span>Tự động chạy</span>
                    <input type="checkbox" data-wb-setting="worldAutoEnabled" ${settings.worldAutoEnabled ? 'checked' : ''}>
                </label>
                <button class="wb-inline-add" type="button" data-wb-action="open-event-form">＋ Đưa vào một dòng chảy ngầm</button>
            </div>
        </div>
        <div class="wb-view-fold-head">
            <span>Trước tiên hãy lướt qua trạng thái, địa điểm và thời gian còn lại～ Muốn xem chi tiết thì mở rộng ra là được.</span>
            ${renderFoldToolbar('currents:')}
        </div>
        <div class="wb-event-list is-full">
            ${activeEvents.map(event => renderEventCard(event, state, true, openFolds)).join('')
                || renderEmpty('Dòng chảy ngầm tạm thời đã được dọn sạch nha～', 'Những sự việc đến hạn, bị hủy hoặc bỏ lỡ sẽ rời khỏi đây, kết quả sẽ ngoan ngoãn chuyển sang tiếng vang.')}
        </div>
    `;
}

function renderEchoesView(state, outcomes, openFolds = new Set()) {
    return `
        <div class="wb-view-intro">
            <p>Sự việc sau khi đi đến kết quả sẽ đến đây～ Có được nội dung chính nhìn thấy hay không lại là chuyện khác, bản thân kết quả sẽ không biến mất một cách vô cớ đâu (｡•̀ᴗ-)✧</p>
            <span>Kết quả gần đây</span>
        </div>
        <div class="wb-view-fold-head">
            <span>Kết quả có tồn tại hay không, và nội dung chính có nhìn thấy hay không, là hai chuyện khác nhau～ Trước tiên hãy xem có chạm vào ống kính không đã.</span>
            ${renderFoldToolbar('echoes:')}
        </div>
        <div class="wb-echo-timeline">
            ${outcomes.map(event => renderOutcome(event, state, openFolds)).join('')
                || renderEmpty('Vẫn chưa có tiếng vang nào nha～', 'Những chuyện từng xảy ra chạy ngầm, không có nghĩa là đã được nội dung chính nhìn thấy. Đợi nó thực sự hình thành kết quả rồi hãy đến đây.')}
        </div>
    `;
}

function publicOpinionClaimLabel(status) {
    return {
        fact: 'Dựa trên sự thật công khai',
        mixed: 'Sự thật và suy đoán lẫn lộn',
        rumor: 'Tin đồn / Chưa được xác nhận',
    }[status] || 'Sự thật và suy đoán lẫn lộn';
}

function publicOpinionConfidenceLabel(confidence) {
    return confidence === 'high' ? 'Độ tin cậy khá cao' : 'Thông tin hạn chế';
}

function publicOpinionSourceTypeLabel(sourceType) {
    return sourceType === 'official' ? '🏛 Chính thức / Chính thống' : '🗣 Không chính thức / Vỉa hè';
}

function renderPublicOpinionAudience(item) {
    const audiences = Array.isArray(item?.audienceTags) ? item.audienceTags.filter(Boolean).slice(0, 5) : [];
    if (!audiences.length && !item?.scope) return '';
    return `
        <div class="wb-opinion-audience">
            ${item?.scope ? `<span class="wb-opinion-scope">${escapeHtml(item.scope)}</span>` : ''}
            ${audiences.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}
        </div>
    `;
}

function publicOpinionGeneratedLabel(value) {
    if (!value) return 'Chưa được tạo';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Bản ghi nhanh gần đây nhất';
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function renderPublicOpinionView(state, opinion = {}, mode = 'news', settings = {}) {
    const news = Array.isArray(opinion.news) ? opinion.news : [];
    const forums = Array.isArray(opinion.forums) ? opinion.forums : [];
    const canonRunning = Boolean(opinion.canonRunning);
    const sandboxRunning = Boolean(opinion.sandboxRunning);
    const running = canonRunning || sandboxRunning || opinion.phase === 'running';
    const stale = Boolean(opinion.stale && opinion.generatedAt);
    const relatedEvents = new Map((state.events || []).map(event => [event.id, event]));
    const sandbox = opinion.sandbox && typeof opinion.sandbox === 'object' ? opinion.sandbox : { news: [], forums: [], generatedAt: '' };
    const sandboxItems = [...(sandbox.news || []), ...(sandbox.forums || [])];
    const activeMode = ['forum', 'sandbox'].includes(mode) ? mode : 'news';
    const statusMessage = opinion.error || opinion.message || '';
    const hasMainOpinion = news.length > 0 || forums.length > 0;
    const hasSandboxOpinion = sandboxItems.length > 0;
    const showStatusMessage = Boolean(statusMessage && (opinion.phase === 'error' || activeMode !== 'sandbox' || !hasSandboxOpinion));
    const renderRelated = item => {
        const event = relatedEvents.get(item.relatedEventId);
        return event
            ? `<span class="wb-opinion-related">Sự kiện nguồn · ${escapeHtml(event.title)}</span>`
            : '';
    };
    return `
        <div class="wb-opinion-toolbar">
            <div class="wb-opinion-summary">
                <p>Hôm nay ngoài ống kính đang bàn tán gì~ Chỉ hóng hớt những thay đổi thực sự công khai, có thể nhận biết được trong thế giới, sẽ không tự bịa tin tức (˘▾˘)</p>
                <div class="wb-opinion-meta">
                    <span>Bản ghi nhanh · ${escapeHtml(publicOpinionGeneratedLabel(opinion.generatedAt))}</span>
                    ${stale
                        ? '<span class="is-stale">Thế giới đang tiến về phía trước rồi · Làm mới một chút sẽ chuẩn hơn</span>'
                        : `<span>${settings.publicOpinionRevealMode === 'relevant' ? 'Có thể hiển thị khi liên quan' : 'Chế độ hóng hớt an tâm'}</span>`}
                </div>
            </div>
            <div class="wb-opinion-actions">
                <label class="wb-view-toggle">
                    <span>Tự động cập nhật</span>
                    <input type="checkbox" data-wb-setting="publicOpinionAutoEnabled" ${settings.publicOpinionAutoEnabled ? 'checked' : ''}>
                </label>
                ${opinion.generatedAt ? `<button type="button" data-wb-action="clear-public-opinion" ${running ? 'disabled' : ''}>Làm trống</button>` : ''}
                <button type="button" data-wb-action="generate-public-opinion-sandbox" ${running ? 'disabled' : ''}>${sandboxRunning ? 'Đang đi dạo…' : 'Đi dạo loanh quanh~'}</button>
                <button class="wb-inline-add" type="button" data-wb-action="generate-public-opinion" ${running ? 'disabled' : ''}>
                    ${canonRunning ? 'Đang làm mới dư luận thế giới…' : (opinion.generatedAt ? 'Làm mới dư luận thế giới' : 'Tạo dư luận hiện tại')}
                </button>
            </div>
        </div>
        <div class="wb-opinion-tabs" role="tablist" aria-label="Loại dư luận">
            <button type="button" role="tab" data-wb-action="set-public-opinion-mode" data-mode="news"
                aria-selected="${activeMode === 'news'}" class="${activeMode === 'news' ? 'is-active' : ''}">📰 Tin tức <small>${news.length}</small></button>
            <button type="button" role="tab" data-wb-action="set-public-opinion-mode" data-mode="forum"
                aria-selected="${activeMode === 'forum'}" class="${activeMode === 'forum' ? 'is-active' : ''}">💬 Diễn đàn <small>${forums.length}</small></button>
            <button type="button" role="tab" data-wb-action="set-public-opinion-mode" data-mode="sandbox"
                aria-selected="${activeMode === 'sandbox'}" class="${activeMode === 'sandbox' ? 'is-active' : ''}">🍿 Đi dạo <small>${sandboxItems.length}</small></button>
        </div>
        ${showStatusMessage ? `<div class="wb-opinion-status is-${escapeAttr(opinion.phase || 'idle')} ${hasMainOpinion || hasSandboxOpinion ? 'is-compact' : ''}">${escapeHtml(statusMessage)}</div>` : ''}
        ${activeMode === 'news' ? `
            <div class="wb-news-grid">
                ${news.map(item => `
                    <article class="wb-news-card">
                        <div class="wb-news-card-top">
                            <span>${escapeHtml(item.category || 'Tin tức thế giới')}</span>
                            <small>${'●'.repeat(Math.max(1, Math.min(3, Number(item.heat) || 1)))}</small>
                        </div>
                        <div class="wb-opinion-source-row">
                            <span class="is-${escapeAttr(item.sourceType || 'official')}">${escapeHtml(publicOpinionSourceTypeLabel(item.sourceType))}</span>
                        </div>
                        <h3>${escapeHtml(item.headline)}</h3>
                        <p>${escapeHtml(item.summary)}</p>
                        ${renderPublicOpinionAudience(item)}
                        <div class="wb-news-card-foot">
                            <span>${escapeHtml(item.source || 'Thông tin công khai')} · ${escapeHtml(publicOpinionConfidenceLabel(item.confidence))}</span>
                            ${renderRelated(item)}
                        </div>
                    </article>
                `).join('') || renderEmpty('Thế giới hôm nay hơi yên tĩnh~', 'Vẫn chưa có chuyện gì đáng lên tin tức, hoặc bạn chưa tạo bản ghi nhanh dư luận (˘▾˘)')}
            </div>
        ` : activeMode === 'forum' ? `
            <div class="wb-forum-list">
                ${forums.map(item => `
                    <article class="wb-forum-card">
                        <div class="wb-forum-card-top">
                            <span>${escapeHtml(item.board || 'Trò chuyện phiếm')}</span>
                            <small class="is-${escapeAttr(item.claimStatus || 'mixed')}">${escapeHtml(publicOpinionClaimLabel(item.claimStatus))}</small>
                        </div>
                        <div class="wb-opinion-source-row">
                            <span class="is-${escapeAttr(item.sourceType || 'unofficial')}">${escapeHtml(publicOpinionSourceTypeLabel(item.sourceType))}</span>
                        </div>
                        <h3>${escapeHtml(item.title)}</h3>
                        <p>${escapeHtml(item.summary)}</p>
                        ${renderPublicOpinionAudience(item)}
                        <div class="wb-forum-heat"><span>Độ hot</span><strong>${'●'.repeat(Math.max(1, Math.min(5, Number(item.heat) || 1)))}</strong></div>
                        ${item.replies?.length ? `
                            <details class="wb-forum-reply-fold">
                                <summary>Xem thử ${item.replies.length}  phản hồi tiêu biểu~</summary>
                                <div class="wb-forum-replies">
                                    ${item.replies.map(reply => `
                                        <div><strong>${escapeHtml(reply.author)}</strong><p>${escapeHtml(reply.text)}</p></div>
                                    `).join('')}
                                </div>
                            </details>
                        ` : ''}
                        <div class="wb-news-card-foot">${renderRelated(item)}</div>
                    </article>
                `).join('') || renderEmpty('Diễn đàn hôm nay không cãi nhau~', 'Không có chuyện gì phù hợp để thảo luận công khai, hoặc bạn chưa tạo bản ghi nhanh dư luận.')}
            </div>
        ` : `
            <div class="wb-opinion-sandbox">
                <div class="wb-memory-fact-note"><strong>🍿 Hộp cát thuần giải trí</strong> · Những điều dưới đây chỉ là“trong thế giới có thể có người đang bàn tán gì đó”tờ báo nhỏ viết tùy hứng, không tính là chính sử, sẽ không được viết vào sự kiện, ký ức,NPC nhận thức hoặc nhân quả của nội dung chính.</div>
                ${sandbox.generatedAt ? `<div class="wb-opinion-meta wb-opinion-meta-inline"><span>Bản ghi nhanh đi dạo · ${escapeHtml(publicOpinionGeneratedLabel(sandbox.generatedAt))}</span><button class="wb-opinion-meta-button" type="button" data-wb-action="clear-public-opinion-sandbox">Cất nồi dưa này đi</button></div>` : ''}
                <div class="wb-news-grid">
                    ${(sandbox.news || []).map(item => `
                        <article class="wb-news-card is-sandbox">
                            <div class="wb-news-card-top"><span>${escapeHtml(item.category || 'Tin tức đi dạo')}</span><small>NON-CANON</small></div>
                            <h3>${escapeHtml(item.headline)}</h3>
                            <p>${escapeHtml(item.summary)}</p>
                            <div class="wb-news-card-foot"><span>${escapeHtml(item.source || 'Thông tin công khai bình thường trong thế giới')}</span></div>
                        </article>
                    `).join('')}
                </div>
                <div class="wb-forum-list">
                    ${(sandbox.forums || []).map(item => `
                        <article class="wb-forum-card is-sandbox">
                            <div class="wb-forum-card-top"><span>${escapeHtml(item.board || 'Trò chuyện phiếm')}</span><small>NON-CANON</small></div>
                            <h3>${escapeHtml(item.title)}</h3>
                            <p>${escapeHtml(item.summary)}</p>
                            ${item.replies?.length ? `<details class="wb-forum-reply-fold"><summary>Xem thử ${item.replies.length}  phản hồi tiêu biểu~</summary><div class="wb-forum-replies">${item.replies.map(reply => `<div><strong>${escapeHtml(reply.author)}</strong><p>${escapeHtml(reply.text)}</p></div>`).join('')}</div></details>` : ''}
                        </article>
                    `).join('')}
                </div>
                ${sandboxItems.length ? '' : renderEmpty('Hôm nay vẫn chưa đi dạo loanh quanh~', 'Nhấn một chút“Đi dạo loanh quanh~”，Rút một nồi tin tức nhỏ và bài đăng rác trên diễn đàn không liên quan đến tuyến truyện chính.')}
            </div>
        `}
    `;
}

function clueStatusLabel(status) {
    return {
        open: 'Chờ nảy mầm',
        developing: 'Đang phát triển',
        echoed: 'Đang phát triển',
        triggered: 'Đã kích hoạt',
        resolved: 'Đã thu hồi',
        discarded: 'Đã buông bỏ',
    }[status] || 'Chưa hô ứng';
}

function memoryFactStatusLabel(status) {
    return {
        active: 'Hiện đang có hiệu lực',
        disputed: 'Xung đột thông tin',
        superseded: 'Đã bị ghi đè bởi phiên bản mới',
        invalidated: 'Đã hết hiệu lực',
    }[status] || 'Hiện đang có hiệu lực';
}

function memoryConfidenceLabel(confidence) {
    return {
        high: 'Rõ ràng',
        medium: 'Khá đáng tin',
        low: 'Chờ xác nhận',
    }[confidence] || 'Khá đáng tin';
}

function memoryItemMatches(item, query) {
    const normalized = String(query || '').trim().toLocaleLowerCase();
    if (!normalized) return true;
    return [
        item?.key,
        item?.subject,
        item?.predicate,
        item?.value,
        item?.title,
        item?.text,
        item?.summary,
        ...(item?.people || []),
        ...(item?.locations || []),
        ...(item?.tags || []),
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized);
}

function resolvePersonEntity(state, value, { allowSubjectPrefix = false } = {}) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const token = raw.toLocaleLowerCase();
    const people = state?.people || [];
    const exact = people.find(item => (
        String(item?.id || '').trim().toLocaleLowerCase() === token
        || String(item?.name || '').trim().toLocaleLowerCase() === token
    ));
    if (exact) return exact;
    if (!allowSubjectPrefix) return null;
    return [...people]
        .filter(item => String(item?.name || '').trim())
        .sort((a, b) => String(b.name).length - String(a.name).length)
        .find(item => {
            const name = String(item.name).trim();
            return raw.startsWith(`${name}của`)
                || raw.startsWith(`${name}·`)
                || raw.startsWith(`${name}：`)
                || raw.startsWith(`${name}:`);
        }) || null;
}

function resolvePersonDisplayName(state, value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return resolvePersonEntity(state, raw)?.name || raw;
}

function memoryFactGroupDescriptor(fact, state) {
    const linkedPerson = Array.isArray(fact?.people) && fact.people.length
        ? resolvePersonEntity(state, fact.people[0])
        : null;
    const subjectPerson = linkedPerson || resolvePersonEntity(
        state,
        fact?.subject || fact?.key,
        { allowSubjectPrefix: true },
    );
    if (subjectPerson) {
        return {
            key: `person:${subjectPerson.id || subjectPerson.name}`,
            label: subjectPerson.name,
        };
    }
    const label = String(fact?.subject || fact?.key || '').trim() || 'Sự thật khác';
    return { key: `fact:${label}`, label };
}

function memoryClueGroupDescriptor(clue, state) {
    const linkedPerson = Array.isArray(clue?.people) && clue.people.length
        ? resolvePersonEntity(state, clue.people[0])
        : null;
    if (linkedPerson) {
        return {
            key: `person:${linkedPerson.id || linkedPerson.name}`,
            label: linkedPerson.name,
        };
    }
    if (Array.isArray(clue?.locations) && clue.locations.length) {
        const label = String(clue.locations[0] || '').trim() || 'Phục bút khác';
        return { key: `location:${label}`, label };
    }
    const label = String(clue?.title || '').trim() || 'Phục bút khác';
    return { key: `clue:${label}`, label };
}

function memorySummaryLevelMeta(summary) {
    if (!summary?.hierarchyManaged) {
        return { label: 'Trải nghiệm phiên bản cũ', tone: 'legacy', description: 'Trải nghiệm giai đoạn để lại từ trước~ vẫn sẽ được ghi nhớ kỹ.' };
    }
    const level = Math.max(0, Math.min(3, Number(summary?.level) || 0));
    const meta = [
        { label: 'Đoạn gần đây', tone: 'detail', description: 'Những đoạn nhỏ gần với nội dung chính gốc nhất~ sẽ có nhiều chi tiết hơn.' },
        { label: 'Tóm tắt giai đoạn', tone: 'stage', description: 'Trọng tâm của một đoạn cốt truyện nhỏ đều được thu thập ở đây nha~' },
        { label: 'Trải nghiệm chương', tone: 'chapter', description: 'Thu thập một đoạn trải nghiệm dài hơn thành trọng tâm~ thuận tiện cho việc tiếp nối sau này.' },
        { label: 'Trải nghiệm dài hạn', tone: 'longterm', description: 'Những thay đổi thực sự quan trọng trải qua thời gian dài, sẽ ngoan ngoãn ở lại đây.' },
    ];
    return meta[level];
}

function renderMemoryActions(kind, item) {
    return `
        <div class="wb-memory-card-actions">
            <button class="is-edit" type="button" data-wb-action="open-memory-editor"
                data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                ${item.locked ? 'disabled' : ''}>Chỉnh sửa</button>
            <button type="button" data-wb-action="toggle-memory-flag"
                data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                data-memory-field="important" class="is-important ${item.important ? 'is-active' : ''}">
                ${item.important ? 'Đã đánh dấu là quan trọng' : 'Đánh dấu là quan trọng'}
            </button>
            <button type="button" data-wb-action="toggle-memory-flag"
                data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                data-memory-field="locked" class="is-lock ${item.locked ? 'is-active' : ''}">
                ${item.locked ? 'Đã khóa' : 'Khóa'}
            </button>
            <button class="is-delete" type="button" data-wb-action="delete-memory-item"
                data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                ${item.locked ? 'disabled' : ''}>Xóa</button>
        </div>
    `;
}

function renderMemoryView(state, observerMode, {
    query = '',
    filter = 'active',
    visibleCount = 12,
    openFolds = new Set(),
} = {}) {
    const memory = state.storyMemory || {
        digest: null,
        facts: [],
        summaries: [],
        clues: [],
    };
    const allFacts = [...(memory.facts || [])]
        .filter(fact => observerMode === 'backstage' || fact.visibility !== 'hidden')
        .sort((a, b) => (
            Number(['active', 'disputed'].includes(b.status))
            - Number(['active', 'disputed'].includes(a.status))
            || Number(b.importance || 0) - Number(a.importance || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ));
    const allClues = [...(memory.clues || [])]
        .filter(clue => observerMode === 'backstage' || clue.visibility !== 'hidden')
        .sort((a, b) => (
            Number(['open', 'developing', 'echoed', 'triggered'].includes(b.status))
            - Number(['open', 'developing', 'echoed', 'triggered'].includes(a.status))
            || Number(b.importance || 0) - Number(a.importance || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ));
    const allSummaries = observerMode === 'backstage'
        ? [...(memory.summaries || [])].sort(
            (a, b) => Number(b.endMessageId || 0) - Number(a.endMessageId || 0),
        )
        : [];
    const summaryById = new Map(allSummaries.map(summary => [String(summary.id || ''), summary]));
    const digest = observerMode === 'backstage' ? memory.digest : null;
    const normalizedFilter = ['active', 'facts', 'clues', 'episodes', 'all'].includes(filter)
        ? filter
        : 'active';
    const maximum = Math.max(6, Number(visibleCount) || 12);
    const facts = allFacts.filter(fact => (
        memoryItemMatches(fact, query)
        && (
            normalizedFilter === 'all'
            || normalizedFilter === 'facts'
            || (normalizedFilter === 'active' && ['active', 'disputed'].includes(fact.status))
        )
    ));
    const clues = allClues.filter(clue => (
        memoryItemMatches(clue, query)
        && (
            normalizedFilter === 'all'
            || normalizedFilter === 'clues'
            || (normalizedFilter === 'active' && ['open', 'developing', 'echoed', 'triggered'].includes(clue.status))
        )
    ));
    const summaries = allSummaries.filter(summary => (
        memoryItemMatches(summary, query)
        && ['all', 'episodes'].includes(normalizedFilter)
    ));
    const shownFacts = facts.slice(0, maximum);
    const shownClues = clues.slice(0, maximum);
    const shownSummaries = summaries.slice(0, maximum);
    const factGroups = groupItems(shownFacts, fact => memoryFactGroupDescriptor(fact, state));
    const clueGroups = groupItems(shownClues, clue => memoryClueGroupDescriptor(clue, state));
    const resultCount = facts.length + clues.length + summaries.length;
    const shownCount = shownFacts.length + shownClues.length + shownSummaries.length;
    const hasMore = shownFacts.length < facts.length
        || shownClues.length < clues.length
        || shownSummaries.length < summaries.length;
    const filterButton = (id, label) => `
        <button type="button" data-wb-action="set-memory-filter" data-filter="${id}"
            aria-pressed="${normalizedFilter === id}"
            class="${normalizedFilter === id ? 'is-active' : ''}">${label}</button>
    `;
    const renderFactCard = (fact, groupLabel = '') => {
        const subject = String(fact.subject || fact.key || '').trim();
        const normalizedGroup = String(groupLabel || '').trim();
        const duplicateSubject = normalizedGroup && subject === normalizedGroup;
        return `
        <article class="wb-memory-fact-card is-${escapeAttr(fact.status)}">
            <div class="wb-memory-fact-meta">
                <span>${escapeHtml(memoryFactStatusLabel(fact.status))}</span>
                <span>${escapeHtml(memoryConfidenceLabel(fact.confidence))}</span>
            </div>
            ${!duplicateSubject && subject ? `<h4>${escapeHtml(subject)}</h4>` : ''}
            ${fact.predicate ? `<small>${escapeHtml(fact.predicate)}</small>` : ''}
            <p>${escapeHtml(fact.value)}</p>
            ${fact.invalidationReason
                ? `<div class="wb-memory-fact-note">${escapeHtml(fact.invalidationReason)}</div>`
                : ''}
            ${renderMemoryActions('fact', fact)}
        </article>
    `;
    };
    const renderClueCard = clue => `
        <article class="wb-clue-card is-${escapeAttr(clue.status)}">
            <div class="wb-clue-meta">
                <span>${escapeHtml(clueStatusLabel(clue.status))}</span>
            </div>
            <h4>${escapeHtml(clue.title)}</h4>
            <p>${escapeHtml(clue.text)}</p>
            ${clue.sourceExcerpt ? `<blockquote>${escapeHtml(clue.sourceExcerpt)}</blockquote>` : ''}
            ${clue.resolution ? `<div class="wb-clue-resolution">${escapeHtml(clue.resolution)}</div>` : ''}
            ${clue.lifecycleReason && clue.lifecycleReason !== clue.resolution ? `<div class="wb-memory-fact-note">Tại sao thay đổi:${escapeHtml(clue.lifecycleReason)}</div>` : ''}
            ${renderMemoryActions('clue', clue)}
        </article>
    `;
    return `
        <div class="wb-view-intro wb-memory-intro">
            <p>Sự thật quan trọng, trải nghiệm và phục bút chưa kết thúc sẽ được lưu lại ở đây~ không cần quan tâm bên dưới dọn dẹp thế nào, nhớ được là tốt rồi nha (｡•̀ᴗ-)✧</p>
            <div class="wb-memory-intro-actions">
                <span>${allFacts.filter(fact => ['active', 'disputed'].includes(fact.status)).length} mục sự thật · ${allClues.filter(clue => ['open', 'developing', 'echoed', 'triggered'].includes(clue.status)).length} mục phục bút</span>
                <button type="button" data-wb-action="open-memory-editor" data-memory-kind="fact">＋ Thêm ký ức mới</button>
            </div>
        </div>
        <div class="wb-memory-shell">
            <div class="wb-memory-tools">
                <div class="wb-memory-filters" aria-label="Lọc ký ức">
                    ${filterButton('active', 'Đang tiến hành')}
                    ${filterButton('facts', 'Sự thật')}
                    ${filterButton('clues', 'Phục bút')}
                    ${filterButton('episodes', 'Trải nghiệm')}
                    ${filterButton('all', 'Tất cả')}
                </div>
                <label class="wb-memory-search">
                    <span>Tìm kiếm ký ức</span>
                    <input type="search" data-wb-memory-search maxlength="80"
                        value="${escapeAttr(query)}" placeholder="Nhân vật, địa điểm, vật phẩm hoặc từ khóa">
                </label>
                <small>${query ? `Tìm thấy ${resultCount} mục` : `Phân loại hiện tại ${resultCount} mục`}</small>
            </div>
            ${(memory.metabolismLog || []).length ? `
                <details class="wb-fold wb-memory-digest" data-fold-key="memory:metabolism"
                    ${foldOpenAttr(openFolds, 'memory:metabolism')}>
                    <summary class="wb-memory-digest-summary">
                        <span><strong>Gần đây đã dọn dẹp những gì~</strong></span>
                        <span class="wb-fold-meta"><small>${Math.min(12, (memory.metabolismLog || []).length)} mục thay đổi gần đây</small><i class="wb-fold-chevron" aria-hidden="true"></i></span>
                    </summary>
                    <div class="wb-fold-body wb-memory-digest-body">
                        ${(memory.metabolismLog || []).slice(-12).reverse().map(item => `<p><strong>${escapeHtml(item.kind === 'fact' ? 'Sự thật' : item.kind === 'clue' ? 'Phục bút' : 'Trải nghiệm')}</strong> · ${escapeHtml(item.action || 'Cập nhật')}<br><small>${escapeHtml(item.reason || 'Đã sắp xếp theo nội dung tiếp theo')}</small></p>`).join('')}
                    </div>
                </details>
            ` : ''}
            ${digest?.text ? `
                <details class="wb-fold wb-memory-digest" data-fold-key="memory:digest"
                    ${foldOpenAttr(openFolds, 'memory:digest')}>
                    <summary class="wb-memory-digest-summary">
                        <span><strong>Tóm tắt dài hạn</strong></span>
                        <span class="wb-fold-meta">
                            <small>Đã ngoan ngoãn sắp xếp xong rồi nha~</small>
                            <i class="wb-fold-chevron" aria-hidden="true"></i>
                        </span>
                    </summary>
                    <div class="wb-fold-body wb-memory-digest-body">
                        <p>${escapeHtml(digest.text)}</p>
                    </div>
                </details>
            ` : ''}
            ${resultCount === 0 ? renderEmpty(
                query ? 'Không tìm thấy ký ức phù hợp' : 'Phân loại này tạm thời trống',
                query ? 'Hãy thử đổi một nhân vật, địa điểm, vật phẩm hoặc từ khóa khác.' : 'Nội dung chính mới sau khi sắp xếp sẽ tự động bổ sung.',
            ) : `
            <div class="wb-memory-layout">
                <section class="wb-memory-section ${shownFacts.length ? '' : 'is-hidden'}">
                    <div class="wb-section-heading wb-memory-heading-with-folds">
                        <div><h3>Sự thật dài hạn</h3></div>
                        ${renderFoldToolbar('memory:facts:')}
                    </div>
                    <div class="wb-memory-group-list">
                        ${factGroups.map(group => {
                            const foldKey = `memory:facts:${encodeURIComponent(group.key || group.label)}`;
                            return `
                                <details class="wb-fold wb-memory-group" data-fold-key="${escapeAttr(foldKey)}"
                                    ${foldOpenAttr(openFolds, foldKey)}>
                                    <summary class="wb-memory-group-summary">
                                        <span>
                                            <strong>${escapeHtml(group.label)}</strong>
                                            <small>${group.items.length} mục sự thật dài hạn</small>
                                        </span>
                                        <i class="wb-fold-chevron" aria-hidden="true"></i>
                                    </summary>
                                    <div class="wb-fold-body wb-memory-group-body">
                                        ${group.items.map(item => renderFactCard(item, group.label)).join('')}
                                    </div>
                                </details>
                            `;
                        }).join('') || renderEmpty('Vẫn chưa có sự thật dài hạn~', 'Sau này những việc thực sự quan trọng, vẫn còn dùng đến sẽ từ từ được lưu lại ở đây.')}
                    </div>
                </section>
                <section class="wb-memory-section ${shownClues.length ? '' : 'is-hidden'}">
                    <div class="wb-section-heading wb-memory-heading-with-folds">
                        <div><h3>Sổ phục bút</h3></div>
                        ${renderFoldToolbar('memory:clues:')}
                    </div>
                    <div class="wb-memory-group-list">
                        ${clueGroups.map(group => {
                            const foldKey = `memory:clues:${encodeURIComponent(group.key || group.label)}`;
                            return `
                                <details class="wb-fold wb-memory-group" data-fold-key="${escapeAttr(foldKey)}"
                                    ${foldOpenAttr(openFolds, foldKey)}>
                                    <summary class="wb-memory-group-summary">
                                        <span>
                                            <strong>${escapeHtml(group.label)}</strong>
                                            <small>${group.items.length} mục phục bút liên quan</small>
                                        </span>
                                        <i class="wb-fold-chevron" aria-hidden="true"></i>
                                    </summary>
                                    <div class="wb-fold-body wb-memory-group-body">
                                        ${group.items.map(renderClueCard).join('')}
                                    </div>
                                </details>
                            `;
                        }).join('') || renderEmpty('Sổ phục bút vẫn đang trống~', 'Sau này có manh mối nào cần nhớ để thu hồi, chúng sẽ tự động hiện ra.')}
                    </div>
                </section>
            </div>
            <section class="wb-memory-summary-section ${shownSummaries.length ? '' : 'is-hidden'}">
                <div class="wb-section-heading wb-memory-heading-with-folds">
                    <div><h3>Trải nghiệm</h3></div>
                    ${renderFoldToolbar('memory:summary:')}
                </div>
                <div class="wb-summary-list">
                    ${shownSummaries.map(summary => {
                        const foldKey = `memory:summary:${summary.id || `${summary.startMessageId}-${summary.endMessageId}`}`;
                        const levelMeta = memorySummaryLevelMeta(summary);
                        const sourceSummaries = (summary.sourceSummaryIds || [])
                            .map(id => summaryById.get(String(id)))
                            .filter(Boolean);
                        const parent = summary.parentId ? summaryById.get(String(summary.parentId)) : null;
                        return `
                            <details class="wb-fold wb-summary-card is-${escapeAttr(levelMeta.tone)}" data-fold-key="${escapeAttr(foldKey)}"
                                ${foldOpenAttr(openFolds, foldKey)}>
                                <summary class="wb-summary-card-summary">
                                    <span><strong>${escapeHtml(summary.title)}</strong></span>
                                    <i class="wb-fold-chevron" aria-hidden="true"></i>
                                </summary>
                                <div class="wb-fold-body wb-summary-card-body">
                                    <p>${escapeHtml(summary.summary)}</p>
                                    <details class="wb-memory-lineage">
                                        <summary>Ký ức này từ đâu đến~</summary>
                                        <div>
                                            <p>${escapeHtml(levelMeta.label)} · Tin nhắn ${escapeHtml(summary.startMessageId)}—${escapeHtml(summary.endMessageId)}</p>
                                            ${parent ? `<p>Đã thu thập vào:${escapeHtml(parent.title)}</p>` : ''}
                                            ${sourceSummaries.length ? `<p>Còn có ${sourceSummaries.length} nguồn chi tiết hơn có thể truy xuất~</p>` : ''}
                                        </div>
                                    </details>
                                    ${renderMemoryActions('summary', summary)}
                                </div>
                            </details>
                        `;
                    }).join('') || renderEmpty(
                        observerMode === 'backstage' ? 'Chưa có trải nghiệm phân tầng' : 'Trải nghiệm phân tầng chỉ hiển thị ở góc nhìn hậu trường',
                        observerMode === 'backstage' ? 'Sau khi sắp xếp nội dung chính, những trải nghiệm quan trọng sẽ dần xuất hiện ở đây~' : '',
                    )}
                </div>
            </section>
            `}
            ${hasMore ? `
                <button class="wb-memory-load-more" type="button" data-wb-action="load-more-memory">
                    Hiển thị thêm một chút · Hiện tại ${shownCount}/${resultCount}
                </button>
            ` : ''}
        </div>
    `;
}

function renderMemoryEditorModal(state, editor) {
    const requestedKind = ['fact', 'clue', 'summary'].includes(editor?.kind)
        ? editor.kind
        : 'fact';
    const collection = requestedKind === 'fact'
        ? state.storyMemory?.facts
        : requestedKind === 'clue'
            ? state.storyMemory?.clues
            : state.storyMemory?.summaries;
    const item = collection?.find(entry => entry.id === editor?.id) || null;
    const title = requestedKind === 'fact' ? item?.subject : item?.title;
    const relation = requestedKind === 'fact' ? item?.predicate : '';
    const content = requestedKind === 'fact'
        ? item?.value
        : requestedKind === 'clue'
            ? item?.text
            : item?.summary;
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-memory-editor">
            <form class="wb-event-form wb-memory-editor" data-wb-form="memory">
                <div class="wb-form-heading">
                    <div><span>MEMORY DESK</span><h3>${item ? 'Chỉnh sửa ký ức' : 'Thêm ký ức thủ công'}</h3></div>
                    <button type="button" data-wb-action="close-memory-editor">×</button>
                </div>
                <input type="hidden" name="id" value="${escapeAttr(item?.id || '')}">
                <label>Loại ký ức
                    <select name="kind" ${item ? 'disabled' : ''}>
                        <option value="fact" ${requestedKind === 'fact' ? 'selected' : ''}>Sự thật dài hạn</option>
                        <option value="clue" ${requestedKind === 'clue' ? 'selected' : ''}>Phục bút</option>
                        <option value="summary" ${requestedKind === 'summary' ? 'selected' : ''}>Trải nghiệm giai đoạn</option>
                    </select>
                    ${item ? `<input type="hidden" name="kind" value="${requestedKind}">` : ''}
                </label>
                <label>Tiêu đề<input name="title" required maxlength="120"
                    value="${escapeAttr(title || '')}" placeholder="Nhân vật, vật phẩm, lời hứa hoặc sự kiện"></label>
                <label>Mối quan hệ (có thể dùng cho sự thật dài hạn)<input name="relation" maxlength="100"
                    value="${escapeAttr(relation || '')}" placeholder="Ví dụ: đồng ý, sở hữu, thân phận thật"></label>
                <label>Nội dung<textarea name="content" required maxlength="1400" rows="5"
                    placeholder="Viết xuống nội dung chính xác cần giữ lại lâu dài">${escapeHtml(content || '')}</textarea></label>
                <div class="wb-memory-editor-flags">
                    <label><input name="important" type="checkbox" ${item?.important ? 'checked' : ''}> Đánh dấu là quan trọng</label>
                    <label><input name="locked" type="checkbox" ${item?.locked ? 'checked' : ''}> Khóa sau khi lưu</label>
                </div>
                <div class="wb-form-note">Sau khi khóa, tự động sắp xếp sẽ không ghi đè hoặc xóa ký ức này; khi cần sửa đổi hãy mở khóa trên thẻ trước.</div>
                <button class="wb-primary-button" type="submit">${item ? 'Lưu sửa đổi' : 'Thêm vào ký ức'}</button>
            </form>
        </div>
    `;
}

function renderArchiveView(state, openFolds = new Set()) {
    const archived = Array.isArray(state.archive) ? state.archive : [];
    return `
        <div class="wb-view-intro">
            <p>Những chuyện không được ống kính nhìn thấy cũng sẽ không bốc hơi khỏi thế gian~ Ở đây ghi lại những lịch sử thế giới đã thực sự xảy ra, nhưng lại lặng lẽ bỏ lỡ nội dung chính.</p>
            <span>Sổ cái thế giới</span>
        </div>
        <div class="wb-archive-ledger">
            ${archived.map(entry => renderArchiveEntry(entry, state, 'archive', openFolds)).join('')
                || renderEmpty('Sổ biên niên sử vẫn còn trống~', 'Chưa có đoạn lịch sử thế giới nào lặng lẽ bỏ lỡ ống kính (˘ω˘)')}
        </div>
    `;
}

function renderWorldEditorModal(state) {
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-world-editor">
            <form class="wb-event-form wb-world-editor" data-wb-form="world">
                <div class="wb-form-heading">
                    <div><span>WORLD DESK</span><h3>Chỉnh sửa tổng quan thế giới</h3></div>
                    <button type="button" data-wb-action="close-world-editor">×</button>
                </div>
                <label>Tiêu đề thế giới
                    <input name="title" required maxlength="140" value="${escapeAttr(state.world?.title || '')}">
                </label>
                <label>Tổng quan hiện tại
                    <textarea name="detail" required maxlength="900" rows="6">${escapeHtml(state.world?.detail || '')}</textarea>
                </label>
                <div class="wb-form-note">Ở đây chỉ sửa đổi“Lúc này”tổng quan thế giới hiển thị trên trang; thời gian thế giới chính vui lòng tiếp tục hiệu chuẩn trong cài đặt quan sát.</div>
                <button class="wb-primary-button" type="submit">Lưu tổng quan thế giới</button>
            </form>
        </div>
    `;
}

function recordEditorData(state, editor) {
    if (!editor) return null;
    if (editor.kind === 'echo') {
        const event = state.events.find(item => item.id === editor.id);
        if (!event) return null;
        return {
            kind: 'echo',
            id: event.id,
            title: event.title || '',
            text: event.result || event.expectedResult || event.consequence || '',
            place: event.place || '',
            visibility: event.visibility || 'hidden',
            deliveryState: event.delivery?.state || 'none',
        };
    }
    const entry = state.archive.find(item => item.id === editor.id);
    if (!entry) return null;
    return {
        kind: 'archive',
        id: entry.id,
        title: entry.title || 'Bản ghi chưa đặt tên',
        text: entry.result || entry.text || entry.consequence || entry.route || '',
        place: '',
        visibility: entry.visibility || 'hidden',
        deliveryState: entry.deliveryState || entry.delivery?.state || 'none',
    };
}

function renderRecordEditorModal(state, editor) {
    const record = recordEditorData(state, editor);
    if (!record) return '';
    const isEcho = record.kind === 'echo';
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-record-editor">
            <form class="wb-event-form wb-record-editor" data-wb-form="record">
                <div class="wb-form-heading">
                    <div><span>${isEcho ? 'ECHO DESK' : 'ARCHIVE DESK'}</span><h3>${isEcho ? 'Chỉnh sửa tiếng vang' : 'Chỉnh sửa biên niên sử'}</h3></div>
                    <button type="button" data-wb-action="close-record-editor">×</button>
                </div>
                <input type="hidden" name="kind" value="${escapeAttr(record.kind)}">
                <input type="hidden" name="id" value="${escapeAttr(record.id)}">
                <label>Tiêu đề
                    <input name="title" required maxlength="140" value="${escapeAttr(record.title)}">
                </label>
                <label>${isEcho ? 'Kết quả hình thành' : 'Nội dung biên niên sử'}
                    <textarea name="text" required maxlength="900" rows="6">${escapeHtml(record.text)}</textarea>
                </label>
                ${isEcho ? `<label>Địa điểm
                    <input name="place" maxlength="160" value="${escapeAttr(record.place)}">
                </label>` : ''}
                <div class="wb-form-grid">
                    <label>Ranh giới có thể nhìn thấy
                        <select name="visibility">
                            <option value="hidden" ${record.visibility === 'hidden' ? 'selected' : ''}>Hoàn toàn hậu trường</option>
                            <option value="trace" ${record.visibility === 'trace' ? 'selected' : ''}>Để lại dấu vết</option>
                            <option value="known" ${record.visibility === 'known' ? 'selected' : ''}>Nhân vật có thể biết</option>
                            <option value="direct" ${record.visibility === 'direct' ? 'selected' : ''}>Có thể hiển thị trực tiếp</option>
                        </select>
                    </label>
                    ${isEcho ? `<label>Trạng thái đệ trình
                        <select name="deliveryState">
                            <option value="none" ${record.deliveryState === 'none' ? 'selected' : ''}>Chưa đệ trình</option>
                            <option value="pending" ${record.deliveryState === 'pending' ? 'selected' : ''}>Chờ hiển thị</option>
                            <option value="delivered" ${record.deliveryState === 'delivered' ? 'selected' : ''}>Nội dung chính đã tiếp nối</option>
                            <option value="expired" ${record.deliveryState === 'expired' ? 'selected' : ''}>Lưu trữ chưa hiển thị</option>
                        </select>
                    </label>` : ''}
                </div>
                <div class="wb-form-note">Sửa đổi chỉ chỉnh sửa kỷ lục thế giới hiện tại, sẽ không thúc đẩy thời gian thế giới chính. Xóa thì có thể dùng hoàn tác ở dưới cùng để khôi phục.</div>
                <button class="wb-primary-button" type="submit">Lưu sửa đổi</button>
            </form>
        </div>
    `;
}

function visualViewportBounds() {
    const viewport = window.visualViewport;
    const left = Math.max(0, Number(viewport?.offsetLeft || 0));
    const top = Math.max(0, Number(viewport?.offsetTop || 0));
    const width = Math.max(0, Number(viewport?.width || window.innerWidth || 0));
    const height = Math.max(0, Number(viewport?.height || window.innerHeight || 0));
    return { left, top, width, height, right: left + width, bottom: top + height };
}

function responsiveOrbSize(
    viewportWidth = window.innerWidth,
    viewportHeight = window.innerHeight,
) {
    const shortestSide = Math.min(viewportWidth, viewportHeight);
    if (shortestSide > 680) return 52;
    return Math.round(Math.max(34, Math.min(38, shortestSide * 0.09)));
}

function clampOrbPosition(position) {
    if (
        !position
        || !Number.isFinite(Number(position.x))
        || !Number.isFinite(Number(position.y))
        || typeof window === 'undefined'
    ) {
        return null;
    }
    const viewport = visualViewportBounds();
    const size = responsiveOrbSize(viewport.width, viewport.height);
    const margin = 10;
    const minX = viewport.left + margin;
    const minY = viewport.top + margin;
    const maxX = Math.max(minX, viewport.right - size - margin);
    const maxY = Math.max(minY, viewport.bottom - size - margin);
    return {
        x: Math.min(maxX, Math.max(minX, Number(position.x))),
        y: Math.min(maxY, Math.max(minY, Number(position.y))),
        size,
    };
}

function orbInlineStyles(position) {
    const placed = clampOrbPosition(position);
    if (!placed) return { orb: '', caption: '' };
    const captionWidth = 210;
    const captionX = placed.x > captionWidth + 28
        ? placed.x - captionWidth - 10
        : placed.x + placed.size + 10;
    return {
        orb: `left:${Math.round(placed.x)}px;top:${Math.round(placed.y)}px;right:auto;bottom:auto;`,
        caption: `left:${Math.round(Math.max(8, Math.min(window.innerWidth - captionWidth - 8, captionX)))}px;top:${Math.round(placed.y + 5)}px;right:auto;bottom:auto;`,
    };
}

export function createWorldBackstageUI({
    getState,
    getSettings,
    getSyncStatus = () => ({ phase: 'idle', message: 'Chưa tiến hành suy diễn thế giới' }),
    onAction,
    pluginVersion = '',
}) {
    const root = document.createElement('div');
    root.id = 'world-backstage-root';
    document.body.appendChild(root);

    function syncVisualViewportInsets() {
        const viewport = window.visualViewport;
        const viewportWidth = Number(viewport?.width || window.innerWidth || 0);
        const viewportHeight = Number(viewport?.height || window.innerHeight || 0);
        const offsetLeft = Math.max(0, Number(viewport?.offsetLeft || 0));
        const offsetTop = Math.max(0, Number(viewport?.offsetTop || 0));
        const right = Math.max(0, Number(window.innerWidth || 0) - viewportWidth - offsetLeft);
        root.style.setProperty('--wb-visual-inset-top', `${Math.round(offsetTop)}px`);
        root.style.setProperty('--wb-visual-inset-right', `${Math.round(right)}px`);
        root.style.setProperty('--wb-visual-inset-left', `${Math.round(offsetLeft)}px`);
        root.style.setProperty('--wb-visual-width', `${Math.round(viewportWidth)}px`);
        root.style.setProperty('--wb-visual-height', `${Math.round(viewportHeight)}px`);
    }
    syncVisualViewportInsets();

    function ensureMounted() {
        if (!root.isConnected) document.body.appendChild(root);
        syncVisualViewportInsets();
        const position = getSettings().orbPosition;
        if (position && root.querySelector('.wb-world-orb')) positionOrbElements(position.x, position.y);
        if (!root.querySelector('.wb-world-orb')) render();
        return root.isConnected;
    }

    let activeView = 'now';
    let renderedView = activeView;
    let observerMode = 'backstage';
    let isOpen = false;
    let settingsOpen = false;
    let eventFormOpen = false;
    let eventEditorId = '';
    let selectedPersonId = null;
    let personObservation = null;
    let busy = false;
    let toast = '';
    let toastTimer = null;
    let closeTimer = null;
    let closing = false;
    let panelEntrancePending = false;
    let publicOpinionMode = 'news';
    let memorySearchTimer = null;
    let memoryFilter = 'active';
    let memoryQuery = '';
    let memoryVisibleCount = 12;
    let memoryEditor = null;
    let personEditor = null;
    let worldEditorOpen = false;
    let recordEditor = null;
    let settingsScrollTop = 0;
    let openSettingsGroups = new Set();
    let openSettingsSubgroups = new Set();
    let openContentFolds = new Set();
    let eventFormDraft = null;
    let clockFormDraft = null;
    let apiFormDraft = null;
    let tagFilterDraftRules = null; // null = use settings; array may include empty draft cards
    let tagFilterCandidates = [];
    let worldbookQuery = '';
    let worldbookOnlyPeople = false;
    let worldbookOnlyEnabled = false;
    let worldbookSelectedIds = new Set();
    let worldbookSearchTimer = null;
    let skipApiDraftCapture = false;
    let skipTagFilterDraftCapture = false;
    const viewScrollTop = new Map();
    let orbDrag = null;
    let suppressOrbClick = false;

    function notify(message, tone = 'normal') {
        toast = String(message || '');
        root.dataset.toastTone = tone;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            toast = '';
            render();
        }, tone === 'error' ? 7600 : 5200);
        render();
    }

    function readApiForm(form) {
        const data = Object.fromEntries(new FormData(form).entries());
        apiFormDraft = { ...data };
        return data;
    }

    function apiSettingsFromDraft(data) {
        const replacementKey = String(data.customApiCredential || '').trim();
        return {
            customApiUrl: data.customApiUrl,
            customApiKey: replacementKey || getSettings().customApiKey,
            customApiModel: data.customApiModel,
            customApiTransport: data.customApiTransport,
        };
    }

    function apiRequestFromDraft(data, { requireModel = true } = {}) {
        const settings = getSettings();
        const profileId = String(data.profileId || '').trim();
        const existingProfile = (settings.apiProfiles || []).find(item => item.id === profileId);
        const key = String(data.customApiCredential || '').trim()
            || existingProfile?.key
            || (!profileId ? settings.customApiKey : '');
        const model = String(data.customApiModel || '').trim();
        if (!key) throw new Error('Giao diện này vẫn thiếu API Key ồ~');
        if (requireModel && !model) throw new Error('Hãy chọn một mô hình trước rồi mới kiểm tra nhé~');
        return {
            url: data.customApiUrl,
            key,
            model,
            transport: data.customApiTransport,
            label: String(data.profileName || existingProfile?.name || 'Giao diện này').trim() || 'Giao diện này',
        };
    }

    function forgetApiKeyDraft(data) {
        apiFormDraft = { ...data, customApiCredential: '' };
        skipApiDraftCapture = true;
    }

    async function invokeAction(action, payload = {}) {
        try {
            const result = await onAction(action, payload);
            return result === undefined ? true : result;
        } catch (error) {
            const message = String(error?.message || error || 'Lỗi không xác định');
            console.warn('[Mặt trái thế giới] Thao tác giao diện chưa hoàn thành', error);
            notify(`Thao tác chưa hoàn thành:${message}`, 'error');
            return false;
        }
    }

    function visibleTagFilterRules(settings) {
        if (Array.isArray(tagFilterDraftRules)) return tagFilterDraftRules;
        return Array.isArray(settings.tagFilterRules)
            ? settings.tagFilterRules.map(rule => ({ open: rule.open, close: rule.close }))
            : [];
    }

    async function persistTagFilterRules(rules) {
        const persisted = rules
            .map(rule => ({
                open: String(rule.open || '').trim().slice(0, 80),
                close: String(rule.close || '').trim().slice(0, 80),
            }))
            .filter(rule => rule.open || rule.close)
            .slice(0, 30);
        tagFilterDraftRules = rules.map(rule => ({
            open: String(rule.open || ''),
            close: String(rule.close || ''),
        }));
        skipTagFilterDraftCapture = true;
        await invokeAction('update-settings', { tagFilterRules: persisted });
    }

    function setBusy(value) {
        busy = Boolean(value);
        render();
    }

    function open() {
        window.clearTimeout(closeTimer);
        closing = false;
        panelEntrancePending = !isOpen;
        isOpen = true;
        render();
    }

    function close() {
        if (!isOpen || closing) return;
        closing = true;
        root.querySelector('.wb-panel-scrim')?.classList.add('is-closing');
        const closeDelay = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            ? 0
            : 145;
        closeTimer = window.setTimeout(() => {
            isOpen = false;
            closing = false;
            settingsOpen = false;
            eventFormOpen = false;
            eventEditorId = '';
            eventFormDraft = null;
            clockFormDraft = null;
            tagFilterDraftRules = null;
            memoryEditor = null;
            personEditor = null;
            worldEditorOpen = false;
            recordEditor = null;
            selectedPersonId = null;
            personObservation = null;
            render();
        }, closeDelay);
    }

    function render() {
        const viewChanged = activeView !== renderedView;
        const animatePanelEntrance = Boolean(isOpen && panelEntrancePending);
        const previousContent = root.querySelector('.wb-view-content');
        if (previousContent) viewScrollTop.set(renderedView, previousContent.scrollTop);
        const previousContentFolds = root.querySelectorAll('.wb-fold[data-fold-key]');
        if (previousContentFolds.length) {
            openContentFolds = new Set(
                [...previousContentFolds]
                    .filter(item => item.open)
                    .map(item => item.dataset.foldKey)
                    .filter(Boolean),
            );
        }
        const previousSettings = root.querySelector('.wb-settings-popover');
        if (previousSettings) settingsScrollTop = previousSettings.scrollTop;
        const previousSettingGroups = root.querySelectorAll('.wb-settings-group[data-settings-group]');
        if (previousSettingGroups.length) {
            openSettingsGroups = new Set(
                [...previousSettingGroups]
                    .filter(group => group.open)
                    .map(group => group.dataset.settingsGroup),
            );
        }
        const previousSettingSubgroups = root.querySelectorAll('.wb-settings-subgroup[data-settings-subgroup]');
        if (previousSettingSubgroups.length) {
            openSettingsSubgroups = new Set(
                [...previousSettingSubgroups]
                    .filter(group => group.open)
                    .map(group => group.dataset.settingsSubgroup),
            );
        }
        const previousEventForm = root.querySelector('[data-wb-form="event"]');
        if (previousEventForm && eventFormOpen) {
            eventFormDraft = Object.fromEntries(new FormData(previousEventForm).entries());
        }
        const previousClockForm = root.querySelector('[data-wb-form="clock"]');
        if (previousClockForm && settingsOpen) {
            clockFormDraft = Object.fromEntries(new FormData(previousClockForm).entries());
        }
        const previousApiForm = root.querySelector('[data-wb-form="api"]');
        if (previousApiForm && !skipApiDraftCapture) {
            readApiForm(previousApiForm);
        }
        skipApiDraftCapture = false;
        if (settingsOpen && !skipTagFilterDraftCapture) {
            const previousTagFilterRules = root.querySelectorAll('.wb-tag-filter-rule');
            if (previousTagFilterRules.length) {
                tagFilterDraftRules = [...previousTagFilterRules].map(card => ({
                    open: String(card.querySelector('[data-wb-tag-filter-field="open"]')?.value || ''),
                    close: String(card.querySelector('[data-wb-tag-filter-field="close"]')?.value || ''),
                }));
            }
        }
        skipTagFilterDraftCapture = false;
        const previousFocus = root.contains(document.activeElement)
            ? {
                id: document.activeElement.id || '',
                name: document.activeElement.getAttribute?.('name') || '',
                selectionStart: document.activeElement.selectionStart,
                selectionEnd: document.activeElement.selectionEnd,
            }
            : null;

        const state = getState();
        const settings = getSettings();
        const syncStatus = getSyncStatus();
        const canCancelSimulation = Boolean(syncStatus.canCancelSimulation);
        const memoryPhase = syncStatus.memory?.phase;
        if (['running', 'error'].includes(memoryPhase)) {
            openSettingsGroups.add('memory');
            openSettingsSubgroups.add('memory-history');
        }
        const memoryTakesFocus = ['running', 'error'].includes(memoryPhase);
        const displayPhase = memoryTakesFocus ? memoryPhase : syncStatus.phase;
        const displayPhaseLabel = memoryTakesFocus
            ? (memoryPhase === 'error' ? 'Ký ức thất bại' : 'Đang sắp xếp ký ức')
            : `${syncPhaseLabel(syncStatus.phase)}${syncStatus.queue?.waitingTurns > 0
                ? ` · Chờ ${syncStatus.queue.waitingTurns} Vòng`
                : ''}`;
        const theme = themeFor(state, settings);
        const clock = formatWorldCalendar(state);
        const clockAnchored = Boolean(state.clock?.anchored);
        const clockLabel = worldClockLabel(state, clock);
        const orbStyles = orbInlineStyles(settings.orbPosition);
        const currentView = VIEWS.find(view => view.id === activeView) || VIEWS[0];
        const userName = String(syncStatus.userName || '').toLocaleLowerCase();
        const displayPeople = state.people.map(person => {
            const isUser = Boolean(
                person.isUser
                || (userName && person.name?.toLocaleLowerCase() === userName)
            );
            return isUser && !settings.includeUserInnerVoice
                ? { ...person, isUser: true, innerVoice: '' }
                : { ...person, isUser };
        });
        const visiblePeople = observerMode === 'backstage'
            ? displayPeople
            : displayPeople.filter(person => person.knowledge === 'known');
        const visibleEvents = observerMode === 'backstage'
            ? state.events
            : state.events.filter(event => event.visibility !== 'hidden');
        const activeEvents = visibleEvents.filter(isActiveEvent);
        const outcomes = visibleEvents
            .filter(event => (event.status === 'ready' || isTerminalEvent(event)) && event.delivery?.state !== 'expired')
            .sort((a, b) => Number(b.resolvedAt ?? b.updatedAt) - Number(a.resolvedAt ?? a.updatedAt));
        const person = displayPeople.find(item => item.id === selectedPersonId);
        const presentPersonIds = new Set(syncStatus.presentPersonIds || []);
        const canObservePerson = Boolean(
            person
            && observerMode === 'backstage'
            && !presentPersonIds.has(person.id)
            && !person.isUser
        );
        const pendingDeliveries = state.events.filter(event => event.delivery?.state === 'pending').length;
        const orbProcessing = (
            ['queued', 'running', 'cancelling'].includes(syncStatus.phase)
            || syncStatus.memory?.phase === 'running'
        );
        const needsAttention = (
            pendingDeliveries
            || state.pendingSync
            || ['error', 'pending', 'queued'].includes(syncStatus.phase)
            || memoryPhase === 'error'
        );

        let content = '';
        if (activeView === 'now') content = renderNowView(state, observerMode, visiblePeople, activeEvents);
        if (activeView === 'people') content = renderPeopleView(state, observerMode, visiblePeople, openContentFolds);
        if (activeView === 'currents') content = renderCurrentsView(state, activeEvents, openContentFolds, settings);
        if (activeView === 'echoes') content = renderEchoesView(state, outcomes, openContentFolds);
        if (activeView === 'opinion') content = renderPublicOpinionView(state, syncStatus.publicOpinion || {}, publicOpinionMode, settings);
        if (activeView === 'memory') content = renderMemoryView(state, observerMode, {
            query: memoryQuery,
            filter: memoryFilter,
            visibleCount: memoryVisibleCount,
            openFolds: openContentFolds,
        });
        if (activeView === 'archive') content = renderArchiveView(state, openContentFolds);

        root.className = `wb-root theme-${theme} wb-size-${settings.uiScale} ${settings.enabled ? 'is-enabled' : 'is-disabled'}`;
        root.innerHTML = `
            <button class="wb-world-orb ${isOpen ? 'is-open' : ''} ${orbProcessing ? 'is-processing' : ''} ${settings.orbPosition ? 'has-custom-position' : ''}" type="button"
                style="${orbStyles.orb}" data-wb-action="toggle-panel"
                aria-label="${isOpen ? 'Thu gọn Mặt trái thế giới' : 'Mở Mặt trái thế giới'}">
                <span class="wb-orb-halo"></span>
                <span class="wb-orb-ring ring-one"></span>
                <span class="wb-orb-ring ring-two"></span>
                <span class="wb-orb-core"></span>
                ${needsAttention ? '<i class="wb-orb-notice"></i>' : ''}
            </button>
            <div class="wb-orb-caption ${!isOpen && needsAttention ? 'is-visible' : ''}"
                style="${orbStyles.caption}">
                <strong>Mặt trái thế giới</strong>
                <span>${escapeHtml(
                    memoryPhase === 'error'
                        ? syncStatus.memory?.message || 'Sắp xếp ký ức vừa bị vấp một chút QAQ，Nhấn vào xem nguyên nhân nhé～'
                        : memoryPhase === 'running'
                        ? syncStatus.memory.message || 'Ký ức đang được âm thầm dọn dẹp～ (｡•̀ᴗ-)✧'
                        : orbProcessing
                            ? syncStatus.message || 'Thế giới ngoài ống kính đang âm thầm vận hành… ( •̀ ω •́ )✧'
                            : syncStatus.phase === 'error'
                                ? 'Ưm, thế giới lần này không quay rồi QAQ，Nhấn vào xem nguyên nhân nhé～'
                                : state.pendingSync
                                    ? 'Nội dung chính mới đang ngoan ngoãn xếp hàng chờ suy diễn～ (｡•̀ᴗ-)✧'
                                    : pendingDeliveries > 0
                                        ? `${pendingDeliveries}  điều thay đổi đang từ từ tiến lại gần ống kính～`
                                        : 'Ngoài ống kính tạm thời rất yên tĩnh～ (˘ω˘)',
                )}</span>
            </div>

            ${isOpen ? `
                <div class="wb-panel-scrim ${animatePanelEntrance ? 'is-opening' : ''}" data-wb-action="close-panel">
                    <section class="wb-window" role="dialog" aria-modal="true" aria-label="Mặt trái thế giới">
                        <header class="wb-window-header">
                            <div class="wb-brand">
                                ${renderBrandMark()}
                                <div>
                            <span class="wb-brand-line"><h1>Mặt trái thế giới</h1><i>Phiên bản chính thức ${escapeHtml(pluginVersion || '1.1.0')}</i></span>
                                    <p>Ngoài ống kính, thế giới vẫn đang tiếp diễn</p>
                                </div>
                            </div>
                            <div class="wb-header-center">
                                <time class="wb-world-calendar" ${clockAnchored ? `datetime="${escapeAttr(
                                    `${clock.year}-${String(clock.month).padStart(2, '0')}-${String(clock.dayOfMonth).padStart(2, '0')}T${clock.time}`,
                                )}"` : ''} aria-label="${escapeAttr(clockLabel)}">
                                    ${clockAnchored ? `
                                        <span class="wb-calendar-page" aria-hidden="true">
                                            <small>${escapeHtml(`T${clock.month}`)}</small>
                                            <strong>${escapeHtml(String(clock.dayOfMonth).padStart(2, '0'))}</strong>
                                        </span>
                                        <span class="wb-calendar-copy">
                                            <small>${escapeHtml(`${state.world.name} · ${clock.calendarName}`)}</small>
                                            <strong>${escapeHtml(`Tháng ${clock.month} Năm ${clock.year}`)}</strong>
                                            <em>${escapeHtml(clock.time)}</em>
                                        </span>
                                    ` : `
                                        <span class="wb-calendar-page" aria-hidden="true">
                                            <small>Thời gian</small>
                                            <strong>··</strong>
                                        </span>
                                        <span class="wb-calendar-copy">
                                            <small>${escapeHtml(`${state.world.name} · Đồng hồ thế giới chính`)}</small>
                                            <strong>Chờ hiệu chuẩn lần đầu</strong>
                                            <em>Thiết lập sau khi suy diễn</em>
                                        </span>
                                    `}
                                </time>
                                <span class="wb-live-status is-${escapeAttr(displayPhase)}">
                                    <i></i>${escapeHtml(displayPhaseLabel)}
                                </span>
                            </div>
                            <div class="wb-header-actions">
                                <button type="button" class="wb-round-action" data-wb-action="cycle-theme"
                                    aria-label="Chuyển sang ban ngày/Ban đêm"><span class="wb-theme-glyph"></span></button>
                                <button type="button" class="wb-round-action ${settingsOpen ? 'is-active' : ''}"
                                    data-wb-action="toggle-settings" aria-label="Cài đặt quan sát">
                                    <span class="wb-settings-glyph"></span>
                                </button>
                                <button type="button" class="wb-round-action" data-wb-action="toggle-panel"
                                    aria-label="Thu gọn">—</button>
                            </div>
                        </header>

                        <div class="wb-window-body">
                            <nav class="wb-side-nav">
                                ${VIEWS.map(view => `
                                    <button type="button" data-wb-action="set-view" data-view="${view.id}"
                                        aria-current="${activeView === view.id ? 'page' : 'false'}"
                                        class="${activeView === view.id ? 'is-active' : ''}">
                                        <i></i><span><small>${view.eyebrow}</small><strong>${view.label}</strong></span>
                                    </button>
                                `).join('')}
                                <button class="wb-side-sync wb-sim-action ${canCancelSimulation ? 'is-cancel' : ''}"
                                    type="button" data-wb-action="${canCancelSimulation ? 'cancel-simulation' : 'manual-sync'}"
                                    ${busy && !canCancelSimulation ? 'disabled' : ''}>
                                    <i aria-hidden="true"></i><span>${canCancelSimulation ? 'Dừng suy diễn' : 'Suy diễn thế giới'}</span>
                                </button>
                            </nav>

                            <div class="wb-content-column">
                                <div class="wb-view-header">
                                    <div><span>${currentView.eyebrow}</span><h2>${currentView.label}</h2></div>
                                    ${activeView === 'opinion' ? `
                                        <div class="wb-public-readonly-badge"><i></i>Chỉ đọc quan sát</div>
                                    ` : `
                                        <div class="wb-observer-switch">
                                            <button type="button" data-wb-action="set-observer" data-mode="backstage"
                                                aria-pressed="${observerMode === 'backstage'}"
                                                class="${observerMode === 'backstage' ? 'is-active' : ''}">Góc nhìn hậu trường</button>
                                            <button type="button" data-wb-action="set-observer" data-mode="known"
                                                aria-pressed="${observerMode === 'known'}"
                                                class="${observerMode === 'known' ? 'is-active' : ''}">Những gì nhân vật biết</button>
                                        </div>
                                    `}
                                </div>
                                ${renderSyncStrip(syncStatus)}
                                <div class="wb-view-content ${viewChanged ? 'is-entering' : ''}">${content}</div>
                                <footer class="wb-window-footer">
                                    <div>
                                        <span>Thế giới chính ${escapeHtml(clockLabel)}</span><i></i>
                                        <span>AI Phản hồi: Thời gian tiêu hao thực tế do Đồng hồ thế giới quyết toán</span><i></i>
                                        <span>Độc thoại: Chỉ hiển thị ở hậu trường</span>
                                    </div>
                                    <button class="wb-sim-action ${canCancelSimulation ? 'is-cancel' : ''}" type="button"
                                        data-wb-action="${canCancelSimulation ? 'cancel-simulation' : 'manual-sync'}"
                                        ${busy && !canCancelSimulation ? 'disabled' : ''}>
                                        <i aria-hidden="true"></i><span>${canCancelSimulation ? 'Dừng lần suy diễn này' : 'Suy diễn nội dung chính mới nhất'}</span>
                                    </button>
                                </footer>
                            </div>
                        </div>

                    </section>
                    ${settingsOpen ? `
                        <div class="wb-settings-layer">
                            ${renderSettings(
                                state,
                                settings,
                                syncStatus,
                                openSettingsGroups,
                                openSettingsSubgroups,
                                apiFormDraft,
                                visibleTagFilterRules(settings),
                                tagFilterCandidates,
                                {
                                    query: worldbookQuery,
                                    onlyPeople: worldbookOnlyPeople,
                                    onlyEnabled: worldbookOnlyEnabled,
                                    selectedIds: worldbookSelectedIds,
                                },
                            )}
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            ${eventFormOpen ? renderEventModal(state, eventEditorId) : ''}
            ${memoryEditor ? renderMemoryEditorModal(state, memoryEditor) : ''}
            ${personEditor ? renderPersonEditorModal(state, personEditor) : ''}
            ${worldEditorOpen ? renderWorldEditorModal(state) : ''}
            ${recordEditor ? renderRecordEditorModal(state, recordEditor) : ''}
            ${person ? renderPersonDrawer(person, observerMode, state.clock.absoluteMinute, {
                canObserve: canObservePerson,
                observation: personObservation,
                busy,
            }) : ''}
            ${syncStatus.editDecision?.available ? `
                <div class="wb-edit-choice" role="alertdialog" aria-modal="false"
                    aria-labelledby="wb-edit-choice-title" aria-describedby="wb-edit-choice-detail">
                    <span class="wb-edit-choice-face" aria-hidden="true">${escapeHtml(TOAST_FACES.warning)}</span>
                    <div class="wb-edit-choice-copy">
                        <strong id="wb-edit-choice-title">Phát hiện nội dung chính đã suy diễn bị sửa đổi</strong>
                        <p id="wb-edit-choice-detail">Khi cốt truyện, thời gian hoặc hành động nhân vật có thay đổi thì khuyên dùng suy diễn lại; nếu chỉ sửa lỗi chính tả, dấu câu hoặc cách dùng từ, có thể giữ lại suy diễn gốc.</p>
                    </div>
                    <div class="wb-edit-choice-actions">
                        <button type="button" class="is-rerun" data-wb-action="resolve-message-edit" data-mode="rerun">Suy diễn lại theo nội dung chính đã sửa đổi</button>
                        <button type="button" data-wb-action="resolve-message-edit" data-mode="keep">Giữ lại suy diễn gốc</button>
                    </div>
                </div>
            ` : ''}
            ${toast ? `
                <div class="wb-toast" role="${root.dataset.toastTone === 'error' ? 'alert' : 'status'}" aria-live="polite">
                    <span aria-hidden="true">${escapeHtml(TOAST_FACES[root.dataset.toastTone] || TOAST_FACES.info)}</span>
                    <div><strong>${escapeHtml(TOAST_LABELS[root.dataset.toastTone] || TOAST_LABELS.info)}</strong><p>${escapeHtml(toast)}</p></div>
                </div>
            ` : ''}
            ${syncStatus.manualUndo?.available ? `
                <div class="wb-undo-toast" role="status">
                    <span>${escapeHtml(syncStatus.manualUndo.label)}</span>
                    <button type="button" data-wb-action="undo-manual">Hoàn tác</button>
                </div>
            ` : ''}
        `;
        panelEntrancePending = false;

        const currentContent = root.querySelector('.wb-view-content');
        if (currentContent) {
            // A module switch is a new reading context. Reusing another visit's
            // scroll offset made the first row look clipped beneath the status bar.
            currentContent.scrollTop = viewChanged ? 0 : (viewScrollTop.get(activeView) || 0);
        }
        const currentSettings = root.querySelector('.wb-settings-popover');
        if (currentSettings) currentSettings.scrollTop = settingsScrollTop;
        const currentEventForm = root.querySelector('[data-wb-form="event"]');
        if (currentEventForm && eventFormDraft) {
            for (const [name, value] of Object.entries(eventFormDraft)) {
                const field = currentEventForm.elements.namedItem(name);
                if (field && 'value' in field) field.value = value;
            }
        }
        const currentClockForm = root.querySelector('[data-wb-form="clock"]');
        if (currentClockForm && clockFormDraft) {
            for (const [name, value] of Object.entries(clockFormDraft)) {
                const field = currentClockForm.elements.namedItem(name);
                if (field && 'value' in field) field.value = value;
            }
        }
        if (previousFocus) {
            const selector = previousFocus.id
                ? `#${globalThis.CSS?.escape?.(previousFocus.id) || previousFocus.id}`
                : previousFocus.name
                    ? `[name="${globalThis.CSS?.escape?.(previousFocus.name) || previousFocus.name}"]`
                    : '';
            const field = selector ? root.querySelector(selector) : null;
            if (field) {
                field.focus({ preventScroll: true });
                if (
                    typeof field.setSelectionRange === 'function'
                    && Number.isInteger(previousFocus.selectionStart)
                ) {
                    field.setSelectionRange(previousFocus.selectionStart, previousFocus.selectionEnd);
                }
            }
        }
        renderedView = activeView;
    }

    function positionOrbElements(x, y) {
        const placed = clampOrbPosition({ x, y });
        if (!placed) return null;
        const orb = root.querySelector('.wb-world-orb');
        const caption = root.querySelector('.wb-orb-caption');
        if (orb) {
            orb.style.left = `${placed.x}px`;
            orb.style.top = `${placed.y}px`;
            orb.style.right = 'auto';
            orb.style.bottom = 'auto';
        }
        if (caption) {
            const captionWidth = 210;
            const captionX = placed.x > captionWidth + 28
                ? placed.x - captionWidth - 10
                : placed.x + placed.size + 10;
            caption.style.left = `${Math.max(8, Math.min(window.innerWidth - captionWidth - 8, captionX))}px`;
            caption.style.top = `${placed.y + 5}px`;
            caption.style.right = 'auto';
            caption.style.bottom = 'auto';
        }
        return placed;
    }

    root.addEventListener('pointerdown', event => {
        const orb = event.target.closest('.wb-world-orb');
        if (!orb || event.button !== 0) return;
        const rect = orb.getBoundingClientRect();
        orb.style.setProperty('left', `${rect.left}px`, 'important');
        orb.style.setProperty('top', `${rect.top}px`, 'important');
        orb.style.setProperty('right', 'auto', 'important');
        orb.style.setProperty('bottom', 'auto', 'important');
        orb.classList.add('has-custom-position');
        orbDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: rect.left,
            originY: rect.top,
            moved: false,
            x: rect.left,
            y: rect.top,
        };
        orb.setPointerCapture?.(event.pointerId);
        orb.classList.add('is-dragging');
    });

    root.addEventListener('pointermove', event => {
        if (!orbDrag || event.pointerId !== orbDrag.pointerId) return;
        const deltaX = event.clientX - orbDrag.startX;
        const deltaY = event.clientY - orbDrag.startY;
        if (Math.hypot(deltaX, deltaY) > 5) orbDrag.moved = true;
        if (!orbDrag.moved) return;
        const placed = positionOrbElements(orbDrag.originX + deltaX, orbDrag.originY + deltaY);
        if (placed) {
            orbDrag.x = placed.x;
            orbDrag.y = placed.y;
        }
        event.preventDefault();
    });

    const finishOrbDrag = async event => {
        if (!orbDrag || event.pointerId !== orbDrag.pointerId) return;
        const orb = root.querySelector('.wb-world-orb');
        orb?.classList.remove('is-dragging');
        orb?.releasePointerCapture?.(event.pointerId);
        const completed = orbDrag;
        orbDrag = null;
        if (!completed.moved) return;

        const viewport = visualViewportBounds();
        const orbSize = responsiveOrbSize(viewport.width, viewport.height);
        const margin = 12;
        const snappedX = completed.x + orbSize / 2 < viewport.left + viewport.width / 2
            ? viewport.left + margin
            : viewport.right - orbSize - margin;
        const placed = positionOrbElements(snappedX, completed.y);
        suppressOrbClick = true;
        window.setTimeout(() => {
            suppressOrbClick = false;
        }, 260);
        if (placed) {
            await invokeAction('update-settings', {
                orbPosition: { x: placed.x, y: placed.y },
            });
        }
    };
    root.addEventListener('pointerup', finishOrbDrag);
    root.addEventListener('pointercancel', finishOrbDrag);

    root.addEventListener('click', async event => {
        const target = event.target.closest('[data-wb-action]');
        if (!target) return;
        if (
            target.classList.contains('wb-drawer-scrim')
            && event.target.closest('.wb-event-form, .wb-person-drawer')
        ) {
            return;
        }
        const action = target.dataset.wbAction;

        if (action === 'close-panel') {
            if (event.target === target) close();
            return;
        }
        if (action === 'toggle-panel') {
            if (target.classList.contains('wb-world-orb') && suppressOrbClick) {
                suppressOrbClick = false;
                event.preventDefault();
                return;
            }
            isOpen ? close() : open();
            return;
        }
        if (action === 'set-view') {
            activeView = target.dataset.view || 'now';
            render();
            return;
        }
        if (action === 'open-world-editor') {
            worldEditorOpen = true;
            render();
            return;
        }
        if (action === 'close-world-editor') {
            worldEditorOpen = false;
            render();
            return;
        }
        if (action === 'open-record-editor') {
            recordEditor = {
                kind: target.dataset.recordKind === 'archive' ? 'archive' : 'echo',
                id: target.dataset.recordId || '',
            };
            render();
            return;
        }
        if (action === 'close-record-editor') {
            recordEditor = null;
            render();
            return;
        }
        if (action === 'delete-record') {
            const kind = target.dataset.recordKind === 'archive' ? 'archive' : 'echo';
            const confirmed = globalThis.confirm?.(`(・_・;)  Xác nhận xóa mục này${kind === 'echo' ? 'Tiếng vang' : 'Biên niên sử'} không? Sau khi xóa có thể dùng nút hoàn tác ở dưới cùng để khôi phục.`);
            if (confirmed === false) return;
            const completed = await invokeAction('delete-record', {
                kind,
                id: target.dataset.recordId || '',
            });
            if (completed && recordEditor?.id === (target.dataset.recordId || '')) recordEditor = null;
            render();
            return;
        }
        if (action === 'expand-folds' || action === 'collapse-folds') {
            const prefix = target.dataset.foldPrefix || '';
            const shouldOpen = action === 'expand-folds';
            [...root.querySelectorAll('.wb-fold[data-fold-key]')]
                .filter(item => !prefix || String(item.dataset.foldKey || '').startsWith(prefix))
                .forEach(item => {
                    item.open = shouldOpen;
                    const key = item.dataset.foldKey;
                    if (!key) return;
                    if (shouldOpen) openContentFolds.add(key);
                    else openContentFolds.delete(key);
                });
            return;
        }
        if (action === 'set-memory-filter') {
            memoryFilter = target.dataset.filter || 'active';
            memoryVisibleCount = 12;
            render();
            return;
        }
        if (action === 'open-memory-editor') {
            memoryEditor = {
                kind: target.dataset.memoryKind || 'fact',
                id: target.dataset.memoryId || '',
            };
            render();
            return;
        }
        if (action === 'close-memory-editor') {
            memoryEditor = null;
            render();
            return;
        }
        if (action === 'toggle-memory-flag') {
            await invokeAction('toggle-memory-flag', {
                kind: target.dataset.memoryKind || 'fact',
                id: target.dataset.memoryId || '',
                field: target.dataset.memoryField || 'important',
            });
            render();
            return;
        }
        if (action === 'delete-memory-item') {
            const confirmed = globalThis.confirm?.('(・_・;)  Xác nhận xóa ký ức này không? Thao tác này có thể dùng nút hoàn tác ở dưới cùng để khôi phục.');
            if (confirmed === false) return;
            await invokeAction('delete-memory-item', {
                kind: target.dataset.memoryKind || 'fact',
                id: target.dataset.memoryId || '',
            });
            render();
            return;
        }
        if (action === 'load-more-memory') {
            memoryVisibleCount += 12;
            render();
            return;
        }
        if (action === 'toggle-settings') {
            const opening = !settingsOpen;
            settingsOpen = opening;
            if (opening) {
                // Mỗi lần mở cài đặt quan sát đều bắt đầu từ trạng thái thu gọn sạch sẽ～ Cần phần nào thì nhấn phần đó,
                // Tránh việc mấy mô-đun lớn mở lần trước đồng loạt lấp đầy màn hình.
                openSettingsGroups = new Set();
                openSettingsSubgroups = new Set();
                settingsScrollTop = 0;
            } else {
                clockFormDraft = null;
                tagFilterDraftRules = null;
                tagFilterCandidates = [];
            }
            render();
            return;
        }
        if (action === 'add-tag-filter-rule') {
            const settings = getSettings();
            const current = visibleTagFilterRules(settings);
            tagFilterDraftRules = [...current, { open: '', close: '' }];
            skipTagFilterDraftCapture = true;
            render();
            return;
        }
        if (action === 'remove-tag-filter-rule') {
            const index = Number(target.dataset.index);
            const settings = getSettings();
            const current = visibleTagFilterRules(settings).filter((_, i) => i !== index);
            skipTagFilterDraftCapture = true;
            await persistTagFilterRules(current);
            render();
            return;
        }
        if (action === 'scan-tag-candidates') {
            const result = await invokeAction('scan-tag-candidates', {
                count: Number(target.dataset.count) || 1,
            });
            tagFilterCandidates = Array.isArray(result) ? result : [];
            openSettingsGroups.add('advanced');
            openSettingsSubgroups.add('advanced-tagfilter');
            render();
            return;
        }
        if (action === 'apply-tag-candidates') {
            const settings = getSettings();
            const current = visibleTagFilterRules(settings).map(rule => ({ ...rule }));
            const selected = [...root.querySelectorAll('[data-wb-tag-candidate-index]:checked')]
                .map(input => tagFilterCandidates[Number(input.dataset.wbTagCandidateIndex)])
                .filter(Boolean)
                .filter(item => !item.alreadyAdded);
            const seen = new Set(current.map(rule => `${String(rule.open || '').trim()}\u0000${String(rule.close || '').trim()}`));
            let added = 0;
            for (const item of selected) {
                const key = `${item.open}\u0000${item.close}`;
                if (seen.has(key) || current.length >= 30) continue;
                current.push({ open: item.open, close: item.close });
                seen.add(key);
                added += 1;
            }
            await persistTagFilterRules(current);
            tagFilterCandidates = tagFilterCandidates.map(item => ({
                ...item,
                alreadyAdded: item.alreadyAdded || seen.has(`${item.open}\u0000${item.close}`),
                recommended: false,
            }));
            notify(added ? `Đã thêm ${added}  quy tắc lọc.` : 'Không có ứng cử viên mới nào cần thêm vào.', added ? 'success' : 'info');
            render();
            return;
        }
        if (action === 'set-public-opinion-mode') {
            publicOpinionMode = ['forum', 'sandbox'].includes(target.dataset.mode) ? target.dataset.mode : 'news';
            render();
            return;
        }
        if (action === 'generate-public-opinion') {
            const result = await invokeAction('generate-public-opinion');
            if (result?.kind === 'sandbox') {
                publicOpinionMode = 'sandbox';
                notify('Chính sử vòng này không có drama gì～ Tiện tay vớt cho bạn một mẻ nội dung dạo chơi, yên tâm, không tính là chính sử `(ﾉ◕ヮ◕)ﾉ`', 'info');
            } else if (result) {
                notify('Dư luận thế giới đã làm mới xong～ Hãy xem mọi người lại đang bàn tán gì nào `(ﾉ◕ヮ◕)ﾉ`', 'success');
            }
            render();
            return;
        }
        if (action === 'generate-public-opinion-sandbox') {
            const result = await invokeAction('generate-public-opinion-sandbox');
            if (result) {
                publicOpinionMode = 'sandbox';
                notify('Tình cờ dạo được một mẻ drama tươi mới～ Yên tâm, những thứ này không tính là chính sử `(≧▽≦)`', 'success');
            }
            render();
            return;
        }
        if (action === 'clear-public-opinion-sandbox') {
            await invokeAction('clear-public-opinion-sandbox');
            render();
            return;
        }
        if (action === 'clear-public-opinion') {
            const confirmed = globalThis.confirm?.('(・_・;)  Xóa bản ghi nhanh dư luận hiện tại không? Trạng thái thế giới sẽ không bị ảnh hưởng.');
            if (confirmed === false) return;
            await invokeAction('clear-public-opinion');
            render();
            return;
        }
        if (action === 'set-observer') {
            observerMode = target.dataset.mode === 'known' ? 'known' : 'backstage';
            selectedPersonId = null;
            render();
            return;
        }
        if (action === 'select-person') {
            if (selectedPersonId !== (target.dataset.personId || null)) {
                personObservation = null;
            }
            selectedPersonId = target.dataset.personId || null;
            if (selectedPersonId) {
                personObservation = await invokeAction('get-person-observation', {
                    personId: selectedPersonId,
                }) || null;
            }
            render();
            return;
        }
        if (action === 'close-person') {
            selectedPersonId = null;
            personObservation = null;
            render();
            return;
        }
        if (action === 'open-person-editor') {
            personEditor = { id: target.dataset.personId || '', name: target.dataset.personName || '' };
            selectedPersonId = null;
            personObservation = null;
            render();
            return;
        }
        if (action === 'close-person-editor') {
            personEditor = null;
            render();
            return;
        }
        if (action === 'delete-manual-person') {
            const confirmed = globalThis.confirm?.('(・_・;)  Xác nhận xóa khỏi danh sách nhân vật chạy ngầm cái này NPC không?');
            if (confirmed === false) return;
            const completed = await invokeAction('delete-manual-person', {
                id: target.dataset.personId || '',
            });
            if (completed) personEditor = null;
            render();
            return;
        }
        if (action === 'open-event-form') {
            eventEditorId = '';
            eventFormDraft = null;
            eventFormOpen = true;
            render();
            return;
        }
        if (action === 'open-event-editor') {
            eventEditorId = target.dataset.eventId || '';
            eventFormDraft = null;
            eventFormOpen = Boolean(eventEditorId);
            render();
            return;
        }
        if (action === 'delete-event') {
            const eventId = target.dataset.eventId || '';
            const confirmed = globalThis.confirm?.('(・_・;)  Xác nhận xóa dòng chảy ngầm này không? Sau khi xóa có thể dùng nút hoàn tác ở dưới cùng để khôi phục.');
            if (confirmed === false) return;
            const completed = await invokeAction('delete-event', { eventId });
            if (completed && eventEditorId === eventId) {
                eventEditorId = '';
                eventFormOpen = false;
                eventFormDraft = null;
            }
            render();
            return;
        }
        if (action === 'close-event-form') {
            eventEditorId = '';
            eventFormDraft = null;
            eventFormOpen = false;
            render();
            return;
        }
        if (action === 'setting-button') {
            const setting = target.dataset.setting;
            const value = target.dataset.value;
            await invokeAction('update-settings', {
                [setting]: value,
            });
            render();
            // Chọn“Giao diện độc lập”sau đó ngay lập tức mở rộng khu vực điền, khôi phục trải nghiệm điền vào cấu hình chỉ với một cú nhấp chuột.
            // Người dùng sau đó vẫn có thể thu gọn thủ công; việc render lại thông thường sẽ không bắt buộc mở rộng lần nữa.
            if (setting === 'apiMode' && value === 'custom') {
                window.setTimeout(() => {
                    const connectionGroup = root.querySelector('.wb-settings-group[data-settings-group="connection"]');
                    const customGroup = root.querySelector('.wb-settings-subgroup[data-settings-subgroup="connection-custom"]');
                    if (connectionGroup) connectionGroup.open = true;
                    if (customGroup) customGroup.open = true;
                    openSettingsGroups.add('connection');
                    openSettingsSubgroups.add('connection-custom');
                    const form = root.querySelector('[data-wb-form="api"]');
                    if (!form) return;
                    const url = form.elements?.customApiUrl;
                    const key = form.elements?.customApiCredential;
                    const model = form.elements?.customApiModel;
                    if (!String(url?.value || '').trim()) url?.focus();
                    else if (!getSettings().customApiKey && !String(key?.value || '').trim()) key?.focus();
                    else if (!String(model?.value || '').trim()) model?.focus();
                }, 0);
            }
            return;
        }
        if (action === 'cycle-theme') {
            const settings = getSettings();
            const state = getState();
            // Phím tắt thanh trên cùng chỉ làm“Ban ngày ↔ Ban đêm”chuyển đổi trực tiếp; chế độ tự động vẫn có thể chọn ở trang cài đặt.
            // Logic cũ sẽ đi qua auto，Nếu auto tình cờ phân tích thành chủ đề hiện tại, về mặt thị giác giống như nút không hoạt động.
            const currentTheme = themeFor(state, settings);
            const next = currentTheme === 'day' ? 'night' : 'day';
            await invokeAction('update-settings', { theme: next });
            render();
            return;
        }
        if (action === 'sync-clock-from-story') {
            clockFormDraft = null;
            await invokeAction('sync-clock-from-story');
            render();
            return;
        }
        if (action === 'advance-clock') {
            clockFormDraft = null;
            await invokeAction('advance-clock', { minutes: Number(target.dataset.minutes) || 0 });
            render();
            return;
        }
        if (action === 'scan-worldbook') {
            const form = target.closest('[data-wb-form="worldbook"]');
            worldbookSelectedIds = new Set();
            const result = await invokeAction('scan-worldbook', {
                bookName: form?.elements?.bookName?.value || '',
            });
            if (result && Array.isArray(result.entries)) {
                const likelyCount = result.entries.filter(entry => entry.likelyPerson).length;
                if (likelyCount > 0 && likelyCount < result.entries.length) worldbookOnlyPeople = true;
            }
            render();
            return;
        }
        if (action === 'select-worldbook-visible' || action === 'clear-worldbook-visible') {
            const entries = Array.isArray(getSyncStatus()?.worldbook?.entries)
                ? getSyncStatus().worldbook.entries
                : [];
            const visible = filterWorldbookEntries(entries, {
                query: worldbookQuery,
                onlyPeople: worldbookOnlyPeople,
                onlyEnabled: worldbookOnlyEnabled,
            });
            const next = new Set(worldbookSelectedIds);
            for (const entry of visible) {
                if (action === 'select-worldbook-visible') next.add(String(entry.uid));
                else next.delete(String(entry.uid));
            }
            worldbookSelectedIds = next;
            render();
            return;
        }
        if (action === 'toggle-event-delivery') {
            await invokeAction('toggle-event-delivery', {
                eventId: target.dataset.eventId || '',
            });
            render();
            return;
        }
        if (action === 'import-state') {
            root.querySelector('.wb-import-input')?.click();
            return;
        }
        if (action === 'observe-person') {
            const result = await invokeAction('observe-person', {
                personId: target.dataset.personId || '',
                force: target.dataset.force === 'true',
            });
            if (result && typeof result === 'object' && result.text) {
                personObservation = result;
            }
            render();
            return;
        }
        if (action === 'queue-person-observation') {
            const result = await invokeAction('queue-person-observation', {
                personId: target.dataset.personId || '',
            });
            if (result && typeof result === 'object') personObservation = result;
            render();
            return;
        }
        if (action === 'resolve-message-edit') {
            await invokeAction('resolve-message-edit', {
                mode: target.dataset.mode === 'keep' ? 'keep' : 'rerun',
            });
            render();
            return;
        }
        if (action === 'save-api-profile-from-form') {
            const form = target.closest('[data-wb-form="api"]');
            if (!form) return;
            const urlField = form.elements?.customApiUrl;
            const modelField = form.elements?.customApiModel;
            if (urlField && !urlField.checkValidity()) {
                urlField.reportValidity();
                return;
            }
            if (modelField && !String(modelField.value || '').trim()) {
                modelField.focus();
                notify('Trước tiên hãy chọn một mô hình rồi lưu phương án nhé~', 'error');
                return;
            }
            const data = readApiForm(form);
            const profileId = String(data.profileId || '').trim();
            const existingProfile = (getSettings().apiProfiles || []).find(item => item.id === profileId);
            const key = String(data.customApiCredential || '').trim()
                || existingProfile?.key
                || (!profileId ? getSettings().customApiKey : '');
            if (!key) {
                notify('Phương án này vẫn thiếu API Key ồ~', 'error');
                form.elements?.customApiCredential?.focus();
                return;
            }
            const name = String(data.profileName || '').trim()
                || String(data.customApiModel || '').trim()
                || 'Độc lập của tôi API';
            const completed = await invokeAction('save-api-profile', {
                id: profileId,
                name,
                url: data.customApiUrl,
                key: String(data.customApiCredential || '').trim(),
                model: data.customApiModel,
                transport: data.customApiTransport,
            });
            if (completed) {
                forgetApiKeyDraft(data);
                openSettingsSubgroups.add('connection-profiles');
            }
            render();
            return;
        }
        if (action === 'edit-api-profile') {
            const profileId = String(target.dataset.profileId || '');
            const profile = (getSettings().apiProfiles || []).find(item => item.id === profileId);
            if (!profile) {
                notify('Cái này API phương án hình như đã không còn nữa~', 'error');
                return;
            }
            apiFormDraft = {
                profileId: profile.id,
                profileName: profile.name || '',
                customApiUrl: profile.url || '',
                customApiCredential: '',
                customApiModel: profile.model || '',
                customApiTransport: profile.transport || 'proxy',
            };
            skipApiDraftCapture = true;
            openSettingsGroups.add('connection');
            openSettingsSubgroups.add('connection-custom');
            render();
            window.setTimeout(() => {
                const group = root.querySelector('.wb-settings-group[data-settings-group="connection"]');
                const subgroup = root.querySelector('.wb-settings-subgroup[data-settings-subgroup="connection-custom"]');
                if (group) group.open = true;
                if (subgroup) subgroup.open = true;
                root.querySelector('[data-wb-form="api"] [name="profileName"]')?.focus();
            }, 0);
            return;
        }
        if (action === 'test-api-profile') {
            await invokeAction('test-api-profile', { profileId: target.dataset.profileId || '' });
            render();
            return;
        }
        if (action === 'pull-api-profile-models') {
            await invokeAction('pull-api-profile-models', { profileId: target.dataset.profileId || '' });
            render();
            return;
        }
        if (action === 'duplicate-api-profile') {
            await invokeAction('duplicate-api-profile', { profileId: target.dataset.profileId || '' });
            openSettingsSubgroups.add('connection-profiles');
            render();
            return;
        }
        if (action === 'delete-api-profile') {
            const settings = getSettings();
            const profile = (settings.apiProfiles || []).find(item => item.id === String(target.dataset.profileId || ''));
            const confirmed = globalThis.confirm?.(`(・_・;)  Muốn xóa API Phương án“${profile?.name || 'phương án này'}”không?\n Mô-đun sử dụng nó sẽ tự động quay về“Theo mặc định”。`);
            if (confirmed === false) return;
            await invokeAction('delete-api-profile', { profileId: target.dataset.profileId || '' });
            render();
            return;
        }
        if (action === 'test-api') {
            const form = target.closest('[data-wb-form="api"]');
            if (!form) return;
            const urlField = form.elements?.customApiUrl;
            const modelField = form.elements?.customApiModel;
            if (urlField && !urlField.checkValidity()) {
                urlField.reportValidity();
                return;
            }
            if (modelField && !String(modelField.value || '').trim()) {
                modelField.focus();
                notify('Hãy chọn một mô hình trước rồi mới kiểm tra nhé~', 'error');
                return;
            }
            const data = readApiForm(form);
            let request;
            try {
                request = apiRequestFromDraft(data, { requireModel: true });
            } catch (error) {
                notify(String(error?.message || error), 'error');
                return;
            }
            await invokeAction('test-api-draft', request);
            render();
            return;
        }
        if (action === 'pull-api-models') {
            const form = target.closest('[data-wb-form="api"]');
            if (!form) return;
            // Lấy mô hình chỉ đọc bản nháp hiện tại, không còn lén lút sửa giao diện độc lập mặc định. Khi chỉnh sửa phương án đã lưu,
            // Key để trống sẽ an toàn tiếp tục sử dụng của chính phương án đó Key，chứ không phải chuyển sang cấu hình mặc định.
            const urlField = form.elements?.customApiUrl;
            const keyField = form.elements?.customApiCredential;
            if (urlField && !urlField.checkValidity()) {
                urlField.reportValidity();
                return;
            }
            const data = readApiForm(form);
            let request;
            try {
                request = apiRequestFromDraft(data, { requireModel: false });
            } catch (error) {
                notify(String(error?.message || error), 'error');
                keyField?.focus();
                return;
            }
            await invokeAction('pull-api-draft-models', request);
            render();
            return;
        }
        if (action === 'reset-api-draft') {
            apiFormDraft = {
                customApiUrl: '',
                customApiCredential: '',
                customApiModel: '',
                customApiTransport: getSettings().customApiTransport,
                profileName: '',
                profileId: '',
            };
            skipApiDraftCapture = true;
            render();
            window.setTimeout(() => {
                root.querySelector('[data-wb-form="api"] [name="customApiUrl"]')?.focus();
            }, 0);
            return;
        }
        if (action === 'toggle-api-key-visibility') {
            const field = target.closest('.wb-api-secret-field')?.querySelector('.wb-secret-input');
            if (!field) return;
            const visible = field.classList.toggle('is-visible');
            target.setAttribute('aria-pressed', String(visible));
            target.textContent = visible ? 'Ẩn' : 'Hiển thị';
            field.focus();
            return;
        }

        await invokeAction(action, {});
        render();
    });

    root.addEventListener('change', async event => {
        const apiForm = event.target.closest?.('[data-wb-form="api"]');
        if (apiForm) {
            readApiForm(apiForm);
            return;
        }

        if (event.target.matches?.('[data-wb-worldbook-entry-id]')) {
            const uid = String(event.target.dataset.wbWorldbookEntryId || '');
            const next = new Set(worldbookSelectedIds);
            if (event.target.checked) next.add(uid);
            else next.delete(uid);
            worldbookSelectedIds = next;
            render();
            return;
        }
        const worldbookFilter = event.target.dataset?.wbWorldbookFilter;
        if (worldbookFilter === 'people' || worldbookFilter === 'enabled') {
            if (worldbookFilter === 'people') worldbookOnlyPeople = Boolean(event.target.checked);
            if (worldbookFilter === 'enabled') worldbookOnlyEnabled = Boolean(event.target.checked);
            render();
            return;
        }

        const apiRouteKey = event.target.dataset?.wbApiRoute;
        if (apiRouteKey && ['simulation', 'observation', 'history', 'opinion'].includes(apiRouteKey)) {
            const settings = getSettings();
            const routes = {
                ...(settings.apiModuleRoutes || {}),
                [apiRouteKey]: String(event.target.value || 'default'),
            };
            await invokeAction('update-settings', { apiModuleRoutes: routes });
            notify('của phần này API Tuyến đường đã ghi nhớ~', 'success');
            render();
            return;
        }

        const tagField = event.target.dataset?.wbTagFilterField;
        if (tagField === 'open' || tagField === 'close') {
            const index = Number(event.target.dataset.index);
            const settings = getSettings();
            const current = visibleTagFilterRules(settings).map(rule => ({ ...rule }));
            if (!current[index]) return;
            current[index] = {
                ...current[index],
                [tagField]: String(event.target.value || '').slice(0, 80),
            };
            await persistTagFilterRules(current);
            render();
            return;
        }

        const setting = event.target.dataset.wbSetting;
        if (setting) {
            const value = event.target.type === 'checkbox'
                ? event.target.checked
                : event.target.value;
            await invokeAction('update-settings', { [setting]: value });
            render();
            return;
        }

        if (event.target.classList.contains('wb-import-input')) {
            const file = event.target.files?.[0];
            if (!file) return;
            await invokeAction('import-state-data', {
                name: file.name,
                text: await file.text(),
            });
            event.target.value = '';
            render();
        }
    });

    root.addEventListener('input', event => {
        const apiForm = event.target.closest?.('[data-wb-form="api"]');
        if (apiForm) {
            readApiForm(apiForm);
            return;
        }

        if (event.target.matches?.('[data-wb-worldbook-search]')) {
            worldbookQuery = String(event.target.value || '').slice(0, 120);
            window.clearTimeout(worldbookSearchTimer);
            worldbookSearchTimer = window.setTimeout(render, 100);
            return;
        }
        if (!event.target.matches?.('[data-wb-memory-search]')) return;
        memoryQuery = String(event.target.value || '').slice(0, 80);
        memoryVisibleCount = 12;
        window.clearTimeout(memorySearchTimer);
        memorySearchTimer = window.setTimeout(render, 120);
    });

    root.addEventListener('submit', async event => {
        const form = event.target.closest('[data-wb-form]');
        if (!form) return;
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());

        if (form.dataset.wbForm === 'clock') {
            clockFormDraft = { ...data };
            const completed = await invokeAction('set-clock', data);
            if (completed) clockFormDraft = null;
        }
        if (form.dataset.wbForm === 'api') {
            apiFormDraft = { ...data };
            const completed = await invokeAction('update-settings', apiSettingsFromDraft(data));
            if (completed) {
                forgetApiKeyDraft(data);
                notify('Giao diện độc lập đã lưu~ cũ Key vẫn sẽ không lén lút điền lại đâu.', 'success');
            }
        }
        if (form.dataset.wbForm === 'world') {
            const completed = await invokeAction('save-world-summary', {
                title: data.title || '',
                detail: data.detail || '',
            });
            if (completed) worldEditorOpen = false;
        }
        if (form.dataset.wbForm === 'record') {
            const completed = await invokeAction('save-record', {
                kind: data.kind || 'echo',
                id: data.id || '',
                title: data.title || '',
                text: data.text || '',
                place: data.place || '',
                visibility: data.visibility || 'hidden',
                deliveryState: data.deliveryState || 'none',
            });
            if (completed) recordEditor = null;
        }
        if (form.dataset.wbForm === 'event') {
            const completed = await invokeAction(data.id ? 'update-event' : 'add-event', data);
            if (completed) {
                eventFormOpen = false;
                eventEditorId = '';
                eventFormDraft = null;
            }
        }
        if (form.dataset.wbForm === 'memory') {
            const completed = await invokeAction('save-memory-item', {
                id: data.id || '',
                kind: data.kind || 'fact',
                title: data.title || '',
                relation: data.relation || '',
                content: data.content || '',
                important: form.elements.important?.checked || false,
                locked: form.elements.locked?.checked || false,
            });
            if (completed) memoryEditor = null;
        }
        if (form.dataset.wbForm === 'person') {
            const completed = await invokeAction('save-manual-person', {
                id: data.id || '',
                originalName: data.originalName || '',
                name: data.name || '',
                location: data.location || '',
                action: data.action || '',
                intent: data.intent || '',
                longTermGoal: data.longTermGoal || '',
                identityAnchor: data.identityAnchor || '',
                personalityAnchor: data.personalityAnchor || '',
                appearanceProfile: data.appearanceProfile || '',
                backgroundProfile: data.backgroundProfile || '',
                speakingStyle: data.speakingStyle || '',
                behaviorBoundaries: data.behaviorBoundaries || '',
                knowledge: data.knowledge || 'backstage',
                relevance: data.relevance || 2,
                simulationEnabled: form.elements.simulationEnabled?.checked || false,
                locked: form.elements.locked?.checked || false,
            });
            if (completed) personEditor = null;
        }
        if (form.dataset.wbForm === 'worldbook') {
            const formData = new FormData(form);
            const completed = await invokeAction('import-worldbook-people', {
                bookName: String(formData.get('bookName') || ''),
                entryIds: [...worldbookSelectedIds],
            });
            if (completed) worldbookSelectedIds = new Set();
        }
        render();
    });

    const onKeydown = event => {
        if (
            ['Enter', ' '].includes(event.key)
            && event.target.matches?.('[role="button"][data-wb-action]')
        ) {
            event.preventDefault();
            event.target.click();
            return;
        }
        if (event.key !== 'Escape') return;
        if (recordEditor) recordEditor = null;
        else if (worldEditorOpen) worldEditorOpen = false;
        else if (selectedPersonId) selectedPersonId = null;
        else if (eventFormOpen) {
            eventFormOpen = false;
            eventEditorId = '';
            eventFormDraft = null;
        }
        else if (settingsOpen) {
            settingsOpen = false;
            clockFormDraft = null;
            tagFilterDraftRules = null;
        }
        else if (isOpen) {
            close();
            return;
        }
        render();
    };
    const onResize = () => {
        syncVisualViewportInsets();
        const position = getSettings().orbPosition;
        if (position) positionOrbElements(position.x, position.y);
    };
    const selfHealTimer = window.setInterval(ensureMounted, 1800);
    const onPageVisible = () => ensureMounted();
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onPageVisible);
    window.addEventListener('focus', onPageVisible);
    window.addEventListener('pageshow', onPageVisible);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);

    render();
    return {
        render,
        ensureMounted,
        notify,
        setBusy,
        open,
        close,
        destroy() {
            window.clearTimeout(toastTimer);
            window.clearTimeout(memorySearchTimer);
            window.clearTimeout(closeTimer);
            window.clearInterval(selfHealTimer);
            document.removeEventListener('keydown', onKeydown);
            document.removeEventListener('visibilitychange', onPageVisible);
            window.removeEventListener('focus', onPageVisible);
            window.removeEventListener('pageshow', onPageVisible);
            window.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('scroll', onResize);
            root.remove();
        },
    };
}
