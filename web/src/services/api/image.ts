import axios from "axios";

import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

export type ChatCompletionMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". */
function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return { width: w, height: h };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || "请求失败");
    }
    const images =
        payload.data
            ?.map(resolveImageDataUrl)
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];

    if (images.length === 0) {
        throw new Error("接口没有返回图片");
    }

    return images;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isAxiosError(error)) {
        let responseData: unknown = error.response?.data;
        // Streaming requests use responseType:"text", so an error body arrives as a raw string — parse it to surface the upstream message.
        if (typeof responseData === "string" && responseData.trim()) {
            const text = responseData;
            try {
                responseData = JSON.parse(text);
            } catch {
                return text;
            }
        }
        const data = responseData as { error?: { message?: string }; msg?: string } | undefined;
        return data?.msg || data?.error?.message || readStatusError(error.response?.status, fallback);
    }
    return error instanceof Error ? error.message : fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}

function parseStreamChunk(chunk: string, onDelta: (value: string) => void) {
    let deltaText = "";
    for (const eventBlock of chunk.split("\n\n")) {
        const data = eventBlock
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
        if (!data || data === "[DONE]") continue;
        const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content || "";
        deltaText += delta;
    }
    if (deltaText) onDelta(deltaText);
}

export type PartialImage = { index: number; dataUrl: string };
export type OnPartialImage = (partial: PartialImage) => void;

type ParsedImage = { id: string; dataUrl: string };
type ImageStreamEvent = { kind: "partial"; index: number; dataUrl: string } | { kind: "completed"; images: ParsedImage[] } | { kind: "error"; message: string };

function isStreamEnabled(config: AiConfig) {
    return config.streamImages === "true";
}

function resolvePartialImages(config: AiConfig) {
    const value = Math.floor(Number(config.streamPartialImages));
    return Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 1;
}

function b64ToDataUrl(b64: string) {
    return `data:image/png;base64,${b64}`;
}

function collectCompletedImages(payload: Record<string, unknown>): ParsedImage[] {
    const data = (payload as { data?: Array<Record<string, unknown>> }).data;
    if (Array.isArray(data)) {
        return data
            .map(resolveImageDataUrl)
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl }));
    }
    if (typeof payload.b64_json === "string" && payload.b64_json) {
        return [{ id: nanoid(), dataUrl: b64ToDataUrl(payload.b64_json) }];
    }
    return [];
}

/** Parse one "\n\n"-delimited SSE block from the image stream, emitting 0..n image events. */
function parseImageStreamChunk(chunk: string, onEvent: (event: ImageStreamEvent) => void) {
    for (const block of chunk.split("\n\n")) {
        const data = block
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
        if (!data || data === "[DONE]") continue;
        let payload: Record<string, unknown>;
        try {
            payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
            continue;
        }
        const type = typeof payload.type === "string" ? payload.type : "";
        if (type.endsWith(".error") || (typeof payload.code === "number" && payload.code !== 0) || payload.error) {
            const message = (payload.error as { message?: string } | undefined)?.message || (typeof payload.msg === "string" ? payload.msg : "") || "生成失败";
            onEvent({ kind: "error", message });
            continue;
        }
        if (type.endsWith("partial_image") && typeof payload.b64_json === "string" && payload.b64_json) {
            onEvent({ kind: "partial", index: Number(payload.partial_image_index ?? 0), dataUrl: b64ToDataUrl(payload.b64_json) });
            continue;
        }
        if (type.endsWith("completed") || Array.isArray((payload as { data?: unknown }).data)) {
            const images = collectCompletedImages(payload);
            if (images.length) onEvent({ kind: "completed", images });
        }
    }
}

type RunImageStreamOptions = {
    /** SSE chunk parser; defaults to the Images-API parser. Responses API uses parseResponsesStreamChunk. */
    parse?: (chunk: string, onEvent: (event: ImageStreamEvent) => void) => void;
    /** When a stream emits the full final set per event (Responses API), keep only the latest instead of appending. */
    replaceCompleted?: boolean;
    /** Parser for the non-SSE JSON fallback (upstream ignored stream). */
    parseJsonFallback?: (payload: unknown) => ParsedImage[];
    onPartialImage?: OnPartialImage;
};

/** Run an SSE image request, forwarding partial frames and aggregating final images. */
async function runImageStream(url: string, body: unknown, headers: Record<string, string>, options: RunImageStreamOptions = {}): Promise<ParsedImage[]> {
    const parse = options.parse ?? parseImageStreamChunk;
    const parseJsonFallback = options.parseJsonFallback ?? ((payload) => parseImagePayload(payload as ImageApiResponse));
    let buffer = "";
    let processedLength = 0;
    let sawEvent = false;
    let streamError = "";
    const completed: ParsedImage[] = [];

    const handle = (event: ImageStreamEvent) => {
        sawEvent = true;
        if (event.kind === "partial") options.onPartialImage?.({ index: event.index, dataUrl: event.dataUrl });
        else if (event.kind === "completed") {
            if (options.replaceCompleted) completed.splice(0, completed.length, ...event.images);
            else completed.push(...event.images);
        } else streamError = event.message;
    };

    const response = await axios.post(url, body, {
        headers,
        responseType: "text",
        onDownloadProgress: (event) => {
            const responseText = String(event.event?.target?.responseText || "");
            buffer += responseText.slice(processedLength);
            processedLength = responseText.length;
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() || "";
            for (const chunk of chunks) parse(chunk, handle);
        },
    });
    if (buffer) parse(buffer, handle);

    if (streamError) throw new Error(streamError);
    if (completed.length) return completed;
    // Fallback: upstream ignored stream and returned a plain JSON payload.
    if (!sawEvent && typeof response.data === "string") {
        return parseJsonFallback(JSON.parse(response.data));
    }
    throw new Error("接口没有返回图片");
}

function normalizeImageB64(value: string) {
    return value.startsWith("data:") ? value : b64ToDataUrl(value);
}

/** Extract base64 from a Responses-API image_generation_call result (string or object). */
function extractResponsesB64(result: unknown): string | undefined {
    if (typeof result === "string") return result.trim() ? result : undefined;
    if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        const value = r.b64_json || r.base64 || r.image || r.data;
        return typeof value === "string" && value.trim() ? value : undefined;
    }
    return undefined;
}

/** Collect images from a Responses payload ({ output: [...] }). */
function collectResponsesImages(payload: Record<string, unknown>): ParsedImage[] {
    const output = (payload as { output?: Array<Record<string, unknown>> }).output;
    if (!Array.isArray(output)) return [];
    const images: ParsedImage[] = [];
    for (const item of output) {
        if (item?.type !== "image_generation_call") continue;
        const b64 = extractResponsesB64(item.result);
        if (b64) images.push({ id: nanoid(), dataUrl: normalizeImageB64(b64) });
    }
    return images;
}

/** Parse a non-streaming Responses-API payload into images. */
function parseResponsesImagePayload(payload: unknown): ParsedImage[] {
    const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    if (typeof record.code === "number" && record.code !== 0) throw new Error((record.msg as string) || "请求失败");
    const images = collectResponsesImages(record);
    if (!images.length) throw new Error("接口没有返回图片");
    return images;
}

/** Parse one SSE block from a Responses-API image stream. */
function parseResponsesStreamChunk(chunk: string, onEvent: (event: ImageStreamEvent) => void) {
    for (const block of chunk.split("\n\n")) {
        const data = block
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
        if (!data || data === "[DONE]") continue;
        let payload: Record<string, unknown>;
        try {
            payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
            continue;
        }
        const type = typeof payload.type === "string" ? payload.type : "";
        if (type.endsWith(".failed") || type.endsWith(".error") || payload.error) {
            const message = (payload.error as { message?: string } | undefined)?.message || (typeof payload.message === "string" ? payload.message : "") || "生成失败";
            onEvent({ kind: "error", message });
            continue;
        }
        if (type === "response.image_generation_call.partial_image" && typeof payload.partial_image_b64 === "string" && payload.partial_image_b64) {
            onEvent({ kind: "partial", index: Number(payload.partial_image_index ?? 0), dataUrl: normalizeImageB64(payload.partial_image_b64) });
            continue;
        }
        let images: ParsedImage[] = [];
        if (payload.response && typeof payload.response === "object") images = collectResponsesImages(payload.response as Record<string, unknown>);
        else if (payload.item && typeof payload.item === "object" && (payload.item as Record<string, unknown>).type === "image_generation_call") images = collectResponsesImages({ output: [payload.item] });
        else if (Array.isArray((payload as { output?: unknown }).output)) images = collectResponsesImages(payload);
        if (images.length) onEvent({ kind: "completed", images });
    }
}

function isResponsesMode(config: AiConfig) {
    return config.imageApiMode === "responses";
}

const RESPONSES_PROMPT_GUARD = "Use the following text as the complete prompt. Do not rewrite it:";

/** Build the Responses-API `input` (matches gpt_image_playground: string for text-only, message list with images). */
function buildResponsesInput(prompt: string, inputImageDataUrls: string[]): unknown {
    const text = `${RESPONSES_PROMPT_GUARD}\n${prompt}`;
    if (!inputImageDataUrls.length) return text;
    return [
        {
            role: "user",
            content: [{ type: "input_text", text }, ...inputImageDataUrls.map((dataUrl) => ({ type: "input_image", image_url: dataUrl }))],
        },
    ];
}

/** Build the Responses-API image_generation tool. Quality is omitted (Codex channels reject it). */
function buildResponsesImageTool(config: AiConfig, isEdit: boolean, requestSize: string | undefined, maskDataUrl?: string): Record<string, unknown> {
    const tool: Record<string, unknown> = {
        type: "image_generation",
        action: isEdit ? "edit" : "generate",
        size: requestSize || "auto",
        output_format: IMAGE_OUTPUT_FORMAT,
        moderation: "auto",
    };
    if (isStreamEnabled(config)) tool.partial_images = resolvePartialImages(config);
    if (maskDataUrl) tool.input_image_mask = { image_url: maskDataUrl };
    return tool;
}

/** Generate/edit an image via the Responses API (POST /responses). Returns the final images. */
async function requestViaResponses(
    config: AiConfig,
    prompt: string,
    inputImageDataUrls: string[],
    maskDataUrl: string | undefined,
    isEdit: boolean,
    requestSize: string | undefined,
    onPartialImage?: OnPartialImage,
): Promise<ParsedImage[]> {
    const stream = isStreamEnabled(config);
    const body: Record<string, unknown> = {
        model: config.model,
        input: buildResponsesInput(prompt, inputImageDataUrls),
        tools: [buildResponsesImageTool(config, isEdit, requestSize, maskDataUrl)],
        tool_choice: "required",
        ...(stream ? { stream: true } : {}),
    };
    const headers = aiHeaders(config, "application/json") as Record<string, string>;
    const url = aiApiUrl(config, "/responses");
    if (stream) {
        return runImageStream(url, body, headers, { parse: parseResponsesStreamChunk, replaceCompleted: true, parseJsonFallback: parseResponsesImagePayload, onPartialImage });
    }
    return parseResponsesImagePayload((await axios.post(url, body, { headers })).data);
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: AiConfig, path: string) {
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    const token = useUserStore.getState().token;
    return config.channelMode === "remote"
        ? {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(contentType ? { "Content-Type": contentType } : {}),
          }
        : {
              Authorization: `Bearer ${config.apiKey}`,
              ...(contentType ? { "Content-Type": contentType } : {}),
          };
}

function refreshRemoteUser(config: AiConfig) {
    if (config.channelMode === "remote") void useUserStore.getState().hydrateUser();
}

function withSystemMessage(config: AiConfig, messages: ChatCompletionMessage[]) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

export async function requestGeneration(config: AiConfig, prompt: string, onPartialImage?: OnPartialImage) {
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const stream = isStreamEnabled(config);
    try {
        let images: ParsedImage[];
        if (isResponsesMode(config)) {
            images = await requestViaResponses(config, withSystemPrompt(config, prompt), [], undefined, false, requestSize, onPartialImage);
        } else {
            const body = {
                model: config.model,
                prompt: withSystemPrompt(config, prompt),
                n,
                ...(quality ? { quality } : {}),
                ...(requestSize ? { size: requestSize } : {}),
                response_format: "b64_json",
                output_format: IMAGE_OUTPUT_FORMAT,
                ...(stream ? { stream: true, partial_images: resolvePartialImages(config) } : {}),
            };
            const headers = aiHeaders(config, "application/json") as Record<string, string>;
            images = stream
                ? await runImageStream(aiApiUrl(config, "/images/generations"), body, headers, { onPartialImage })
                : parseImagePayload((await axios.post<ImageApiResponse>(aiApiUrl(config, "/images/generations"), body, { headers })).data);
        }
        refreshRemoteUser(config);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, onPartialImage?: OnPartialImage) {
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    const stream = isStreamEnabled(config);
    try {
        let images: ParsedImage[];
        if (isResponsesMode(config)) {
            const inputImageDataUrls = await Promise.all(references.map((image) => imageToDataUrl(image)));
            const maskDataUrl = mask ? await imageToDataUrl(mask) : undefined;
            images = await requestViaResponses(config, withSystemPrompt(config, requestPrompt), inputImageDataUrls, maskDataUrl, true, requestSize, onPartialImage);
            refreshRemoteUser(config);
            return images;
        }
        const formData = new FormData();
        formData.set("model", config.model);
        formData.set("prompt", withSystemPrompt(config, requestPrompt));
        formData.set("n", String(n));
        formData.set("response_format", "b64_json");
        formData.set("output_format", IMAGE_OUTPUT_FORMAT);
        if (quality) {
            formData.set("quality", quality);
        }
        if (requestSize) {
            formData.set("size", requestSize);
        }
        if (stream) {
            formData.set("stream", "true");
            formData.set("partial_images", String(resolvePartialImages(config)));
        }
        const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
        files.forEach((file) => formData.append("image", file));
        if (mask) formData.set("mask", dataUrlToFile(mask));

        const headers = aiHeaders(config) as Record<string, string>;
        images = stream
            ? await runImageStream(aiApiUrl(config, "/images/edits"), formData, headers, { onPartialImage })
            : parseImagePayload((await axios.post<ImageApiResponse>(aiApiUrl(config, "/images/edits"), formData, { headers })).data);
        refreshRemoteUser(config);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: ChatCompletionMessage[], onDelta: (text: string) => void) {
    let buffer = "";
    let answer = "";
    let processedLength = 0;

    try {
        const response = await axios.post(
            aiApiUrl(config, "/chat/completions"),
            {
                model: config.model,
                messages: withSystemMessage(config, messages),
                stream: true,
            },
            {
                headers: {
                    ...aiHeaders(config, "application/json"),
                } as Record<string, string>,
                responseType: "text",
                onDownloadProgress: (event) => {
                    const responseText = String(event.event?.target?.responseText || "");
                    const nextText = responseText.slice(processedLength);
                    processedLength = responseText.length;
                    buffer += nextText;
                    const chunks = buffer.split("\n\n");
                    buffer = chunks.pop() || "";
                    for (const chunk of chunks) {
                        parseStreamChunk(chunk, (delta) => {
                            answer += delta;
                            onDelta(answer);
                        });
                    }
                },
            },
        );
        if (typeof response.data === "object" && response.data && "code" in response.data && (response.data as { code?: number; msg?: string }).code !== 0) {
            throw new Error((response.data as { msg?: string }).msg || "请求失败");
        }
        if (typeof response.data === "string") {
            let apiError = "";
            try {
                const payload = JSON.parse(response.data) as { code?: number; msg?: string };
                if (typeof payload.code === "number" && payload.code !== 0) {
                    apiError = payload.msg || "请求失败";
                }
            } catch {
                // ignore plain text stream content
            }
            if (apiError) throw new Error(apiError);
        }
        if (buffer) {
            parseStreamChunk(buffer, (delta) => {
                answer += delta;
                onDelta(answer);
            });
        }
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
    refreshRemoteUser(config);
    return answer || "没有返回内容";
}

export async function fetchImageModels(config: AiConfig) {
    if (config.channelMode === "remote") return config.models;
    try {
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}
