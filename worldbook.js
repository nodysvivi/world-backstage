const PROFILE_LABELS = Object.freeze({
    name: ['Tên tiếng Trung', 'Họ tên', 'Tên', 'Tên nhân vật', 'chinese name', 'full name', 'name'],
    nickname: ['Biệt danh', 'Tên khác', 'Tên gọi khác', 'Danh xưng', 'nickname', 'alias', 'aliases'],
    gender: ['Giới tính', 'gender', 'sex'],
    age: ['Tuổi tác', 'age'],
    birthday: ['Sinh nhật', 'birthday', 'birth date'],
    species: ['Chủng tộc', 'Loài', 'race', 'species'],
    identity: ['Thân phận', 'Nghề nghiệp', 'Chức vụ', 'Chức vụ', 'occupation', 'profession', 'identity', 'role'],
    personality: ['Tính cách', 'Nhân cách', 'Cá tính', 'Tính tình', 'personality', 'temperament', 'character'],
    values: ['Giá trị quan', 'Nguyên tắc', 'Thói quen', 'Sở thích', 'Thiên hướng', 'values', 'habit', 'habits', 'likes', 'preferences'],
    mbti: ['mbti'],
    appearance: ['Ngoại hình', 'Vẻ ngoài', 'Tướng mạo', 'Thể mạo', 'appearance', 'looks'],
    height: ['Chiều cao', 'height'],
    body: ['Thể hình', 'Vóc dáng', 'Đặc điểm cơ thể', 'body', 'build'],
    clothing: ['Ăn mặc', 'Trang phục', 'Trang phục', 'clothing', 'outfit'],
    background: ['Bối cảnh', 'Trải nghiệm', 'Lý lịch', 'Quá khứ', 'Tiểu sử', 'background story', 'background', 'history', 'backstory'],
    relations: ['Mối quan hệ', 'Mối quan hệ xã hội', 'Gia đình', 'Người nhà', 'Người thân', 'relationships', 'relations', 'family'],
    speech: ['Cách nói chuyện', 'Thói quen nói chuyện', 'Phong cách ngôn ngữ', 'Câu cửa miệng', 'Giọng điệu', 'speech style', 'speaking style', 'speech', 'voice'],
    behavior: ['Thói quen hành vi', 'Ranh giới hành vi', 'Giới hạn cuối', 'Cấm kỵ', 'Bãi mìn', 'behavior boundaries', 'behavior', 'boundaries', 'taboo'],
});

const PROFILE_LOOKUP = new Map(
    Object.entries(PROFILE_LABELS)
        .flatMap(([field, labels]) => labels.map(label => [label.toLocaleLowerCase(), field])),
);

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PROFILE_MARKER = new RegExp(
    `(${[...PROFILE_LOOKUP.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|')})\\s*(?:[（(][^）)\\n]{0,40}[）)])?\\s*[:：]`,
    'giu',
);

function compactValue(value, maximum = 900) {
    return String(value || '')
        .replace(/^[\s\-–—•·|]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum);
}

function readableText(value) {
    return String(value || '')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/(?:p|div|li|section|character|info|profile)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
}

function joinFields(parts, maximum) {
    return parts
        .map(part => compactValue(part, maximum))
        .filter(Boolean)
        .join('；')
        .slice(0, maximum);
}

export function extractWorldbookCharacterProfile(content, fallbackName = '') {
    const raw = String(content || '').trim().slice(0, 4000);
    const readable = readableText(raw);
    const matches = [...readable.matchAll(PROFILE_MARKER)];
    const values = {};

    for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        const label = String(match[1] || '').toLocaleLowerCase();
        const field = PROFILE_LOOKUP.get(label);
        if (!field) continue;
        const start = Number(match.index || 0) + match[0].length;
        const end = index + 1 < matches.length
            ? Number(matches[index + 1].index || readable.length)
            : readable.length;
        const value = compactValue(readable.slice(start, end), field === 'background' ? 1400 : 900);
        if (!value) continue;
        values[field] = values[field] ? `${values[field]}；${value}` : value;
    }

    const explicitName = compactValue(values.name, 80)
        .replace(/^[-—–·•]+/, '')
        .slice(0, 80);
    const name = explicitName || String(fallbackName || '').trim().slice(0, 80);
    const identityAnchor = joinFields([
        values.nickname ? `Biệt danh/Biệt danh:${values.nickname}` : '',
        values.gender ? `Giới tính:${values.gender}` : '',
        values.age ? `Tuổi tác:${values.age}` : '',
        values.birthday ? `Sinh nhật:${values.birthday}` : '',
        values.species ? `Chủng tộc/Loài:${values.species}` : '',
        values.identity ? `Thân phận/Nghề nghiệp:${values.identity}` : '',
    ], 500);
    const personalityAnchor = joinFields([
        values.personality,
        values.values ? `Giá trị quan/Thói quen:${values.values}` : '',
        values.mbti ? `MBTI：${values.mbti}` : '',
    ], 600);
    const appearanceProfile = joinFields([
        values.height ? `Chiều cao:${values.height}` : '',
        values.body ? `Thể hình/Đặc điểm cơ thể:${values.body}` : '',
        values.appearance,
        values.clothing ? `Trang phục:${values.clothing}` : '',
    ], 700);
    const backgroundProfile = joinFields([
        values.background,
        values.relations ? `Mối quan hệ/Gia đình:${values.relations}` : '',
    ], 900);

    return {
        name,
        explicitName: Boolean(explicitName),
        identityAnchor,
        personalityAnchor,
        appearanceProfile,
        backgroundProfile,
        speakingStyle: compactValue(values.speech, 360),
        behaviorBoundaries: compactValue(values.behavior, 500),
        worldbookRaw: raw,
        matchedFields: Object.keys(values),
    };
}

export function detectWorldbookCharacter(entry, profile = extractWorldbookCharacterProfile(entry?.content, entry?.name)) {
    const title = `${entry?.name || ''} ${(entry?.keys || []).join(' ')}`.toLocaleLowerCase();
    const content = String(entry?.content || '');
    let score = 0;
    const signals = [];

    if (/<\s*character\b/i.test(content) || /<\s*(?:char|npc|person)\b/i.test(content)) {
        score += 3;
        signals.push('Thẻ cấu trúc nhân vật');
    }
    if (profile.explicitName) {
        score += 3;
        signals.push('Họ tên rõ ràng');
    }
    const strongFields = ['personality', 'appearance', 'background', 'speech', 'gender', 'age', 'identity'];
    const matchedStrong = strongFields.filter(field => profile.matchedFields.includes(field));
    score += Math.min(5, matchedStrong.length);
    if (matchedStrong.length >= 2) signals.push(`Trường dữ liệu nhân vật ${matchedStrong.length} Mục`);
    if (/(?:Nhân vật|Nhân vật|npc|character|char(?:acter)?\s*card)/iu.test(title)) {
        score += 2;
        signals.push('Tên mục/Từ khóa giống nhân vật');
    }
    if (/(?:Thế giới quan|Thiết lập thế giới|Quy tắc|Hệ thống|Hướng dẫn|Mô tả|Mẫu|Định dạng|Địa điểm|Thành phố|Quốc gia|Tổng quan thế lực|Dòng thời gian|Từ điển|Bách khoa toàn thư|Tóm tắt cốt truyện)/iu.test(title)) {
        score -= 4;
        signals.push('Tên mục giống thiết lập hơn');
    }
    if (profile.matchedFields.length >= 4) score += 2;

    return {
        likelyPerson: score >= 5,
        characterScore: score,
        characterSignals: signals.slice(0, 4),
    };
}

export function filterWorldbookEntries(entries, {
    query = '',
    onlyPeople = false,
    onlyEnabled = false,
} = {}) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return (Array.isArray(entries) ? entries : []).filter(entry => {
        if (onlyPeople && !entry?.likelyPerson) return false;
        if (onlyEnabled && entry?.disabled) return false;
        if (!needle) return true;
        const haystack = [
            entry?.name,
            entry?.parsedName,
            ...(Array.isArray(entry?.keys) ? entry.keys : []),
            ...(Array.isArray(entry?.tags) ? entry.tags : []),
            ...(Array.isArray(entry?.formatHints) ? entry.formatHints : []),
            entry?.content,
        ].map(value => String(value || '').toLocaleLowerCase()).join('\n');
        return haystack.includes(needle);
    });
}
