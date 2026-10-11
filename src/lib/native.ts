import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Native features added after a phone's app build was made are missing on that phone until it
// updates. Modules that may be missing are loaded only when used and checked first, so an older
// build keeps working and says what to do instead of crashing at launch.

export function hasNative(...names: string[]) {
  return Platform.OS === 'web' || names.every((name) => !!requireOptionalNativeModule(name));
}

export const UPDATE_APP = 'Update Uni Era to use this. This version of the app does not have it yet.';
