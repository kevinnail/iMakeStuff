import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useWorkStore } from '@/store/workStore';

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function showError(title: string) {
  return (error: Error) => Alert.alert(title, error.message);
}

// Computed from the clock each second, never counted, so time spent with the app
// closed shows up as soon as it reopens.
function RunningTime({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return <Text style={styles.runningTime}>{formatElapsed(now - Date.parse(startedAt))}</Text>;
}

export default function WorkScreen() {
  const { runningPieces, load, start, stop } = useWorkStore();
  const [name, setName] = useState('');
  const trimmedName = name.trim();

  useEffect(() => {
    load().catch(showError('Could not load your work'));
  }, [load]);

  function handleStart() {
    start(trimmedName)
      .then(() => setName(''))
      .catch(showError('Could not start'));
  }

  if (runningPieces.length === 0) {
    return (
      <View style={styles.screen}>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="What are you making?"
          returnKeyType="go"
          onSubmitEditing={trimmedName ? handleStart : undefined}
        />
        <Pressable
          style={[styles.button, !trimmedName && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={!trimmedName}
        >
          <Text style={styles.buttonText}>Start</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {runningPieces.map((piece) => (
        <View key={piece.id} style={styles.pieceRow}>
          <Text style={styles.pieceName}>{piece.name}</Text>
          <RunningTime startedAt={piece.started_at} />
          <Pressable
            style={styles.button}
            onPress={() => stop(piece.id).catch(showError('Could not stop'))}
          >
            <Text style={styles.buttonText}>Stop</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  nameInput: {
    fontSize: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 18,
    lineHeight: 20,
    color: '#fff',
  },
  pieceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pieceName: {
    flex: 1,
    fontSize: 18,
  },
  runningTime: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
});
