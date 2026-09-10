export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowSize {
  width: number
  height: number
}

const edgeGap = 16

export function placeAtRightCenter(workArea: Rectangle, windowSize: WindowSize): Pick<Rectangle, 'x' | 'y'> {
  return {
    x: workArea.x + workArea.width - windowSize.width - edgeGap,
    y: workArea.y + Math.round((workArea.height - windowSize.height) / 2)
  }
}
