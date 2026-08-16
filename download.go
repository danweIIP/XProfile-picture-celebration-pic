package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// AvatarInfo 对应油猴脚本「一键下载头像.js」导出的 JSON 条目：
//
//	[{"username":"alice","avatar":"https://pbs.twimg.com/...","time":1700000000000,"order":1}, ...]
type AvatarInfo struct {
	Username string `json:"username"`
	Avatar   string `json:"avatar"`
	Time     int64  `json:"time"`
	Order    int    `json:"order"`
}

// downloadAvatarsFromJSON 读取油猴脚本导出的 JSON，把其中的头像 URL 并发下载到
// 临时目录。返回值为成功下载的本地文件路径列表（保持 JSON 顺序）和临时目录，
// 临时目录需要由调用方负责清理（defer os.RemoveAll）。
func downloadAvatarsFromJSON(jsonPath string, workers int) ([]string, string, error) {
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return nil, "", fmt.Errorf("读取JSON文件失败：%w", err)
	}

	var avatars []AvatarInfo
	if err := json.Unmarshal(data, &avatars); err != nil {
		return nil, "", fmt.Errorf("解析JSON文件失败（请确认是「一键下载头像.js」导出的格式）：%w", err)
	}
	if len(avatars) == 0 {
		return nil, "", fmt.Errorf("JSON文件中没有头像数据")
	}

	// 过滤掉没有 avatar URL 的条目
	var jobs []AvatarInfo
	for _, a := range avatars {
		if strings.TrimSpace(a.Avatar) == "" {
			fmt.Printf("[WARN] 跳过 %s：缺少 avatar URL\n", labelOf(a))
			continue
		}
		jobs = append(jobs, a)
	}
	if len(jobs) == 0 {
		return nil, "", fmt.Errorf("JSON文件中没有任何带 avatar URL 的头像")
	}

	tempDir, err := os.MkdirTemp("", "xavatarwall-*")
	if err != nil {
		return nil, "", fmt.Errorf("创建临时目录失败：%w", err)
	}
	if workers <= 0 {
		workers = 8
	}

	client := &http.Client{Timeout: 30 * time.Second}

	type result struct {
		index int
		path  string
		err   error
	}

	jobCh := make(chan int)
	resultCh := make(chan result, len(jobs))

	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobCh {
				path, err := downloadAvatar(client, jobs[i], i, tempDir)
				resultCh <- result{index: i, path: path, err: err}
			}
		}()
	}

	go func() {
		for i := range jobs {
			jobCh <- i
		}
		close(jobCh)
		wg.Wait()
		close(resultCh)
	}()

	ordered := make([]string, len(jobs))
	failures := 0
	for r := range resultCh {
		if r.err != nil {
			failures++
		} else {
			ordered[r.index] = r.path
		}
	}

	if failures > 0 {
		fmt.Printf("[WARN] 共 %d 个头像，成功 %d 个，失败 %d 个\n", len(jobs), len(jobs)-failures, failures)
	}

	// 按 JSON 顺序整理成功下载的路径
	paths := make([]string, 0, len(jobs))
	for _, p := range ordered {
		if p != "" {
			paths = append(paths, p)
		}
	}
	if len(paths) == 0 {
		return nil, tempDir, fmt.Errorf("没有成功下载任何头像")
	}

	return paths, tempDir, nil
}

// downloadAvatar 下载单个头像并保存到 dir，文件名尽量带上用户名方便排查。
func downloadAvatar(client *http.Client, avatar AvatarInfo, index int, dir string) (string, error) {
	rawURL := upgradeAvatarURL(avatar.Avatar)

	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "", fmt.Errorf("无效的URL：%w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; XAvatarWall/1.0)")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP状态码 %d", resp.StatusCode)
	}

	ext := getFileExtension(rawURL, resp.Header.Get("Content-Type"))
	base := sanitizeUsername(avatar.Username)
	if base == "" {
		base = fmt.Sprintf("avatar_%06d", index+1)
	} else {
		base = fmt.Sprintf("%04d_%s", index+1, base)
	}
	path := filepath.Join(dir, base+ext)

	file, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("创建文件失败：%w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, resp.Body); err != nil {
		return "", fmt.Errorf("保存文件失败：%w", err)
	}
	return path, nil
}

// getFileExtension 优先从 URL 路径取扩展名，取不到再按 Content-Type 推断，兜底 .jpg。
func getFileExtension(rawURL, contentType string) string {
	if u, err := url.Parse(rawURL); err == nil {
		ext := strings.ToLower(filepath.Ext(u.Path))
		if validExts[ext] {
			return ext
		}
	}

	switch strings.TrimSpace(strings.Split(contentType, ";")[0]) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/bmp":
		return ".bmp"
	default:
		return ".jpg"
	}
}

// 头像 URL 里常见的小尺寸后缀，统一升级为 400x400，避免拼图模糊。
var smallAvatarSuffixes = []string{
	"_mini",
	"_normal",
	"_bigger",
	"_reasonably_small",
	"_200x200",
}

// upgradeAvatarURL 把 X(Twitter) 头像 URL 中的小尺寸后缀替换成 _400x400。
// 油猴脚本抓到的 img.src 通常是 _normal（约48px），直接拼 200px 的墙会模糊。
func upgradeAvatarURL(rawURL string) string {
	for _, s := range smallAvatarSuffixes {
		old := s + "."
		if strings.Contains(rawURL, old) {
			return strings.Replace(rawURL, old, "_400x400.", 1)
		}
	}
	return rawURL
}

var invalidFileChars = regexp.MustCompile(`[^\w.-]`)

// sanitizeUsername 把用户名清洗成安全的文件名。
func sanitizeUsername(name string) string {
	name = strings.TrimSpace(name)
	name = invalidFileChars.ReplaceAllString(name, "_")
	name = strings.Trim(name, "_.")
	if len(name) > 60 {
		name = name[:60]
	}
	return name
}

// labelOf 生成日志里的人类可读标识。
func labelOf(a AvatarInfo) string {
	if a.Username != "" {
		return fmt.Sprintf("@%s", a.Username)
	}
	return "无名用户"
}
