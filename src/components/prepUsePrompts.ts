import { Alert, type AlertButton } from 'react-native';

interface PercentPrompt {
  prepName: string;
  currentPercent: number;
  onSave: (percent: number) => void;
  onRemove: () => void;
}

// A whole number from 1 to 100, or null for anything else.
export function parsePercent(text: string | undefined) {
  const percent = Number(text);
  return Number.isInteger(percent) && percent >= 1 && percent <= 100 ? percent : null;
}

// Changes how much of a prep a piece took, or takes the prep off the piece.
export function askPrepPercent({ prepName, currentPercent, onSave, onRemove }: PercentPrompt) {
  const buttons: AlertButton[] = [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onRemove },
    {
      text: 'Save',
      isPreferred: true,
      onPress: (text?: string) => {
        const percent = parsePercent(text);
        if (percent === null) Alert.alert('Enter a percent from 1 to 100.');
        else onSave(percent);
      },
    },
  ];
  Alert.prompt(
    prepName,
    'Percent of it this piece took',
    buttons,
    'plain-text',
    String(currentPercent),
    'number-pad',
  );
}
