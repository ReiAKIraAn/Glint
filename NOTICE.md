# 第三方数据声明

Glint 的**代码**以 [MIT](LICENSE) 发布。**词库数据**来自下面三份公开数据集，按各自的条款分发，不适用 MIT。

## 涉及的文件

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `data/cefrj-vocabulary-profile-1.5.csv` | 原始数据，未修改 | CEFR-J |
| `data/octanove-vocabulary-profile-c1c2-1.0.csv` | 原始数据，未修改 | Octanove |
| `data/ecdict.csv` | 原始数据，**不入库**，按 README 下载 | ECDICT |
| `src/assets/lexicon.json` | `scripts/build-data.ts` 加工产物：等级表、不规则变形表 | 三份都有 |
| `public/data/dict.json` | 同上：音标（修复过编码）、释义、标签 | ECDICT |
| `public/data/exams.json` | 同上：六份考纲词表 | ECDICT |

因为 `lexicon.json` 混入了 Octanove 的 CC BY-SA 数据，**上面三个加工产物整体按 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 发布**。拿去用的话，需要署名并以相同方式共享。

## 各数据集的条款

### ECDICT

- 作者：skywind3000
- 地址：https://github.com/skywind3000/ECDICT
- 许可：MIT

### CEFR-J Vocabulary Profile 1.5

- 版权：Tono Laboratory, Tokyo University of Foreign Studies
- 整理发布：Open Language Profiles，https://github.com/openlanguageprofiles/olp-en-cefrj
- 条款：可免费用于研究和商业用途，**前提是正确注明出处**。数据按原样提供，CEFR-J 和 Open Language Profiles 均不对数据错误或由此造成的损失负责。

### Octanove Vocabulary Profile C1/C2 1.0

- 作者：Octanove Labs，http://www.octanove.com/
- 整理发布：Open Language Profiles，https://github.com/openlanguageprofiles/olp-en-cefrj
- 许可：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

## 对原始数据做过的改动

`scripts/build-data.ts` 是全部改动的唯一来源，主要包括：修复 ECDICT 音标字段的编码损坏并归一化为 IPA，剔除可由规则还原的词形变化，丢弃只有 BNC 排名、没有其它词典信号的条目，以及人工分级与词频分级取较简单的一级。
