import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import type { HostInstance } from 'react-native';
import { create } from 'zustand';

// A button the first-run guide points at. Its screen reports where it is, and the guide outlines it.
export type GuideTarget = 'supplies' | 'start' | 'addWork';

// Where the target is on screen.
export interface TargetFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GuideState {
  // The guide's step on screen, or null while it's closed. Here rather than in the guide, so the
  // Work tab's ? button can start it again.
  stepIndex: number | null;
  target: GuideTarget | null;
  // The guide draws the target's outline above its dark layer, so the outline stays bright. The
  // guide sits over the whole app and can't measure the target, so the target's screen reports it.
  targetFrame: TargetFrame | null;
  // From the bottom of the screen to the top of the tab bar, for the arrow that points at a tab.
  // The guide sits over the whole app and can't see the native tab bar, so the Work tab reports
  // it: a tab's bottom safe area includes the bar.
  tabBarHeight: number;
  setStep: (stepIndex: number | null, target: GuideTarget | null) => void;
  setTargetFrame: (targetFrame: TargetFrame) => void;
  setTabBarHeight: (tabBarHeight: number) => void;
}

export const useGuideStore = create<GuideState>((set) => ({
  stepIndex: null,
  target: null,
  targetFrame: null,
  tabBarHeight: 0,
  // A new step's target is measured once its tab shows, so the last one's outline doesn't linger.
  setStep: (stepIndex, target) => set({ stepIndex, target, targetFrame: null }),
  setTargetFrame: (targetFrame) => set({ targetFrame }),
  setTabBarHeight: (tabBarHeight) => set({ tabBarHeight }),
}));

// The ref and measure for a button the guide can point at. While it's the target, it reports where
// it is on screen when its tab shows, and again whenever its screen calls measure: when the button
// lays out, and when a list it's in moves. A tab opened for the first time lays out before iOS
// moves its list below the status bar, so the list's move is the measure that lands.
export function useGuideTarget(target: GuideTarget) {
  const ref = useRef<HostInstance>(null);
  const isTarget = useGuideStore((state) => state.target === target);
  const setTargetFrame = useGuideStore((state) => state.setTargetFrame);

  const measure = useCallback(() => {
    if (!isTarget) return;
    ref.current?.measureInWindow((x, y, width, height) => setTargetFrame({ x, y, width, height }));
  }, [isTarget, setTargetFrame]);

  useFocusEffect(measure);
  return { ref, measure };
}
