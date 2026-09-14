export type OverlayMode = 'docked' | 'orb' | 'expanded' | 'pinned';
export type OverlayEvent = 'hover' | 'leave' | 'pin' | 'unpin' | 'dock';
export interface Position {
    x: number;
    y: number;
}
export interface Size {
    width: number;
    height: number;
}
export interface WorkArea extends Position, Size {
}
export declare function sizeForOverlayMode(mode: OverlayMode): Size;
export declare function shouldToggleOverlayOnPointerUp(start: Position, end: Position): boolean;
export declare function reduceOverlayMode(mode: OverlayMode, event: OverlayEvent): OverlayMode;
export declare function clampPosition(position: Position, size: Size, workArea: WorkArea): Position;
export declare function selectWorkAreaForPosition(position: Position, size: Size, workAreas: WorkArea[]): WorkArea;
