// When APP_VARIANT=development (set by the EAS `development` build profile), the
// bundle id gets a `.dev` suffix so the dev build installs as a separate app with
// its own data, alongside any App Store build. Same setup as Crop Planner.
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => {
  if (!IS_DEV) return config;

  return {
    ...config,
    name: 'iMakeStuff (Dev)',
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
      infoPlist: {
        ...config.ios.infoPlist,
        // Dev only: the dev build loads its JS from Metro over plain HTTP on the
        // LAN or Tailscale IP, which iOS blocks for hosts it doesn't treat as local.
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
        },
      },
    },
  };
};
