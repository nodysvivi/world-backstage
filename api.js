function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

let lastCustomApiOperation = null;
let customApiOperationSequence = 0;

function beginCustomApiOperation({
    operation = 'request',
    route = '',
    model = '',
    transport = '',
} = {}) {
    const id = ++customApiOperationSequence;
    lastCustomApiOperation = {
        id,
        phase: 'running',
        operation,
        source: 'custom-independent',
        route: cleanText(route),
        model: cleanText(model),
        transport: cleanText(transport),
        transportStatus: null,
        upstreamStatus: null,
        errorType: 'none',
        errorSummary: '',
        attemptedAt: new Date().toISOString(),
        succeededAt: '',
        failedAt: '',
    };
    return id;
}

function finishCustomApiOperation(id, patch = {}) {
    if (!lastCustomApiOperation || lastCustomApiOperation.id !== id) return;
    lastCustomApiOperation = {
        ...lastCustomApiOperation,
        ...patch,
    };
}

export function getLastCustomApiOperation() {
    return lastCustomApiOperation ? { ...lastCustomApiOperation } : null;
}

export function resetLastCustomApiOperation() {
    lastCustomApiOperation = null;
}


export async function runWithRetries(operation, {
    retries = 0,
    delayMs = 750,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    onRetry = null,
    shouldRetry = () => true,
    signal = null,
} = {}) {
    const maximumRetries = Math.min(5, Math.max(0, Number.parseInt(retries, 10) || 0));
    let attempt = 0;
    while (true) {
        try {
            if (signal?.aborted) throw cancellationError();
            return await operation(attempt);
        } catch (error) {
            if (signal?.aborted || isAbortError(error)) throw cancellationError();
            if (attempt >= maximumRetries || !shouldRetry(error, attempt)) throw error;
            attempt += 1;
            const milliseconds = Math.min(
                5000,
                Math.max(0, Number(delayMs) || 0) * (2 ** (attempt - 1)),
            );
            await onRetry?.({
                attempt,
                total: maximumRetries,
                delayMs: milliseconds,
                error,
            });
            if (milliseconds > 0) await waitForRetry(wait, milliseconds, signal);
        }
    }
}

function cancellationError() {
    const error = new Error('Suy diễn đã bị người dùng hủy');
    error.name = 'AbortError';
    return error;
}

export function isAbortError(error) {
    return error?.name === 'AbortError'
        || /aborted|aborterror|Đã bị người dùng hủy|Người dùng hủy/i.test(String(error?.message || error || ''));
}

async function waitForRetry(wait, milliseconds, signal) {
    if (!signal) {
        await wait(milliseconds);
        return;
    }
    if (signal.aborted) throw cancellationError();
    let abort;
    try {
        await Promise.race([
            wait(milliseconds),
            new Promise((_, reject) => {
                abort = () => reject(cancellationError());
                signal.addEventListener('abort', abort, { once: true });
            }),
        ]);
    } finally {
        if (abort) signal.removeEventListener('abort', abort);
    }
}

export function normalizeCustomApiUrl(value) {
    const url = cleanText(value).replace(/\/+$/, '');
    if (!url) return '';
    if (/\/chat\/completions$/i.test(url)) return url;
    return `${url}/chat/completions`;
}

export function customProxyBase(value) {
    return normalizeCustomApiUrl(value).replace(/\/chat\/completions$/i, '');
}

export function normalizeCustomModelsUrl(value) {
    const base = customProxyBase(value).replace(/\/+$/, '');
    return base ? `${base}/models` : '';
}

function contentText(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return contentText(value.text ?? value.value ?? value.content ?? '');
    }
    if (!Array.isArray(value)) return '';
    return value
        .map(part => (
            typeof part === 'string'
                ? part
                : contentText(part?.text ?? part?.value ?? part?.content ?? '')
        ))
        .filter(Boolean)
        .join('');
}

function responsesApiText(payload) {
    if (!Array.isArray(payload?.output)) return '';
    return payload.output
        .map(item => contentText(item?.content ?? item?.text ?? ''))
        .filter(Boolean)
        .join('');
}

function isDeepSeekV4Model(model) {
    return /(?:^|[\/_-])deepseek[-_]?v?4(?:[\/_-]|$)/i.test(String(model || ''));
}

export function extractCompletionText(payload) {
    const choice = payload?.choices?.[0];
    return cleanText(
        contentText(choice?.message?.content)
        || contentText(choice?.message?.output_text)
        || choice?.text
        || payload?.output_text
        || responsesApiText(payload)
        || contentText(payload?.content)
        || payload?.response,
    );
}

export function extractCompletionFinishReason(payload) {
    return cleanText(
        payload?.choices?.[0]?.finish_reason
        || payload?.choices?.[0]?.finishReason
        || payload?.finish_reason
        || payload?.finishReason,
    );
}

async function readResponse(response) {
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            if (response.ok) {
                throw new Error(`Giao diện trả về không phải là JSON：${text.slice(0, 180)}`);
            }
        }
    }
    return { text, data };
}

function errorDetail(data, text) {
    const error = data?.error;
    return cleanText(
        error?.message
        || error?.detail
        || error?.code
        || data?.message
        || (typeof error === 'string' ? error : '')
        || text,
    ).slice(0, 360);
}

function classifyUpstreamError(response, data, detail = '') {
    const text = [
        detail,
        data?.error?.code,
        data?.error?.type,
        data?.code,
        data?.type,
    ].filter(Boolean).join(' ').toLocaleLowerCase();

    if (
        /insufficient[_\s-]*quota|quota\s*(?:exceeded|exhausted|depleted)|credits?\s*(?:exhausted|depleted)|Hạn mức(?:Không đủ|Cạn kiệt)|Số dư không đủ/.test(text)
    ) {
        return { errorType: 'quota-exhausted', upstreamStatus: response?.status === 429 ? 429 : null };
    }
    if (
        Number(response?.status) === 429
        || /too many requests|rate[_\s-]*limit(?:ed|_exceeded)?|Yêu cầu quá thường xuyên|Giới hạn luồng|Giới hạn tần suất/.test(text)
    ) {
        return { errorType: 'rate-limit', upstreamStatus: 429 };
    }
    return { errorType: 'other', upstreamStatus: null };
}

function buildCustomApiResponseError(response, data, text, subject = 'Độc lập API') {
    const detail = errorDetail(data, text);
    const classified = classifyUpstreamError(response, data, detail);
    let message;
    if (classified.errorType === 'rate-limit') {
        message = `${subject} Bị giới hạn luồng từ thượng nguồn:${detail || 'Too Many Requests'}（429 Lỗi loại`;
        if (Number(response?.status) === 200) message += '；Lớp chuyển tiếp Tavern HTTP 200';
        message += '）。Thử lại sau, hoặc kiểm tra giao diện này/Giới hạn tần suất của mô hình.';
    } else if (classified.errorType === 'quota-exhausted') {
        message = `${subject} Hạn mức đã cạn kiệt:${detail || 'quota exhausted'}`;
        if (Number(response?.status) === 200) message += '（Lớp chuyển tiếp Tavern HTTP 200）';
        message += '。Vui lòng kiểm tra giao diện này/Hạn mức hoặc số dư của mô hình.';
    } else {
        message = `${subject} Trả về HTTP ${response?.status}${detail ? `：${detail}` : ''}`;
    }
    const error = new Error(message);
    error.errorType = classified.errorType;
    error.transportStatus = Number(response?.status) || null;
    error.upstreamStatus = classified.upstreamStatus;
    error.upstreamMessage = detail;
    if (classified.errorType === 'rate-limit') error.code = 'RATE_LIMIT';
    if (classified.errorType === 'quota-exhausted') error.code = 'QUOTA_EXHAUSTED';
    return error;
}

function headersFrom(getRequestHeaders) {
    const headers = typeof getRequestHeaders === 'function'
        ? { ...(getRequestHeaders() || {}) }
        : {};
    if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

function timeoutError(timeoutMs) {
    return new Error(`Độc lập API Yêu cầu hết thời gian (${Math.ceil(timeoutMs / 1000)} giây)`);
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, externalSignal) {
    if (!(timeoutMs > 0)) {
        return fetchImpl(url, { ...options, signal: externalSignal || undefined });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();

    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', abort, { once: true });
    }

    try {
        return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (timedOut) throw timeoutError(timeoutMs);
        throw error;
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener?.('abort', abort);
    }
}

function modelIdsFrom(payload) {
    const candidates = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.models)
                ? payload.models
                : Array.isArray(payload?.model_names)
                    ? payload.model_names
                    : [];
    return [...new Set(candidates
        .map(item => cleanText(
            typeof item === 'string' ? item : item?.id || item?.name || item?.model,
        ))
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

export async function requestCustomModels(settings, {
    fetchImpl = globalThis.fetch,
    getRequestHeaders = null,
    timeoutMs = null,
    signal = null,
    routeLabel = '',
} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Môi trường hiện tại không hỗ trợ yêu cầu mạng');
    const modelsUrl = normalizeCustomModelsUrl(settings?.customApiUrl);
    const apiKey = cleanText(settings?.customApiKey);
    const transport = settings?.customApiTransport === 'direct' ? 'direct' : 'proxy';
    const requestTimeout = Number(timeoutMs ?? settings?.customApiTimeoutMs ?? 120000);
    if (!modelsUrl) throw new Error('Vui lòng điền độc lập trước API Địa chỉ');
    if (!apiKey) throw new Error('Vui lòng điền độc lập trước API Key');

    let target = modelsUrl;
    let options = {
        method: 'GET',
        cache: 'no-cache',
        headers: { Authorization: `Bearer ${apiKey}` },
    };
    if (transport === 'proxy') {
        target = '/api/backends/chat-completions/status';
        options = {
            method: 'POST',
            cache: 'no-cache',
            headers: headersFrom(getRequestHeaders),
            body: JSON.stringify({
                chat_completion_source: 'openai',
                reverse_proxy: customProxyBase(settings.customApiUrl),
                proxy_password: apiKey,
            }),
        };
    }

    const operationId = beginCustomApiOperation({
        operation: 'model-list',
        route: routeLabel,
        model: cleanText(settings?.customApiModel),
        transport,
    });
    try {
        const response = await fetchWithTimeout(fetchImpl, target, options, requestTimeout, signal);
        const { text, data } = await readResponse(response);
        if (!response.ok || data?.error) {
            throw buildCustomApiResponseError(response, data, text, 'Yêu cầu danh sách mô hình');
        }
        const models = modelIdsFrom(data);
        if (!models.length) {
            throw new Error('Kết nối giao diện thành công, nhưng không trả về danh sách mô hình có thể nhận dạng; vẫn có thể điền tên mô hình thủ công');
        }
        finishCustomApiOperation(operationId, {
            phase: 'success',
            transportStatus: Number(response.status) || null,
            succeededAt: new Date().toISOString(),
        });
        return models;
    } catch (error) {
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error?.transportStatus ?? null,
            upstreamStatus: error?.upstreamStatus ?? null,
            errorType: error?.errorType || 'other',
            errorSummary: cleanText(error?.message || error).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
}

export async function requestCustomCompletion(settings, messages, {
    fetchImpl = globalThis.fetch,
    getRequestHeaders = null,
    maxTokens = 2200,
    temperature = 0.2,
    timeoutMs = null,
    signal = null,
    rejectTruncated = false,
    operation = 'completion',
    routeLabel = '',
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Môi trường hiện tại không hỗ trợ yêu cầu mạng');
    }

    const apiUrl = normalizeCustomApiUrl(settings?.customApiUrl);
    const model = cleanText(settings?.customApiModel);
    const apiKey = cleanText(settings?.customApiKey);
    const transport = settings?.customApiTransport === 'direct' ? 'direct' : 'proxy';
    const requestTimeout = Number(timeoutMs ?? settings?.customApiTimeoutMs ?? 120000);

    if (!apiUrl) throw new Error('Vui lòng điền độc lập trước API Địa chỉ');
    if (!model) throw new Error('Vui lòng điền độc lập trước API Tên mô hình');
    if (!apiKey) throw new Error('Vui lòng điền độc lập trước API Key');

    const body = {
        model,
        messages: Array.isArray(messages) ? messages : [],
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
        max_tokens: Math.max(64, Number.parseInt(maxTokens, 10) || 2200),
        stream: false,
    };
    const useDeepSeekV4Compatibility = isDeepSeekV4Model(model);
    if (useDeepSeekV4Compatibility) {
        // DeepSeek V4 defaults to thinking mode. Structured background work does
        // not need hidden reasoning, and it can otherwise consume the completion
        // budget before message.content is produced.
        body.thinking = { type: 'disabled' };
    }

    let target = apiUrl;
    let headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
    };
    let payload = body;

    if (transport === 'proxy') {
        target = '/api/backends/chat-completions/generate';
        headers = headersFrom(getRequestHeaders);
        payload = {
            chat_completion_source: useDeepSeekV4Compatibility ? 'deepseek' : 'openai',
            reverse_proxy: customProxyBase(settings.customApiUrl),
            proxy_password: apiKey,
            include_reasoning: false,
            ...body,
        };
        if (useDeepSeekV4Compatibility) {
            // The tavern's DeepSeek dispatcher rebuilds the upstream body from a
            // whitelist and only emits `thinking` when reasoning_effort is present,
            // so body.thinking alone is dropped on this path and V4 keeps thinking
            // on until it burns the whole completion budget before writing content.
            payload.reasoning_effort = 'none';
        }
    }

    const operationId = beginCustomApiOperation({
        operation,
        route: routeLabel,
        model,
        transport,
    });

    let response;
    try {
        response = await fetchWithTimeout(fetchImpl, target, {
            method: 'POST',
            cache: 'no-cache',
            headers,
            body: JSON.stringify(payload),
        }, requestTimeout, signal);
    } catch (error) {
        let nextError = error;
        if (transport === 'direct' && /fetch|network|cors/i.test(String(error?.message || error))) {
            nextError = new Error('Kết nối trực tiếp giao diện qua trình duyệt thất bại, có thể do giới hạn cross-domain; vui lòng chuyển sang dùng“Chuyển tiếp qua Tavern”');
        }
        finishCustomApiOperation(operationId, {
            phase: 'error',
            errorType: nextError?.errorType || 'network',
            errorSummary: cleanText(nextError?.message || nextError).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw nextError;
    }

    let text;
    let data;
    try {
        ({ text, data } = await readResponse(response));
    } catch (error) {
        error.errorType ||= 'invalid-json';
        error.transportStatus ??= Number(response.status) || null;
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error.transportStatus,
            upstreamStatus: null,
            errorType: error.errorType,
            errorSummary: cleanText(error.message || error).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
    if (!response.ok || data?.error) {
        const detail = errorDetail(data, text);
        let error;
        if (/no message generated|empty (?:message|response)|no content/i.test(detail)) {
            error = new Error(
                'Độc lập API Không trả về nội dung chính cuối cùng (No message generated）。'
                + (useDeepSeekV4Compatibility
                    ? 'Plugin đã yêu cầu đóng DS4 suy nghĩ; nếu vẫn trống, thường là do trạm trung chuyển không chuyển tiếp tham số này hoặc hạn mức đầu ra của giao diện đã cạn kiệt'
                    : 'Vui lòng kiểm tra hạn mức đầu ra của mô hình hoặc chuyển sang mô hình có thể trả về nội dung chính ổn định'),
            );
            error.errorType = 'empty-response';
            error.transportStatus = Number(response.status) || null;
        } else {
            error = buildCustomApiResponseError(response, data, text, 'Độc lập API');
        }
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error.transportStatus ?? (Number(response.status) || null),
            upstreamStatus: error.upstreamStatus ?? null,
            errorType: error.errorType || 'other',
            errorSummary: cleanText(error.message).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }

    const completion = extractCompletionText(data);
    const finishReason = extractCompletionFinishReason(data);
    if (!completion) {
        const hitLengthLimit = /length|max[_\s-]*tokens?|token[_\s-]*limit/i.test(finishReason);
        const error = hitLengthLimit
            ? new Error(`Độc lập API Đầu ra đạt giới hạn độ dài (${finishReason}），và không trả về nội dung chính có thể khôi phục`)
            : new Error(
                'Độc lập API Trả về thành công, nhưng không có nội dung chính cuối cùng có thể đọc.'
                + (useDeepSeekV4Compatibility ? 'DS4 Suy nghĩ có thể đã chiếm hết hạn mức đầu ra của trạm trung chuyển' : ''),
            );
        error.errorType = hitLengthLimit ? 'output-limit' : 'empty-response';
        error.transportStatus = Number(response.status) || null;
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error.transportStatus,
            upstreamStatus: null,
            errorType: error.errorType,
            errorSummary: cleanText(error.message).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
    const hitLengthLimit = /length|max[_\s-]*tokens?|token[_\s-]*limit/i.test(finishReason);
    if (hitLengthLimit && rejectTruncated) {
        const error = new Error(`Độc lập API Đầu ra đạt giới hạn độ dài (${finishReason}），Nhiệm vụ này không chấp nhận kết quả bị cắt bớt`);
        error.code = 'OUTPUT_TRUNCATED';
        error.errorType = 'output-limit';
        error.transportStatus = Number(response.status) || null;
        error.finishReason = finishReason;
        error.partialText = completion;
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error.transportStatus,
            upstreamStatus: null,
            errorType: error.errorType,
            errorSummary: cleanText(error.message).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
    // Structured simulation calls may still receive a complete JSON object even
    // when a provider reports MAX_TOKENS. Preserve non-empty output there and let
    // the JSON parser decide whether compact retry is necessary.
    finishCustomApiOperation(operationId, {
        phase: 'success',
        transportStatus: Number(response.status) || null,
        succeededAt: new Date().toISOString(),
    });
    return completion;
}
