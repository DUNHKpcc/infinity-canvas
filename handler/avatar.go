package handler

import (
	"io"
	"net/http"
	"strconv"

	"github.com/basketikun/infinite-canvas/service"
)

const avatarUploadMaxBytes = 2 << 20

// UploadAvatar 接收前端压好的 webp 头像并落库，返回更新后的用户信息。
func UploadAvatar(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		Fail(w, "未登录或权限不足")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, avatarUploadMaxBytes+1)
	if err := r.ParseMultipartForm(avatarUploadMaxBytes); err != nil {
		Fail(w, "头像过大或上传格式不正确")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		Fail(w, "请选择头像文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		Fail(w, "头像读取失败")
		return
	}
	updated, err := service.UpdateUserAvatar(user.ID, data)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, updated)
}

// AvatarMedia 提供站内自定义头像的二进制访问。
func AvatarMedia(w http.ResponseWriter, r *http.Request, id string) {
	avatar, ok, err := service.UserAvatarByID(id)
	if err != nil || !ok {
		http.NotFound(w, r)
		return
	}
	mimeType := avatar.MimeType
	if mimeType == "" {
		mimeType = "image/webp"
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", strconv.Itoa(len(avatar.Data)))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(avatar.Data)
}
