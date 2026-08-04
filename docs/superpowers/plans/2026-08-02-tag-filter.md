# Tag Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an observation-settings module “Lọc thẻ” that strips HTML comments and user-defined open/close tag blocks from narrative text before world simulation, memory indexing, and person observation.

**Architecture:** Pure `filterNarrativeText` in `core.js`; `index.js` keeps `selectedMessageText` raw for hashes/queue and adds `narrativeMessageText` as the filtered choke point; `ui.js` adds a settings group with draft-aware rule cards.

**Tech Stack:** SillyTavern extension (vanilla JS modules), Node `node:test` / `node:assert/strict`, existing `update-settings` action path.

**Spec:** `docs/superpowers/specs/2026-08-02-tag-filter-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `core.js` | `escapeRegExp`, `normalizeTagFilterRules`, `filterNarrativeText` |
| `tests/tag-filter.test.mjs` | Unit tests for filter + normalize |
| `index.js` | Defaults v13, settings normalize, `narrativeMessageText`, wire narrative paths, empty-after-filter short-circuit |
| `ui.js` | Settings group UI, draft cards, add/delete/change handlers |
| `style.css` | Minimal rule-card styles using existing CSS variables |
| `docs/ARCHITECTURE.md` | One short note under extraction / 0.8.x (optional last task) |

---

### Task 1: `filterNarrativeText` (TDD)

**Files:**
- Create: `tests/tag-filter.test.mjs`
- Modify: `core.js` (exports near other pure helpers; place after `hashText` or before `buildSimulationPrompt`)

- [ ] **Step 1: Write the failing tests**

Create `tests/tag-filter.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterNarrativeText, normalizeTagFilterRules } from '../core.js';

const enabled = (rules) => ({ tagFilterEnabled: true, tagFilterRules: rules });

test('Luôn xóa chú thích HTML nhiều dòng', () => {
    const text = 'Trước<!--\nBản nháp\n-->Sau';
    assert.equal(filterNarrativeText(text, { tagFilterEnabled: false, tagFilterRules: [] }), 'TrướcSau');
});

test('Chú thích chưa đóng giữ nguyên', () => {
    const text = 'Trước<!--Bản nháp Sau';
    assert.equal(filterNarrativeText(text, { tagFilterEnabled: false, tagFilterRules: [] }), text);
});

test('Quy tắc theo cặp xóa toàn bộ khối', () => {
    const text = 'A<options>Chọn 1</options>B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        'AB',
    );
});

test('Không khớp chính xác theo nghĩa đen với phần mở đầu có thuộc tính', () => {
    const text = 'A<options type="x">Chọn 1</options>B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        text,
    );
});

test('Phân biệt chữ hoa chữ thường', () => {
    const text = 'A<Options>x</Options>B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        text,
    );
});

test('Chỉ phần cuối: Xóa phần cuối và toàn bộ trước đó, và cắt tỉa lặp đi lặp lại', () => {
    const text = 'aaa</x>bbb</x>ccc';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '', close: '</x>' }])),
        'ccc',
    );
});

test('Chỉ phần đầu: Xóa từ phần đầu đến cuối văn bản', () => {
    const text = 'Giữ lại<tail>Xóa toàn bộ phía sau';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<tail>', close: '' }])),
        'Giữ lại',
    );
});

test('Vẫn xóa chú thích khi tắt quy tắc người dùng', () => {
    const text = 'A<!--c-->B<options>x</options>C';
    assert.equal(
        filterNarrativeText(text, {
            tagFilterEnabled: false,
            tagFilterRules: [{ open: '<options>', close: '</options>' }],
        }),
        'AB<options>x</options>C',
    );
});

test('Áp dụng nhiều quy tắc theo thứ tự', () => {
    const text = '1<think>t</think>2<options>o</options>3';
    assert.equal(
        filterNarrativeText(text, enabled([
            { open: '<think>', close: '</think>' },
            { open: '<options>', close: '</options>' },
        ])),
        '123',
    );
});

test('Không xóa nhầm đến cuối văn bản khi không tìm thấy close của cặp', () => {
    const text = 'A<options>Không có phần kết B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        text,
    );
});

test('normalizeTagFilterRules Bỏ qua khoảng trống kép và cắt bớt', () => {
    const rules = normalizeTagFilterRules([
        { open: '', close: '' },
        { open: ` <${'a'.repeat(100)}> `, close: '</a>' },
    ]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].open.length, 80);
    assert.equal(rules[0].close, '</a>');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/hao/Luker/public/scripts/extensions/third-party/world-backstage
npm test -- tests/tag-filter.test.mjs
```

Expected: FAIL — `filterNarrativeText` / `normalizeTagFilterRules` not exported.

- [ ] **Step 3: Implement in `core.js`**

Add and export:

```js
function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
```

Also export `DEFAULT_TAG_FILTER_RULES` constant for reuse:

```js
export const DEFAULT_TAG_FILTER_RULES = Object.freeze([
    Object.freeze({ open: '<options>', close: '</options>' }),
    Object.freeze({ open: '<thinking>', close: '</thinking>' }),
    Object.freeze({ open: '<think>', close: '</think>' }),
]);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/tag-filter.test.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add core.js tests/tag-filter.test.mjs
git commit -m "$(cat <<'EOF'
feat: add filterNarrativeText for tag and comment stripping

Pure extraction helper with open/close rules and always-on HTML
comment removal, covered by unit tests.
EOF
)"
```

---

### Task 2: Settings defaults and normalization

**Files:**
- Modify: `index.js` (`DEFAULT_SETTINGS`, `getSettings`)

- [ ] **Step 1: Import helpers**

At top of `index.js`, extend the `core.js` import:

```js
import {
    // ...existing...
    DEFAULT_TAG_FILTER_RULES,
    filterNarrativeText,
    normalizeTagFilterRules,
} from './core.js';
```

- [ ] **Step 2: Extend `DEFAULT_SETTINGS`**

In `DEFAULT_SETTINGS` (around line 37):

```js
settingsVersion: 13,
// ...existing fields...
tagFilterEnabled: true,
tagFilterRules: DEFAULT_TAG_FILTER_RULES.map(rule => ({ ...rule })),
```

- [ ] **Step 3: Normalize in `getSettings`**

After other field clamps (near `settings.settingsVersion = 12`), replace version bump and add:

```js
settings.tagFilterEnabled = settings.tagFilterEnabled !== false;
if (!Array.isArray(settings.tagFilterRules)) {
    settings.tagFilterRules = DEFAULT_TAG_FILTER_RULES.map(rule => ({ ...rule }));
} else {
    settings.tagFilterRules = normalizeTagFilterRules(settings.tagFilterRules);
}
settings.settingsVersion = 13;
```

Keep writing back via existing `context.extensionSettings[MODULE_ID] = settings` path. When upgrading from <13 with missing fields, defaults fill in.

- [ ] **Step 4: Smoke check syntax**

```bash
npm run check
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "$(cat <<'EOF'
feat: add tag filter settings defaults at version 13

Persist tagFilterEnabled and tagFilterRules with normalize-on-read
defaults for options/thinking/think pairs.
EOF
)"
```

---

### Task 3: Wire narrative choke point + empty short-circuits

**Files:**
- Modify: `index.js` (`selectedMessageText` area, `narrativeContext`, `recentChatText`, `nextHistoryBatch`, simulation runner)

- [ ] **Step 1: Add `narrativeMessageText`**

Immediately after `selectedMessageText`:

```js
function narrativeMessageText(message) {
    return filterNarrativeText(selectedMessageText(message), getSettings());
}
```

Leave `selectedMessageText` and `hasUsableAssistantText` unchanged (raw).

- [ ] **Step 2: Update `recentChatText`**

Replace body with:

```js
function recentChatText(maximum = 8) {
    const chat = getContext()?.chat || [];
    return chat
        .slice(-maximum)
        .map(message => narrativeMessageText(message))
        .join('\n')
        .slice(-9000);
}
```

- [ ] **Step 3: Update `narrativeContext`**

Replace raw `.mes` / `selectedMessageText` narrative reads:

```js
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
```

- [ ] **Step 4: Update `nextHistoryBatch` content line**

Change:

```js
const content = selectedMessageText(message).slice(0, maximum);
```

to:

```js
const content = narrativeMessageText(message).slice(0, maximum);
```

(Filter full text first via `narrativeMessageText`, then slice — already correct order.)

Empty batches already skip the model (`if (!batch.messages.length) { cursor = batch.nextCursor; continue; }`).

- [ ] **Step 5: Empty-after-filter simulation short-circuit**

In the simulation runner (after `newAssistantTexts` is computed, before `buildSimulationPrompt` / `runWithRetries`), insert:

Insert **after** `runtime.activeSimulation = activeSimulation` and the initial `setBusy` / `setSyncStatus({ phase: 'running' ... })`, at the start of the existing `try` (before `runWithRetries`):

```js
const filteredNewTexts = newAssistantTexts
    .map(text => String(text || '').trim())
    .filter(Boolean);
if (!filteredNewTexts.length) {
    let resultState = markPendingSync(clone(baseState), false);
    resultState = recordDeliveryOffers(resultState, offeredEventIds, {
        messageId,
        expireAfter: 3,
    });
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
        result: createSnapshot(resultState, {
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
    if (branchIsCurrent) {
        const store = getStore();
        store.currentState = trimState(resultState);
        saveStore(store, { immediate: true });
        refreshInjection();
        runtime.ui?.render();
    }
    await target.context.saveChat?.();
    setSyncStatus({
        phase: 'success',
        message: 'Không có nội dung chính hợp lệ sau khi lọc, vòng này không tiến hành thế giới',
        error: '',
        succeededAt: new Date().toISOString(),
        method: runtime.syncStatus.method,
        summary,
    });
    return resultState;
}
```

This mirrors the existing success-commit shape (`committed.result`, `simulationSummary`). The function’s existing `finally` must still clear `runtime.activeSimulation` / `setBusy(false)` — keep the early return inside the same `try/finally` as the normal path.

Person observation: no special short-circuit (allow call with empty turns).

- [ ] **Step 6: Add a regression test for filter-then-slice semantics**

Append to `tests/tag-filter.test.mjs`:

```js
test('Lọc trước rồi cắt bớt: Thẻ đóng sau điểm cắt bớt vẫn sẽ bị xóa hoàn toàn', () => {
    const open = '<options>';
    const close = '</options>';
    const inner = 'x'.repeat(50);
    const full = `KEEP${open}${inner}${close}TAIL`;
    const filtered = filterNarrativeText(full, enabled([{ open, close }]));
    assert.equal(filtered, 'KEEPTAIL');
    // Simulate nextHistoryBatch: filter full, then slice
    assert.equal(filtered.slice(0, 20), 'KEEPTAIL');
});
```

- [ ] **Step 7: Run tests + check**

```bash
npm test
npm run check
```

Expected: all PASS, check exit 0.

- [ ] **Step 8: Commit**

```bash
git add index.js tests/tag-filter.test.mjs
git commit -m "$(cat <<'EOF'
feat: apply tag filter at narrative extraction choke point

Route simulation, memory, observation, and recentChatText through
narrativeMessageText; short-circuit empty-after-filter simulations.
EOF
)"
```

---

### Task 4: Settings UI — Lọc thẻ group

**Files:**
- Modify: `ui.js` (`renderSettings`, `createWorldBackstageUI` state + handlers)
- Modify: `style.css` (small rule-card block)

- [ ] **Step 1: Add UI draft state**

Inside `createWorldBackstageUI`, near other drafts:

```js
let tagFilterDraftRules = null; // null = use settings; array may include empty draft cards
```

When settings close (`toggle-settings` turning off, or overlay dismiss that clears settings), set `tagFilterDraftRules = null`.

Helper inside UI factory:

```js
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
    await invokeAction('update-settings', { tagFilterRules: persisted });
}
```

- [ ] **Step 2: Extend `renderSettings` signature**

Change `renderSettings(...)` to accept `tagFilterDraft = null` (or read via closure if `renderSettings` is nested — currently it is a module-level function, so pass the visible rules array):

```js
function renderSettings(state, settings, syncStatus, openGroups = new Set(), apiDraft = null, tagFilterRules = null) {
```

Inside, compute:

```js
const rules = Array.isArray(tagFilterRules)
    ? tagFilterRules
    : (settings.tagFilterRules || []);
```

- [ ] **Step 3: Insert settings group HTML**

Between the closing `</details>` of `simulation` and the opening of `worldbook`, insert:

```html
<details class="wb-settings-group" data-settings-group="tagfilter" ${groupOpen('tagfilter')}>
    <summary><span>Lọc thẻ</span><small>Loại bỏ các thẻ tạp và chú thích trước khi suy diễn / ký ức</small></summary>
    <div class="wb-settings-group-body">
        <div class="wb-setting-toggle">
            <div><strong>Bật lọc thẻ</strong><span>Vẫn sẽ xóa chú thích HTML &lt;!-- --&gt; sau khi đóng</span></div>
            <label class="wb-switch">
                <input type="checkbox" data-wb-setting="tagFilterEnabled"
                    ${settings.tagFilterEnabled !== false ? 'checked' : ''}>
                <i></i>
            </label>
        </div>
        <div class="wb-setting-block">
            <p>Chú thích HTML <code>&lt;!-- ... --&gt;</code> luôn bị xóa toàn bộ khối. Khớp chính xác theo nghĩa đen (phân biệt chữ hoa chữ thường). Thẻ mở đầu có thể để trống: chỉ điền thẻ kết thúc sẽ xóa thẻ kết thúc đó và toàn bộ trước đó; chỉ điền thẻ mở đầu sẽ xóa từ thẻ mở đầu đến cuối mục này.</p>
            <div class="wb-tag-filter-list">
                ${rules.map((rule, index) => `
                    <div class="wb-tag-filter-rule" data-tag-filter-index="${index}">
                        <div class="wb-tag-filter-rule-head">
                            <strong>Quy tắc ${index + 1}</strong>
                            <button type="button" data-wb-action="remove-tag-filter-rule"
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
            <button type="button" class="wb-secondary-button" data-wb-action="add-tag-filter-rule"
                ${rules.filter(rule => String(rule.open || '').trim() || String(rule.close || '').trim()).length >= 30 ? 'disabled' : ''}>
                ＋ Thêm quy tắc
            </button>
        </div>
    </div>
</details>
```

Use `escapeAttr` / `escapeHtml` already in `ui.js`. If `wb-secondary-button` does not exist, reuse an existing button class from settings (e.g. plain button in `wb-setting-actions`).

- [ ] **Step 4: Pass draft into render**

Where `renderSettings(...)` is called:

```js
${renderSettings(
    state,
    settings,
    syncStatus,
    openSettingsGroups,
    apiFormDraft,
    visibleTagFilterRules(settings),
)}
```

- [ ] **Step 5: Click handlers**

In the root `click` handler:

```js
if (action === 'add-tag-filter-rule') {
    const settings = getSettings();
    const current = visibleTagFilterRules(settings);
    tagFilterDraftRules = [...current, { open: '', close: '' }];
    render();
    return;
}
if (action === 'remove-tag-filter-rule') {
    const index = Number(target.dataset.index);
    const settings = getSettings();
    const current = visibleTagFilterRules(settings).filter((_, i) => i !== index);
    await persistTagFilterRules(current);
    render();
    return;
}
```

When `action === 'toggle-settings'` closes settings, clear draft:

```js
if (!settingsOpen) tagFilterDraftRules = null;
```

- [ ] **Step 6: Change handler for rule fields**

In the root `change` listener, before/after `data-wb-setting` handling:

```js
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
```

`tagFilterEnabled` continues to work via existing `data-wb-setting` → `update-settings`.

- [ ] **Step 7: CSS**

Append to `style.css`:

```css
.wb-tag-filter-list {
    display: grid;
    gap: 10px;
    margin: 10px 0;
}

.wb-tag-filter-rule {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--wb-line-strong, rgba(255, 255, 255, 0.08));
    border-radius: 12px;
    background: var(--wb-panel-faint, rgba(0, 0, 0, 0.18));
}

.wb-tag-filter-rule-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.wb-tag-filter-rule label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--wb-text-soft);
}

.wb-tag-filter-rule label span {
    color: var(--wb-text-faint);
}

.wb-tag-filter-rule input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--wb-line-strong, rgba(255, 255, 255, 0.12));
    background: var(--wb-bg, #0d1218);
    color: var(--wb-text);
    font-size: 13px;
}

.wb-tag-filter-rule input::placeholder {
    color: var(--wb-text-faint);
}
```

- [ ] **Step 8: Manual sanity + automated check**

```bash
npm test
npm run check
```

Manual (SillyTavern): open Cài đặt quan sát → Lọc thẻ → confirm defaults, add empty card (does not vanish), fill `</dream_body>` only, toggle enable.

- [ ] **Step 9: Commit**

```bash
git add ui.js style.css
git commit -m "$(cat <<'EOF'
feat: add tag filter settings group in observation panel

Let users enable filtering and edit open/close rules with draft-safe
empty cards between simulation and worldbook groups.
EOF
)"
```

---

### Task 5: Architecture note + final verification

**Files:**
- Modify: `docs/ARCHITECTURE.md` (short bullet under 0.8.x or Ranh giới mô-đun)

- [ ] **Step 1: Document**

Add under the latest version section or Ranh giới mô-đun:

```md
- Lọc thẻ tùy chọn ở lớp trích xuất tự sự: `filterNarrativeText` loại bỏ chú thích HTML và các thẻ đóng mở do người dùng cấu hình khi đọc nội dung chính trong suy diễn / ký ức / quan sát nhân vật; băm nhánh và đánh giá tính khả dụng vẫn sử dụng văn bản gốc.
```

- [ ] **Step 2: Full verification**

```bash
npm test
npm run check
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: note narrative tag filtering in architecture
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Always strip `<!-- -->` | Task 1 |
| Open/close rules + only-open / only-close | Task 1 |
| Strict literal + case-sensitive + regexp escape | Task 1 |
| Defaults options/thinking/think | Task 2 |
| settingsVersion 13 | Task 2 |
| `narrativeMessageText` choke point | Task 3 |
| Raw `.mes` fixes in narrativeContext/recentChatText | Task 3 |
| Filter-then-slice | Task 3 |
| Empty-after-filter simulation short-circuit | Task 3 |
| Memory empty batch skip (existing loop) | Task 3 |
| Observation allows empty turns | Task 3 (no-op) |
| UI group + toggle + rule cards | Task 4 |
| Draft empty cards vs normalize | Task 4 |
| High-contrast inputs | Task 4 CSS |
| ARCHITECTURE note | Task 5 |