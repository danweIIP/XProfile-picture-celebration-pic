// XAvatarWall - 粉丝头像墙生成器（Go 版）
//
// 用法：
//
//	默认读取当前目录下的 avatars.json（油猴脚本「一键下载头像.js」导出的文件），
//	自动下载其中的头像后拼图，输出到 output/fans_grid.jpg
//	./xavatarwall -json ./avatars.json -output ./output/fans_grid.jpg -size 200 -spacing 4 -bg "#ADD8E6"
//
// 支持子命令风格的开关：
//
//	-dedupe         是否在拼图前做感知哈希去重（默认开启）
//	-dedupe=false   关闭去重
//	-threshold N    感知哈希汉明距离阈值，越小越严格（默认 2）
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

const (
	defaultJSONFile  = "avatars.json"
	defaultOutputDir = "output"
	defaultOutName   = "fans_grid.jpg"

	defaultThumbSize = 200
	defaultSpacing   = 4
	defaultBGHex     = "#ADD8E6"
	defaultThreshold = 2 // 感知哈希汉明距离阈值，默认取保守值（见 README）
	defaultQuality   = 95
)

func main() {
	jsonFile := flag.String("json", defaultJSONFile, "头像数据JSON文件路径（油猴脚本导出的文件）")
	outputPath := flag.String("output", "", "输出图片路径（默认 output/fans_grid.jpg）")
	thumbSize := flag.Int("size", defaultThumbSize, "每张头像缩略图的边长（像素）")
	spacing := flag.Int("spacing", defaultSpacing, "头像之间的间距（像素）")
	bgHex := flag.String("bg", defaultBGHex, "背景颜色，十六进制，如 #ADD8E6")
	quality := flag.Int("quality", defaultQuality, "JPEG 输出质量 1-100")
	dedupe := flag.Bool("dedupe", true, "是否启用感知哈希去重")
	threshold := flag.Int("threshold", defaultThreshold, "感知哈希去重的汉明距离阈值，越小越严格")
	deleteDup := flag.Bool("delete-duplicates", false, "发现重复图片后直接删除源文件（默认只跳过，不删除）")
	cols := flag.Int("cols", 0, "手动指定列数（默认自动计算最接近正方形的布局）")
	workers := flag.Int("workers", 8, "并发下载头像的线程数")

	flag.Parse()

	if *outputPath == "" {
		*outputPath = filepath.Join(defaultOutputDir, defaultOutName)
	}

	bg, err := parseHexColor(*bgHex)
	if err != nil {
		fatal("背景颜色格式错误：%v（应为形如 #ADD8E6 的十六进制颜色）", err)
	}

	if *thumbSize <= 0 {
		fatal("缩略图大小必须为正整数，当前为 %d", *thumbSize)
	}
	if *spacing < 0 {
		fatal("间距不能为负数，当前为 %d", *spacing)
	}
	if *quality <= 0 || *quality > 100 {
		fatal("JPEG 质量必须在 1-100 之间，当前为 %d", *quality)
	}

	paths, tempDir, err := downloadAvatarsFromJSON(*jsonFile, *workers)
	if tempDir != "" {
		defer os.RemoveAll(tempDir)
	}
	if err != nil {
		// fatal 通过 os.Exit 退出，不会执行 defer，这里需要先手动清理临时目录
		if tempDir != "" {
			os.RemoveAll(tempDir)
		}
		fatal("%v", err)
	}

	if *dedupe {
		groups, err := findDuplicates(paths, *threshold)
		if err != nil {
			fmt.Printf("[WARN] 去重扫描出现错误：%v（将继续使用全部图片）\n", err)
		} else if len(groups) == 0 {
			fmt.Println("[OK] 未发现重复图片")
		} else {
			total := 0
			for _, g := range groups {
				total += len(g)
			}
			fmt.Printf("[WARN] 发现 %d 组重复，共 %d 张\n", len(groups), total)
			keep := make(map[string]bool, len(paths))
			for _, p := range paths {
				keep[p] = true
			}
			for i, g := range groups {
				fmt.Printf("       重复组 %d：保留 %s\n", i+1, filepath.Base(g[0]))
				for _, p := range g[1:] {
					fmt.Printf("                 跳过 %s\n", filepath.Base(p))
					keep[p] = false
					if *deleteDup {
						if err := os.Remove(p); err != nil {
							fmt.Printf("[ERROR] 删除失败 %s：%v\n", filepath.Base(p), err)
						} else {
							fmt.Printf("[OK]    已删除 %s\n", filepath.Base(p))
						}
					}
				}
			}
			filtered := paths[:0]
			for _, p := range paths {
				if keep[p] {
					filtered = append(filtered, p)
				}
			}
			paths = filtered
		}
	}

	if len(paths) == 0 {
		fatal("去重后没有剩余图片，无法拼图")
	}

	opts := GridOptions{
		ThumbSize:   *thumbSize,
		Spacing:     *spacing,
		Background:  bg,
		JPEGQuality: *quality,
		Cols:        *cols,
	}

	if err := buildGrid(paths, *outputPath, opts, nil); err != nil {
		fatal("拼图失败：%v", err)
	}

	fmt.Printf("[OK] 拼图完成，共处理 %d 张图片\n", len(paths))
	fmt.Printf("[OK] 已保存到：%s\n", mustAbs(*outputPath))
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[ERROR] "+format+"\n", args...)
	os.Exit(1)
}

func mustAbs(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}
