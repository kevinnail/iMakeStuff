import Purchases, {
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import { create } from 'zustand';

// The RevenueCat entitlement that turns backup on. It has to match the entitlement in the
// RevenueCat dashboard. The server decides who is subscribed; this check only saves a call
// that would be refused.
export const PREMIUM_ENTITLEMENT = 'premium';

function hasPremium(info: CustomerInfo): boolean {
  return info.entitlements.active[PREMIUM_ENTITLEMENT] != null;
}

export function messageFromPurchaseError(error: unknown): string {
  // RevenueCat's transfer behavior is "Keep with original App User ID", so a second account
  // buying or restoring on an Apple ID that already subscribed gets a receipt in use error. The
  // SDK's own message for it is written for developers.
  const code = (error as { code?: string } | null)?.code;
  if (
    code === PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR ||
    code === PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR
  ) {
    return 'This Apple ID already has a subscription on another account. Sign in to that account to use backup.';
  }

  const message = (error as { message?: string } | null)?.message;
  return message && message.length > 0 ? message : 'Something went wrong. Please try again.';
}

const STILL_CONNECTING_MESSAGE = 'Your account is still connecting. Wait a moment and try again.';

interface SubscriptionState {
  isPremium: boolean;
  offering: PurchasesOffering | null;
  // Why the subscription or what's for sale couldn't be loaded. Kept apart from error so a
  // purchase or restore never wipes the store's own reason for having nothing to buy.
  loadError: string | null;
  // Why the last purchase, restore, or sign in to RevenueCat failed.
  error: string | null;
  // True while a purchase or restore is running, so the buttons are off until it finishes and a
  // second tap can't start a second purchase.
  purchasePending: boolean;
  // Sets up the SDK once, then loads the subscription and what's for sale. Runs when the app
  // opens and again each time the Backup screen opens, so one failed load doesn't leave nothing
  // to buy until the app is closed.
  init: () => Promise<void>;
  // Makes RevenueCat's user the signed in account's id, so the purchase's webhook reaches that
  // account on the server.
  identify: (userId: string) => Promise<void>;
  // Drops the account from RevenueCat on sign out. The phone's data stays as it is.
  forget: () => Promise<void>;
  applyCustomerInfo: (info: CustomerInfo) => void;
  // Buys the package. True when backup is now on.
  subscribe: (packageToBuy: PurchasesPackage) => Promise<boolean>;
  // Brings back an earlier purchase after a reinstall or on a new phone. True when backup is on.
  restore: () => Promise<boolean>;
}

// Configure and the listener run once per launch. The loads run on every init.
let configured = false;

// Runs identify and forget one at a time. The root layout's session effect can call forget twice
// on one sign out, and two at once would both see a signed in user and both call logOut. The
// second logOut would hit an anonymous user, which the SDK logs as an error.
let identityQueue: Promise<void> = Promise.resolve();
function serializeIdentity(operation: () => Promise<void>): Promise<void> {
  identityQueue = identityQueue.then(operation, operation);
  return identityQueue;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  isPremium: false,
  offering: null,
  loadError: null,
  error: null,
  purchasePending: false,

  init: async () => {
    const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    if (!apiKey) {
      set({ loadError: 'Subscriptions are not available in this build.' });
      return;
    }

    if (!configured) {
      Purchases.configure({ apiKey });
      Purchases.addCustomerInfoUpdateListener((info) => get().applyCustomerInfo(info));
      configured = true;
    }

    // Settled separately: these are two unrelated loads, and Promise.all would throw away what's
    // for sale whenever the subscription load fails.
    const [infoResult, offeringsResult] = await Promise.allSettled([
      Purchases.getCustomerInfo(),
      Purchases.getOfferings(),
    ]);

    if (infoResult.status === 'fulfilled') set({ isPremium: hasPremium(infoResult.value) });
    if (offeringsResult.status === 'fulfilled') set({ offering: offeringsResult.value.current });

    const failed = [offeringsResult, infoResult].find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    set({ loadError: failed ? messageFromPurchaseError(failed.reason) : null });
  },

  identify: (userId) =>
    serializeIdentity(async () => {
      if (!(await Purchases.isConfigured())) return;
      try {
        const { customerInfo } = await Purchases.logIn(userId);
        get().applyCustomerInfo(customerInfo);
      } catch (error) {
        set({ error: messageFromPurchaseError(error) });
      }
    }),

  forget: () =>
    serializeIdentity(async () => {
      if (!(await Purchases.isConfigured())) return;
      // logOut on an anonymous user makes the SDK log an error, and the app is anonymous on
      // every launch until its session loads.
      if (await Purchases.isAnonymous()) return;
      try {
        get().applyCustomerInfo(await Purchases.logOut());
      } catch (error) {
        set({ error: messageFromPurchaseError(error) });
      }
    }),

  applyCustomerInfo: (info) => {
    set({ isPremium: hasPremium(info) });
  },

  subscribe: async (packageToBuy) => {
    set({ error: null, purchasePending: true });
    try {
      // A purchase made before identify's logIn lands goes to the anonymous customer. Its
      // webhook then carries an id the server can't match, and the payment turns nothing on.
      if (await Purchases.isAnonymous()) {
        set({ error: STILL_CONNECTING_MESSAGE });
        return false;
      }
      const { customerInfo } = await Purchases.purchasePackage(packageToBuy);
      const premium = hasPremium(customerInfo);
      set({ isPremium: premium });
      return premium;
    } catch (error) {
      // Cancel on Apple's purchase box is a normal answer, not a failure.
      if ((error as { userCancelled?: boolean | null }).userCancelled) return false;
      set({ error: messageFromPurchaseError(error) });
      return false;
    } finally {
      set({ purchasePending: false });
    }
  },

  restore: async () => {
    set({ error: null, purchasePending: true });
    try {
      if (await Purchases.isAnonymous()) {
        set({ error: STILL_CONNECTING_MESSAGE });
        return false;
      }
      const premium = hasPremium(await Purchases.restorePurchases());
      set({ isPremium: premium });
      return premium;
    } catch (error) {
      set({ error: messageFromPurchaseError(error) });
      return false;
    } finally {
      set({ purchasePending: false });
    }
  },
}));
