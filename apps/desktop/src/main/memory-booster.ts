import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ipcMain } from 'electron'
import si from 'systeminformation'
import { calculateMemoryUsage } from './collectors/base'

const run = promisify(execFile)

export type MemoryBoostResult = {
  /*
   * 口径：系统可用内存的净增，与悬浮球水波同源于 si.mem()。
   * 不能改用各进程工作集差值累加 —— EmptyWorkingSet 之后立刻读 WorkingSet64 会得到虚低值，
   * 实测本机能把「整理量」报成 18 GB，而全机工作集合计才 22 GB。
   */
  freedBytes: number
  beforeAvailable: number
  afterAvailable: number
  beforeUsage: number
  afterUsage: number
  totalBytes: number
  trimmed: number
  skipped: number
  top: Array<{ name: string; pid: number; workingSet: number }>
}

/*
 * 内联 C# 由 PowerShell 5.1 的 Add-Type 经 CodeDom 编译，语言级别只到 C# 5：
 * 不能用字符串内插、nameof、out var。
 *
 * 遍历放在 C# 而非 PowerShell 管道里：340 多个对象每个都要过一次类型适配器，能慢上一截。
 *
 * 刻意不使用 GetProcessMemoryInfo / PERFORMANCE_INFORMATION_COUNTERS：其 DeviceNode 实为
 * PUNICODE_STRING，按 string 直接 marshal 会让子进程抛非托管 AccessViolationException，
 * 整个 PowerShell 崩掉且 try/catch 兜不住。工作集一律取托管的 WorkingSet64。
 *
 * 回传用「数字 + 空格 + 进程名」的行格式而非 JSON：进程名是行尾剩余部分，
 * 因此不必在 C# 里转义引号/反斜杠，序列化交给 Node 侧的 JSON.stringify。
 */
const TRIM_SOURCE = `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class LocalForgeMemoryTrim {
  [DllImport("psapi.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool EmptyWorkingSet(IntPtr hProcess);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint desiredAccess, bool inherit, uint pid);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool CloseHandle(IntPtr handle);

  // PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA，EmptyWorkingSet 要求的正是这两个权限。
  const uint TrimAccess = 0x00000500;

  // 工作集不足 32 MB 的进程整理不出什么，省掉一次 OpenProcess 和一轮无谓的页面换出。
  const long MinWorkingSet = 32L * 1024L * 1024L;

  // 这几个进程的工作集是系统正在主动利用的，换出去只会立刻换回并拖慢整机。
  static bool KeepAsIs(string name) {
    return string.Equals(name, "System", StringComparison.OrdinalIgnoreCase)
      || string.Equals(name, "Idle", StringComparison.OrdinalIgnoreCase)
      || string.Equals(name, "Memory Compression", StringComparison.OrdinalIgnoreCase);
  }

  // 换行会破坏行协议，控制字符会让 PowerShell 输出变形；就地替换成空格，
  // 真实进程名里出现这些字符的情形可以忽略。
  static string OneLine(string value) {
    if (string.IsNullOrEmpty(value)) return "?";
    var builder = new StringBuilder(value.Length);
    foreach (var c in value) {
      builder.Append(c < ' ' || c == 0x2028 || c == 0x2029 ? ' ' : c);
    }
    return builder.ToString().Trim();
  }

  public static string Run(uint selfPid, uint hostPid, int topCount) {
    var touched = new List<long[]>();
    var names = new List<string>();
    var trimmed = 0;
    var skipped = 0;
    Process[] processes;
    try { processes = Process.GetProcesses(); }
    catch { return "COUNTS 0 0"; }

    foreach (var process in processes) {
      try {
        // 本 PowerShell 与宿主 Electron 正在前台绘制，换出去只是让界面先卡一下。
        var pid = (uint) process.Id;
        if (pid == selfPid || pid == hostPid) { skipped++; continue; }
        var name = process.ProcessName;
        if (KeepAsIs(name)) { skipped++; continue; }
        long workingSet;
        // WorkingSet64 的类型随 Add-Type 实际引用的程序集而异（.NET Framework 是 IntPtr，
        // 新引用集是 long）；显式 (long) 转换两边都编得过，写成 .ToInt64() 只在其中一种下成立。
        try { workingSet = (long) process.WorkingSet64; }
        catch { skipped++; continue; }
        if (workingSet < MinWorkingSet) { skipped++; continue; }

        var handle = OpenProcess(TrimAccess, false, pid);
        if (handle == IntPtr.Zero) { skipped++; continue; }
        bool done;
        try { done = EmptyWorkingSet(handle); }
        finally { CloseHandle(handle); }
        // 失败基本都是权限不足：普通权限只能触达约一半进程，属预期而非异常。
        if (!done) { skipped++; continue; }

        trimmed++;
        touched.Add(new long[] { workingSet, process.Id });
        names.Add(OneLine(name));
      } catch { skipped++; }
      finally { process.Dispose(); }
    }

    // 按整理前工作集降序取前 topCount 个，作为「整理了哪些进程」。
    var order = new List<int>();
    for (var i = 0; i < touched.Count; i++) order.Add(i);
    order.Sort(delegate(int a, int b) { return touched[b][0].CompareTo(touched[a][0]); });

    var output = new StringBuilder(1024);
    output.Append("COUNTS ").Append(trimmed).Append(' ').Append(skipped);
    var limit = order.Count < topCount ? order.Count : topCount;
    for (var i = 0; i < limit; i++) {
      var row = touched[order[i]];
      output.Append('\\n').Append(row[0]).Append(' ').Append(row[1]).Append(' ').Append(names[order[i]]);
    }
    return output.ToString();
  }
}
`

// EncodedCommand 走 UTF-16LE base64，绕开内联 C# 里成串引号与大括号的 shell 转义问题。
function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/*
 * C# 源码装进 here-string 交给 Add-Type。用单引号形式（@' '@）而非双引号形式，
 * 这样源码里的 $ 不会被 PowerShell 展开；结束标记 '@ 必须在行首，故整体不能缩进。
 */
function boostScript(hostPid: number): string {
  const host = Number.isInteger(hostPid) && hostPid > 0 ? hostPid : 0
  return `$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
${TRIM_SOURCE}
'@
  [LocalForgeMemoryTrim]::Run([uint32] $PID, [uint32] ${host}, 12)
} catch {
  Write-Output ('BOOST-ERROR ' + $_.Exception.Message)
  exit 1
}`
}

/*
 * 解析 C# 的行协议：
 *   COUNTS <trimmed> <skipped>
 *   <workingSet> <pid> <进程名（行尾剩余部分，可含空格）>
 * Add-Type 的告警可能混进 stdout，故只从 COUNTS 行开始认，之前的行一律忽略。
 */
function parsePayload(stdout: string): { trimmed: number; skipped: number; top: MemoryBoostResult['top'] } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const error = lines.find((line) => line.startsWith('BOOST-ERROR'))
  if (error) throw new Error(error.slice('BOOST-ERROR'.length).trim() || '内存整理失败')

  const head = lines.findIndex((line) => line.startsWith('COUNTS '))
  if (head < 0) throw new Error('内存整理未返回结果，可能被系统策略或安全软件拦截')

  const counts = lines[head].slice('COUNTS'.length).trim().split(/\s+/).map(Number)
  const [trimmed, skipped] = counts
  if (!Number.isFinite(trimmed)) throw new Error('内存整理返回结果异常')

  const top = lines.slice(head + 1).reduce<MemoryBoostResult['top']>((accumulator, line) => {
    const workingSet = line.slice(0, line.indexOf(' '))
    const rest = line.slice(line.indexOf(' ') + 1)
    const pid = rest.slice(0, rest.indexOf(' '))
    const name = rest.slice(rest.indexOf(' ') + 1).trim()
    // 三列都对不上就说明这行不是协议输出（多半是混进来的告警），跳过而不是整体失败。
    if (!name || !/^\d+$/.test(workingSet) || !/^\d+$/.test(pid)) return accumulator
    accumulator.push({ name, pid: Number(pid), workingSet: Number(workingSet) })
    return accumulator
  }, [])

  return { trimmed, skipped: Number.isFinite(skipped) ? skipped : 0, top }
}

// 页面换出是异步的：子进程退出那一刻可用内存还没走完，立刻读会明显低估。
const AFTER_SETTLE_MS = 350
const POWERSHELL_TIMEOUT_MS = 15_000

async function memorySnapshot(): Promise<{ total: number; available: number }> {
  const memory = await si.mem()
  return { total: memory.total, available: memory.available }
}

let inFlight: Promise<MemoryBoostResult> | undefined

/*
 * 悬浮球一键加速：把各进程的工作集换出到待机列表，可用内存随之上升。
 *
 * 需要知情的是——这不是删除数据，被换出的页在进程再次访问时会换回来。数字是真的，
 * 但收益是削峰而非永久回收，因此 UI 文案写「已整理」而不是「已释放」。
 */
export function boostMemory(): Promise<MemoryBoostResult> {
  // 整理要跑两三秒，期间重复点击只复用同一次执行，避免叠出多个 PowerShell 子进程。
  if (inFlight) return inFlight

  inFlight = (async (): Promise<MemoryBoostResult> => {
    if (process.platform !== 'win32') throw new Error('内存整理当前仅支持 Windows')
    const before = await memorySnapshot()
    const { stdout } = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodeCommand(boostScript(process.pid))
    ], { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
    const outcome = parsePayload(stdout)
    await new Promise((settle) => setTimeout(settle, AFTER_SETTLE_MS))
    const after = await memorySnapshot()
    // 其他进程同时在吃内存时差值可能为负，按 0 处理比显示负数更诚实。
    const freedBytes = Math.max(0, after.available - before.available)
    return {
      freedBytes,
      beforeAvailable: before.available,
      afterAvailable: after.available,
      beforeUsage: calculateMemoryUsage(before),
      afterUsage: calculateMemoryUsage(after),
      totalBytes: after.total,
      trimmed: outcome.trimmed,
      skipped: outcome.skipped,
      top: outcome.top
    }
  })().finally(() => { inFlight = undefined })

  return inFlight
}

/*
 * IPC 只是把渲染层的调用转交给宿主提供的执行函数。
 * 加速的实际编排（含结果卡片播报）留在 index.ts，好让悬浮球、托盘菜单与工具箱
 * 三个入口共用同一条路径，而不是各报各的。
 */
export function registerMemoryBoosterIpc(execute: () => Promise<MemoryBoostResult>): void {
  ipcMain.handle('memory:boost', () => execute())
}
