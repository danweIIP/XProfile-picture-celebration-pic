package network

import (
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/pelletier/go-toml"

	"xavatarwall/image"
)

// AvatarInfo 对应油猴脚本「一键下载头像.js」导出的 TOML 条目：
//
//	[[avatar]]
//	username = "alice"
//	avatar = "https://pbs.twimg.com/..."
//	time = 1700000000000
//	order = 1
type AvatarInfo struct {
	Username string `toml:"username"`
	Avatar   string `toml:"avatar"`
	Time     int64  `toml:"time"`
	Order    int    `toml:"order"`
}

// AvatarList 是 TOML 文件的顶层结构
type AvatarList struct {
	Avatars []AvatarInfo `toml:"avatar"`
}

// DownloadAvatarsFromConfig 读取油猴脚本导出的 TOML，以 workers 为并发上限发起下载请求，
// 结果逐个接收；瞬时错误（超时、网络异常、5xx/429）自动重试 3 次并带随机抖动，
// 永久错误或重试仍失败的头像自动忽略。相同 URL 只下载一次。
// 返回值为成功下载的本地文件路径列表（保持 TOML 顺序）和临时目录，
// 临时目录需要由调用方负责清理（defer os.RemoveAll）。
func DownloadAvatarsFromConfig(configPath string, workers int, proxyURL string) ([]string, string, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, "", fmt.Errorf("读取头像数据文件失败：%w", err)
	}

	var list AvatarList
	if err := toml.Unmarshal(data, &list); err != nil {
		return nil, "", fmt.Errorf("读取头像数据文件失败（请确认是「一键下载头像.js」导出的 TOML 格式）：%w", err)
	}

	avatars := list.Avatars
	if len(avatars) == 0 {
		return nil, "", fmt.Errorf("TOML文件中没有头像数据")
	}

	// 过滤掉没有 avatar URL 的条目，并按最终请求的 URL 去重
	// （_normal/_bigger 等不同尺寸会升级到同一个 _400x400 地址，按升级后地址判断）
	seen := make(map[string]string)
	var jobs []AvatarInfo
	for _, a := range avatars {
		if strings.TrimSpace(a.Avatar) == "" {
			fmt.Printf("已跳过 %s（缺少头像链接）\n", labelOf(a))
			continue
		}
		key := upgradeAvatarURL(strings.TrimSpace(a.Avatar))
		if first, ok := seen[key]; ok {
			fmt.Printf("已跳过 %s（头像与 %s 相同）\n", labelOf(a), first)
			continue
		}
		seen[key] = labelOf(a)
		jobs = append(jobs, a)
	}
	if len(jobs) == 0 {
		return nil, "", fmt.Errorf("TOML文件中没有任何带 avatar URL 的头像")
	}

	transport, err := buildTransport(proxyURL)
	if err != nil {
		return nil, "", err
	}

	// 下载前先探测头像服务器是否可访问，避免服务器不通时逐张等待超时
	checkClient := &http.Client{Transport: transport, Timeout: 8 * time.Second}
	if err := checkAvatarServer(jobs, checkClient); err != nil {
		return nil, "", err
	}

	tempDir, err := os.MkdirTemp("", "xavatarwall-*")
	if err != nil {
		return nil, "", fmt.Errorf("创建临时目录失败：%w", err)
	}
	if workers <= 0 {
		workers = 50
	}

	client := &http.Client{Transport: transport, Timeout: 30 * time.Second}

	type result struct {
		index int
		path  string
		err   error
	}

	resultCh := make(chan result, len(jobs))
	jobCh := make(chan int)

	// 高并发但设上限：workers 个 worker 同时消费任务，任务源源不断送入
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobCh {
				path, err := downloadAvatarWithRetry(client, jobs[i], i, tempDir, 3)
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
	success, failures, done := 0, 0, 0
	for r := range resultCh {
		done++
		if r.err != nil {
			failures++
		} else {
			success++
			ordered[r.index] = r.path
		}
		if done < len(jobs) && done%20 == 0 {
			fmt.Printf("下载进度：%d/%d（成功 %d，失败 %d）\n", done, len(jobs), success, failures)
		}
	}
	fmt.Printf("下载完成：成功 %d，失败 %d\n", success, failures)

	// 按 TOML 顺序整理成功下载的路径
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

// downloadAvatarWithRetry 下载单个头像，最多尝试 attempts 次。
// 只有瞬时错误才重试（网络异常、超时、5xx/429），每次重试前随机抖动退避；
// 4xx 等永久错误直接放弃。全部失败返回最后一次错误。
func downloadAvatarWithRetry(client *http.Client, avatar AvatarInfo, index int, dir string, attempts int) (string, error) {
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		path, err := downloadAvatar(client, avatar, index, dir)
		if err == nil {
			return path, nil
		}
		lastErr = err
		if !isRetryable(err) {
			break
		}
		if attempt < attempts {
			// 随机抖动退避：基础 1s、2s... + 0~500ms，避免所有失败请求同时重试
			base := time.Duration(attempt) * time.Second
			jitter := time.Duration(rand.IntN(500)) * time.Millisecond
			time.Sleep(base + jitter)
		}
	}
	return "", lastErr
}

// httpStatusError 携带 HTTP 状态码的错误，便于判断是否值得重试。
type httpStatusError struct {
	code int
	msg  string
}

func (e *httpStatusError) Error() string {
	return e.msg
}

func (e *httpStatusError) StatusCode() int {
	return e.code
}

// isRetryable 判断错误是否值得重试：429/5xx 属于服务器瞬时状态，网络层错误也视为瞬时；
// 4xx 等其他 HTTP 状态是永久错误，不值得重试。
func isRetryable(err error) bool {
	var se *httpStatusError
	if errors.As(err, &se) {
		return se.code == 408 || se.code == 425 || se.code == 429 || se.code >= 500
	}
	return true
}

// checkAvatarServer 在正式下载前用第一条头像 URL 探测服务器连通性（经由同一个代理）。
// 只要服务器有响应（哪怕 4xx/5xx）就算可访问；只有网络层错误（DNS/TCP/TLS/超时）才报错。
func checkAvatarServer(avatars []AvatarInfo, client *http.Client) error {
	var probe string
	for _, a := range avatars {
		if u := strings.TrimSpace(a.Avatar); u != "" {
			probe = u
			break
		}
	}
	if probe == "" {
		return nil
	}

	host := probe
	if u, err := url.Parse(probe); err == nil && u.Host != "" {
		host = u.Host
	}
	fmt.Printf("正在检查头像服务器连通性（%s）...\n", host)

	req, err := http.NewRequest(http.MethodHead, probe, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; XAvatarWall/1.0)")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("无法访问 %s：%v", host, err)
	}
	resp.Body.Close()
	fmt.Println("头像服务器可访问，开始下载")
	return nil
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
		return "", &httpStatusError{code: resp.StatusCode, msg: fmt.Sprintf("HTTP状态码 %d", resp.StatusCode)}
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
		if image.ValidExts[ext] {
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
