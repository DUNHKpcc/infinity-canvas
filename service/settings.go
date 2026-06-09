package service

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// 渠道生图测试用的最小可重复请求参数；尺寸取 1024×1024（满足主流渠道的最小像素预算，256×256 会被
// gpt-image / Codex 类渠道以 "below the current minimum pixel budget" 拒绝），张数 1，控制成本。
const (
	adminChannelTestImagePrompt = "a red dot on white background"
	adminChannelTestImageSize   = "1024x1024"
	// 与前端 image.ts 的 RESPONSES_PROMPT_GUARD 保持一致：部分网关要求 input 为消息列表且不被改写。
	adminChannelResponsesPromptGuard = "Use the following text as the complete prompt. Do not rewrite it:"
)

var adminModelHTTPClient = &http.Client{Timeout: 30 * time.Second}

func PublicSettings() (model.PublicSetting, error) {
	settings, err := repository.GetSettings()
	return normalizeSettings(settings).Public, err
}

func AdminSettings() (model.Settings, error) {
	settings, err := repository.GetSettings()
	return hidePrivateAPIKeys(normalizeSettings(settings)), err
}

func SaveSettings(settings model.Settings) (model.Settings, error) {
	saved, err := repository.GetSettings()
	if err != nil {
		return model.Settings{}, err
	}
	settings = normalizeSettings(settings)
	keepPrivateAPIKeys(&settings, normalizeSettings(saved))
	keepPrivateAuthSecrets(&settings, normalizeSettings(saved))
	result, err := repository.SaveSettings(settings, now())
	if err == nil {
		RefreshPromptSyncScheduler()
	}
	return hidePrivateAPIKeys(result), err
}

func AdminChannelModels(index *int, channel model.ModelChannel) ([]string, error) {
	resolved, err := resolveAdminChannel(index, channel)
	if err != nil {
		return nil, err
	}
	return fetchAdminChannelModels(resolved)
}

func AdminTestChannelModel(index *int, channel model.ModelChannel, modelName string, testType string) (string, error) {
	resolved, err := resolveAdminChannel(index, channel)
	if err != nil {
		return "", err
	}
	if isArkAgentPlanChannel(resolved) || isSeedanceModelName(modelName) {
		return testArkSeedanceChannelModel(resolved, modelName)
	}
	switch strings.TrimSpace(testType) {
	case "image":
		return testAdminChannelImage(resolved, modelName, false)
	case "image_stream":
		return testAdminChannelImage(resolved, modelName, true)
	case "responses":
		return testAdminChannelResponses(resolved, modelName)
	default:
		return testAdminChannelModel(resolved, modelName)
	}
}

func normalizeSettings(settings model.Settings) model.Settings {
	settings.Private = normalizePrivateSetting(settings.Private)
	settings.Public = normalizePublicSettingWithChannels(settings.Public, settings.Private.Channels)
	return settings
}

func normalizePublicSetting(setting model.PublicSetting) model.PublicSetting {
	return normalizePublicSettingWithChannels(setting, nil)
}

func normalizePublicSettingWithChannels(setting model.PublicSetting, channels []model.ModelChannel) model.PublicSetting {
	if setting.ModelChannel.AvailableModels == nil {
		setting.ModelChannel.AvailableModels = []string{}
	}
	if setting.ModelChannel.ModelCosts == nil {
		setting.ModelChannel.ModelCosts = []model.ModelCost{}
	}
	for i := range setting.ModelChannel.ModelCosts {
		setting.ModelChannel.ModelCosts[i].Model = strings.TrimSpace(setting.ModelChannel.ModelCosts[i].Model)
		if setting.ModelChannel.ModelCosts[i].Credits < 0 {
			setting.ModelChannel.ModelCosts[i].Credits = 0
		}
	}
	if setting.ModelChannel.AllowCustomChannel == nil {
		enabled := true
		setting.ModelChannel.AllowCustomChannel = &enabled
	}
	if setting.Auth.AllowRegister == nil {
		enabled := true
		setting.Auth.AllowRegister = &enabled
	}
	enabledModels := enabledChannelModels(channels)
	if len(enabledModels) > 0 {
		setting.ModelChannel.AvailableModels = enabledModels
	} else {
		setting.ModelChannel.AvailableModels = uniqueModelNames(setting.ModelChannel.AvailableModels)
	}
	setting.ModelChannel.DefaultTextModel = repairDefaultModel(setting.ModelChannel.DefaultTextModel, setting.ModelChannel.AvailableModels, isTextModelName)
	setting.ModelChannel.DefaultImageModel = repairDefaultModel(setting.ModelChannel.DefaultImageModel, setting.ModelChannel.AvailableModels, isImageModelName)
	setting.ModelChannel.DefaultVideoModel = repairDefaultModel(setting.ModelChannel.DefaultVideoModel, setting.ModelChannel.AvailableModels, isVideoModelName)
	setting.ModelChannel.DefaultModel = repairDefaultModel(setting.ModelChannel.DefaultModel, setting.ModelChannel.AvailableModels, isTextModelName)
	return setting
}

func ModelCost(modelName string) (int, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return 0, err
	}
	modelName = strings.TrimSpace(modelName)
	for _, item := range normalizePublicSetting(settings.Public).ModelChannel.ModelCosts {
		if item.Model == modelName {
			return item.Credits, nil
		}
	}
	return 0, nil
}

func normalizePrivateSetting(setting model.PrivateSetting) model.PrivateSetting {
	if setting.Channels == nil {
		setting.Channels = []model.ModelChannel{}
	}
	setting.PromptSync = normalizePromptSyncSetting(setting.PromptSync)
	for i := range setting.Channels {
		if setting.Channels[i].Protocol == "" {
			setting.Channels[i].Protocol = "openai"
		}
		if setting.Channels[i].Models == nil {
			setting.Channels[i].Models = []string{}
		}
		if setting.Channels[i].Weight <= 0 {
			setting.Channels[i].Weight = 1
		}
	}
	return setting
}

func hidePrivateAPIKeys(settings model.Settings) model.Settings {
	for i := range settings.Private.Channels {
		settings.Private.Channels[i].APIKey = ""
	}
	settings.Private.Auth.LinuxDo.ClientSecret = ""
	return settings
}

func keepPrivateAPIKeys(settings *model.Settings, saved model.Settings) {
	for i := range settings.Private.Channels {
		if strings.TrimSpace(settings.Private.Channels[i].APIKey) != "" {
			continue
		}
		if channel, ok := findSavedChannel(settings.Private.Channels[i], saved.Private.Channels, i); ok {
			settings.Private.Channels[i].APIKey = channel.APIKey
		}
	}
}

func keepPrivateAuthSecrets(settings *model.Settings, saved model.Settings) {
	if strings.TrimSpace(settings.Private.Auth.LinuxDo.ClientSecret) == "" {
		settings.Private.Auth.LinuxDo.ClientSecret = saved.Private.Auth.LinuxDo.ClientSecret
	}
}

func findSavedChannel(channel model.ModelChannel, saved []model.ModelChannel, index int) (model.ModelChannel, bool) {
	for _, item := range saved {
		if item.Name == channel.Name && item.BaseURL == channel.BaseURL {
			return item, true
		}
	}
	if index < len(saved) {
		return saved[index], true
	}
	return model.ModelChannel{}, false
}

func SelectModelChannel(modelName string) (model.ModelChannel, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return model.ModelChannel{}, err
	}
	channels := modelChannelsForModel(normalizePrivateSetting(settings.Private).Channels, modelName)
	if len(channels) == 0 {
		return model.ModelChannel{}, errors.New("没有可用模型渠道")
	}
	total := 0
	for _, channel := range channels {
		total += channel.Weight
	}
	hit := rand.Intn(total)
	for _, channel := range channels {
		hit -= channel.Weight
		if hit < 0 {
			return channel, nil
		}
	}
	return channels[0], nil
}

func BuildModelChannelURL(channel model.ModelChannel, path string) string {
	baseURL := normalizeModelChannelBaseURL(channel.BaseURL)
	lowerBaseURL := strings.ToLower(baseURL)
	if !strings.HasSuffix(lowerBaseURL, "/v1") && !strings.HasSuffix(lowerBaseURL, "/api/v3") && !strings.HasSuffix(lowerBaseURL, "/api/plan/v3") {
		baseURL += "/v1"
	}
	return baseURL + path
}

func normalizeModelChannelBaseURL(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(baseURL)
	if err == nil && parsed.Scheme != "" && parsed.Host != "" {
		path := strings.TrimRight(parsed.Path, "/")
		lowerPath := strings.ToLower(path)
		if index := strings.Index(lowerPath, "/api/plan/v3"); index >= 0 {
			end := index + len("/api/plan/v3")
			if len(lowerPath) == end || lowerPath[end] == '/' {
				parsed.Path = path[:end]
				parsed.RawPath = ""
				parsed.RawQuery = ""
				parsed.Fragment = ""
				return strings.TrimRight(parsed.String(), "/")
			}
		}
	}
	return baseURL
}

func isArkAgentPlanChannel(channel model.ModelChannel) bool {
	baseURL := strings.ToLower(normalizeModelChannelBaseURL(channel.BaseURL))
	return strings.HasSuffix(baseURL, "/api/plan/v3")
}

func isSeedanceModelName(modelName string) bool {
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(modelName, "seedance") || strings.Contains(modelName, "doubao-seedance")
}

func enabledChannelModels(channels []model.ModelChannel) []string {
	models := []string{}
	for _, channel := range channels {
		if !channel.Enabled {
			continue
		}
		models = append(models, channel.Models...)
	}
	return uniqueModelNames(models)
}

func uniqueModelNames(models []string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, item := range models {
		name := strings.TrimSpace(item)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		result = append(result, name)
	}
	return result
}

func repairDefaultModel(current string, models []string, preferred func(string) bool) string {
	current = strings.TrimSpace(current)
	for _, item := range models {
		if item == current {
			return current
		}
	}
	for _, item := range models {
		if preferred(item) {
			return item
		}
	}
	if len(models) > 0 {
		return models[0]
	}
	return ""
}

func isVideoModelName(modelName string) bool {
	name := strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(name, "seedance") || strings.Contains(name, "video")
}

func isImageModelName(modelName string) bool {
	name := strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(name, "seedream") || strings.Contains(name, "gpt-image") || strings.Contains(name, "image")
}

func isTextModelName(modelName string) bool {
	return !isImageModelName(modelName) && !isVideoModelName(modelName)
}

func normalizeModelChannel(channel model.ModelChannel) model.ModelChannel {
	if channel.Protocol == "" {
		channel.Protocol = "openai"
	}
	if channel.Models == nil {
		channel.Models = []string{}
	}
	if channel.Weight <= 0 {
		channel.Weight = 1
	}
	return channel
}

func resolveAdminChannel(index *int, channel model.ModelChannel) (model.ModelChannel, error) {
	resolved := normalizeModelChannel(channel)
	if strings.TrimSpace(resolved.APIKey) == "" {
		settings, err := repository.GetSettings()
		if err != nil {
			return model.ModelChannel{}, err
		}
		saved := normalizePrivateSetting(settings.Private).Channels
		if index != nil && *index >= 0 && *index < len(saved) {
			if resolved.APIKey == "" {
				resolved.APIKey = saved[*index].APIKey
			}
			if resolved.BaseURL == "" {
				resolved.BaseURL = saved[*index].BaseURL
			}
			if resolved.Name == "" {
				resolved.Name = saved[*index].Name
			}
		}
		if resolved.APIKey == "" {
			if savedChannel, ok := findSavedChannel(resolved, saved, -1); ok {
				resolved.APIKey = savedChannel.APIKey
			}
		}
	}
	if strings.TrimSpace(resolved.BaseURL) == "" {
		return model.ModelChannel{}, safeMessageError{message: "缺少接口地址"}
	}
	if strings.TrimSpace(resolved.APIKey) == "" {
		return model.ModelChannel{}, safeMessageError{message: "缺少 API Key"}
	}
	return resolved, nil
}

func fetchAdminChannelModels(channel model.ModelChannel) ([]string, error) {
	request, err := http.NewRequest(http.MethodGet, BuildModelChannelURL(channel, "/models"), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	response, err := adminModelHTTPClient.Do(request)
	if err != nil {
		log.Printf("[AdminChannelModels] 拉取模型失败 url=%s err=%v", BuildModelChannelURL(channel, "/models"), err)
		return nil, safeMessageError{message: fmt.Sprintf("读取模型失败：上游接口无响应或网络不可达（%s）", err.Error())}
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		if response.StatusCode == http.StatusNotFound && isArkAgentPlanChannel(channel) {
			return nil, safeMessageError{message: "火山方舟 Agent Plan 未提供 OpenAI /models 模型列表接口，请手动填写模型名称，例如 doubao-seedance-2.0。"}
		}
		return nil, readAdminChannelError(body, response.StatusCode, "读取模型失败")
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &payload)
	result := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if strings.TrimSpace(item.ID) != "" {
			result = append(result, item.ID)
		}
	}
	sort.Strings(result)
	return result, nil
}

func testAdminChannelModel(channel model.ModelChannel, modelName string) (string, error) {
	if strings.TrimSpace(modelName) == "" {
		return "", errors.New("缺少模型名称")
	}
	body, _ := json.Marshal(map[string]any{
		"model": modelName,
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hi",
		}},
	})
	request, err := http.NewRequest(http.MethodPost, BuildModelChannelURL(channel, "/chat/completions"), strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := adminModelHTTPClient.Do(request)
	if err != nil {
		log.Printf("[testAdminChannelModel] 测试失败 url=%s model=%s err=%v", BuildModelChannelURL(channel, "/chat/completions"), modelName, err)
		return "", safeMessageError{message: fmt.Sprintf("测试失败：上游接口无响应或网络不可达（%s）", err.Error())}
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return "", readAdminChannelError(responseBody, response.StatusCode, "测试失败")
	}
	var payload struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	_ = json.Unmarshal(responseBody, &payload)
	if len(payload.Choices) > 0 && strings.TrimSpace(payload.Choices[0].Message.Content) != "" {
		return payload.Choices[0].Message.Content, nil
	}
	return "ok", nil
}

func testArkSeedanceChannelModel(channel model.ModelChannel, modelName string) (string, error) {
	if strings.TrimSpace(modelName) == "" {
		return "", errors.New("缺少模型名称")
	}
	if strings.TrimSpace(channel.BaseURL) == "" {
		return "", safeMessageError{message: "缺少接口地址"}
	}
	if strings.TrimSpace(channel.APIKey) == "" {
		return "", safeMessageError{message: "缺少 API Key"}
	}
	if !isArkAgentPlanChannel(channel) {
		return "Seedance 视频模型不会发送 /chat/completions 文本测试。已检查 Base URL、API Key 和模型名非空；未调用视频生成接口，因此未验证套餐额度或模型权限。", nil
	}
	return "Agent Plan / Seedance 视频模型配置格式已通过。后台测试不会调用视频生成接口，因此未验证 API Key、套餐额度或模型权限；请在画布中使用视频生成验证。", nil
}

// testAdminChannelImage 用 /images/generations 验证渠道是否真正可生图；stream=true 时只读到首个
// partial_image / image_generation.completed 事件就关掉连接，避免拉完整 b64 浪费带宽。
func testAdminChannelImage(channel model.ModelChannel, modelName string, stream bool) (string, error) {
	if strings.TrimSpace(modelName) == "" {
		return "", errors.New("缺少模型名称")
	}
	payload := map[string]any{
		"model":           modelName,
		"prompt":          adminChannelTestImagePrompt,
		"n":               1,
		"size":            adminChannelTestImageSize,
		"response_format": "b64_json",
	}
	if stream {
		payload["stream"] = true
		payload["partial_images"] = 1
	}
	body, _ := json.Marshal(payload)
	url := BuildModelChannelURL(channel, "/images/generations")
	request, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	request.Header.Set("Content-Type", "application/json")
	if stream {
		request.Header.Set("Accept", "text/event-stream")
	}
	client := adminModelHTTPClient
	if stream {
		// 流式测试单独用一个更长超时但不复用连接池，避免连接长时间挂起影响后续测试。
		client = &http.Client{Timeout: 60 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		log.Printf("[testAdminChannelImage] 测试失败 url=%s model=%s stream=%v err=%v", url, modelName, stream, err)
		return "", safeMessageError{message: fmt.Sprintf("测试失败：上游接口无响应或网络不可达（%s）", err.Error())}
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		respBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return "", hintCodexChannel(readAdminChannelError(respBody, response.StatusCode, "测试失败"))
	}
	if stream {
		return readImageStreamFirstEvent(response)
	}
	respBody, _ := io.ReadAll(response.Body)
	if len(respBody) == 0 {
		return "", safeMessageError{message: "测试失败：上游返回空响应"}
	}
	var parsed struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil || len(parsed.Data) == 0 {
		return "", safeMessageError{message: "测试失败：上游响应中未找到 data[0]，请确认渠道支持 /images/generations"}
	}
	if parsed.Data[0].B64JSON == "" && parsed.Data[0].URL == "" {
		return "", safeMessageError{message: "测试失败：上游 data[0] 缺少 b64_json/url 字段"}
	}
	return "ok", nil
}

// readImageStreamFirstEvent 扫描 SSE 流，遇到首个 image_generation.partial_image / completed
// 事件就返回；扫描到结束都没拿到说明渠道不支持流式生图。
func readImageStreamFirstEvent(response *http.Response) (string, error) {
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	if !strings.Contains(contentType, "text/event-stream") {
		return "", safeMessageError{message: "测试失败：上游未返回 text/event-stream，渠道可能不支持流式生图"}
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var payload struct {
			Type    string `json:"type"`
			B64JSON string `json:"b64_json"`
		}
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			continue
		}
		lower := strings.ToLower(payload.Type)
		if strings.Contains(lower, "partial_image") || strings.Contains(lower, "image_generation.completed") || strings.Contains(lower, "image.completed") {
			return "ok (stream)", nil
		}
		if payload.B64JSON != "" {
			return "ok (stream)", nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", safeMessageError{message: fmt.Sprintf("测试失败：读取流式响应出错（%s）", err.Error())}
	}
	return "", safeMessageError{message: "测试失败：流式响应中未捕获到 partial_image 或 completed 事件"}
}

// testAdminChannelResponses 用 /responses + image_generation 工具验证 Codex 类渠道是否可生图。
// 请求结构与前端 image.ts requestViaResponses 对齐：顶层 stream=true（Codex 网关强制流式，否则报
// "Stream must be set to true"）、input 为消息列表、image_generation 工具带 action/output_format/
// moderation/partial_images，且不带 quality（Codex 网关会拒绝）。
func testAdminChannelResponses(channel model.ModelChannel, modelName string) (string, error) {
	if strings.TrimSpace(modelName) == "" {
		return "", errors.New("缺少模型名称")
	}
	body, _ := json.Marshal(map[string]any{
		"model": modelName,
		"input": []map[string]any{{
			"role": "user",
			"content": []map[string]any{{
				"type": "input_text",
				"text": adminChannelResponsesPromptGuard + "\n" + adminChannelTestImagePrompt,
			}},
		}},
		"tools": []map[string]any{{
			"type":           "image_generation",
			"action":         "generate",
			"size":           adminChannelTestImageSize,
			"output_format":  "png",
			"moderation":     "auto",
			"partial_images": 1,
		}},
		"tool_choice": "required",
		"stream":      true,
	})
	url := BuildModelChannelURL(channel, "/responses")
	request, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	client := &http.Client{Timeout: 60 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		log.Printf("[testAdminChannelResponses] 测试失败 url=%s model=%s err=%v", url, modelName, err)
		return "", safeMessageError{message: fmt.Sprintf("测试失败：上游接口无响应或网络不可达（%s）", err.Error())}
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		respBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return "", readAdminChannelError(respBody, response.StatusCode, "测试失败")
	}
	return readResponsesFirstImage(response)
}

// readResponsesFirstImage 解析 /responses 的返回：若为 SSE 则扫到首个 image_generation 的
// partial_image / completed 事件即返回；若上游忽略 stream 返回普通 JSON 则回退解析 output 数组。
func readResponsesFirstImage(response *http.Response) (string, error) {
	if !strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		respBody, _ := io.ReadAll(response.Body)
		if len(respBody) == 0 {
			return "", safeMessageError{message: "测试失败：上游返回空响应"}
		}
		var parsed struct {
			Output []struct {
				Type   string `json:"type"`
				Result string `json:"result"`
			} `json:"output"`
		}
		if err := json.Unmarshal(respBody, &parsed); err != nil {
			return "", safeMessageError{message: "测试失败：上游响应不是合法 JSON"}
		}
		for _, item := range parsed.Output {
			if strings.Contains(strings.ToLower(item.Type), "image_generation") && item.Result != "" {
				return "ok (responses)", nil
			}
		}
		return "", safeMessageError{message: "测试失败：/responses 输出中未找到 image_generation 结果，渠道可能不支持该接口"}
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var payload struct {
			Type            string `json:"type"`
			PartialImageB64 string `json:"partial_image_b64"`
			Error           *struct {
				Message string `json:"message"`
			} `json:"error"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			continue
		}
		lower := strings.ToLower(payload.Type)
		if strings.HasSuffix(lower, ".failed") || strings.HasSuffix(lower, ".error") || payload.Error != nil {
			msg := payload.Message
			if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
				msg = payload.Error.Message
			}
			if strings.TrimSpace(msg) == "" {
				msg = "生成失败"
			}
			return "", safeMessageError{message: "测试失败：" + msg}
		}
		if strings.Contains(lower, "image_generation_call.partial_image") && payload.PartialImageB64 != "" {
			return "ok (responses stream)", nil
		}
		if strings.Contains(lower, "image_generation_call") && strings.HasSuffix(lower, ".completed") {
			return "ok (responses stream)", nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", safeMessageError{message: fmt.Sprintf("测试失败：读取流式响应出错（%s）", err.Error())}
	}
	return "", safeMessageError{message: "测试失败：/responses 流中未捕获到 image_generation 事件，渠道可能不支持该接口"}
}

// hintCodexChannel 当 /images/generations 报端点不支持 / 强制流式等错误时，提示渠道可能是 Codex 类，
// 引导改用 Responses 测试，并在前端把生图接口切到 Responses + 流式。
func hintCodexChannel(err error) error {
	if err == nil {
		return nil
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "endpoint not supported") || strings.Contains(lower, "codex") || strings.Contains(lower, "stream must be set") {
		return safeMessageError{message: err.Error() + "（该渠道可能是 Codex 类，仅支持 /responses，请改用「Responses」测试；前端生图请在图像设置里把「生图接口」切到 Responses 并开启流式）"}
	}
	return err
}

func readAdminChannelError(body []byte, statusCode int, fallback string) error {
	var payload struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Msg string `json:"msg"`
	}
	if len(body) > 0 && json.Unmarshal(body, &payload) == nil {
		if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
			return safeMessageError{message: payload.Error.Message}
		}
		if strings.TrimSpace(payload.Msg) != "" {
			return safeMessageError{message: payload.Msg}
		}
	}
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return safeMessageError{message: fmt.Sprintf("上游接口鉴权失败（%d），请检查 API Key、套餐权限或模型权限", statusCode)}
	}
	if statusCode == http.StatusTooManyRequests {
		return safeMessageError{message: "上游接口限流或额度不足（429），请稍后重试或检查额度"}
	}
	if statusCode > 0 {
		return safeMessageError{message: fmt.Sprintf("%s：%d", fallback, statusCode)}
	}
	return safeMessageError{message: fallback}
}

type safeMessageError struct {
	message string
}

func (err safeMessageError) Error() string {
	return err.message
}

func (err safeMessageError) SafeMessage() string {
	return err.message
}

func modelChannelsForModel(channels []model.ModelChannel, modelName string) []model.ModelChannel {
	result := []model.ModelChannel{}
	for _, channel := range channels {
		if !channel.Enabled || channel.BaseURL == "" || channel.APIKey == "" {
			continue
		}
		for _, item := range channel.Models {
			if strings.TrimSpace(item) == modelName {
				result = append(result, channel)
				break
			}
		}
	}
	return result
}
