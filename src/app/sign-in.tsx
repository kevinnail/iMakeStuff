import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldError } from '@/components/FieldError';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';
import { getSignInErrors } from '@/utils/authFormValidate';

// Email and password. Problems show under each field once Sign In has been tapped, and the
// server's refusal (like a wrong password) in a pop-up box.
export default function SignInScreen() {
  const signIn = useAuthStore((state) => state.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);

  const errors = getSignInErrors({ email, password });
  const shownErrors = checked ? errors : {};

  async function send() {
    setChecked(true);
    if (Object.keys(errors).length > 0) return;
    setSending(true);
    const signedIn = await signIn(email, password).finally(() => setSending(false));
    if (signedIn) {
      // Not back(): arriving from the emailed reset link, there may be no screen behind this one.
      router.dismissTo('/backup');
      return;
    }
    Alert.alert('Could not sign in', useAuthStore.getState().error ?? undefined);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      alwaysBounceVertical={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
    >
      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={[styles.input, shownErrors.email && styles.missingInput]}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.secondaryText}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        {shownErrors.email && <FieldError message={shownErrors.email} />}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={[styles.input, shownErrors.password && styles.missingInput]}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          secureTextEntry
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={send}
        />
        {shownErrors.password && <FieldError message={shownErrors.password} />}
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
        <Text style={styles.primaryButtonText}>{sending ? 'Signing In…' : 'Sign In'}</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
        onPress={() => router.push('/forgot-password')}
      >
        <Text style={styles.linkButtonText}>Forgot password?</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 16,
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
  linkButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  linkButtonText: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.6,
  },
});
