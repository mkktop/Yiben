/**
 * 扫描期间的书架节流刷新。
 *
 * 系列入库是逐个增量的（本地 scanOneLocalSeries / 云端 writeSeries 都是扫完一个
 * 立即写库），但书架列表跟着 dataStore 的 version 计数走——不 bump 网格就一直
 * 是旧快照，大库要等整轮扫描结束才一起冒出来。这里把「进度事件 → 刷新」做成
 * 节流阀：首轮立即刷（首个系列几秒内可见），之后最多每 intervalMs 刷一次；
 * 终态 done 无条件刷并复位（收尾对账 retire/FTS 之后必须是最终列表）。
 *
 * 中途刷出来的是「半对账」快照：新系列已出现、源里已删除的要到 done 才消失，
 * 搜索索引（FTS 在扫描收尾才重建）也可能缺最新一批——这是接受的取舍。
 */
export function createScanRefresher(
  bump: () => void,
  intervalMs = 5000,
  now: () => number = Date.now
): (phase: string) => void {
  let last = -Infinity
  return (phase) => {
    if (phase === 'done') {
      last = -Infinity
      bump()
      return
    }
    const t = now()
    if (t - last >= intervalMs) {
      last = t
      bump()
    }
  }
}
