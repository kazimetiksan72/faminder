const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLandscape(config) {
  return withAndroidManifest(config, (result) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(result.modResults);
    activity.$['android:screenOrientation'] = 'sensorLandscape';
    activity.$['android:resizeableActivity'] = 'false';
    // Preserve the landscape lock on large screens when targeting Android 16 (API 36).
    const name = 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY';
    activity.property = (activity.property ?? []).filter((p) => p.$['android:name'] !== name);
    activity.property.push({ $: { 'android:name': name, 'android:value': 'true' } });
    return result;
  });
};
