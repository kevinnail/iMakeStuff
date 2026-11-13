import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldError } from '@/components/FieldError';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';
import { getNewPasswordErrors, PASSWORD_MIN_LENGTH } from '@/utils/authFormValidate';

// Where the emailed link lands: evencraft://reset-password?token=… sets a new password with that
// token. A link the server found used or expired arrives with no token, and the screen offers a
// new one instead.
export default function ResetPasswordScreen() {
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);

  const errors = getNewPasswordErrors({ password, confirm });
  const shownErrors = checked ? errors : {};

  if (!token) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        alwaysBounceVertical={false}
        contentContainerStyle={styles.page}
      >
        <Text style={styles.description}>
          This link has expired or was already used. Send a new one and open it on this phone.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          onPress={() => router.replace('/forgot-password')}
        >
          <Text style={styles.primaryButtonText}>Send a New Link</Text>
        </Pressable>
      </ScrollView>
    );
  }

  async function save(linkToken: string) {
    setChecked(true);
    if (Object.keys(errors).length > 0) return;
    setSending(true);
    const saved = await resetPassword(linkToken, password).finally(() => setSending(false));
    if (!saved) {
      Alert.alert('Could not set the password', useAuthStore.getState().error ?? undefined);
      return;
    }
    Alert.alert('Password updated', 'Sign in with your new password.');
    router.dismissTo('/sign-in');
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      alwaysBounceVertical={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
    >
      <View style={styles.field}>
        <Text style={styles.label}>New password</Text>
        <TextInput
          style={[styles.input, shownErrors.password && styles.missingInput]}
          value={password}
          onChangeText={setPassword}
          placeholder={`At least ${PASSWORD_MIN_LENGTH} characters, letters and numbers`}
          placeholderTextColor={colors.secondaryText}
          autoCapitalize="none"
          secureTextEntry
          textContentType="newPassword"
        />
        {shownErrors.password && <FieldError message={shownErrors.password} />}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>New password again</Text>
        <TextInput
          style={[styles.input, shownErrors.confirm && styles.missingInput]}
          value={confirm}
          onChangeText={setConfirm}
          placeholderTextColor={colors.secondaryText}
          autoCapitalize="none"
          secureTextEntry
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => save(token)}
        />
        {shownErrors.confirm && <FieldError message={shownErrors.confirm} />}
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          sending && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => save(token)}
        disabled={sending}
      >
        <Text style={styles.primaryButtonText}>{sending ? 'Saving…' : 'Save New Password'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
  },
  description: {
    fontSize: 18,
    color: colors.secondaryText,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 18,
    color: colors.text,
  },
  input: {
    fontSize: 18,
    padding: 12,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  missingInput: {
    borderColor: colors.danger,
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
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.6,
  },
});
