import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldError } from '@/components/FieldError';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';
import { isValidEmail } from '@/utils/authFormValidate';

// The account's email. Sending it emails a link that opens the app's New Password screen. The
// answer is the same whether or not the email has an account, so nobody can use it to find out.
export default function ForgotPasswordScreen() {
  const requestPasswordReset = useAuthStore((state) => state.requestPasswordReset);
  const [email, setEmail] = useState('');
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);

  const emailError = isValidEmail(email.trim()) ? null : 'Enter a valid email address.';
  const shownEmailError = checked ? emailError : null;

  async function send() {
    setChecked(true);
    if (emailError) return;
    setSending(true);
    const sent = await requestPasswordReset(email).finally(() => setSending(false));
    if (!sent) {
      Alert.alert('Could not send the email', useAuthStore.getState().error ?? undefined);
      return;
    }
    Alert.alert(
      'Check your email',
      'If that email has an account, a link to set a new password is on its way. Open it on this phone.',
    );
    router.back();
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      alwaysBounceVertical={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
    >
      <Text style={styles.description}>
        Enter your account&apos;s email and we&apos;ll send a link to set a new password.
      </Text>
      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={[styles.input, shownEmailError && styles.missingInput]}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.secondaryText}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={send}
        />
        {shownEmailError && <FieldError message={shownEmailError} />}
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          sending && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={send}
        disabled={sending}
      >
        <Text style={styles.primaryButtonText}>{sending ? 'Sending…' : 'Send Reset Link'}</Text>
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
