import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldError } from '@/components/FieldError';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';
import { getCreateAccountErrors, PASSWORD_MIN_LENGTH } from '@/utils/authFormValidate';

// Email, password, and the password again. Problems show under each field once Create Account
// has been tapped, and the server's refusal (like an email already in use) in a pop-up box.
export default function CreateAccountScreen() {
  const signUp = useAuthStore((state) => state.signUp);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);

  const errors = getCreateAccountErrors({ email, password, confirm });
  const shownErrors = checked ? errors : {};

  async function create() {
    setChecked(true);
    if (Object.keys(errors).length > 0) return;
    setSending(true);
    const created = await signUp(email, password);
    setSending(false);
    if (created) {
      router.back();
      return;
    }
    Alert.alert('Could not create your account', useAuthStore.getState().error ?? undefined);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
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
          autoFocus
        />
        {shownErrors.email && <FieldError message={shownErrors.email} />}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Password</Text>
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
        <Text style={styles.label}>Password again</Text>
        <TextInput
          style={[styles.input, shownErrors.confirm && styles.missingInput]}
          value={confirm}
          onChangeText={setConfirm}
          placeholderTextColor={colors.secondaryText}
          autoCapitalize="none"
          secureTextEntry
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={create}
        />
        {shownErrors.confirm && <FieldError message={shownErrors.confirm} />}
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          sending && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
        onPress={create}
        disabled={sending}
      >
        <Text style={styles.primaryButtonText}>
          {sending ? 'Creating Account…' : 'Create Account'}
        </Text>
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
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.6,
  },
});
