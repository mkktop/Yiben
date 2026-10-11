interface WindowSize {
  width: number
  height: number
}

/** 按当前系统外框差值恢复内容尺寸，避免 Windows 缩放下外框被重复计入。 */
export function restoredContentSize(saved: WindowSize, normal: WindowSize, content: WindowSize): WindowSize {
  return {
    width: Math.max(1, saved.width - (normal.width - content.width)),
    height: Math.max(1, saved.height - (normal.height - content.height))
  }
}
