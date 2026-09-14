const orbSize = { width: 164, height: 72 };
const expandedSize = { width: 280, height: 320 };
export function sizeForOverlayMode(mode) {
    return mode === 'expanded' || mode === 'pinned' ? expandedSize : orbSize;
}
export function shouldToggleOverlayOnPointerUp(start, end) {
    return Math.hypot(end.x - start.x, end.y - start.y) < 4;
}
export function reduceOverlayMode(mode, event) {
    if (event === 'dock')
        return 'docked';
    if (event === 'hover' && (mode === 'docked' || mode === 'orb'))
        return mode === 'docked' ? 'orb' : 'expanded';
    if (event === 'leave' && mode === 'expanded')
        return 'orb';
    if (event === 'pin' && mode === 'expanded')
        return 'pinned';
    if (event === 'unpin' && mode === 'pinned')
        return 'orb';
    return mode;
}
export function clampPosition(position, size, workArea) {
    return {
        x: Math.min(Math.max(position.x, workArea.x), workArea.x + workArea.width - size.width),
        y: Math.min(Math.max(position.y, workArea.y), workArea.y + workArea.height - size.height)
    };
}
export function selectWorkAreaForPosition(position, size, workAreas) {
    const center = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
    const containing = workAreas.find((area) => (center.x >= area.x && center.x <= area.x + area.width &&
        center.y >= area.y && center.y <= area.y + area.height));
    if (containing)
        return containing;
    return workAreas.reduce((closest, area) => {
        const nearestX = Math.min(Math.max(center.x, area.x), area.x + area.width);
        const nearestY = Math.min(Math.max(center.y, area.y), area.y + area.height);
        const distance = (center.x - nearestX) ** 2 + (center.y - nearestY) ** 2;
        const closestNearestX = Math.min(Math.max(center.x, closest.x), closest.x + closest.width);
        const closestNearestY = Math.min(Math.max(center.y, closest.y), closest.y + closest.height);
        const closestDistance = (center.x - closestNearestX) ** 2 + (center.y - closestNearestY) ** 2;
        return distance < closestDistance ? area : closest;
    });
}
