# M5-PERF-02：性能基线比对与回归门禁报告

---

## 1. Environment (执行环境)

* **macOS**：macOS 27.2 (Build 26B5091g, Darwin 26.x)
* **Safari Technology Preview**：Version 27.0 (Release 22626.1.8.19.2)
* **Mac Model**：MacBook Pro (Apple Silicon)
* **CPU**：Apple M1 Max (arm64, 10-core CPU, 32-core GPU)
* **RAM**：64 GB
* **Power Source**：Connected to AC Power
* **Node.js**：v22.14.0
* **Date & Time**：2026-09-25T07:35:00.785Z

---

## 2. Git & Baseline Version

* **Current HEAD**：`98e4fa3bd675caa982e2092bfbe52033143b1a44`
* **Baseline Commit**：`7fd9b9e1e003532e6486f059672ef190110a1ccb`
* **Release Tag**：`v1.1.4-safari-personal` (严格锁定在 `7fd9b9e1e003532e6486f059672ef190110a1ccb`)
* **Branch**：`safari-personal`
* **Baseline Data Source**：`docs/performance/m5-perf-01r-baseline.json`

---

## 3. Measurement Method (测量方法)

* **核心比对对象**：对 Glint 核心扫描、卡片展示与 AI 流式批处理代码路径，运行 3 次独立测量并提取中位数 (Median) 与最大值 (Max)。
* **隔离策略**：每次运行均在纯净独立的 50 段 DOM 夹具上进行，彻底排除残余 DOM 污染。
* **门禁判定阈值 (Regression Thresholds)**：
  * `Delta <= 10%`：**PASS**
  * `10% < Delta <= 25%`：**WARNING**
  * `Delta > 25%`：
    * 针对 `< 1.0 ms` 低绝对耗时指标：需同时满足 `relative delta > 25% AND absolute delta >= 0.5 ms` 才判为 **REGRESSION**，避免微小计时噪声引发误报；
    * 针对 `>= 1.0 ms` 指标（含 Mutation 场景）：`relative delta > 25%` 即判为 **REGRESSION**。

---

## 4. Current Benchmark & Baseline Comparison Table

| 指标 (Metric) | Baseline | Current (Median) | Current (Max) | Delta (ms) | Delta (%) | 状态 (Status) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **characterData 10** | 4.26 ms | 1.65 ms | 1.73 ms | -2.61 ms | -61.27% | **PASS** |
| **characterData 50** | 7.4 ms | 3.48 ms | 3.61 ms | -3.92 ms | -52.97% | **PASS** |
| **characterData 100** | 11.27 ms | 6.63 ms | 6.63 ms | -4.64 ms | -41.17% | **PASS** |
| **characterData 250** | 33.92 ms | 25.62 ms | 26.84 ms | -8.3 ms | -24.47% | **PASS** |
| **characterData 500** | 109.36 ms | 92.88 ms | 93.3 ms | -16.48 ms | -15.07% | **PASS** |
| **characterData 1000** | 468.83 ms | 435.56 ms | 439.5 ms | -33.27 ms | -7.1% | **PASS** |
| **addedNodes 10** | 4.99 ms | 1.53 ms | 1.63 ms | -3.46 ms | -69.34% | **PASS** |
| **addedNodes 50** | 9.62 ms | 4.72 ms | 5.32 ms | -4.9 ms | -50.94% | **PASS** |
| **addedNodes 100** | 19.25 ms | 11.43 ms | 11.61 ms | -7.82 ms | -40.62% | **PASS** |
| **addedNodes 250** | 68.73 ms | 51.26 ms | 51.39 ms | -17.47 ms | -25.42% | **PASS** |
| **addedNodes 500** | 189.92 ms | 163.94 ms | 168.57 ms | -25.98 ms | -13.68% | **PASS** |
| **addedNodes 1000** | 766.95 ms | 709.15 ms | 712.91 ms | -57.8 ms | -7.54% | **PASS** |
| **Card mean** | 0.7 ms | 0.22 ms | 0.31 ms | -0.48 ms | -68.57% | **PASS** |
| **Card peak** | 3.45 ms | 1.58 ms | 1.87 ms | -1.87 ms | -54.2% | **PASS** |
| **AI short stream** | 0.41 ms | 0.19 ms | 0.6 ms | -0.22 ms | -53.66% | **PASS** |
| **AI long stream** | 0.47 ms | 0.15 ms | 0.24 ms | -0.32 ms | -68.09% | **PASS** |
| **AI abort** | 0.2 ms | 0.13 ms | 0.28 ms | -0.07 ms | -35% | **PASS** |

---

## 5. Regression Status (回归状态分析)

* **REGRESSION 检测**：未检测到任何 REGRESSION。
* **WARNING 检测**：无 WARNING，全部指标完全处于基线允许范围内。
* **250 mutations 降级行为验证**：
  * 在 10~250 规模内，增量批处理耗时随着变动规模受控扩展；
  * 当变动规模达到 500 与 1000 时，系统按 `content.ts:224` 架构平滑进入全量重扫 (`full rescan`)，成本受控。

---

## 6. Unverified Metrics (保持 UNVERIFIED 的指标清单)

根据 Measurement Scope 严格约束，以下未在 Safari Technology Preview 原生 Web Inspector 下采集的系统级指标严格保持 **UNVERIFIED**：

1. `safari_webkit_process_cpu`：Safari / WebKit 渲染进程原生物理 CPU 占用率
2. `safari_service_worker_cpu`：Service Worker 进程原生 CPU 占用率与睡眠/唤醒周期
3. `ai_heap_attribution`：AI 流式前后 V8 堆微幅波动的单一对象级归因
4. `real_network_slow_stream_over_30s`：真实公网慢速网络下 > 30s 持续流式响应

---

## 7. Known Limitations (已知测量边界与限制)

1. **环境差异隔离**：本回归测试运行于 Node.js 22 + Happy-DOM 核心代码流水线，用于捕获 Glint 代码本身的逻辑与计算回归，不得解释为 Safari/WebKit 操作系统进程级性能数据。
2. **Git Hook 隔离**：本门禁作为独立/手动的回归门禁（Manual Regression Gate），严禁挂载于 pre-commit / pre-push，绝不阻断正常功能提交。

---

## 8. Final Verdict (最终结论)

```text
M5-PERF-02 VERDICT: PASS
```
