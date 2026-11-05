/**
 * 一套统一的多端适配基线，供页面按断点而不是魔法数判断布局。
 *
 * 断点取值对齐 DevEco「一次开发多端部署」与 ArkUI GridRow 的默认断点
 * （SDK 里 BreakPoints.value 的默认值就是 ["320vp", "600vp", "840vp"]），
 * 另外补一档 1440 给 PC / 2in1 的大窗口：
 *
 *   xs  < 320          小屏手机竖屏
 *   sm  320 – 600      常规手机竖屏
 *   md  600 – 840      手机横屏 / 小折叠展开 / 小平板
 *   lg  840 – 1440     平板、2in1 窗口
 *   xl  >= 1440        2in1 / PC 全屏
 *
 * 断点统一按「窗口宽度」算，不用屏幕宽度：2in1 上应用可以拉成任意大小的窗口，
 * 折叠屏展开/折叠也会直接体现为窗口尺寸变化，按窗口算才不会错位。
 */

export const BREAKPOINT_XS_END: number = 320;
export const BREAKPOINT_SM_END: number = 600;
export const BREAKPOINT_MD_END: number = 840;
export const BREAKPOINT_LG_END: number = 1440;

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** 按窗口宽度（vp）取断点；宽度未知时按手机竖屏处理。 */
export function breakpointOf(widthVp: number): Breakpoint {
  if (widthVp <= 0) {
    return 'sm';
  }
  if (widthVp < BREAKPOINT_XS_END) {
    return 'xs';
  }
  if (widthVp < BREAKPOINT_SM_END) {
    return 'sm';
  }
  if (widthVp < BREAKPOINT_MD_END) {
    return 'md';
  }
  if (widthVp < BREAKPOINT_LG_END) {
    return 'lg';
  }
  return 'xl';
}

/** 手机形态：xs / sm，单列、满宽。 */
export function isCompactWidth(breakpoint: Breakpoint): boolean {
  return breakpoint === 'xs' || breakpoint === 'sm';
}

/** 平板及更宽：lg / xl，可以并排、限宽居中。 */
export function isExpandedWidth(breakpoint: Breakpoint): boolean {
  return breakpoint === 'lg' || breakpoint === 'xl';
}

/** 内容列的最大宽度：随断点放宽，同时留出边距，避免贴边。 */
export function contentColumnWidth(breakpoint: Breakpoint, windowWidthVp: number): number {
  const width: number = windowWidthVp > 0 ? windowWidthVp : BREAKPOINT_SM_END;
  if (breakpoint === 'xl') {
    return Math.min(1200, width - 160);
  }
  if (breakpoint === 'lg') {
    return Math.min(1040, width - 120);
  }
  // md 及以下直接铺满窗口，交给外层 padding 控制留白
  return width;
}

/** 设备页要不要并排两列：只有真正宽起来（lg/xl）且有两台以上才分栏。 */
export function deviceColumns(breakpoint: Breakpoint, deviceCount: number): number {
  return isExpandedWidth(breakpoint) && deviceCount > 1 ? 2 : 1;
}

/**
 * 陪伴小人出场条件：纵向空间够。
 * 手机横屏约 405vp（md 断点、高度很矮）时让位给列表；平板/2in1 窗口够高就出来。
 */
export function mascotVisible(breakpoint: Breakpoint, windowHeightVp: number): boolean {
  if (windowHeightVp <= 0) {
    return !isCompactWidth(breakpoint);
  }
  return windowHeightVp >= 620;
}

/**
 * 折叠形态：单折轴设备只有 展开 / 折叠 / 半折 三态，
 * 双折轴（三折叠）在 SDK 里是 10 个组合值（11/12/13 表示第一轴展开、第二轴展开/折叠/半折，
 * 21/22/23 表示第一轴折叠，31/32/33 表示第一轴半折）。
 * 布局只关心「第一折轴是否展开」，所以按十位数归一成三态。
 */
export type FoldState = 'expanded' | 'half' | 'folded';

export function foldStateOf(status: number): FoldState {
  if (status <= 0) {
    return 'expanded';
  }
  const axis1: number = Math.floor(status / 10);
  const primary: number = axis1 === 0 ? status : axis1;
  if (primary === 1) {
    return 'expanded';
  }
  if (primary === 3) {
    return 'half';
  }
  return 'folded';
}

/** 半折悬停时（桌面立起来那种）适合上下分栏，展开/折叠时仍是常规布局。 */
export function isHalfFoldedFold(state: FoldState): boolean {
  return state === 'half';
}
