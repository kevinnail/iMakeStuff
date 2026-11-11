import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';

// The way into backup: create an account, or see which one this phone is signed in to.
export default function BackupScreen() {
  const status = useAuthStore((state) => state.status);
  const email = useAuthStore((state) => state.email);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <Text style={styles.title}>Backup</Text>
      <Text style={styles.description}>
        Keeps a copy of every piece, prep, supply, and photo, so deleting the app or moving to a new
        phone loses nothing.
      </Text>
      {status === 'signed-in' ? (
        <View style={styles.card}>
          <Text style={styles.secondaryText}>Signed in as</Text>
          <Text style={styles.text}>{email}</Text>
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          onPress={() => router.push('/create-account')}
        >
          <Text style={styles.primaryButtonText}>Create Account</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  description: {
    fontSize: 18,
    color: colors.secondaryText,
  },
  card: {
    padding: 16,
    gap: 4,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  text: {
    fontSize: 18,
    color: colors.text,
  },
  secondaryText: {
    fontSize: 16,
    color: colors.secondaryText,
  },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textOnFill,
  },
  buttonPressed: {
    opacity: 0.6,
  },
});
