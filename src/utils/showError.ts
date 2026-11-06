import { Alert } from 'react-native';

// A catch handler that shows a failed save or load as an alert with the error's message.
export function showError(title: string) {
  return (error: Error) => Alert.alert(title, error.message);
}
