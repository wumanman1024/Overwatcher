/*
 * 雪花 ID（41 位毫秒时间戳 + 10 位机器号 + 12 位序列号），与目标库 sys_menu 里
 * 既有 18~19 位 ID 的形态一致。机器号在每次应用启动时随机取，避免与后端自己生成的
 * ID（另一台机器/另一个 worker）落在同一秒序列上时相撞；序列号在同一毫秒内递增，
 * 溢出时把时间戳推后 1 毫秒——批量生成几千个 ID 也远不到每毫秒 4096 个的上限。
 */
const EPOCH = 1577808000000n // 2020-01-01，量级对齐现网数据
const WORKER_ID = BigInt(Math.floor(Math.random() * 1024))
let sequence = 0n
let lastTimestamp = -1n

export function nextSnowflakeId(): string {
  let timestamp = BigInt(Date.now())
  if (timestamp <= lastTimestamp) timestamp = lastTimestamp
  if (timestamp === lastTimestamp) {
    sequence = (sequence + 1n) & 0xfffn
    if (sequence === 0n) timestamp += 1n
  } else {
    sequence = 0n
  }
  lastTimestamp = timestamp
  return (((timestamp - EPOCH) << 22n) | (WORKER_ID << 12n) | sequence).toString()
}
