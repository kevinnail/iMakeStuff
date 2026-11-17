import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '@/store/authStore';
import { useSubscriptionStore } from '@/store/subscriptionStore';
import { colors } from '@/theme';

const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PRIVACY_URL = 'https://kevinnail.com/evencraft/privacy.html';

// The way into backup: create an account or sign in, then subscribe. Signed in, it shows which
// account this phone is on, the yearly price or that backup is on, and Sign Out.
export default function BackupScreen() {
  const status = useAuthStore((state) => state.status);
  const email = useAuthStore((state) => state.email);
  const signOut = useAuthStore((state) => state.signOut);
  const [signingOut, setSigningOut] = useState(false);

  const initSubscriptions = useSubscriptionStore((state) => state.init);
  const isPremium = useSubscriptionStore((state) => state.isPremium);
  const offering = useSubscriptionStore((state) => state.offering);
  const loadError = useSubscriptionStore((state) => state.loadError);
  const purchaseError = useSubscriptionStore((state) => state.error);
  const purchasePending = useSubscriptionStore((state) => state.purchasePending);
  const subscribe = useSubscriptionStore((state) => state.subscribe);
  const restore = useSubscriptionStore((state) => state.restore);

  const yearlyPackage = offering?.annual ?? offering?.availablePackages[0];
  // The store's own reason comes first, so the general one never covers it.
  const subscriptionMessage =
    purchaseError ??
    loadError ??
    (yearlyPackage ? null : 'No subscription is available right now.');

  // Loads what's for sale again each time this tab opens, so a load that failed when the app
  // opened recovers without closing the app.
  useFocusEffect(
    useCallback(() => {
      initSubscriptions();
    }, [initSubscriptions]),
  );

  async function leave() {
    setSigningOut(true);
    const signedOut = await signOut().finally(() => setSigningOut(false));
    if (!signedOut) Alert.alert('Could not sign out', useAuthStore.getState().error ?? undefined);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <Text style={styles.title}>Backup</Text>
      <Text style={styles.description}>
        Keeps a copy of every piece, prep, supply, and photo, so deleting the app or moving to a new
        phone loses nothing.
      </Text>
      {status === 'signed-in' ? (
        <>
          <View style={styles.card}>
            <Text style={styles.secondaryText}>Signed in as</Text>
            <Text style={styles.text}>{email}</Text>
          </View>
          {isPremium ? (
            <View style={styles.card}>
              <Text style={styles.text}>Backup is on</Text>
            </View>
          ) : (
            <>
              {yearlyPackage ? (
                <Text style={styles.text}>
                  Backup is {yearlyPackage.product.priceString} a year.
                </Text>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  (!yearlyPackage || purchasePending) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => yearlyPackage && subscribe(yearlyPackage)}
                disabled={!yearlyPackage || purchasePending}
              >
                <Text style={styles.primaryButtonText}>
                  {purchasePending ? 'Working…' : 'Subscribe'}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  purchasePending && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={restore}
                disabled={purchasePending}
              >
                <Text style={styles.secondaryButtonText}>Restore Purchases</Text>
              </Pressable>
              {subscriptionMessage ? (
                <Text style={styles.errorText}>{subscriptionMessage}</Text>
              ) : null}
              <Text style={styles.secondaryText}>
                The subscription renews every year and is billed to your Apple ID. It renews on its
                own unless it is canceled at least 24 hours before the year ends. Manage or cancel
                it in your Apple ID settings.
              </Text>
              <View style={styles.links}>
                <Pressable onPress={() => Linking.openURL(TERMS_URL)} accessibilityRole="link">
                  <Text style={styles.linkText}>Terms of Use</Text>
                </Pressable>
                <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
                  <Text style={styles.linkText}>Privacy Policy</Text>
                </Pressable>
              </View>
            </>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              signingOut && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={leave}
            disabled={signingOut}
          >
            <Text style={styles.secondaryButtonText}>
              {signingOut ? 'Signing Out…' : 'Sign Out'}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            onPress={() => router.push('/create-account')}
          >
            <Text style={styles.primaryButtonText}>Create Account</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            onPress={() => router.push('/sign-in')}
          >
            <Text style={styles.secondaryButtonText}>Sign In</Text>
          </Pressable>
        </>
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
  errorText: {
    fontSize: 16,
    color: colors.danger,
  },
  links: {
    flexDirection: 'row',
    gap: 24,
  },
  linkText: {
    fontSize: 16,
    color: colors.primary,
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
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryButtonText: {
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
