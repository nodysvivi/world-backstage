import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applySimulationResult,
    createInitialState,
    hasExplicitTimeEvidence,
    trimState,
} from '../core.js';

test('ambiguous Chinese wording does not count as explicit elapsed time', () => {
    assert.equal(hasExplicitTimeEvidence('洞内十分安静，只能听见水滴声。'), false);
});

test('cautious time policy caps unsupported elapsed time', () => {
    const base = createInitialState({ day: 1, hour: 8, minute: 0 });
    const result = applySimulationResult(
        base,
        { elapsed_minutes: 480 },
        { timePolicy: 'cautious', narrativeText: '许久以后，雨声仍未停。' },
    );

    assert.equal(result.clock.absoluteMinute, base.clock.absoluteMinute + 180);
});

test('legacy people records receive new defaults during migration', () => {
    const oldState = createInitialState();
    oldState.people = [
        {
            id: 'old-person',
            name: 'Nhân vật cũ',
            location: 'Địa điểm cũ',
            status: 'Chờ đợi',
            intent: 'Tiếp tục quan sát',
            lastSeen: 'Vừa mới',
            innerVoice: 'Đợi chút đã.',
        },
    ];

    const migrated = trimState(oldState);
    assert.equal(migrated.people[0].longTermGoal, '');
    assert.equal(migrated.people[0].personalityAnchor, '');
    assert.equal(migrated.people[0].speakingStyle, '');
    assert.equal(migrated.people[0].behaviorBoundaries, '');
    assert.equal(migrated.people[0].isUser, false);
});
