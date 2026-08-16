package network

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// buildTransport 根据 -proxy 参数创建 HTTP 传输层，自动识别代理类型。
// 支持 http://、https://、socks5://、socks5h://；不带协议前缀时默认按 HTTP 代理处理。
func buildTransport(proxyURL string) (*http.Transport, error) {
	transport := &http.Transport{}
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL == "" {
		return transport, nil
	}
	// 没写协议前缀（如 127.0.0.1:7890）时，默认按 HTTP 代理处理
	if !strings.Contains(proxyURL, "://") {
		proxyURL = "http://" + proxyURL
	}

	u, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("代理地址格式错误：%v", err)
	}

	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		transport.Proxy = http.ProxyURL(u)
	case "socks5", "socks5h":
		if u.Host == "" {
			return nil, fmt.Errorf("SOCKS5 代理地址缺少 host:port")
		}
		user, pass := "", ""
		if u.User != nil {
			user = u.User.Username()
			pass, _ = u.User.Password()
		}
		transport.DialContext = socks5DialContext(u.Host, user, pass)
	default:
		return nil, fmt.Errorf("不支持的代理类型：%s（支持 http/https/socks5）", u.Scheme)
	}
	return transport, nil
}

// socks5DialContext 返回一个 SOCKS5 拨号函数，支持无认证和用户名/密码认证。
func socks5DialContext(proxyAddr, user, pass string) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		d := net.Dialer{}
		conn, err := d.DialContext(ctx, "tcp", proxyAddr)
		if err != nil {
			return nil, fmt.Errorf("连接 SOCKS5 代理失败：%v", err)
		}
		if err := socks5Handshake(conn, user, pass, addr); err != nil {
			conn.Close()
			return nil, err
		}
		return conn, nil
	}
}

// socks5Handshake 完成 SOCKS5 握手：方法协商、可选用户名/密码认证、CONNECT 请求。
func socks5Handshake(conn net.Conn, user, pass, target string) error {
	conn.SetDeadline(time.Now().Add(15 * time.Second))
	defer conn.SetDeadline(time.Time{})

	// 方法协商：同时声明支持无认证（0x00）和用户名密码认证（0x02）
	greeting := []byte{0x05, 0x02, 0x00, 0x02}
	if _, err := conn.Write(greeting); err != nil {
		return fmt.Errorf("SOCKS5 方法协商失败：%v", err)
	}
	reply := make([]byte, 2)
	if _, err := io.ReadFull(conn, reply); err != nil {
		return fmt.Errorf("SOCKS5 方法协商失败：%v", err)
	}
	if reply[0] != 0x05 {
		return fmt.Errorf("SOCKS5 代理返回非法协议版本：%d", reply[0])
	}

	switch reply[1] {
	case 0x00: // 无认证
	case 0x02: // 用户名密码认证
		req := []byte{0x01, byte(len(user))}
		req = append(req, user...)
		req = append(req, byte(len(pass)))
		req = append(req, pass...)
		if _, err := conn.Write(req); err != nil {
			return fmt.Errorf("SOCKS5 认证失败：%v", err)
		}
		authReply := make([]byte, 2)
		if _, err := io.ReadFull(conn, authReply); err != nil {
			return fmt.Errorf("SOCKS5 认证失败：%v", err)
		}
		if authReply[1] != 0x00 {
			return fmt.Errorf("SOCKS5 认证被拒绝")
		}
	default:
		return fmt.Errorf("SOCKS5 代理不支持可用的认证方式（0x%02x）", reply[1])
	}

	// CONNECT 请求：目标地址支持域名（0x03）、IPv4（0x01）、IPv6（0x04）
	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		return fmt.Errorf("无法解析目标地址 %q：%v", target, err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 0 || port > 65535 {
		return fmt.Errorf("目标端口无效：%s", portStr)
	}

	var atyp byte
	var addrBytes []byte
	if ip := net.ParseIP(host); ip != nil {
		if v4 := ip.To4(); v4 != nil {
			atyp = 0x01
			addrBytes = v4
		} else {
			atyp = 0x04
			addrBytes = ip.To16()
		}
	} else {
		if len(host) > 255 {
			return fmt.Errorf("目标域名过长")
		}
		atyp = 0x03
		addrBytes = []byte{byte(len(host))}
		addrBytes = append(addrBytes, host...)
	}

	req := []byte{0x05, 0x01, 0x00, atyp}
	req = append(req, addrBytes...)
	req = append(req, byte(port>>8), byte(port&0xff))
	if _, err := conn.Write(req); err != nil {
		return fmt.Errorf("SOCKS5 CONNECT 请求失败：%v", err)
	}

	head := make([]byte, 4)
	if _, err := io.ReadFull(conn, head); err != nil {
		return fmt.Errorf("SOCKS5 CONNECT 响应失败：%v", err)
	}
	if head[1] != 0x00 {
		return fmt.Errorf("SOCKS5 CONNECT 失败，状态码 0x%02x", head[1])
	}
	// 跳过 BND.ADDR 和 BND.PORT
	switch head[3] {
	case 0x01:
		if _, err := io.CopyN(io.Discard, conn, 4+2); err != nil {
			return fmt.Errorf("SOCKS5 读取 BND 地址失败：%v", err)
		}
	case 0x03:
		lenBuf := make([]byte, 1)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			return fmt.Errorf("SOCKS5 读取 BND 地址失败：%v", err)
		}
		if _, err := io.CopyN(io.Discard, conn, int64(lenBuf[0])+2); err != nil {
			return fmt.Errorf("SOCKS5 读取 BND 地址失败：%v", err)
		}
	case 0x04:
		if _, err := io.CopyN(io.Discard, conn, 16+2); err != nil {
			return fmt.Errorf("SOCKS5 读取 BND 地址失败：%v", err)
		}
	default:
		return fmt.Errorf("SOCKS5 返回未知地址类型：%d", head[3])
	}

	return nil
}
