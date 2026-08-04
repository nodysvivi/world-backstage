import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyHistoryIndexResult,
    applySimulationResult,
    buildHistoryIndexPrompt,
    buildInjectionPackage,
    buildPersonObservationPrompt,
    buildSimulationPrompt,
    createInitialState,
    selectRelevantStoryMemory,
    trimState,
} from '../core.js';

test('legacy state receives an empty story memory ledger', () => {
    const state = createInitialState();
    delete state.storyMemory;
    const migrated = trimState(state);

    assert.equal(migrated.storyMemory.indexedThroughMessageId, -1);
    assert.equal(migrated.storyMemory.digest.text, '');
    assert.deepEqual(migrated.storyMemory.facts, []);
    assert.deepEqual(migrated.storyMemory.summaries, []);
    assert.deepEqual(migrated.storyMemory.clues, []);
});

test('locked manual memory survives model updates and invalidation', () => {
    const state = createInitialState();
    state.storyMemory.facts.push({
        id: 'locked-promise',
        key: 'person:a:promise',
        subject: 'A',
        predicate: 'Lời hứa',
        value: 'Sẽ không rời đi',
        status: 'active',
        confidence: 'high',
        importance: 3,
        visibility: 'known',
        locked: true,
        manual: true,
    });
    const updated = applySimulationResult(state, {
        memory_update: {
            facts_upsert: [{ id: 'locked-promise', key: 'person:a:promise', value: 'Đã rời đi' }],
            facts_invalidate: [{ id: 'locked-promise', reason: 'Mô hình phán đoán thất bại' }],
        },
    });
    const locked = updated.storyMemory.facts.find(fact => fact.id === 'locked-promise');
    assert.equal(locked.value, 'Sẽ không rời đi');
    assert.equal(locked.status, 'active');
});

test('history batches create summaries and deduplicated clues', () => {
    const base = createInitialState();
    const first = applyHistoryIndexResult(base, {
        chapter_summary: {
            title: 'Vị khách đêm mưa',
            summary: 'Một bức thư không có chữ ký được giấu vào quầy.',
            start_message_id: 0,
            end_message_id: 19,
            people: ['Lão Bạch'],
            locations: ['Đồng Phúc khách sạn'],
        },
        clues_upsert: [{
            id: 'unsigned-letter',
            title: 'Bức thư không chữ ký',
            text: 'Dấu sáp niêm phong trên phong bì đến từ kinh thành.',
            source_message_id: 8,
            source_swipe_id: 1,
            source_excerpt: 'Trên sáp niêm phong có một đường vân hạc cực kỳ mờ nhạt.',
            people: ['Lão Bạch'],
            locations: ['Đồng Phúc khách sạn'],
            tags: ['Sáp niêm phong', 'Vân hạc'],
            importance: 3,
        }],
    }, { startMessageId: 0, endMessageId: 19 });
    const second = applyHistoryIndexResult(first, {
        clues_upsert: [{
            id: 'unsigned-letter',
            text: 'Dấu sáp niêm phong trên phong bì đến từ kinh thành, sau đó lại được chưởng quỹ cất đi.',
            status: 'echoed',
        }],
    }, { startMessageId: 20, endMessageId: 39 });

    assert.equal(second.storyMemory.summaries.length, 1);
    assert.equal(second.storyMemory.clues.length, 1);
    assert.equal(second.storyMemory.clues[0].status, 'echoed');
    assert.equal(second.storyMemory.indexedThroughMessageId, 39);
});

test('relevant memory retrieval prefers matching people and objects', () => {
    const state = applyHistoryIndexResult(createInitialState(), {
        clues_upsert: [
            {
                id: 'letter',
                title: 'Sáp niêm phong vân hạc',
                text: 'Bức thư không chữ ký sử dụng sáp niêm phong vân hạc.',
                people: ['Lão Bạch'],
                tags: ['Bức thư', 'Sáp niêm phong'],
                importance: 3,
            },
            {
                id: 'well',
                title: 'Dấu chân bên giếng',
                text: 'Bên giếng ở hậu viện có dấu chân lạ.',
                people: ['Tiểu Quách'],
                tags: ['Giếng nước'],
                importance: 1,
            },
        ],
    }, { startMessageId: 0, endMessageId: 10 });

    const memory = selectRelevantStoryMemory(state, 'Lão Bạch một lần nữa cầm lên bức thư có sáp niêm phong kia.', {
        maximumClues: 1,
        maximumSummaries: 0,
    });
    assert.equal(memory.clues[0].id, 'letter');
});

test('normal world simulation can add and resolve clue records', () => {
    const base = applyHistoryIndexResult(createInitialState(), {
        clues_upsert: [{
            id: 'old-key',
            title: 'Chìa khóa cũ',
            text: 'Trên răng chìa khóa có khắc ba đường ngang.',
        }],
    }, { startMessageId: 0, endMessageId: 4 });
    const result = applySimulationResult(base, {
        elapsed_minutes: 0,
        memory_update: {
            clues_upsert: [{
                id: 'new-map',
                title: 'Bản đồ tàn khuyết',
                text: 'Bản đồ thiếu một góc phía bắc.',
            }],
            clues_resolve: [{
                id: 'old-key',
                resolution: 'Chìa khóa đã mở nhà kho cũ.',
            }],
        },
    }, { messageId: 12, swipeId: 2 });

    assert.equal(result.storyMemory.clues.length, 2);
    assert.equal(
        result.storyMemory.clues.find(clue => clue.id === 'old-key').status,
        'resolved',
    );
    assert.equal(
        result.storyMemory.clues.find(clue => clue.id === 'new-map').sourceMessageId,
        12,
    );
});

test('history and world prompts carry source-aware long memory rules', () => {
    const state = createInitialState();
    const historyPrompt = buildHistoryIndexPrompt(state, {
        messages: [
            { id: 7, swipe: 2, role: 'assistant', content: 'Dưới góc bàn có đè một bức thư.' },
        ],
        userName: 'Người chơi',
    });
    const worldPrompt = buildSimulationPrompt(state, {
        narrativeTurns: [{ role: 'assistant', content: 'Dưới góc bàn có đè một bức thư.' }],
    });

    assert.equal(historyPrompt.includes('source_message_id'), true);
    assert.equal(historyPrompt.includes('swipe="2"'), true);
    assert.equal(worldPrompt.includes('memory_update'), true);
    assert.equal(worldPrompt.includes('Ký ức cũ liên quan'), true);
});

test('person observation is bounded and protects the player by default', () => {
    const state = createInitialState();
    const npc = {
        id: 'npc',
        name: 'Lão Bạch',
        isUser: false,
        location: 'Sân sau',
        action: 'Kiểm tra chốt cửa',
        intent: 'Xác nhận xem có ai từng đến chưa',
        longTermGoal: 'Bảo vệ khách điếm',
        innerVoice: 'Chốt cửa này có vẻ như đã bị ai đó động vào.',
        knowledge: 'hidden',
    };
    const prompt = buildPersonObservationPrompt(state, npc);
    assert.equal(prompt.includes('Không thúc đẩy thời gian thế giới chính'), true);
    assert.equal(prompt.includes('Sử dụng“Tôi”'), true);

    assert.throws(
        () => buildPersonObservationPrompt(state, { ...npc, name: 'Người chơi', isUser: true }),
        /Góc nhìn người chơi mặc định tắt/,
    );
});

test('player identity anchor is free-form, gender-neutral and shared by all prompt paths', () => {
    const state = createInitialState();
    const anchor = 'Nam giới, ngoại hình thiên hướng nữ giới, sử dụng“Anh ta”và danh xưng nam giới; nhân ngoại tộc hồ ly.';
    const worldPrompt = buildSimulationPrompt(state, {
        userName: 'Nguyệt Đảo',
        playerIdentityAnchor: anchor,
        narrativeTurns: [{ role: 'assistant', content: 'Có người nhìn về phía Nguyệt Đảo.' }],
    });
    const historyPrompt = buildHistoryIndexPrompt(state, {
        userName: 'Nguyệt Đảo',
        playerIdentityAnchor: anchor,
        messages: [{ id: 1, role: 'assistant', content: 'Có người nhìn về phía Nguyệt Đảo.' }],
    });
    const observationPrompt = buildPersonObservationPrompt(state, {
        id: 'npc',
        name: 'Thủ vệ',
        location: 'Cổng thành',
        action: 'Canh gác',
        intent: 'Quan sát khách đến',
        knowledge: 'hidden',
    }, {
        userName: 'Nguyệt Đảo',
        playerIdentityAnchor: anchor,
    });

    for (const prompt of [worldPrompt, historyPrompt, observationPrompt]) {
        assert.match(prompt, /Nam giới, ngoại hình thiên hướng nữ giới/);
        assert.match(prompt, /Không được dựa vào ngoại hình, trang phục, cơ thể hoặc loài/);
    }
    assert.doesNotMatch(worldPrompt, /Theo dõi vị trí và hành động của cô ấy/);
    assert.doesNotMatch(observationPrompt, /Miêu tả cô ấy lúc này/);
});

test('every character can keep an authoritative free-form identity anchor', () => {
    const state = createInitialState();
    state.people.push({
        id: 'npc-androgynous-fox',
        name: 'Naruto lang thang',
        identityAnchor: 'Nam giới, ngoại hình thiên về nữ giới, sử dụng“Anh ta”；Nhân ngoại tộc cáo, giai đoạn tuổi là trưởng thành.',
        location: 'Bãi đá cuội',
        action: 'Cảnh giác xung quanh',
        intent: 'Tìm kiếm đồng hành',
        knowledge: 'hidden',
        source: 'manual',
        manual: true,
        simulationEnabled: true,
    });
    const normalized = trimState(state);
    const person = normalized.people[0];
    const worldPrompt = buildSimulationPrompt(normalized, {
        narrativeTurns: [{ role: 'assistant', content: 'Có người đi ngang qua ở phía xa.' }],
    });
    const historyPrompt = buildHistoryIndexPrompt(normalized, {
        messages: [{ id: 1, role: 'assistant', content: 'Naruto lang thang đang cảnh giác ở bãi đá cuội.' }],
    });
    const observationPrompt = buildPersonObservationPrompt(normalized, person);

    for (const prompt of [worldPrompt, historyPrompt, observationPrompt]) {
        assert.match(prompt, /Nam giới, ngoại hình thiên về nữ giới/);
        assert.match(prompt, /Nhân ngoại tộc cáo/);
    }

    const modelAttempt = applySimulationResult(normalized, {
        elapsed_minutes: 0,
        people_upsert: [{
            id: person.id,
            name: person.name,
            identity_anchor: 'Nữ giới',
            action: 'Tiếp tục cảnh giác',
            source: 'background',
        }],
    });
    assert.equal(modelAttempt.people[0].identityAnchor, person.identityAnchor);
});

test('history indexing stores a rolling digest and durable facts', () => {
    const state = applyHistoryIndexResult(createInitialState(), {
        memory_digest: {
            text: 'The innkeeper promised to protect the sealed letter.',
            through_message_id: 18,
            people: ['Innkeeper'],
            tags: ['promise'],
        },
        facts_upsert: [{
            id: 'innkeeper-promise',
            key: 'person:innkeeper:promise',
            subject: 'Innkeeper',
            predicate: 'promised',
            value: 'Protect the sealed letter',
            source_message_id: 18,
            status: 'active',
            confidence: 'high',
            importance: 3,
            visibility: 'known',
        }],
    }, { startMessageId: 9, endMessageId: 18 });

    assert.equal(state.storyMemory.digest.throughMessageId, 18);
    assert.match(state.storyMemory.digest.text, /sealed letter/);
    assert.equal(state.storyMemory.facts.length, 1);
    assert.equal(state.storyMemory.facts[0].key, 'person:innkeeper:promise');
});

test('a changed durable fact keeps the old version and links the replacement', () => {
    const first = applyHistoryIndexResult(createInitialState(), {
        facts_upsert: [{
            id: 'keeper-role',
            key: 'person:keeper:role',
            subject: 'Keeper',
            predicate: 'role',
            value: 'Innkeeper',
            importance: 3,
            visibility: 'known',
        }],
    }, { startMessageId: 0, endMessageId: 10 });
    const second = applyHistoryIndexResult(first, {
        facts_upsert: [{
            id: 'keeper-role',
            key: 'person:keeper:role',
            subject: 'Keeper',
            predicate: 'role',
            value: 'Royal spy',
            importance: 3,
            visibility: 'known',
        }],
    }, { startMessageId: 11, endMessageId: 20 });

    assert.equal(second.storyMemory.facts.length, 2);
    const oldVersion = second.storyMemory.facts.find(fact => fact.value === 'Innkeeper');
    const newVersion = second.storyMemory.facts.find(fact => fact.value === 'Royal spy');
    assert.equal(oldVersion.status, 'superseded');
    assert.equal(oldVersion.supersededBy, newVersion.id);
    assert.equal(newVersion.status, 'active');
    assert.equal(newVersion.supersedes.includes(oldVersion.id), true);
});

test('disputed replacements remain parallel instead of erasing either claim', () => {
    const first = applyHistoryIndexResult(createInitialState(), {
        facts_upsert: [{
            key: 'artifact:origin',
            subject: 'Artifact',
            predicate: 'origin',
            value: 'Northern ruins',
            visibility: 'known',
        }],
    }, { startMessageId: 0, endMessageId: 4 });
    const second = applyHistoryIndexResult(first, {
        facts_upsert: [{
            key: 'artifact:origin',
            subject: 'Artifact',
            predicate: 'origin',
            value: 'Capital forge',
            status: 'disputed',
            visibility: 'known',
        }],
    }, { startMessageId: 5, endMessageId: 9 });

    assert.equal(second.storyMemory.facts.length, 2);
    assert.deepEqual(
        second.storyMemory.facts.map(fact => fact.status).sort(),
        ['disputed', 'disputed'],
    );
});

test('normal simulation writes durable facts and can invalidate them later', () => {
    const written = applySimulationResult(createInitialState(), {
        elapsed_minutes: 0,
        memory_update: {
            facts_upsert: [{
                key: 'letter:owner',
                subject: 'Sealed letter',
                predicate: 'owner',
                value: 'Mira',
                visibility: 'known',
            }],
        },
    }, { messageId: 12, swipeId: 1 });
    const invalidated = applySimulationResult(written, {
        elapsed_minutes: 0,
        memory_update: {
            facts_invalidate: [{
                key: 'letter:owner',
                reason: 'The letter was proven to be a planted decoy.',
            }],
        },
    }, { messageId: 15, swipeId: 0 });

    assert.equal(written.storyMemory.facts[0].sourceMessageId, 12);
    assert.equal(invalidated.storyMemory.facts[0].status, 'invalidated');
    assert.match(invalidated.storyMemory.facts[0].invalidationReason, /decoy/);
});

test('main prompt recalls only relevant knowledge-safe memory', () => {
    const state = applyHistoryIndexResult(createInitialState(), {
        facts_upsert: [
            {
                key: 'letter:owner',
                subject: 'Sealed letter',
                predicate: 'owner',
                value: 'Mira may openly claim it',
                tags: ['sealed letter'],
                importance: 3,
                visibility: 'known',
            },
            {
                key: 'letter:secret',
                subject: 'Sealed letter',
                predicate: 'secret',
                value: 'Hidden assassin order',
                tags: ['sealed letter'],
                importance: 3,
                visibility: 'hidden',
            },
        ],
    }, { startMessageId: 0, endMessageId: 14 });
    const injection = buildInjectionPackage(state, {
        enabled: true,
        promptInjection: true,
        sceneTiming: 'strict',
    }, 'Mira examines the sealed letter.');

    assert.match(injection.text, /Mira may openly claim it/);
    assert.equal(injection.text.includes('Hidden assassin order'), false);
});

test('history prompts request all four memory layers', () => {
    const prompt = buildHistoryIndexPrompt(createInitialState(), {
        messages: [{ id: 1, role: 'assistant', content: 'A promise is made.' }],
    });

    assert.equal(prompt.includes('memory_digest'), true);
    assert.equal(prompt.includes('chapter_summary'), true);
    assert.equal(prompt.includes('facts_upsert'), true);
    assert.equal(prompt.includes('clues_upsert'), true);

    const compactPrompt = buildHistoryIndexPrompt(createInitialState(), {
        messages: [{ id: 1, role: 'assistant', content: 'A promise is made.' }],
        compact: true,
    });
    assert.match(compactPrompt, /Thử lại tối giản/);
    assert.match(compactPrompt, /Không vượt quá 240 chữ/);
    assert.match(compactPrompt, /facts_upsert Tối đa 3 mục/);
    assert.equal(compactPrompt.length < prompt.length + 300, true);
});

test('more than 200 turns remain bounded and still recall recent character facts', () => {
    let state = createInitialState({ worldName: 'Kiểm tra áp lực văn bản dài' });
    for (let turn = 0; turn < 220; turn += 1) {
        const personIndex = turn % 18;
        state = applySimulationResult(state, {
            elapsed_minutes: turn % 10 === 0 ? 1 : 0,
            people_upsert: [{
                id: `npc-${personIndex}`,
                name: `Nhân vật${personIndex}`,
                action: `Xử lý thứ${turn}công việc còn lại của vòng`,
                intent: `Giữ manh mối${turn % 9}Liên tục`,
                source: 'background',
            }],
            events_create: [{
                id: `event-${turn}`,
                title: `Sự kiện chạy ngầm${turn}`,
                place: `Địa điểm${turn % 12}`,
                summary: `Nhân vật${personIndex}Đã thúc đẩy manh mối${turn % 9}`,
                clock_mode: 'condition',
                visibility: 'hidden',
            }],
        }, {
            messageId: turn * 2 + 1,
            backgroundNpcBudget: 4,
            narrativeText: `Thứ${turn}nội dung chính của vòng`,
        });
        state = applyHistoryIndexResult(state, {
            chapter_summary: {
                id: `summary-${turn}`,
                title: `Giai đoạn${turn}`,
                summary: `Nhân vật${personIndex}Ở địa điểm${turn % 12}Đã xử lý manh mối${turn % 9}`,
            },
            facts_upsert: [{
                id: `fact-${turn}`,
                key: `turn:${turn}:fact`,
                subject: `Nhân vật${personIndex}`,
                predicate: 'Trải nghiệm',
                value: `Hoàn thành thứ${turn}sự thật bền vững của vòng`,
                importance: turn === 219 ? 3 : 1,
                visibility: 'known',
            }],
            clues_upsert: [{
                id: `clue-${turn}`,
                title: `Manh mối${turn}`,
                text: `Nhân vật${personIndex}Nhớ thứ${turn}chi tiết của vòng`,
                people: [`Nhân vật${personIndex}`],
                tags: [`Manh mối${turn % 9}`],
            }],
        }, {
            startMessageId: turn * 2,
            endMessageId: turn * 2 + 1,
        });
    }

    assert.equal(state.people.length, 18);
    assert.equal(state.events.length <= 96, true);
    assert.equal(state.storyMemory.facts.length <= 240, true);
    assert.equal(state.storyMemory.clues.length <= 180, true);
    assert.equal(state.storyMemory.summaries.length <= 72, true);
    assert.equal(state.audit.length <= 40, true);
    const prompt = buildSimulationPrompt(state, {
        narrativeTurns: [{ role: 'assistant', content: 'Nhân vật 3 Nhắc lại manh mối lần nữa 3。', messageId: 441 }],
    });
    assert.equal(prompt.includes('Nhân vật 3'), true);
    assert.equal(prompt.length < 80000, true);
});
