const PUBLIC_VISIBILITY = new Set(['known', 'direct']);
const OPINION_VISIBILITY = new Set(['trace', 'known', 'direct']);
const VALID_CONFIDENCE = new Set(['high', 'medium']);
const VALID_CLAIM_STATUS = new Set(['fact', 'mixed', 'rumor']);
const VALID_SOURCE_TYPE = new Set(['official', 'unofficial']);

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asText(value, maximum = 600) {
    return String(value ?? '').trim().slice(0, maximum);
}

function clampInteger(value, fallback = 1, minimum = 0, maximum = 9) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(maximum, Math.max(minimum, numeric));
}

function uniqueStrings(value, maximum = 6) {
    return [...new Set(asArray(value)
        .map(item => asText(item, 60))
        .filter(Boolean))]
        .slice(0, maximum);
}

function uniqueBy(items, keyFor) {
    const seen = new Set();
    return items.filter(item => {
        const key = keyFor(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizeSourceType(value, fallback = 'unofficial') {
    const normalized = asText(value, 20).toLowerCase();
    return VALID_SOURCE_TYPE.has(normalized) ? normalized : fallback;
}

export function emptyPublicOpinionCache({
    generatedAt = '',
    sourceRevision = -1,
    sourceWorldMinute = -1,
    sourceEventSignature = '',
} = {}) {
    return {
        generatedAt: asText(generatedAt, 40),
        sourceRevision: clampInteger(sourceRevision, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceWorldMinute: clampInteger(sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceEventSignature: asText(sourceEventSignature, 240),
        news: [],
        forums: [],
    };
}

export function eligiblePublicOpinionEvents(state) {
    return asArray(state?.events)
        .filter(event => OPINION_VISIBILITY.has(String(event?.visibility || '')))
        .filter(event => String(event?.id || '').trim())
        .sort((a, b) => Number(b?.updatedAt || b?.resolvedAt || 0) - Number(a?.updatedAt || a?.resolvedAt || 0))
        .slice(0, 24)
        .map(event => {
            const visibility = asText(event.visibility, 20);
            if (visibility === 'trace') {
                const place = asText(event.place, 140);
                const explicitTrace = asText(event.publicTrace ?? event.public_trace, 260);
                return {
                    id: asText(event.id, 120),
                    title: 'Dấu hiệu bất thường chưa được xác nhận',
                    place,
                    summary: '',
                    result: '',
                    status: asText(event.status, 30),
                    visibility,
                    public_hint: explicitTrace || `${place ? `${place}Gần đó` : 'Nơi nào đó'}Đã xuất hiện dấu hiệu bất thường có thể bị thế giới bên ngoài nhận biết, nguyên nhân cụ thể vẫn chưa rõ ràng.`,
                };
            }
            return {
                id: asText(event.id, 120),
                title: asText(event.title, 140),
                place: asText(event.place, 140),
                summary: asText(event.summary, 420),
                result: asText(event.result || event.consequence || event.expectedResult, 520),
                status: asText(event.status, 30),
                visibility,
                public_hint: asText(event.publicTrace ?? event.public_trace, 260),
            };
        });
}

export function buildPublicOpinionPrompt(state, { clockLabel = '' } = {}) {
    const events = eligiblePublicOpinionEvents(state);
    const context = {
        world_name: asText(state?.world?.name || 'Thế giới chính', 80),
        world_time: asText(clockLabel, 100),
        public_event_candidates: events,
    };

    return [
        'Bạn là“Mặt trái thế giới”máy quan sát dư luận thế giới của. Bạn chỉ tạo bản ghi nhanh tin tức và diễn đàn chỉ đọc, không sửa đổi trạng thái thế giới, nhận thức nhân vật, sự kiện, ký ức, thời gian hoặc nội dung chính. Sẽ không ghi lại vào nhận thức nhân vật, cũng không kích hoạt thay đổi thế giới mới.',
        'Chỉ có thể dựa vào bên dưới public_event_candidates。Không được sử dụng bất kỳ sự thật hậu trường nào chưa được cung cấp, không được viết sự kiện ẩn, hành động riêng tư hoặc bí mật nhân vật thành tin nhắn công khai.',
        'visibility=trace ứng cử viên không phải là "sự kiện đã công khai", mà chỉ là một chút dấu hiệu bề ngoài mà thế giới bên ngoài có thể nhận biết: chỉ cho phép dựa vào public_hint và place tạo thảo luận diễn đàn không chính thức; không được sử dụng tiêu đề thực sự của sự kiện này, summary/result, nguyên nhân ẩn hoặc thông tin nhân vật hậu trường, cũng không được tạo tin tức. trace diễn đàn tương ứng phải source_type=unofficial, claim_status chỉ có thể là mixed hoặc rumor.',
        'không được hư cấu sự kiện chính sử mới; nhưng chỉ cần public_event_candidates không trống, thì phải chọn ít nhất trong đó 1 mục nội dung có khả năng lan truyền tự nhiên để tạo tin tức hoặc thảo luận diễn đàn. Khi ảnh hưởng nhỏ có thể viết thành thảo luận địa phương, vòng tròn nhỏ, độ hot thấp, không cần gượng ép nâng thành tin tức quan trọng.',
        'Tin tức và diễn đàn là“phương tiện lan truyền”，source_type mới biểu thị cấp độ nguồn tin nhắn:official = Chính thức/Cơ quan/kênh có thẩm quyền,unofficial = chứng kiến, tiết lộ ẩn danh, truyền thông dân gian, diễn đàn, tin vỉa hè. Tin tức chính thức cũng có thể dùng từ ngữ thận trọng, tiết lộ có chọn lọc; tin tức không chính thức cũng có thể tình cờ là sự thật. Cấp độ nguồn không đồng nghĩa với sự thật thế giới.',
        'Tin tức thiên về lan truyền sự thật: chỉ đưa tin nội dung có giá trị lan truyền công cộng; nguyên nhân không thể xác nhận đừng tự ý kết luận. Diễn đàn thiên về phản ứng quần chúng: cho phép suy đoán, hiểu lầm, đùa cợt và tin đồn, nhưng phải thông qua claim_status phân biệt rõ ràng fact / mixed / rumor，và không được viết tin đồn thành sự thật.',
        'Mỗi tin nhắn đưa ra audience_tags：chỉ viết“những loại người nào có thể quan tâm hơn đến tin nhắn này”，ví dụ như cư dân địa phương, người làm trong ngành, thành viên tổ chức nào đó, phóng viên, học sinh, v.v. Nó chỉ là thẻ đối tượng khán giả, không đại diện cho bất kỳ cụ thể nào NPC đã nhìn thấy hoặc tin vào tin nhắn này, cũng không cần đọc toàn bộ Worldbook.',
        'scope Dùng một câu rất ngắn để tóm tắt phạm vi lan truyền, ví dụ“Vòng tròn cư dân địa phương”“Nội bộ ngành”“Công khai toàn thành phố”“Lưu truyền ẩn danh phạm vi nhỏ”。',
        'related_event_id phải đến từ public_event_candidates đã có trong id。không được hư cấu sự kiện mới ID。',
        'tạo tối đa 3 tin tức,4 chủ đề diễn đàn; mỗi chủ đề diễn đàn tối đa 4 phản hồi đại diện.news / forums không cần gom đủ riêng biệt, nhưng tổng cộng cả hai ít nhất phải có 1  nội dung hợp lệ, và related_event_id phải đến từ ứng viên.',
        'chỉ xuất ra JSON，không được Markdown，Không dùng khối mã, không giải thích.',
        JSON.stringify({
            output_schema: {
                news: [{
                    category: 'Thành phố / Xã hội / Thương mại / Thông báo / Khác',
                    headline: 'Tiêu đề',
                    summary: 'báo cáo ngắn gọn,1-3 câu',
                    source: 'Tên phương tiện truyền thông, cơ quan, tổ chức hoặc nguồn thông tin công khai, có thể là tên gọi chung',
                    source_type: 'official | unofficial',
                    audience_tags: ['nhóm người có thể quan tâm,1-5 cái'],
                    scope: 'Phạm vi lan truyền, câu ngắn',
                    related_event_id: 'phải đến từ đầu vào',
                    confidence: 'high | medium',
                    heat: '1-3',
                }],
                forums: [{
                    board: 'Tên chuyên mục',
                    title: 'Tiêu đề bài đăng',
                    summary: 'Chủ thớt hoặc tóm tắt chủ đề',
                    source_type: 'official | unofficial（Diễn đàn thường là unofficial，Khi tài khoản chính thức đăng tải có thể là official）',
                    audience_tags: ['nhóm người có thể quan tâm,1-5 cái'],
                    scope: 'Phạm vi lan truyền, câu ngắn',
                    related_event_id: 'phải đến từ đầu vào',
                    claim_status: 'fact | mixed | rumor',
                    heat: '1-5',
                    replies: [{ author: 'Biệt danh ẩn danh', text: 'Phản hồi tiêu biểu' }],
                }],
            },
            context,
        }, null, 2),
    ].join('\n\n');
}

export function normalizePublicOpinionPayload(payload, {
    validEventIds = [],
    eventVisibilityById = {},
    sourceRevision = -1,
    sourceWorldMinute = -1,
    sourceEventSignature = '',
    generatedAt = new Date().toISOString(),
} = {}) {
    const allowedIds = new Set(asArray(validEventIds).map(item => String(item || '')).filter(Boolean));
    const visibilityFor = id => String(eventVisibilityById?.[id] || '');
    const news = uniqueBy(
        asArray(payload?.news).map((item, index) => {
            const relatedEventId = asText(item?.related_event_id ?? item?.relatedEventId, 120);
            if (!allowedIds.has(relatedEventId)) return null;
            if (visibilityFor(relatedEventId) === 'trace') return null;
            const headline = asText(item?.headline ?? item?.title, 160);
            const summary = asText(item?.summary, 700);
            if (!headline || !summary) return null;
            const confidenceRaw = asText(item?.confidence, 20).toLowerCase();
            return {
                id: `news_${index}_${relatedEventId}`,
                category: asText(item?.category, 40) || 'Tin tức thế giới',
                headline,
                summary,
                source: asText(item?.source, 100) || 'Thông tin công khai',
                sourceType: normalizeSourceType(item?.source_type ?? item?.sourceType, 'official'),
                audienceTags: uniqueStrings(item?.audience_tags ?? item?.audienceTags, 5),
                scope: asText(item?.scope, 80),
                relatedEventId,
                confidence: VALID_CONFIDENCE.has(confidenceRaw) ? confidenceRaw : 'medium',
                heat: clampInteger(item?.heat, 1, 1, 3),
            };
        }).filter(Boolean).slice(0, 3),
        item => `${item.relatedEventId}\u0000${item.headline}`,
    );

    const forums = uniqueBy(
        asArray(payload?.forums).map((item, index) => {
            const relatedEventId = asText(item?.related_event_id ?? item?.relatedEventId, 120);
            if (!allowedIds.has(relatedEventId)) return null;
            const eventVisibility = visibilityFor(relatedEventId);
            const title = asText(item?.title, 180);
            const summary = asText(item?.summary, 700);
            if (!title || !summary) return null;
            const claimRaw = asText(item?.claim_status ?? item?.claimStatus, 20).toLowerCase();
            const replies = asArray(item?.replies).map((reply, replyIndex) => {
                const text = asText(reply?.text ?? reply?.content, 360);
                if (!text) return null;
                return {
                    id: `reply_${index}_${replyIndex}`,
                    author: asText(reply?.author ?? reply?.name, 60) || `Ẩn danh${replyIndex + 1}`,
                    text,
                };
            }).filter(Boolean).slice(0, 4);
            return {
                id: `forum_${index}_${relatedEventId}`,
                board: asText(item?.board, 60) || 'Trò chuyện phiếm',
                title,
                summary,
                sourceType: eventVisibility === 'trace'
                    ? 'unofficial'
                    : normalizeSourceType(item?.source_type ?? item?.sourceType, 'unofficial'),
                audienceTags: uniqueStrings(item?.audience_tags ?? item?.audienceTags, 5),
                scope: asText(item?.scope, 80),
                relatedEventId,
                claimStatus: eventVisibility === 'trace'
                    ? (claimRaw === 'rumor' ? 'rumor' : 'mixed')
                    : (VALID_CLAIM_STATUS.has(claimRaw) ? claimRaw : 'mixed'),
                heat: clampInteger(item?.heat, 1, 1, 5),
                replies,
            };
        }).filter(Boolean).slice(0, 4),
        item => `${item.relatedEventId}\u0000${item.title}`,
    );

    return {
        generatedAt: asText(generatedAt, 40),
        sourceRevision: clampInteger(sourceRevision, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceWorldMinute: clampInteger(sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceEventSignature: asText(sourceEventSignature, 240),
        news,
        forums,
    };
}

export function normalizePublicOpinionCache(raw) {
    const sourceRevision = clampInteger(raw?.sourceRevision, -1, -1, Number.MAX_SAFE_INTEGER);
    const sourceWorldMinute = clampInteger(raw?.sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER);
    const validEventIds = [
        ...asArray(raw?.news).map(item => item?.relatedEventId),
        ...asArray(raw?.forums).map(item => item?.relatedEventId),
    ].filter(Boolean);
    return normalizePublicOpinionPayload(raw, {
        validEventIds,
        sourceRevision,
        sourceWorldMinute,
        sourceEventSignature: raw?.sourceEventSignature || '',
        generatedAt: raw?.generatedAt || '',
    });
}


export function emptyPublicOpinionSandbox({ generatedAt = '' } = {}) {
    return {
        generatedAt: asText(generatedAt, 40),
        nonCanon: true,
        news: [],
        forums: [],
    };
}

export function buildPublicOpinionSandboxPrompt(state, { clockLabel = '' } = {}) {
    const context = {
        world_name: asText(state?.world?.name || 'Thế giới chính', 80),
        world_time: asText(clockLabel, 100),
        world_flavor: asText(state?.world?.detail || state?.world?.title || '', 700),
    };
    return [
        'Bạn là“Mặt trái thế giới” của trình tạo dư luận dạo chơi. Đây là hộp cát giải trí thuần túy: có thể tạo ra tin tức hàng ngày, bài đăng rác trên diễn đàn, quảng cáo nhỏ, tin đồn thành phố, bài đăng hot kỳ lạ và mảnh ghép cuộc sống hoàn toàn không liên quan đến tuyến truyện chính, sự kiện hiện tại.',
        'Tất cả nội dung đều phải được đánh dấu là non-canon  bản ghi nhanh giải trí: chúng không phải là sự thật thế giới, không ghi vào sự kiện, ký ức, nhận thức nhân vật, nhân quả nội dung chính, cũng không được ám chỉ những gì đã xảy ra trong tuyến truyện chính thực sự.',
        'Có thể tham khảo world_name / world_time / world_flavor Giữ nguyên khí chất thế giới, nhưng không được dùng trộm hoặc viết tiếp tuyến truyện chính hiện tại, bí mật ẩn giấu, chuyện riêng tư của nhân vật. Cố gắng viết về cuộc sống xã hội bình thường, để thế giới này trông như có người đang sinh sống.',
        'Nội dung có thể nhẹ nhàng, hài hước, vụn vặt, thà giống như đang dạo chơi trong cộng đồng thật, còn hơn là mỗi mục đều tạo ra sự kiện lớn.',
        'Vui lòng nhất thiết phải tạo nội dung có thể dạo chơi: ít nhất 1  tin tức nhẹ và 2  chủ đề diễn đàn, tối đa 2  tin tức nhẹ, 4  chủ đề diễn đàn; mỗi diễn đàn tối đa 4  phản hồi tiêu biểu. Chỉ xuất ra JSON。',
        JSON.stringify({
            output_schema: {
                news: [{ category: 'Cuộc sống / Địa phương / Chuyện thú vị / Thương mại / Khác', headline: '', summary: '', source: '', heat: 1 }],
                forums: [{ board: 'Trò chuyện phiếm', title: '', summary: '', heat: 1, replies: [{ author: '', text: '' }] }],
            },
            context,
        }, null, 2),
    ].join('\n\n');
}

export function normalizePublicOpinionSandboxPayload(payload, { generatedAt = new Date().toISOString() } = {}) {
    const news = uniqueBy(
        asArray(payload?.news).map((item, index) => {
            const headline = asText(item?.headline ?? item?.title, 160);
            const summary = asText(item?.summary, 700);
            if (!headline || !summary) return null;
            return {
                id: `sandbox_news_${index}`,
                category: asText(item?.category, 40) || 'Tin tức dạo chơi',
                headline,
                summary,
                source: asText(item?.source, 100) || 'Thông tin công khai bình thường trong thế giới',
                sourceType: 'unofficial',
                audienceTags: [],
                scope: 'Hộp cát giải trí',
                relatedEventId: '',
                confidence: 'medium',
                heat: clampInteger(item?.heat, 1, 1, 3),
                nonCanon: true,
            };
        }).filter(Boolean).slice(0, 2),
        item => item.headline,
    );
    const forums = uniqueBy(
        asArray(payload?.forums).map((item, index) => {
            const title = asText(item?.title, 180);
            const summary = asText(item?.summary, 700);
            if (!title || !summary) return null;
            const replies = asArray(item?.replies).map((reply, replyIndex) => {
                const text = asText(reply?.text ?? reply?.content, 360);
                if (!text) return null;
                return { id: `sandbox_reply_${index}_${replyIndex}`, author: asText(reply?.author ?? reply?.name, 60) || `Ẩn danh${replyIndex + 1}`, text };
            }).filter(Boolean).slice(0, 4);
            return {
                id: `sandbox_forum_${index}`,
                board: asText(item?.board, 60) || 'Trò chuyện phiếm',
                title,
                summary,
                sourceType: 'unofficial',
                audienceTags: [],
                scope: 'Hộp cát giải trí',
                relatedEventId: '',
                claimStatus: 'rumor',
                heat: clampInteger(item?.heat, 1, 1, 5),
                replies,
                nonCanon: true,
            };
        }).filter(Boolean).slice(0, 4),
        item => item.title,
    );
    return { generatedAt: asText(generatedAt, 40), nonCanon: true, news, forums };
}

export function normalizePublicOpinionSandbox(raw) {
    return normalizePublicOpinionSandboxPayload(raw || {}, { generatedAt: raw?.generatedAt || '' });
}
