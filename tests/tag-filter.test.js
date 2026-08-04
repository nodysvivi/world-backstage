import test from 'node:test';
import assert from 'node:assert/strict';
import {
    countSurvivingNewAssistantTurns,
    filterNarrativeText,
    normalizeTagFilterRules,
    selectPendingAssistantMessageIds,
} from '../core.js';

const enabled = (rules) => ({ tagFilterEnabled: true, tagFilterRules: rules });

test('Luôn xóa qua nhiều dòng HTML Chú thích', () => {
    const text = 'Trước<!--\n Bản nháp\n-->Sau';
    assert.equal(filterNarrativeText(text, { tagFilterEnabled: false, tagFilterRules: [] }), 'Trước sau');
});

test('Chú thích chưa đóng giữ nguyên không đổi', () => {
    const text = 'Trước<!--Sau bản nháp';
    assert.equal(filterNarrativeText(text, { tagFilterEnabled: false, tagFilterRules: [] }), text);
});

test('Quy tắc theo cặp xóa toàn bộ khối', () => {
    const text = 'A<options>Chọn 1</options>B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        'AB',
    );
});

test('Khớp chính xác theo nghĩa đen không khớp phần mở đầu có thuộc tính', () => {
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

test('Chỉ phần cuối: Xóa phần cuối và toàn bộ trước đó, đồng thời cắt gọt lặp đi lặp lại', () => {
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

test('Nhiều quy tắc áp dụng theo thứ tự', () => {
    const text = '1<think>t</think>2<options>o</options>3';
    assert.equal(
        filterNarrativeText(text, enabled([
            { open: '<think>', close: '</think>' },
            { open: '<options>', close: '</options>' },
        ])),
        '123',
    );
});

test('Không tìm thấy theo cặp close Khi đó không xóa nhầm đến cuối văn bản', () => {
    const text = 'A<options>Không có phần cuối B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        text,
    );
});

test('normalizeTagFilterRules Loại bỏ khoảng trống kép và cắt bớt', () => {
    const rules = normalizeTagFilterRules([
        { open: '', close: '' },
        { open: ` <${'a'.repeat(100)}> `, close: '</a>' },
    ]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].open.length, 80);
    assert.equal(rules[0].close, '</a>');
});

test('Lọc trước rồi cắt bớt: Thẻ đóng sau điểm cắt bớt vẫn sẽ bị xóa hoàn toàn', () => {
    const open = '<options>';
    const close = '</options>';
    const inner = 'x'.repeat(50);
    const full = `KEEP${open}${inner}${close}TAIL`;
    const filtered = filterNarrativeText(full, enabled([{ open, close }]));
    assert.equal(filtered, 'KEEPTAIL');
    assert.equal(filtered.slice(0, 20), 'KEEPTAIL');
});

// Regression: pending batch must be selected by raw chat message ids ending at
// messageId. narrativeContext drops empty-after-filter turns, so slicing the
// last N assistants from narrative.turns can incorrectly treat an older
// committed assistant as "new" and skip the empty short-circuit.
test('selectPendingAssistantMessageIds Lấy gần nhất theo tính khả dụng của văn bản gốc N Mục assistant id', () => {
    const chat = [
        { is_user: true, mes: 'u0' },
        { is_user: false, mes: 'old committed' }, // id 1
        { is_user: true, mes: 'u1' },
        { is_user: false, mes: '<!--only comment-->' }, // id 3, usable raw, empty after filter
        { is_user: true, mes: 'u2' },
        { is_user: false, mes: '<options>x</options>' }, // id 5, usable raw, empty after filter
    ];
    const isUsable = (message) => Boolean(
        message && !message.is_user && !message.is_system && String(message.mes || '').trim(),
    );
    assert.deepEqual(
        selectPendingAssistantMessageIds(chat, 5, 2, isUsable),
        [3, 5],
    );
    assert.deepEqual(
        selectPendingAssistantMessageIds(chat, 5, 1, isUsable),
        [5],
    );
});

test('countSurvivingNewAssistantTurns Chỉ tính những gì vẫn còn lại trong narrative Trong pending id', () => {
    // After filter, pending ids 3 and 5 are empty and absent from narrative.turns;
    // only older assistant id 1 remains. Surviving pending count must be 0 so the
    // runner short-circuits instead of marking id 1 as new="true".
    const narrativeTurns = [
        { role: 'user', messageId: 0, content: 'u0' },
        { role: 'assistant', messageId: 1, content: 'old committed' },
        { role: 'user', messageId: 2, content: 'u1' },
        { role: 'user', messageId: 4, content: 'u2' },
    ];
    const pendingIds = [3, 5];
    assert.equal(countSurvivingNewAssistantTurns(narrativeTurns, pendingIds), 0);

    const withSurvivor = [
        ...narrativeTurns,
        { role: 'assistant', messageId: 5, content: 'kept body' },
    ];
    assert.equal(countSurvivingNewAssistantTurns(withSurvivor, pendingIds), 1);
    assert.equal(countSurvivingNewAssistantTurns(withSurvivor, [1, 5]), 2);
});

test('Nhiều vòng pending Khi lọc trống toàn bộ không nên lấy phần sớm hơn assistant Coi như new', () => {
    const rules = enabled([{ open: '<options>', close: '</options>' }]);
    const chat = [
        { is_user: false, mes: 'already committed scene' },
        { is_user: true, mes: 'go' },
        { is_user: false, mes: '<options>menu only</options>' },
        { is_user: true, mes: 'again' },
        { is_user: false, mes: '<!--draft-->' },
    ];
    const isUsable = (message) => Boolean(
        message && !message.is_user && !message.is_system && String(message.mes || '').trim(),
    );
    const pendingIds = selectPendingAssistantMessageIds(chat, 4, 2, isUsable);
    assert.deepEqual(pendingIds, [2, 4]);

    const pendingFiltered = pendingIds.map(
        id => filterNarrativeText(chat[id].mes, rules).trim(),
    );
    assert.ok(!pendingFiltered.some(Boolean), 'pending batch filters to empty');

    // Mimic narrativeContext dropping empty assistant turns:
    const narrativeTurns = [
        { role: 'assistant', messageId: 0, content: 'already committed scene' },
        { role: 'user', messageId: 1, content: 'go' },
        { role: 'user', messageId: 3, content: 'again' },
    ];
    // Buggy path would slice(-2) assistants from narrative and see [committed],
    // skipping short-circuit. Correct path counts surviving pending ids → 0.
    assert.equal(countSurvivingNewAssistantTurns(narrativeTurns, pendingIds), 0);
    const buggySlice = narrativeTurns
        .filter(turn => turn.role === 'assistant')
        .slice(-2)
        .map(turn => turn.content);
    assert.equal(buggySlice.length, 1, 'documents the old buggy non-empty slice');
    assert.ok(buggySlice[0].trim(), 'old path wrongly saw older assistant text');
});
