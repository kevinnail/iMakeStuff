import { create } from 'zustand';

// A button the first-run guide points at. Its screen outlines it while it's the target.
export type GuideTarget = 'supplies' | 'start' | 'addWork';

interface GuideState {
  // The guide's step on screen, or null while it's closed. Here rather than in the guide, so the
  // Work tab's ? button can start it again.
  stepIndex: number | null;
  target: GuideTarget | null;
  // From the bottom of the screen to the top of the tab bar, for the arrow that points at a tab.
  // The guide sits over the whole app and can't see the native tab bar, so the Work tab reports
  // it: a tab's bottom safe area includes the bar.
  tabBarHeight: number;
  setStep: (stepIndex: number | null, target: GuideTarget | null) => void;
  setTabBarHeight: (tabBarHeight: number) => void;
}

export const useGuideStore = create<GuideState>((set) => ({
  stepIndex: null,
  target: null,
  tabBarHeight: 0,
  setStep: (stepIndex, target) => set({ stepIndex, target }),
  setTabBarHeight: (tabBarHeight) => set({ tabBarHeight }),
}));
