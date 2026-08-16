package main

import (
	"fmt"
	"image/color"
	"strconv"
	"strings"
)

// 支持的图片扩展名，与原 Python 版本保持一致（外加 webp 已包含）
var validExts = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".bmp":  true,
	".gif":  true,
	".webp": true,
}

// parseHexColor 解析形如 "#RRGGBB" 的十六进制颜色字符串
func parseHexColor(s string) (color.RGBA, error) {
	s = strings.TrimSpace(s)
	if len(s) != 7 || s[0] != '#' {
		return color.RGBA{}, fmt.Errorf("颜色格式应为 #RRGGBB，实际为 %q", s)
	}
	r, err := strconv.ParseUint(s[1:3], 16, 8)
	if err != nil {
		return color.RGBA{}, err
	}
	g, err := strconv.ParseUint(s[3:5], 16, 8)
	if err != nil {
		return color.RGBA{}, err
	}
	b, err := strconv.ParseUint(s[5:7], 16, 8)
	if err != nil {
		return color.RGBA{}, err
	}
	return color.RGBA{R: uint8(r), G: uint8(g), B: uint8(b), A: 255}, nil
}
