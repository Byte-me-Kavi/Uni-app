import { isAuthError } from '@supabase/supabase-js';

// Turns Supabase Auth errors into short, plain messages. Messages from our sign-up hook (unknown
// domain, university not open yet, missing confirmations) are already written for students and are
// passed through.
export function authErrorMessage(error: unknown): string {
  if (!isAuthError(error)) {
    return 'Something went wrong. Check your connection and try again.';
  }

  switch (error.code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'email_not_confirmed':
      return 'Confirm your email first. We sent you a 6-digit code.';
    case 'weak_password':
      return 'Use at least 10 characters, with both letters and numbers.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Sign in instead.';
    case 'otp_expired':
      return 'That code is wrong or has expired. Request a new one.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.';
    case 'signup_disabled':
      return 'Sign-up is paused right now. Try again later.';
    default:
      if (error.status && error.status >= 500) {
        return 'Uni Era is having trouble right now. Try again in a moment.';
      }
      return error.message || 'Something went wrong. Try again.';
  }
}

export function isEmailNotConfirmed(error: unknown): boolean {
  return isAuthError(error) && error.code === 'email_not_confirmed';
}
