import { INTERNAL_COMPAT_SYSTEM_PROMPT } from './internal-compat.js';

const STRUCTURAL_PROMPT_IDS = new Set([
    'worldInfoBefore',
    'worldInfoAfter',
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'chatExamples',
    'dialogueExamples',
    'chatHistory',
    'enhanceDefinitions',
    'groupNudge',
    'newChat',
    'newGroupChat',
    'newExampleChat',
    'continueNudge',
]);

const STRUCTURAL_IDENTIFIER_PATTERN = /(?:world.?info|char(?:acter)?.?(?:description|personality)|scenario|persona.?description|chat.?(?:history|examples)|dialogue.?examples|group.?nudge|new.?(?:chat|group|example)|continue.?nudge|enhance.?definitions)/i;

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function promptIdentifier(prompt) {
    return cleanText(prompt?.identifier || prompt?.id || prompt?.name);
}

function promptRole(prompt) {
    const role = cleanText(prompt?.role).toLowerCase();
    if (role) return role;
    return prompt?.system_prompt === true ? 'system' : '';
}

function promptContent(prompt) {
    return cleanText(prompt?.content ?? prompt?.prompt ?? prompt?.text);
}

function promptOrderEntries(settings, characterId) {
    const groups = Array.isArray(settings?.prompt_order) ? settings.prompt_order : [];
    if (!groups.length) return [];

    const candidates = [
        characterId,
        Number.isInteger(Number(characterId)) ? Number(characterId) : null,
        100001,
        '100001',
        'default',
    ].filter(value => value !== null && value !== undefined && value !== '');

    let selected = null;
    for (const candidate of candidates) {
        selected = groups.find(group => String(group?.character_id) === String(candidate));
        if (selected) break;
    }
    selected ||= groups.find(group => Array.isArray(group?.order)) || null;
    return Array.isArray(selected?.order) ? selected.order : [];
}

function isStructuralPrompt(prompt) {
    if (prompt?.marker === true) return true;
    const identifier = promptIdentifier(prompt);
    if (STRUCTURAL_PROMPT_IDS.has(identifier)) return true;
    return STRUCTURAL_IDENTIFIER_PATTERN.test(identifier);
}

/**
 * Pulls only active system-role preset prompts that are useful as a shared
 * policy/identity layer. Character data, WI markers, chat history and other
 * structural prompt slots are deliberately skipped so a background request
 * does not accidentally duplicate the whole foreground context.
 */
export function extractPresetBridgePrompt(settings, {
    characterId = null,
    maxChars = 48000,
    substitute = null,
} = {}) {
    const prompts = Array.isArray(settings?.prompts) ? settings.prompts : [];
    if (!prompts.length) {
        return { text: '', promptCount: 0, available: false, truncated: false };
    }

    const order = promptOrderEntries(settings, characterId);
    const orderMap = new Map();
    const enabledMap = new Map();
    order.forEach((entry, index) => {
        const id = cleanText(entry?.identifier || entry?.id || entry?.name);
        if (!id) return;
        orderMap.set(id, index);
        enabledMap.set(id, entry?.enabled !== false);
    });

    const candidates = prompts
        .map((prompt, sourceIndex) => ({ prompt, sourceIndex }))
        .filter(({ prompt }) => promptRole(prompt) === 'system')
        .filter(({ prompt }) => Boolean(promptContent(prompt)))
        .filter(({ prompt }) => !isStructuralPrompt(prompt))
        .filter(({ prompt }) => {
            const id = promptIdentifier(prompt);
            if (enabledMap.has(id)) return enabledMap.get(id);
            return prompt?.enabled !== false;
        })
        .sort((a, b) => {
            const aId = promptIdentifier(a.prompt);
            const bId = promptIdentifier(b.prompt);
            const aOrder = orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER;
            const bOrder = orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder || a.sourceIndex - b.sourceIndex;
        });

    const limit = Math.max(0, Number.parseInt(maxChars, 10) || 0);
    const chunks = [];
    let used = 0;
    let truncated = false;

    for (const { prompt } of candidates) {
        let content = promptContent(prompt);
        if (typeof substitute === 'function') {
            try {
                const resolved = substitute(content);
                if (typeof resolved === 'string' && resolved.trim()) content = resolved.trim();
            } catch {
                // Macro substitution is best-effort. The raw preset text is still
                // more useful than dropping the bridge entirely.
            }
        }
        if (!content) continue;

        const id = promptIdentifier(prompt) || 'system';
        const header = `<preset_prompt id="${id.replaceAll('"', '&quot;')}">\n`;
        const footer = '\n</preset_prompt>';
        const chunk = `${header}${content}${footer}`;
        const separator = chunks.length ? '\n\n' : '';

        if (limit && used + separator.length + chunk.length > limit) {
            truncated = true;
            continue;
        }
        chunks.push(chunk);
        used += separator.length + chunk.length;
    }

    return {
        text: chunks.join('\n\n'),
        promptCount: chunks.length,
        available: candidates.length > 0,
        truncated,
    };
}

export function splitBackstagePrompt(prompt) {
    const text = String(prompt || '').trim();
    if (!text) {
        return {
            systemPrompt: 'Bạn là“Mặt trái thế giới”trình thực thi nhiệm vụ có cấu trúc chạy ngầm. Nghiêm túc thực thi nhiệm vụ vòng này, chỉ xuất ra kết quả có cấu trúc theo yêu cầu của nhiệm vụ.',
            userPrompt: '',
        };
    }

    const lines = text.split(/\r?\n/);
    const firstLine = cleanText(lines[0]);
    const looksLikeRoleDeclaration = /^Bạn là[“"]?Mặt trái thế giới[”"]?của/.test(firstLine)
        && /(Trình suy diễn|Động cơ trạng thái thế giới|Động cơ trạng thái|Người lưu trữ|Trình sắp xếp|Trình quan sát)/.test(firstLine);

    if (!looksLikeRoleDeclaration) {
        return {
            systemPrompt: 'Bạn là“Mặt trái thế giới”trình thực thi nhiệm vụ có cấu trúc chạy ngầm. Nghiêm túc thực thi nhiệm vụ vòng này, không viết tiếp nội dung chính của trò chuyện.',
            userPrompt: text,
        };
    }

    return {
        systemPrompt: firstLine,
        userPrompt: lines.slice(1).join('\n').trim(),
    };
}

export function buildBackstageMessages(prompt, {
    internalCompatSystemPrompt = INTERNAL_COMPAT_SYSTEM_PROMPT,
} = {}) {
    const task = splitBackstagePrompt(prompt);
    const systemParts = [];
    const internalCompat = cleanText(internalCompatSystemPrompt);

    if (internalCompat) {
        systemParts.push([
            '<world_backstage_internal_compat_system>',
            internalCompat,
            '</world_backstage_internal_compat_system>',
        ].join('\n'));
    }
    systemParts.push([
        '<world_backstage_task_system>',
        task.systemPrompt,
        'Lệnh nhiệm vụ chạy ngầm vòng này ưu tiên quyết định định dạng đầu ra và ràng buộc dữ liệu. Không tạo nội dung chính của trò chuyện.',
        '</world_backstage_task_system>',
    ].join('\n'));

    return [
        { role: 'system', content: systemParts.join('\n\n') },
        { role: 'user', content: task.userPrompt },
    ];
}
