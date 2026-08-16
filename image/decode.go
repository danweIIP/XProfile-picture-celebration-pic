package image

import (
	"fmt"
	stdimg "image"
	_ "image/gif"  // 注册 GIF 解码器
	_ "image/jpeg" // 注册 JPEG 解码器
	_ "image/png"  // 注册 PNG 解码器
	"os"
	"path/filepath"
	"strings"

	_ "golang.org/x/image/bmp"  // 注册 BMP 解码器
	_ "golang.org/x/image/webp" // 注册 WebP 解码器（仅解码，无编码）
)

// decodeImage 打开并解码任意支持格式的图片
func decodeImage(path string) (stdimg.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("无法打开文件：%w", err)
	}
	defer f.Close()

	img, _, err := stdimg.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("解码失败（可能文件已损坏或格式不支持）：%w", err)
	}
	return img, nil
}

// isSupportedExt 判断文件扩展名是否受支持（供其他文件复用校验逻辑）
func isSupportedExt(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ValidExts[ext]
}
