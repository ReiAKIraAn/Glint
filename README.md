# Glint

阅读英文网页时，按你的水平把难词标出来。鼠标停上去，看它在**这一句**里的意思。

## 功能

- **按水平标词**：选你的 CEFR 等级（A1–C2），或者你通过的考试（中考 / 高考 / 四级 / 六级），高于这个水平的词才会被标出来。
- **备考模式**：只标四级、六级、考研、托福、雅思、GRE 词表里的词。
- **悬浮卡片**：音标、发音、中文释义、考试标签都从本地词库查，不联网。配了 API Key 的话，还能让 AI 解释这个词在当前句子里的意思。
- **我的词**：点「认识」的词以后不再标。已生成的释义可以导出到 Anki，设置和词表可以备份成 JSON。
- **按网站关闭**：在工具栏弹窗里一键关掉当前网站的标注。

难度判定完全在本地完成，不调用 AI。只有你主动点了 AI 释义，才会发出网络请求。详见 [PRIVACY.md](PRIVACY.md)。

## AI 释义

用你自己的 API Key，在设置页里选服务商、填 Key 和模型名。支持：

- Anthropic、OpenAI、Google Gemini
- OpenRouter、OpenCode Zen、硅基流动
- DeepSeek、Kimi、智谱 GLM、Groq
- Ollama（本机，不用 Key）
- 任意 OpenAI 兼容接口

不配 Key 也能用，只是卡片上没有 AI 语境释义。

## 键盘

| 键 | 作用 |
| --- | --- |
| `Alt+G` | 跳到下一个标注的词，弹出卡片 |
| `Alt+Shift+G` | 上一个 |
| `Esc` | 收起卡片 |

可以在 `chrome://extensions/shortcuts` 里改键。

浏览器需要支持 CSS Custom Highlight API：Chrome 128+、Safari 17.2+、Firefox 140+。

## 开发

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` 会自动打开一个装好扩展的浏览器。

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 打包到 `.output/chrome-mv3`，可在 `chrome://extensions` 里「加载已解压的扩展程序」 |
| `pnpm zip` | 打成上架用的 zip |
| `pnpm test` | 跑测试 |
| `pnpm compile` | 类型检查 |
| `pnpm demo` | 预览沙盒，不装扩展也能调标注效果、设置页和弹窗 |

词库索引已经提交在仓库里。只有修改 `scripts/build-data.ts` 后才需要重新生成，先下载 66 MB 的原始词典：

```bash
curl -L -o data/ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
```

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm data
```

## 许可

代码以 [MIT](LICENSE) 发布。

词库来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT）、[CEFR-J Vocabulary Profile](https://github.com/openlanguageprofiles/olp-en-cefrj)（注明出处即可免费使用）和 Octanove C1/C2 Profile（CC BY-SA 4.0）。加工出来的索引文件按 CC BY-SA 4.0 发布，详见 [NOTICE.md](NOTICE.md)。

---

## Safari Personal Edition 文档索引

- [最终发布基线 (Release Baseline)](docs/release-baseline.md)
- [最终系统架构手册 (Final Architecture)](docs/final-architecture.md)
- [WebKit 引擎依赖清单 (Safari/WebKit Dependencies)](docs/safari-webkit-dependencies.md)
- [未来 Safari 升级指引 (Future Safari Upgrade)](docs/future-safari-upgrade.md)
- [长期维护与缺陷准入政策 (Maintenance Policy)](docs/maintenance-policy.md)
- [灾难恢复与异常排查指南 (Recovery Guide)](docs/recovery-guide.md)
- [最终技术签收报告 (Long-Term Freeze Report)](docs/long-term-freeze-report.md)
- [发布候选与最终审计报告 (Final RC Report)](docs/final-report.md)
- [全景功能对等报告 (Feature Parity Closure)](docs/feature-parity-closure.md)
