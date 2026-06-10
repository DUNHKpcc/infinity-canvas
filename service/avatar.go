package service

import (
	"log"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

const (
	// avatarMaxBytes 单张头像最大体积，前端已压成 webp，正常仅几十 KB。
	avatarMaxBytes  = 1 << 20
	avatarMimeType  = "image/webp"
	avatarURLPrefix = "/api/media/avatars/"
)

// UpdateUserAvatar 保存新头像并清理旧头像。
//
// 策略：先写入新头像 blob，再把用户头像指向新地址，最后删除该用户的历史头像。
// 新头像始终使用新的随机 ID，因此 URL 天然带缓存击穿；旧头像在新头像落库后才删除，
// 任一步失败都不会让用户处于「无头像」状态。
func UpdateUserAvatar(userID string, data []byte) (model.AuthUser, error) {
	if strings.TrimSpace(userID) == "" {
		return model.AuthUser{}, safeMessageError{message: "未登录或权限不足"}
	}
	if len(data) == 0 {
		return model.AuthUser{}, safeMessageError{message: "请选择头像文件"}
	}
	if len(data) > avatarMaxBytes {
		return model.AuthUser{}, safeMessageError{message: "头像文件过大，请重新选择"}
	}
	if !isWebPImage(data) {
		return model.AuthUser{}, safeMessageError{message: "头像格式不支持，请使用图片文件"}
	}

	user, ok, err := repository.GetUserByID(userID)
	if err != nil {
		return model.AuthUser{}, err
	}
	if !ok {
		return model.AuthUser{}, safeMessageError{message: "用户不存在"}
	}

	avatar := model.UserAvatar{
		ID:        uuid.NewString(),
		UserID:    userID,
		MimeType:  avatarMimeType,
		Data:      data,
		Bytes:     len(data),
		CreatedAt: now(),
	}
	if err := repository.SaveUserAvatar(avatar); err != nil {
		return model.AuthUser{}, err
	}

	user.AvatarURL = avatarURLPrefix + avatar.ID
	user.UpdatedAt = now()
	user, err = repository.SaveUser(user)
	if err != nil {
		return model.AuthUser{}, err
	}

	// 旧头像删库：用户重复更新头像时清理历史 blob，避免库内残留。
	if err := repository.DeleteOtherUserAvatars(userID, avatar.ID); err != nil {
		log.Printf("clean old avatar failed: %v", err)
	}
	return model.PublicUser(user), nil
}

// UserAvatarByID 读取头像二进制，供 /api/media/avatars/:id 提供访问。
func UserAvatarByID(id string) (model.UserAvatar, bool, error) {
	return repository.GetUserAvatar(id)
}

// isInternalAvatarURL 判断头像是否为站内自定义头像（区别于 Linux.do 等外链）。
func isInternalAvatarURL(url string) bool {
	return strings.HasPrefix(strings.TrimSpace(url), avatarURLPrefix)
}

// isWebPImage 校验 webp 魔数（RIFF....WEBP）。
func isWebPImage(data []byte) bool {
	return len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP"
}
