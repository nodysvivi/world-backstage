import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MINUTES_PER_DAY,
    RECOVERY_LIMIT,
    addRecoveryPoint,
    addManualEvent,
    advanceWorldClock,
    applySimulationResult,
    buildInjectionPackage,
    buildPersonObservationPrompt,
    buildSimulationPrompt,
    createInitialState,
    createSnapshot,
    eventProgress,
    extractJsonObject,
    formatWorldCalendar,
    formatWorldMinute,
    hasExplicitTimeEvidence,
    listRecoveryPoints,
    normalizeEvent,
    recordDeliveryOffers,
    restoreSnapshot,
    restoreRecoveryPoint,
    selectDeliveryCandidates,
    setWorldCalendar,
    settleTimedEvents,
    trimState,
} from '../core.js';
import { renderPersonCard } from '../ui.js';

test('Đồng hồ thế giới chính sử dụng phút tuyệt đối, và theo ngày/Giờ/Phút khôi phục ổn định', () => {
    const state = createInitialState({ worldName: 'Vụ Cảng', day: 17, hour: 22, minute: 40 });

    assert.equal(state.clock.absoluteMinute, 17 * MINUTES_PER_DAY + 22 * 60 + 40);
    assert.deepEqual(formatWorldMinute(state.clock.absoluteMinute), {
        day: 17,
        hour: 22,
        minute: 40,
        time: '22:40',
        stamp: 'Thứ 17 Ngày 22:40',
    });
});

test('Sự kiện hoạt động do người dùng chỉ định sẽ ưu tiên vào vòng chèn tiếp theo và chỉ tiêu thụ một lần', () => {
    const state = addManualEvent(createInitialState(), {
        id: 'quiet-current',
        title: 'Đổi gác bến cảng',
        summary: 'Đội tuần tra đang được triển khai lại.',
        visibility: 'trace',
    });
    state.events[0].delivery.manualQueued = true;
    const selected = selectDeliveryCandidates(state, { deliveryDensity: 'restrained' });
    assert.equal(selected[0].id, 'quiet-current');
    const offered = recordDeliveryOffers(state, ['quiet-current'], { messageId: 8 });
    assert.equal(offered.events[0].delivery.manualQueued, false);
});

test('Chèn thế giới và ký ức có thể tắt độc lập với nhau', () => {
    const state = createInitialState();
    state.storyMemory.facts.push({
        id: 'promise', key: 'promise', subject: 'Giao ước', predicate: 'Nội dung', value: 'Trở về trước bình minh',
        status: 'active', confidence: 'high', importance: 3, visibility: 'known',
    });
    const memoryOnly = buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: false,
        memorySystemEnabled: true,
        memoryPromptInjection: true,
    }, 'Giao ước');
    assert.match(memoryOnly.text, /Trở về trước bình minh/);
    assert.doesNotMatch(memoryOnly.text, /Thời gian thế giới chính chuẩn/);
    const none = buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: false,
        memorySystemEnabled: true,
        memoryPromptInjection: false,
    }, 'Giao ước');
    assert.equal(none.text, '');
});

test('Chèn siêu dài được nén theo dòng hoàn chỉnh và giữ lại thẻ đóng', () => {
    const state = createInitialState();
    state.storyMemory.facts = Array.from({ length: 8 }, (_, index) => ({
        id: `fact-${index}`,
        key: `Giao ước-${index}`,
        subject: `Giao ước-${index}`,
        predicate: 'Nội dung cụ thể',
        value: `Từ khóa chung ${'Thông tin hợp lệ rất dài'.repeat(90)}`,
        status: 'active',
        confidence: 'high',
        importance: 5,
        visibility: 'known',
    }));
    state.people = Array.from({ length: 12 }, (_, index) => ({
        id: `person-${index}`,
        name: `Nhân vật từ khóa chung${index}`,
        location: 'Mô tả địa điểm rất dài'.repeat(20),
        action: 'Mô tả hành động rất dài'.repeat(35),
        knowledge: 'known',
        relevance: 5,
        updatedAt: state.clock.absoluteMinute,
    }));
    const packet = buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: true,
        memorySystemEnabled: true,
        memoryPromptInjection: true,
    }, 'Từ khóa chung');
    assert.ok(packet.text.length <= 4200);
    assert.match(packet.text, /Thông tin ít liên quan đã được nén và lược bỏ/);
    assert.match(packet.text, /<\/world_backstage_state>$/);
    assert.ok(packet.omittedLines > 0);
});

test('Lịch thế giới hỗ trợ hiệu chuẩn năm, tháng, ngày, và tự động qua tháng qua năm theo đồng hồ chuẩn', () => {
    let state = createInitialState({ day: 3, hour: 23, minute: 30 });
    state = setWorldCalendar(state, {
        calendarName: 'Quần Tinh Lịch',
        year: 2026,
        month: 12,
        day: 31,
        hour: 23,
        minute: 30,
    });

    assert.deepEqual(
        {
            calendarName: formatWorldCalendar(state).calendarName,
            date: formatWorldCalendar(state).date,
            time: formatWorldCalendar(state).time,
        },
        { calendarName: 'Quần Tinh Lịch', date: '2026 Năm 12 Tháng 31 Ngày', time: '23:30' },
    );

    state = advanceWorldClock(state, 60, 'Thử nghiệm qua năm');
    assert.equal(formatWorldCalendar(state).stamp, 'Quần Tinh Lịch 2027 Năm 1 Tháng 1 Ngày 00:30');
    assert.equal(state.world.calendar.anchorAbsoluteDay, 3);
});

test('Trạng thái cũ sẽ được chuyển thành lịch khả dụng mà không thay đổi thời gian tuyệt đối ban đầu', () => {
    const legacy = createInitialState({ day: 17, hour: 22, minute: 40 });
    delete legacy.world.calendar;
    const migrated = trimState(legacy);

    assert.equal(migrated.clock.absoluteMinute, legacy.clock.absoluteMinute);
    assert.equal(formatWorldCalendar(migrated).date, '1 Năm 1 Tháng 17 Ngày');
    assert.equal(formatWorldCalendar(migrated).time, '22:40');
});

test('Sự kiện dự kiến mười hai giờ sẽ không vì AI Số lần phản hồi tăng lên', () => {
    let state = createInitialState({ day: 3, hour: 9, minute: 0 });
    state = addManualEvent(state, {
        id: 'repair-radio',
        title: 'Sửa chữa máy liên lạc cũ',
        clock_mode: 'duration',
        duration_minutes: 12 * 60,
        visibility: 'hidden',
    });

    const startedAt = state.clock.absoluteMinute;
    assert.equal(state.events[0].dueAt, startedAt + 12 * 60);

    for (let reply = 0; reply < 8; reply += 1) {
        state = applySimulationResult(state, {
            elapsed_minutes: 0,
            time_reason: 'Nội dung chính không xảy ra sự trôi qua thời gian có thể xác nhận',
        }, {
            messageId: reply,
            swipeId: 0,
            sourceKey: `${reply}:0:no-time`,
        });
    }

    assert.equal(state.clock.absoluteMinute, startedAt);
    assert.equal(state.events[0].status, 'active');
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).percent, 0);

    state = settleTimedEvents(state, startedAt + 12 * 60 - 1);
    assert.equal(state.events[0].status, 'active');
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).remaining, 1);

    state = settleTimedEvents(state, startedAt + 12 * 60);
    assert.equal(state.events[0].status, 'ready');
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).percent, 100);
});

test('Sự kiện giờ làm việc hợp lệ chỉ tích lũy số phút làm việc thực tế được xác nhận trong nội dung chính', () => {
    let state = createInitialState({ day: 1, hour: 8, minute: 0 });
    state = addManualEvent(state, {
        id: 'forge-key',
        title: 'Rèn chìa khóa',
        clock_mode: 'active',
        duration_minutes: 120,
        visibility: 'hidden',
    });

    state = applySimulationResult(state, {
        elapsed_minutes: 480,
        time_reason: 'Tám giờ trôi qua, nhưng chỉ làm việc nửa giờ',
        events_update: [{ id: 'forge-key', status: 'active', worked_minutes: 30 }],
    });

    assert.equal(state.events[0].accruedMinutes, 30);
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).percent, 25);

    state = applySimulationResult(state, {
        elapsed_minutes: 120,
        time_reason: 'Nhân vật đang nghỉ ngơi',
        events_update: [{ id: 'forge-key', status: 'active', worked_minutes: 0 }],
    });

    assert.equal(state.events[0].accruedMinutes, 30);
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).percent, 25);
});

test('Sự kiện dự định sử dụng thời điểm hết hạn rõ ràng', () => {
    const start = 5 * MINUTES_PER_DAY + 10 * 60;
    const event = normalizeEvent({
        id: 'train-arrival',
        title: 'Chuyến xe đêm đến nơi',
        clock_mode: 'scheduled',
        scheduled_at: start + 95,
    }, start);

    assert.equal(event.startedAt, start);
    assert.equal(event.dueAt, start + 95);
    assert.equal(eventProgress(event, start + 94).remaining, 1);
    assert.equal(settleTimedEvents({
        ...createInitialState(),
        clock: {
            absoluteMinute: start,
            lastCheckedAt: start,
            source: 'test',
            reason: '',
        },
        events: [event],
    }, start + 95).events[0].status, 'ready');
});

test('Độc thoại góc nhìn thứ nhất giữ lại thời điểm tạo ở tầng dưới cùng, chỉ vào chạy ngầm để quyết toán mà không chèn vào nội dung chính', () => {
    let state = createInitialState({ worldName: 'Vụ Cảng', day: 2, hour: 14, minute: 10 });
    const voiceAt = state.clock.absoluteMinute;
    const secret = 'Tôi phải giấu bức thư đó vào ngọn hải đăng trước khi tiếng sóng dừng lại.';

    state = applySimulationResult(state, {
        elapsed_minutes: 0,
        people_upsert: [{
            id: 'lin',
            name: 'Lâm',
            location: 'Ngọn hải đăng cũ',
            action: 'Đi lên theo cầu thang xoắn ốc',
            intent: 'Giấu kỹ bức thư',
            inner_voice: secret,
            knowledge: 'known',
            relevance: 3,
        }],
    });
    state = advanceWorldClock(state, 180, 'Thử nghiệm thời gian trôi qua');

    assert.equal(state.people[0].innerVoice, secret);
    assert.equal(state.people[0].innerVoiceAt, voiceAt);

    const injected = buildInjectionPackage(state, {
        enabled: true,
        promptInjection: true,
        deliveryDensity: 'restrained',
        sceneTiming: 'strict',
    }, 'Lâm đang ở đâu?').text;
    assert.equal(injected.includes(secret), false);

    const backstagePrompt = buildSimulationPrompt(state);
    assert.equal(backstagePrompt.includes(secret), true);
});

test('Độc thoại góc nhìn thứ nhất từ kết quả mô hình đến bản ghi nhanh nhánh và giao diện hậu trường được triển khai hoàn chỉnh', () => {
    const base = createInitialState({ worldName: 'Thất Hiệp Trấn', day: 4, hour: 22, minute: 5 });
    const secret = 'Miệng tôi nói không bận tâm, nhưng ngọn đèn mãi không tắt kia, rõ ràng vẫn đang đợi một người trở về.';
    const settled = applySimulationResult(base, {
        elapsed_minutes: 15,
        people_upsert: [{
            id: 'tong-xiangyu',
            name: 'Đồng Tương Ngọc',
            location: 'Đại sảnh khách sạn Đồng Phúc',
            action: 'Dọn xong bàn bát đũa cuối cùng',
            intent: 'Đợi mọi người bình an trở về',
            inner_voice: secret,
            knowledge: 'known',
            relevance: 3,
            source: 'foreground',
        }],
    }, {
        messageId: 12,
        swipeId: 1,
        sourceKey: '12:1:voice',
    });
    const snapshot = createSnapshot(settled, {
        messageId: 12,
        swipeId: 1,
        sourceKey: '12:1:voice',
        kind: 'result',
    });
    const restored = restoreSnapshot(snapshot);
    const person = restored.people[0];

    assert.equal(person.innerVoice, secret);
    assert.equal(snapshot.meta.swipeId, 1);
    const backstageCard = renderPersonCard(person, 'backstage', restored.clock.absoluteMinute);
    assert.equal(backstageCard.includes(secret), true);
    assert.equal(backstageCard.includes('22:20'), false);
    assert.equal(renderPersonCard(person, 'known', restored.clock.absoluteMinute).includes(secret), false);
    assert.equal(buildInjectionPackage(restored, {
        enabled: true,
        promptInjection: true,
        deliveryDensity: 'balanced',
        sceneTiming: 'smart',
    }, 'Đồng Tương Ngọc').text.includes(secret), false);
});

test('Prompt suy diễn thế giới mang theo nội dung chính gần nhất một cách rõ ràng và chỉ xử lý điều cuối cùng AI Phản hồi', () => {
    const state = createInitialState({ worldName: 'Thất Hiệp Trấn' });
    const prompt = buildSimulationPrompt(state, {
        trigger: 'manual',
        narrativeTurns: [
            { role: 'user', content: 'Tôi nhẹ nhàng bước vào khách sạn.' },
            { role: 'assistant', content: 'Trục cửa phát ra một tiếng động rất nhẹ.' },
            { role: 'user', content: 'Tôi nhìn về phía quầy vẫn đang sáng đèn.' },
            { role: 'assistant', content: 'Đèn phía sau quầy vẫn đang sáng.' },
        ],
        userName: 'Hồ Dạ',
        includeUserInnerVoice: false,
        timePolicy: 'explicit',
    });

    assert.equal(prompt.includes('Tôi nhẹ nhàng bước vào khách sạn.'), true);
    assert.equal(prompt.includes('Đèn phía sau quầy vẫn đang sáng.'), true);
    assert.equal(prompt.includes('Lần này chỉ suy diễn cái cuối cùng assistant_turn'), true);
    assert.equal(prompt.includes('inner_voice Bắt buộc phải để trống'), true);
    assert.equal(prompt.includes('long_term_goal'), true);
    assert.equal(prompt.includes('"inner_voice":""'), true);
    assert.equal(prompt.trimEnd().endsWith('}'), true);
});

test('Tích lũy kích hoạt sẽ đánh dấu nhiều vòng nội dung chính mới theo thứ tự, và giữ lại các vòng sớm hơn làm ngữ cảnh nhân quả', () => {
    const prompt = buildSimulationPrompt(createInitialState(), {
        narrativeTurns: [
            { role: 'user', content: 'Tin nhắn người dùng vòng 1', messageId: 20, swipeId: 0 },
            { role: 'assistant', content: 'Nội dung chính vòng 1', messageId: 21, swipeId: 0 },
            { role: 'user', content: 'Tin nhắn người dùng vòng 2', messageId: 22, swipeId: 0 },
            { role: 'assistant', content: 'Nội dung chính vòng 2', messageId: 23, swipeId: 1 },
            { role: 'user', content: 'Tin nhắn người dùng vòng 3', messageId: 24, swipeId: 0 },
            { role: 'assistant', content: 'Nội dung chính vòng 3', messageId: 25, swipeId: 0 },
        ],
        newAssistantTurns: 2,
        simulationMode: 'deep',
        customInstruction: 'Ưu tiên chú ý cổng thành và thương hội.',
        backgroundNpcBudget: 4,
    });

    assert.equal(
        prompt.includes('<assistant_turn order="2" message_id="21" swipe_id="0" new="false">'),
        true,
    );
    assert.equal(
        prompt.includes('<assistant_turn order="4" message_id="23" swipe_id="1" new="true">'),
        true,
    );
    assert.equal(
        prompt.includes('<assistant_turn order="6" message_id="25" swipe_id="0" new="true">'),
        true,
    );
    assert.equal(prompt.includes('Cuối cùng 2 cái assistant_turn'), true);
    assert.equal(prompt.includes('Ưu tiên chú ý cổng thành và thương hội'), true);
    assert.equal(prompt.includes('Cập nhật tối đa 4 người ngoài ống kính NPC'), true);
});

test('Chạy ngầm NPC Ngân sách do phía plugin thực thi, giả mạo thành vào ống kính cũng không thể lách qua ngân sách bằng không', () => {
    const result = applySimulationResult(createInitialState(), {
        elapsed_minutes: 0,
        people_upsert: [
            { id: 'zhang', name: 'Trương Tam', source: 'foreground', action: 'Đẩy cửa vào nhà' },
            { id: 'li', name: 'Lý Tứ', source: 'foreground', action: 'Đang đi gấp ngoài thành' },
            { id: 'wang', name: 'Vương Ngũ', source: 'background', action: 'Đang đợi ở bến tàu' },
            { id: 'player', name: 'Hồ Dạ', is_user: true, source: 'foreground' },
        ],
    }, {
        userName: 'Hồ Dạ',
        messageId: 30,
        narrativeText: 'Trương Tam đẩy cửa vào nhà, nhìn về phía người chơi.',
        backgroundNpcBudget: 0,
    });

    assert.deepEqual(
        result.people.map(person => person.name).sort(),
        ['Trương Tam', 'Hồ Dạ'].sort(),
    );
    assert.equal(result.people.find(person => person.name === 'Trương Tam').lastSeenMessageId, 30);
});

test('Chế độ thời gian nghiêm ngặt từ chối quy đổi các từ chỉ bầu không khí như màn đêm thành vài giờ', () => {
    let base = createInitialState({ day: 1, hour: 8, minute: 0 });
    base = addManualEvent(base, {
        id: 'night-watch',
        title: 'Gác đêm',
        clock_mode: 'active',
        duration_minutes: 120,
    });
    const result = applySimulationResult(base, {
        elapsed_minutes: 360,
        time_reason: 'Mô hình dựa vào màn đêm buông xuống để đoán sáu giờ đã trôi qua',
        world: { title: 'Đêm đầu tiên của kỳ thi thứ nhất' },
        events_update: [{ id: 'night-watch', worked_minutes: 60 }],
    }, {
        timePolicy: 'explicit',
        narrativeText: 'Màn đêm buông xuống, vách đá mang theo cái ẩm lạnh đặc trưng của khu rừng.',
    });

    assert.equal(hasExplicitTimeEvidence('Màn đêm buông xuống, vách đá mang theo cái ẩm lạnh.'), false);
    assert.equal(result.clock.absoluteMinute, base.clock.absoluteMinute);
    assert.equal(result.events[0].accruedMinutes, 0);
    assert.equal(result.clock.reason.includes('Giữ đồng hồ thế giới không đổi'), true);
});

test('Chế độ thời gian nghiêm ngặt giữ lại khoảng thời gian được đưa ra rõ ràng trong nội dung chính', () => {
    const base = createInitialState({ day: 1, hour: 8, minute: 0 });
    const result = applySimulationResult(base, {
        elapsed_minutes: 360,
        time_reason: 'Nội dung chính viết rõ sáu giờ',
    }, {
        timePolicy: 'explicit',
        narrativeText: 'Sáu giờ sau, trời đã hoàn toàn tối đen.',
    });

    assert.equal(hasExplicitTimeEvidence('Sáu giờ sau, trời đã hoàn toàn tối đen.'), true);
    assert.equal(result.clock.absoluteMinute, base.clock.absoluteMinute + 360);
});

test('Nội tâm người chơi mặc định tắt,NPC Độc thoại và mục tiêu dài hạn vẫn có thể lưu lại', () => {
    const base = createInitialState({ worldName: 'Thất Hiệp Trấn' });
    const result = applySimulationResult(base, {
        elapsed_minutes: 0,
        people_upsert: [
            {
                id: 'huye',
                name: 'Hồ Dạ',
                is_user: true,
                inner_voice: 'Tôi đã quyết định thay cho người chơi rồi.',
                long_term_goal: 'Điều tra rõ nguồn gốc của vụ mất tích',
            },
            {
                id: 'laobai',
                name: 'Lão Bạch',
                is_user: false,
                inner_voice: 'Chuyện này tám phần mười không đơn giản như vẻ bề ngoài.',
                long_term_goal: 'Bảo vệ sự an toàn của mọi người trong Đồng Phúc khách sạn',
            },
        ],
    }, {
        userName: 'Hồ Dạ',
        allowUserInnerVoice: false,
    });

    const user = result.people.find(person => person.name === 'Hồ Dạ');
    const npc = result.people.find(person => person.name === 'Lão Bạch');
    assert.equal(user.isUser, true);
    assert.equal(user.innerVoice, '');
    assert.equal(user.longTermGoal, 'Điều tra rõ nguồn gốc của vụ mất tích');
    assert.equal(npc.innerVoice, 'Chuyện này tám phần mười không đơn giản như vẻ bề ngoài.');
    assert.equal(npc.longTermGoal, 'Bảo vệ sự an toàn của mọi người trong Đồng Phúc khách sạn');

    const next = applySimulationResult(result, {
        elapsed_minutes: 0,
        people_upsert: [{ id: 'laobai', name: 'Lão Bạch', long_term_goal: '' }],
    });
    assert.equal(next.people.find(person => person.name === 'Lão Bạch').longTermGoal, 'Bảo vệ sự an toàn của mọi người trong Đồng Phúc khách sạn');
});

test('Ràng buộc nhân vật sẽ đi vào nhắc nhở suy diễn và quan sát, đồng thời suy diễn thông thường không thể tự ý viết lại', () => {
    const anchored = applySimulationResult(createInitialState({ worldName: 'Thất Hiệp Trấn' }), {
        elapsed_minutes: 0,
        people_upsert: [{
            id: 'laobai',
            name: 'Lão Bạch',
            personality_anchor: 'Nhát gan cẩn thận, nhưng khi thấy đồng đội bị thương sẽ chắn ở phía trước.',
            speaking_style: 'Giọng điệu hòa nhã, khi căng thẳng sẽ nói lắp.',
            behavior_boundaries: 'Sẽ không vô duyên vô cớ phản bội khách sạn, cũng sẽ không biết những bí mật hậu trường chưa được kể.',
            action: 'Lau chùi mặt bàn',
            intent: 'Xác nhận cửa sổ và cửa ra vào đã khóa kỹ',
        }],
    });

    const updated = applySimulationResult(anchored, {
        elapsed_minutes: 0,
        people_upsert: [{
            id: 'laobai',
            name: 'Lão Bạch',
            personality_anchor: 'Lạnh lùng vô tình',
            speaking_style: 'Giọng quan liêu',
            behavior_boundaries: 'Không có ranh giới',
            action: 'Kiểm tra cửa sau',
        }],
    });
    const person = updated.people.find(item => item.id === 'laobai');

    assert.equal(person.personalityAnchor, 'Nhát gan cẩn thận, nhưng khi thấy đồng đội bị thương sẽ chắn ở phía trước.');
    assert.equal(person.speakingStyle, 'Giọng điệu hòa nhã, khi căng thẳng sẽ nói lắp.');
    assert.equal(person.behaviorBoundaries, 'Sẽ không vô duyên vô cớ phản bội khách sạn, cũng sẽ không biết những bí mật hậu trường chưa được kể.');

    const simulationPrompt = buildSimulationPrompt(updated);
    const observationPrompt = buildPersonObservationPrompt(updated, person);
    for (const text of [person.personalityAnchor, person.speakingStyle, person.behaviorBoundaries]) {
        assert.equal(simulationPrompt.includes(text), true);
        assert.equal(observationPrompt.includes(text), true);
    }
    assert.match(simulationPrompt, /Không được tại people_upsert viết lại trong/);
});

test('Khi nhân vật chỉ được nhắc đến sẽ không bị đánh dấu là thực tế có mặt trong vòng này', () => {
    const mentioned = applySimulationResult(createInitialState(), {
        elapsed_minutes: 0,
        people_upsert: [{
            id: 'distant-npc',
            name: 'Lính gác phương xa',
            source: 'foreground',
            present_in_scene: false,
            location: 'Cổng bắc',
            action: 'Tuần tra',
            intent: 'Canh giữ cổng thành',
        }],
    }, {
        messageId: 12,
        narrativeText: 'Có người nhắc đến lính gác phương xa, nhưng bản thân anh ta vẫn đang ở cổng bắc.',
    });
    assert.equal(mentioned.people[0].presentInSceneMessageId, -1);

    const present = applySimulationResult(mentioned, {
        elapsed_minutes: 0,
        people_upsert: [{
            id: 'distant-npc',
            name: 'Lính gác phương xa',
            source: 'foreground',
            present_in_scene: true,
            location: 'Đình viện',
            action: 'Đẩy cửa bước vào',
            intent: 'Báo cáo tin nhắn',
        }],
    }, {
        messageId: 13,
        narrativeText: 'Lính canh từ xa đẩy cửa bước vào sân.',
    });
    assert.equal(present.people[0].presentInSceneMessageId, 13);
});

test('Khôi phục bản ghi nhanh tạo ra các nhánh tạo lại không ảnh hưởng lẫn nhau', () => {
    const root = createInitialState({ day: 7, hour: 12, minute: 0 });
    const base = createSnapshot(root, {
        messageId: 10,
        swipeId: 0,
        sourceKey: '10:0:base',
        kind: 'base',
    });

    const firstBranch = advanceWorldClock(restoreSnapshot(base), 90, 'Nội dung chính đầu tiên');
    const secondBranch = advanceWorldClock(restoreSnapshot(base), 15, 'Tạo lại nội dung chính');

    assert.equal(firstBranch.clock.absoluteMinute, root.clock.absoluteMinute + 90);
    assert.equal(secondBranch.clock.absoluteMinute, root.clock.absoluteMinute + 15);
    assert.equal(restoreSnapshot(base).clock.absoluteMinute, root.clock.absoluteMinute);
});

test('Điểm khôi phục trò chuyện giới hạn số lượng và có thể khôi phục trạng thái thế giới lúc lưu', () => {
    let store = {
        schemaVersion: 6,
        currentState: createInitialState({ worldName: 'Thế giới thứ nhất', day: 2, hour: 8 }),
        recoveryPoints: [],
    };
    const savedIds = [];
    for (let index = 0; index < RECOVERY_LIMIT + 1; index += 1) {
        store.currentState.world.title = `Giai đoạn ${index}`;
        store = addRecoveryPoint(store, {
            id: `recovery-${index}`,
            createdAt: `2026-08-01T0${index}:00:00.000Z`,
            reason: 'manual',
            label: `Lưu ${index}`,
        });
        savedIds.push(`recovery-${index}`);
    }

    const points = listRecoveryPoints(store);
    assert.equal(points.length, RECOVERY_LIMIT);
    assert.equal(points[0].id, savedIds[1]);
    assert.equal(points.at(-1).id, savedIds.at(-1));

    store.currentState.world.title = 'Thế giới bị thay đổi sau đó';
    const restored = restoreRecoveryPoint(store, savedIds[2]);
    assert.equal(restored.point.label, 'Lưu 2');
    assert.equal(restored.store.currentState.world.title, 'Giai đoạn 2');
    assert.equal(store.currentState.world.title, 'Thế giới bị thay đổi sau đó');
});

test('Kết quả gián tiếp không được tiếp nối bởi nội dung chính sẽ được lưu trữ sau ba lần hiển thị', () => {
    let state = createInitialState();
    state.events = [normalizeEvent({
        id: 'harbor-rumor',
        title: 'Tin đồn lan truyền ở bến cảng',
        status: 'resolved',
        result: 'Tin đồn đã lan truyền khắp bến tàu.',
        visibility: 'trace',
        delivery_state: 'pending',
    }, state.clock.absoluteMinute)];

    assert.deepEqual(
        selectDeliveryCandidates(state, { deliveryDensity: 'restrained' }).map(event => event.id),
        ['harbor-rumor'],
    );

    state = recordDeliveryOffers(state, ['harbor-rumor'], { messageId: 1 });
    state = recordDeliveryOffers(state, ['harbor-rumor'], { messageId: 2 });
    assert.equal(state.events[0].delivery.state, 'pending');

    state = recordDeliveryOffers(state, ['harbor-rumor'], { messageId: 3 });
    assert.equal(state.events[0].delivery.state, 'expired');
    assert.equal(state.archive.length, 1);
    assert.equal(state.archive[0].eventId, 'harbor-rumor');
});

test('Có thể trích xuất duy nhất từ kết quả trả về có kèm theo mô tả hoặc khối mã JSON Đối tượng', () => {
    assert.deepEqual(
        extractJsonObject('```json\n{"elapsed_minutes":45,"people_upsert":[]}\n```'),
        { elapsed_minutes: 45, people_upsert: [] },
    );
    assert.deepEqual(
        extractJsonObject('Kết toán như sau:{"elapsed_minutes":0,"world":{"title":"Đêm tĩnh lặng"}} Hoàn tất'),
        { elapsed_minutes: 0, world: { title: 'Đêm tĩnh lặng' } },
    );
    assert.deepEqual(
        extractJsonObject('{"elapsed_minutes":8,"world":{"title":"Đêm mưa\n Két sắt",},}'),
        { elapsed_minutes: 8, world: { title: 'Đêm mưa\n Két sắt' } },
    );
    assert.equal(
        extractJsonObject('{"elapsed_minutes":8,"world":{"title":"Bị cắt bớt'),
        null,
    );
    assert.equal(extractJsonObject('Không có nội dung có cấu trúc'), null);
});
