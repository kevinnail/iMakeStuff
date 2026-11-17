import Purchases from 'react-native-purchases';

import {
  messageFromPurchaseError,
  PREMIUM_ENTITLEMENT,
  useSubscriptionStore,
} from '@/store/subscriptionStore';

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    getCustomerInfo: jest.fn(),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(),
    isAnonymous: jest.fn(),
    isConfigured: jest.fn(),
  },
  PURCHASES_ERROR_CODE: {
    RECEIPT_ALREADY_IN_USE_ERROR: '7',
    RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: '13',
  },
}));

const getCustomerInfoMock = Purchases.getCustomerInfo as unknown as jest.Mock;
const getOfferingsMock = Purchases.getOfferings as unknown as jest.Mock;
const purchasePackageMock = Purchases.purchasePackage as unknown as jest.Mock;
const restorePurchasesMock = Purchases.restorePurchases as unknown as jest.Mock;
const logInMock = Purchases.logIn as unknown as jest.Mock;
const logOutMock = Purchases.logOut as unknown as jest.Mock;
const isAnonymousMock = Purchases.isAnonymous as unknown as jest.Mock;
const isConfiguredMock = Purchases.isConfigured as unknown as jest.Mock;

// Only the parts of RevenueCat's objects the store reads.
const premiumInfo = {
  entitlements: { active: { [PREMIUM_ENTITLEMENT]: { identifier: PREMIUM_ENTITLEMENT } } },
} as never;
const freeInfo = { entitlements: { active: {} } } as never;

const annualPackage = { identifier: '$rc_annual', product: { priceString: '$11.99' } } as never;
const offering = { annual: annualPackage, availablePackages: [annualPackage] } as never;

const STORE_ERROR = 'None of the products registered in the RevenueCat dashboard could be fetched.';

beforeEach(() => {
  jest.clearAllMocks();
  useSubscriptionStore.setState({
    isPremium: false,
    offering: null,
    loadError: null,
    error: null,
    purchasePending: false,
  });
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'test_key';
  isConfiguredMock.mockResolvedValue(true);
  isAnonymousMock.mockResolvedValue(false);
});

describe('messageFromPurchaseError', () => {
  // Otherwise the store's reason for a failed purchase never reaches the screen, or a failure with none shows nothing.
  it("uses the error's message, and a general one when there is none", () => {
    expect(messageFromPurchaseError({ message: 'Network down' })).toBe('Network down');
    expect(messageFromPurchaseError(null)).toBe('Something went wrong. Please try again.');
  });

  // Otherwise a maker on a second account sees "The receipt is already in use" with no idea what to do.
  it('says which account to sign in to when the Apple ID already subscribed on another', () => {
    const expected =
      'This Apple ID already has a subscription on another account. Sign in to that account to use backup.';

    expect(messageFromPurchaseError({ code: '7', message: 'The receipt is already in use.' })).toBe(
      expected,
    );
    expect(messageFromPurchaseError({ code: '13' })).toBe(expected);
  });
});

describe('subscriptionStore.init', () => {
  // Otherwise the Backup screen has no price and nothing to buy, or a subscriber sees Subscribe again.
  it("loads the subscription and what's for sale", async () => {
    getCustomerInfoMock.mockResolvedValue(premiumInfo);
    getOfferingsMock.mockResolvedValue({ current: offering });

    await useSubscriptionStore.getState().init();

    expect(useSubscriptionStore.getState()).toMatchObject({
      isPremium: true,
      offering,
      loadError: null,
    });
  });

  // Otherwise a build with no RevenueCat key crashes on launch instead of just leaving backup off.
  it('loads nothing and says so when the build has no key', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;

    await useSubscriptionStore.getState().init();

    expect(getCustomerInfoMock).not.toHaveBeenCalled();
    expect(useSubscriptionStore.getState()).toMatchObject({
      isPremium: false,
      loadError: 'Subscriptions are not available in this build.',
    });
  });

  // Otherwise a failed subscription load throws away a price that did load, and Subscribe has nothing to buy.
  it("keeps what's for sale when the subscription load fails", async () => {
    getCustomerInfoMock.mockRejectedValue({ message: 'Entitlement lookup failed' });
    getOfferingsMock.mockResolvedValue({ current: offering });

    await useSubscriptionStore.getState().init();

    expect(useSubscriptionStore.getState()).toMatchObject({
      offering,
      loadError: 'Entitlement lookup failed',
    });
  });

  // Otherwise one failed load at launch leaves nothing to buy until the app is closed, which is what got Crop Planner rejected.
  it('recovers on a later call after a failed load', async () => {
    getCustomerInfoMock.mockRejectedValueOnce({ message: STORE_ERROR });
    getOfferingsMock.mockRejectedValueOnce({ message: STORE_ERROR });

    await useSubscriptionStore.getState().init();
    expect(useSubscriptionStore.getState()).toMatchObject({
      offering: null,
      loadError: STORE_ERROR,
    });

    getCustomerInfoMock.mockResolvedValue(freeInfo);
    getOfferingsMock.mockResolvedValue({ current: offering });

    await useSubscriptionStore.getState().init();

    expect(useSubscriptionStore.getState()).toMatchObject({ offering, loadError: null });
  });
});

describe('subscriptionStore.identify', () => {
  // Otherwise the purchase goes to an anonymous RevenueCat user and the server never marks the account subscribed.
  it("signs in to RevenueCat with the account's id and takes its subscription", async () => {
    logInMock.mockResolvedValue({ customerInfo: premiumInfo, created: false });

    await useSubscriptionStore.getState().identify('user-1');

    expect(logInMock).toHaveBeenCalledWith('user-1');
    expect(useSubscriptionStore.getState().isPremium).toBe(true);
  });

  // Otherwise a build with no RevenueCat key replaces "not available in this build" with an SDK error on every sign in.
  it('does nothing when the SDK was never set up', async () => {
    isConfiguredMock.mockResolvedValue(false);

    await useSubscriptionStore.getState().identify('user-1');

    expect(logInMock).not.toHaveBeenCalled();
    expect(useSubscriptionStore.getState().error).toBeNull();
  });
});

describe('subscriptionStore.forget', () => {
  // Otherwise the next account to sign in on this phone shows the last one's "Backup is on".
  it('signs out of RevenueCat and drops the subscription', async () => {
    logOutMock.mockResolvedValue(freeInfo);
    useSubscriptionStore.setState({ isPremium: true });

    await useSubscriptionStore.getState().forget();

    expect(logOutMock).toHaveBeenCalledTimes(1);
    expect(useSubscriptionStore.getState().isPremium).toBe(false);
  });

  // Otherwise every launch that starts signed out logs an SDK error for signing out an anonymous user.
  it('skips the sign out when RevenueCat has no account', async () => {
    isAnonymousMock.mockResolvedValue(true);

    await useSubscriptionStore.getState().forget();

    expect(logOutMock).not.toHaveBeenCalled();
  });

  // Otherwise one sign out that fires forget twice signs out of RevenueCat twice and logs an SDK error.
  it('runs two calls at once one after the other, so only the first signs out', async () => {
    let identified = true;
    isAnonymousMock.mockImplementation(() => Promise.resolve(!identified));
    logOutMock.mockImplementation(() => {
      identified = false;
      return Promise.resolve(freeInfo);
    });

    await Promise.all([
      useSubscriptionStore.getState().forget(),
      useSubscriptionStore.getState().forget(),
    ]);

    expect(logOutMock).toHaveBeenCalledTimes(1);
  });
});

describe('subscriptionStore.subscribe', () => {
  // Otherwise a finished purchase leaves the Backup screen still asking the maker to subscribe.
  it('buys the package and turns backup on', async () => {
    purchasePackageMock.mockResolvedValue({ customerInfo: premiumInfo });

    const subscribed = await useSubscriptionStore.getState().subscribe(annualPackage);

    expect(subscribed).toBe(true);
    expect(purchasePackageMock).toHaveBeenCalledWith(annualPackage);
    expect(useSubscriptionStore.getState()).toMatchObject({
      isPremium: true,
      error: null,
      purchasePending: false,
    });
  });

  // Otherwise tapping Cancel on Apple's purchase box shows an error.
  it('shows no error when the maker cancels', async () => {
    purchasePackageMock.mockRejectedValue({ userCancelled: true });

    const subscribed = await useSubscriptionStore.getState().subscribe(annualPackage);

    expect(subscribed).toBe(false);
    expect(useSubscriptionStore.getState()).toMatchObject({ isPremium: false, error: null });
  });

  // Otherwise a failed purchase looks like nothing happened and the maker never learns why.
  it("keeps the store's message when the purchase fails", async () => {
    purchasePackageMock.mockRejectedValue({ message: 'The App Store is unavailable.' });

    const subscribed = await useSubscriptionStore.getState().subscribe(annualPackage);

    expect(subscribed).toBe(false);
    expect(useSubscriptionStore.getState()).toMatchObject({
      error: 'The App Store is unavailable.',
      purchasePending: false,
    });
  });

  // Otherwise a purchase made before RevenueCat knows the account is paid for and turns nothing on.
  it('refuses to buy while RevenueCat has no account yet', async () => {
    isAnonymousMock.mockResolvedValue(true);

    const subscribed = await useSubscriptionStore.getState().subscribe(annualPackage);

    expect(subscribed).toBe(false);
    expect(purchasePackageMock).not.toHaveBeenCalled();
    expect(useSubscriptionStore.getState()).toMatchObject({
      error: 'Your account is still connecting. Wait a moment and try again.',
      purchasePending: false,
    });
  });
});

describe('subscriptionStore.restore', () => {
  // Otherwise a subscriber who reinstalls has to pay again to get backup.
  it('turns backup on when an earlier purchase comes back', async () => {
    restorePurchasesMock.mockResolvedValue(premiumInfo);

    const restored = await useSubscriptionStore.getState().restore();

    expect(restored).toBe(true);
    expect(useSubscriptionStore.getState().isPremium).toBe(true);
  });

  // Otherwise Restore Purchases turns backup on for someone who never bought it.
  it('leaves backup off when there is nothing to restore', async () => {
    restorePurchasesMock.mockResolvedValue(freeInfo);

    const restored = await useSubscriptionStore.getState().restore();

    expect(restored).toBe(false);
    expect(useSubscriptionStore.getState().isPremium).toBe(false);
  });

  // Otherwise a tap on Restore Purchases wipes the store's reason for having nothing to buy, which is what Apple's reviewer saw on Crop Planner.
  it("keeps the store's load error", async () => {
    useSubscriptionStore.setState({ loadError: STORE_ERROR });
    restorePurchasesMock.mockResolvedValue(freeInfo);

    await useSubscriptionStore.getState().restore();

    expect(useSubscriptionStore.getState().loadError).toBe(STORE_ERROR);
  });

  // Otherwise a failed restore looks like there was nothing to restore.
  it("keeps the store's message when the restore fails", async () => {
    restorePurchasesMock.mockRejectedValue({ message: 'Restore failed' });

    const restored = await useSubscriptionStore.getState().restore();

    expect(restored).toBe(false);
    expect(useSubscriptionStore.getState()).toMatchObject({
      error: 'Restore failed',
      purchasePending: false,
    });
  });
});
