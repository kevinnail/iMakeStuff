import type { ViewStyle } from 'react-native';

// The app's colors: dark blues with a bright sky blue for action.
export const colors = {
  background: '#1A2233',
  // Rows, panels, and boxes that sit on the background.
  surface: '#25304A',
  text: '#EEF1F8',
  secondaryText: '#A9B4CC',
  separator: '#3A4766',
  // Buttons, the running piece, and worked days on the calendar.
  primary: '#6AA6F2',
  // Prep on the Work screen, so it never passes for a piece at a glance.
  prep: '#5FC8A0',
  // Breaks, so they stand apart from work.
  accent: '#D18A6B',
  // A record missing something, like a piece with no cost.
  warning: '#E8C547',
  // Delete, the one action that can't be undone.
  danger: '#F06A6A',
  // Text on a primary or accent fill.
  textOnFill: '#1A2233',
};

// The first-run guide's ring around the button it's pointing at, on whichever tab that is. An
// outline takes no room, so nothing moves when it shows.
export const guideOutline: ViewStyle = {
  outlineWidth: 3,
  outlineOffset: 4,
  outlineColor: colors.warning,
  borderRadius: 8,
  boxShadow: `0px 0px 50px ${colors.warning}`,
};
