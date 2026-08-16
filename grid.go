package main

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"os"
	"path/filepath"

	xdraw "golang.org/x/image/draw"
)

// GridOptions 控制拼图的排版与输出参数
type GridOptions struct {
	ThumbSize   int        // 每张缩略图的边长（正方形）
	Spacing     int        // 缩略图之间及四周的间距
	Background  color.RGBA // 画布背景色
	JPEGQuality int        // 输出 JPEG 质量 1-100
	Cols        int        // 手动指定列数，0 表示自动计算最接近正方形的布局
}

// ProgressFunc 用于报告拼图进度：done 为已处理张数，total 为总张数
type ProgressFunc func(done, total int)

// buildGrid 读取 paths 中的所有图片，中心裁剪为正方形、缩放到统一尺寸后
// 按网格布局拼接成一张大图，保存到 outputPath。
//
// 布局规则与原 Python 版本一致：
//
//	cols = ceil(sqrt(n))
//	rows = ceil(n / cols)
//
// 即优先保证列数，行数按需补齐，尽量接近正方形整体比例。
func buildGrid(paths []string, outputPath string, opts GridOptions, progress ProgressFunc) error {
	n := len(paths)
	if n == 0 {
		return fmt.Errorf("没有可用图片")
	}

	cols := opts.Cols
	if cols <= 0 {
		cols = int(math.Ceil(math.Sqrt(float64(n))))
	}
	if cols <= 0 {
		cols = 1
	}
	rows := int(math.Ceil(float64(n) / float64(cols)))

	thumb := opts.ThumbSize
	spacing := opts.Spacing

	canvasW := cols*thumb + (cols+1)*spacing
	canvasH := rows*thumb + (rows+1)*spacing

	canvas := image.NewRGBA(image.Rect(0, 0, canvasW, canvasH))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: opts.Background}, image.Point{}, draw.Src)

	for idx, path := range paths {
		if err := pasteThumbnail(canvas, path, idx, cols, thumb, spacing); err != nil {
			fmt.Printf("[ERROR] 处理失败 %s：%v\n", filepath.Base(path), err)
		}
		if progress != nil {
			progress(idx+1, n)
		}
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return fmt.Errorf("创建输出目录失败：%w", err)
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("创建输出文件失败：%w", err)
	}
	defer out.Close()

	if err := jpeg.Encode(out, canvas, &jpeg.Options{Quality: opts.JPEGQuality}); err != nil {
		return fmt.Errorf("编码 JPEG 失败：%w", err)
	}

	return nil
}

// pasteThumbnail 处理单张图片（中心裁剪为正方形 -> 高质量缩放 -> 粘贴到画布对应格子）
func pasteThumbnail(canvas *image.RGBA, path string, idx, cols, thumb, spacing int) error {
	img, err := decodeImage(path)
	if err != nil {
		return err
	}

	square := centerCropSquare(img)
	resized := resizeSquare(square, thumb)

	row := idx / cols
	col := idx % cols
	x := spacing + col*(thumb+spacing)
	y := spacing + row*(thumb+spacing)

	dstRect := image.Rect(x, y, x+thumb, y+thumb)
	draw.Draw(canvas, dstRect, resized, image.Point{}, draw.Src)

	return nil
}

// centerCropSquare 从图片中心裁剪出最大的正方形区域
func centerCropSquare(img image.Image) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	side := w
	if h < side {
		side = h
	}
	left := b.Min.X + (w-side)/2
	top := b.Min.Y + (h-side)/2
	rect := image.Rect(left, top, left+side, top+side)

	type subImager interface {
		SubImage(r image.Rectangle) image.Image
	}
	if si, ok := img.(subImager); ok {
		return si.SubImage(rect)
	}

	// 兜底：图片类型不支持 SubImage 时，手动复制像素
	cropped := image.NewRGBA(image.Rect(0, 0, side, side))
	draw.Draw(cropped, cropped.Bounds(), img, rect.Min, draw.Src)
	return cropped
}

// resizeSquare 将正方形图片高质量缩放到指定边长（等价于原版 PIL 的 LANCZOS 重采样）
func resizeSquare(img image.Image, size int) image.Image {
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), xdraw.Src, nil)
	return dst
}
