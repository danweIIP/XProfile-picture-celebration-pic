// XAvatarWall - 粉丝头像墙生成器（Go 版）
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"xavatarwall/image"
	"xavatarwall/network"
)

const (
	defaultConfigFile = "avatars.toml"
	defaultOutputDir  = ""
	defaultOutName    = "fans_grid.png"

	defaultThumbSize = 200
	defaultSpacing   = 4
	defaultBGHex     = "#ADD8E6"
	defaultThreshold = 2
)

func main() {
	fs := flag.NewFlagSet("xavatarwall", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.Usage = func() {} // 错误提示统一由下方中文输出

	configFile := fs.String("config", defaultConfigFile, "头像数据 TOML 文件路径（油猴脚本导出的文件）")
	outputPath := fs.String("output", "", "输出图片路径（默认 fans_grid.png）")
	proxy := fs.String("proxy", "", "下载时使用的代理，如 socks5://127.0.0.1:1080 或 http://127.0.0.1:7890（自动识别类型）")
	thumbSize := fs.Int("size", defaultThumbSize, "每张头像缩略图的边长（像素）")
	spacing := fs.Int("spacing", defaultSpacing, "头像之间的间距（像素）")
	bgHex := fs.String("bg", defaultBGHex, "背景颜色，十六进制，如 #ADD8E6")
	dedupe := fs.Bool("dedupe", true, "是否启用感知哈希去重")
	threshold := fs.Int("threshold", defaultThreshold, "感知哈希去重的汉明距离阈值，越小越严格")
	deleteDup := fs.Bool("delete-duplicates", false, "发现重复图片后直接删除源文件（默认只跳过，不删除）")
	cols := fs.Int("cols", 0, "手动指定列数（默认自动计算最接近正方形的布局）")
	workers := fs.Int("workers", 8, "并发下载头像的线程数")

	if err := fs.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			printUsage(os.Stdout)
			os.Exit(0)
		}
		fmt.Fprintf(os.Stderr, "参数错误：%s\n\n", translateFlagErr(err))
		printUsage(os.Stderr)
		os.Exit(2)
	}

	if *outputPath == "" {
		*outputPath = filepath.Join(defaultOutputDir, defaultOutName)
	}

	bg, err := image.ParseHexColor(*bgHex)
	if err != nil {
		fatal("背景颜色格式错误：%v（应为形如 #ADD8E6 的十六进制颜色）", err)
	}

	if *thumbSize <= 0 {
		fatal("缩略图大小必须为正整数，当前为 %d", *thumbSize)
	}
	if *spacing < 0 {
		fatal("间距不能为负数，当前为 %d", *spacing)
	}
	paths, tempDir, err := network.DownloadAvatarsFromConfig(*configFile, *workers, *proxy)
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
		groups, err := image.FindDuplicates(paths, *threshold)
		if err != nil {
			fmt.Printf("去重扫描出现错误：%v（将继续使用全部图片）\n", err)
		} else if len(groups) == 0 {
			fmt.Println("未发现重复图片")
		} else {
			total := 0
			for _, g := range groups {
				total += len(g)
			}
			fmt.Printf("发现 %d 组重复，共 %d 张\n", len(groups), total)
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
							fmt.Printf("删除失败 %s：%v\n", filepath.Base(p), err)
						} else {
							fmt.Printf("已删除 %s\n", filepath.Base(p))
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

	opts := image.GridOptions{
		ThumbSize:  *thumbSize,
		Spacing:    *spacing,
		Background: bg,
		Cols:       *cols,
	}

	if err := image.BuildGrid(paths, *outputPath, opts, nil); err != nil {
		fatal("拼图失败：%v", err)
	}

	fmt.Printf("拼图完成，共处理 %d 张图片\n", len(paths))
	fmt.Printf("已保存到：%s\n", mustAbs(*outputPath))
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "错误："+format+"\n", args...)
	os.Exit(1)
}

// printUsage 输出中文参数说明。
func printUsage(w io.Writer) {
	fmt.Fprintln(w, "用法：xavatarwall [参数]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "默认读取当前目录下的 avatars.toml（油猴脚本「一键下载头像.js」导出的文件），自动下载头像、去重并拼图。")
	fmt.Fprintln(w, "示例：xavatarwall -config X_avatar_v0.7_1786883236271.toml -output fans_grid.png")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "参数：")
	fmt.Fprintln(w, "  -config <文件>         头像数据 TOML 文件（默认 avatars.toml）")
	fmt.Fprintln(w, "  -output <路径>         输出图片路径（默认 fans_grid.png）")
	fmt.Fprintln(w, "  -proxy <地址>          下载代理，支持 http/https/socks5（默认直连）")
	fmt.Fprintln(w, "  -size <像素>           每张头像缩略图边长（默认 200）")
	fmt.Fprintln(w, "  -spacing <像素>        头像间距（默认 4）")
	fmt.Fprintln(w, "  -bg <颜色>             背景颜色，如 #ADD8E6（默认 #ADD8E6）")
	fmt.Fprintln(w, "  -dedupe[=true|false]   是否启用感知哈希去重（默认 true）")
	fmt.Fprintln(w, "  -threshold <整数>      去重汉明距离阈值，越小越严格（默认 2）")
	fmt.Fprintln(w, "  -delete-duplicates     去重时直接删除重复的源文件（默认只跳过）")
	fmt.Fprintln(w, "  -cols <整数>           手动指定列数（默认自动）")
	fmt.Fprintln(w, "  -workers <整数>        并发下载线程数（默认 8）")
	fmt.Fprintln(w, "  -h / -help             显示本帮助")
}

var invalidValueRe = regexp.MustCompile(`^invalid value "([^"]*)" for flag (-[^:]+): (.+)$`)

// translateFlagErr 把 Go flag 包报的英文错误翻译成中文。
func translateFlagErr(err error) string {
	msg := err.Error()
	switch {
	case strings.HasPrefix(msg, "flag provided but not defined: "):
		return "未定义的参数：" + strings.TrimPrefix(msg, "flag provided but not defined: ")
	case strings.HasPrefix(msg, "flag needs an argument: "):
		return "参数缺少值：" + strings.TrimPrefix(msg, "flag needs an argument: ")
	}
	if m := invalidValueRe.FindStringSubmatch(msg); m != nil {
		return fmt.Sprintf("参数 %s 的值 %q 无效：%s", m[2], m[1], m[3])
	}
	return msg
}

func mustAbs(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}
