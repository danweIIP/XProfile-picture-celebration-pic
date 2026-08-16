package main

import (
	"fmt"

	"github.com/corona10/goimagehash"
)

// findDuplicates 用感知哈希（pHash）对一批图片两两比较，找出相似组。
// threshold 是汉明距离阈值：两张图的 pHash 汉明距离 <= threshold 时视为重复。
// 返回值：每个重复组是一个路径切片，组内第一个元素为"保留"的那张，其余为重复项。
// 与文件内容 MD5 去重不同，pHash 能识别"看起来相同但字节不同"的图片（不同分辨率、
// 重新编码、轻微压缩等），更贴近"这其实是同一张头像"的直觉判断。
func findDuplicates(paths []string, threshold int) ([][]string, error) {
	type hashed struct {
		path string
		hash *goimagehash.ImageHash
	}

	var items []hashed
	for _, p := range paths {
		img, err := decodeImage(p)
		if err != nil {
			// 单张图片解码失败不应中断整个去重流程，跳过并继续
			fmt.Printf("去重扫描时无法读取 %s：%v\n", p, err)
			continue
		}
		h, err := goimagehash.PerceptionHash(img)
		if err != nil {
			fmt.Printf("计算感知哈希失败 %s：%v\n", p, err)
			continue
		}
		items = append(items, hashed{path: p, hash: h})
	}

	visited := make([]bool, len(items))
	var groups [][]string

	for i := 0; i < len(items); i++ {
		if visited[i] {
			continue
		}
		group := []string{items[i].path}
		for j := i + 1; j < len(items); j++ {
			if visited[j] {
				continue
			}
			dist, err := items[i].hash.Distance(items[j].hash)
			if err != nil {
				continue
			}
			if dist <= threshold {
				group = append(group, items[j].path)
				visited[j] = true
			}
		}
		visited[i] = true
		if len(group) > 1 {
			groups = append(groups, group)
		}
	}

	return groups, nil
}
