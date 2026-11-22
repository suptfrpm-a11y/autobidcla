import React, { useState, useEffect } from 'react';
import { 
  auth, db, googleProvider, microsoftProvider,
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup,
  signOut,
  sendEmailVerification,
  FirebaseUser,
  doc, getDoc, setDoc 
} from '../firebase';
import { sanitizeInstagramUsername, validateInstagramUsername } from '../utils/username';

interface AuthProps {
  initialMode: 'login' | 'register';
  onLoginSuccess: (userData?: { username: string, uid: string }) => void;
  pendingVerificationUser?: FirebaseUser | null;
  t: any;
}

const RESEND_COOLDOWN_SECONDS = 60;

function isOAuthVerifiedProvider(user: FirebaseUser | null | undefined): boolean {
  if (!user) return false;
  return Boolean(
    user.providerData?.some(
      (p) => p?.providerId === 'google.com' || p?.providerId === 'microsoft.com'
    )
  );
}

function getStoredCooldownRemaining(uid: string | undefined): number {
  if (!uid) return 0;
  try {
    const raw = sessionStorage.getItem(`autobid_verify_sent_${uid}`);
    if (!raw) return 0;
    const elapsedSec = Math.floor((Date.now() - Number(raw)) / 1000);
    const remaining = RESEND_COOLDOWN_SECONDS - elapsedSec;
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

function markVerificationSentTimestamp(uid: string | undefined): void {
  if (!uid) return;
  try {
    sessionStorage.setItem(`autobid_verify_sent_${uid}`, String(Date.now()));
  } catch {
    // Ignore storage restriction
  }
}

export const Auth: React.FC<AuthProps> = ({ initialMode, onLoginSuccess, pendingVerificationUser, t }) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email verification state
  const [verificationUser, setVerificationUser] = useState<FirebaseUser | null>(pendingVerificationUser || null);
  const [resendCooldown, setResendCooldown] = useState<number>(() => getStoredCooldownRemaining(pendingVerificationUser?.uid));
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);

  // Sync external pendingVerificationUser (e.g. restored unverified session on reload)
  useEffect(() => {
    if (pendingVerificationUser) {
      setVerificationUser(pendingVerificationUser);
      setResendCooldown(prev => prev > 0 ? prev : getStoredCooldownRemaining(pendingVerificationUser.uid));
    } else if (pendingVerificationUser === null && verificationUser) {
      // Parent cleared pending verification (user verified or signed out)
      if (!auth.currentUser || auth.currentUser.emailVerified || isOAuthVerifiedProvider(auth.currentUser)) {
        setVerificationUser(null);
      }
    }
  }, [pendingVerificationUser]);

  // 60-second countdown timer for Resend button
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifyNotice(null);
    
    if (mode === 'register') {
        if (!agreedToTerms) {
            setError("Please review and agree to AutoBid's Terms & Conditions to create an account.");
            return;
        }
        if (password !== confirmPassword) {
            setError(t.passwordsNoMatch || "Passwords do not match");
            return;
        }
        const validation = validateInstagramUsername(username);
        if (!validation.isValid) {
            setError(validation.error || "Please choose a valid username.");
            return;
        }
    }

    setIsLoading(true);
    
    try {
      if (mode === 'register') {
        const cleanUsername = sanitizeInstagramUsername(username);
        const usernameRef = doc(db, 'usernames', cleanUsername);
        const usernameDoc = await getDoc(usernameRef);
        
        if (usernameDoc.exists()) {
           setError("Username @" + cleanUsername + " is already taken.");
           setIsLoading(false);
           return;
        }

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Reserve username
        await setDoc(usernameRef, { uid: userCredential.user.uid });
        try {
          sessionStorage.setItem(`autobid_pending_username_${userCredential.user.uid}`, cleanUsername);
        } catch {
          // Ignore storage restriction
        }

        // Send mandatory email verification using Firebase project settings
        setVerificationUser(userCredential.user);
        try {
          auth.useDeviceLanguage();
          await sendEmailVerification(userCredential.user);
          markVerificationSentTimestamp(userCredential.user.uid);
          setResendCooldown(RESEND_COOLDOWN_SECONDS);
          setVerifyNotice(`We sent a verification link to ${userCredential.user.email || email}. Please check your inbox and verify your email to continue.`);
        } catch (verifyErr: any) {
          if (verifyErr?.code === 'auth/too-many-requests') {
            markVerificationSentTimestamp(userCredential.user.uid);
            setResendCooldown(RESEND_COOLDOWN_SECONDS);
          }
          setError(verifyErr?.message || 'Account created, but failed to send verification email. Click Resend to try again.');
        }
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        if (!userCredential.user.emailVerified) {
          setVerificationUser(userCredential.user);
          setResendCooldown(getStoredCooldownRemaining(userCredential.user.uid));
          setVerifyNotice('Please verify your email address before accessing AutoBid.');
          return;
        }
        await userCredential.user.getIdToken(true);
        const fallbackUsername = sanitizeInstagramUsername(userCredential.user.email?.split('@')[0] || 'user');
        onLoginSuccess({ username: fallbackUsername, uid: userCredential.user.uid });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (resendCooldown > 0 || isResending) return;
    const targetUser = auth.currentUser || verificationUser;
    if (!targetUser) {
      setError('Session expired. Please sign in again.');
      setVerificationUser(null);
      return;
    }

    setIsResending(true);
    setError(null);
    setVerifyNotice(null);

    try {
      auth.useDeviceLanguage();
      await sendEmailVerification(targetUser);
      markVerificationSentTimestamp(targetUser.uid);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setVerifyNotice(`Verification email sent to ${targetUser.email || 'your email'}. Please check your inbox and spam folder.`);
    } catch (err: any) {
      if (err?.code === 'auth/too-many-requests') {
        markVerificationSentTimestamp(targetUser.uid);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setError('Too many requests. Please wait 60 seconds before resending.');
      } else {
        setError(err?.message || 'Failed to resend verification email.');
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleCheckVerified = async () => {
    const targetUser = auth.currentUser || verificationUser;
    if (!targetUser) {
      setError('Session expired. Please sign in again.');
      setVerificationUser(null);
      return;
    }

    setIsCheckingVerification(true);
    setError(null);

    try {
      await targetUser.reload();
      const reloadedUser = auth.currentUser || targetUser;
      if (reloadedUser.emailVerified) {
        await reloadedUser.getIdToken(true);
        const resolvedUsername = sanitizeInstagramUsername(
          reloadedUser.displayName || reloadedUser.email?.split('@')[0] || 'user'
        );
        setVerificationUser(null);
        setVerifyNotice(null);
        onLoginSuccess({ username: resolvedUsername, uid: reloadedUser.uid });
      } else {
        setVerifyNotice(null);
        setError('Your email is not verified yet. Please click the verification link in your inbox, then click "I have verified" again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not check verification status. Please try again.');
    } finally {
      setIsCheckingVerification(false);
    }
  };

  const handleSignOutUnverified = async () => {
    try {
      await signOut(auth);
    } catch {
      // Ignore sign out error
    }
    setVerificationUser(null);
    setVerifyNotice(null);
    setError(null);
    setPassword('');
    setConfirmPassword('');
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const cleanUsername = sanitizeInstagramUsername(result.user.displayName || result.user.email?.split('@')[0] || 'user');
      onLoginSuccess({ username: cleanUsername, uid: result.user.uid });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, microsoftProvider);
      onLoginSuccess({ username: result.user.displayName || result.user.email?.split('@')[0] || 'User', uid: result.user.uid });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (verificationUser) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] py-12 px-4 w-full">
        <div className="glass-panel p-8 sm:p-10 rounded-[2.5rem] w-full max-w-md relative overflow-hidden shadow-2xl shadow-red-900/5">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-400/20 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-400/20 rounded-full blur-3xl pointer-events-none"></div>

          <div className="relative z-10 text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shadow-sm">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>

            <h2 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">
              Verify your email
            </h2>
            <p className="text-gray-600 text-sm mb-6 leading-relaxed">
              We need to confirm your email address{' '}
              <span className="font-bold text-gray-900 break-all">
                {verificationUser.email || email}
              </span>{' '}
              before you can access AutoBid, your wallet, or bidding.
            </p>

            {verifyNotice && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-medium">
                {verifyNotice}
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-xl text-sm font-medium">
                {error}
              </div>
            )}

            <div className="space-y-3 mt-4">
              <button
                type="button"
                onClick={handleCheckVerified}
                disabled={isCheckingVerification || isResending}
                className="w-full bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold py-4 rounded-2xl hover:shadow-xl hover:shadow-red-500/30 hover:scale-[1.01] active:scale-[0.99] transition-all text-base shadow-lg disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
              >
                {isCheckingVerification ? 'Checking...' : 'I have verified'}
              </button>

              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendCooldown > 0 || isResending || isCheckingVerification}
                className="w-full bg-white border border-gray-200 text-gray-800 font-bold py-3.5 rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm text-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {isResending
                  ? 'Sending...'
                  : resendCooldown > 0
                    ? `Resend (${resendCooldown}s)`
                    : 'Resend'}
              </button>
            </div>

            <div className="mt-6 pt-5 border-t border-gray-200/70">
              <button
                type="button"
                onClick={handleSignOutUnverified}
                disabled={isCheckingVerification || isResending}
                className="text-xs font-bold text-gray-500 hover:text-red-600 underline transition cursor-pointer"
              >
                Sign out and use a different account
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh] py-12 px-4">
      <div className="glass-panel p-8 sm:p-10 rounded-[2.5rem] w-full max-w-md relative overflow-hidden shadow-2xl shadow-red-900/5">
        
        {/* Decorative ambient blobs inside the card */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-400/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-400/20 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10">
            <h2 className="text-4xl font-bold text-gray-900 mb-3 text-center tracking-tight">
            {mode === 'login' ? t.welcomeBack : t.joinAutoBid}
            </h2>
            <p className="text-gray-500 text-center mb-8 font-medium">
            {mode === 'login' 
                ? t.enterCredentials 
                : t.startJourney}
            </p>

            {error && (
                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm font-medium text-center">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
                {mode === 'register' && (
                  <div className="animate-fade-in-down">
                      <div className="flex justify-between items-center mb-2 ml-2">
                        <label className="block text-sm font-bold text-gray-700">{t.username}</label>
                        <span className="text-[11px] text-gray-400 font-medium">No spaces • a-z, 0-9, _, .</span>
                      </div>
                      <div className="relative">
                        <span className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">@</span>
                        <input 
                            type="text" 
                            required
                            value={username}
                            onChange={(e) => {
                              const sanitized = sanitizeInstagramUsername(e.target.value);
                              setUsername(sanitized);
                            }}
                            className="w-full pl-10 pr-6 py-4 bg-white/50 border border-white/60 rounded-2xl focus:ring-4 focus:ring-red-100 focus:bg-white focus:border-red-200 outline-none transition-all shadow-inner text-gray-800 placeholder-gray-400 font-medium"
                            placeholder="racer_x"
                        />
                      </div>
                      {username && (
                        <p className="text-[11px] text-emerald-600 font-medium mt-1 ml-2">
                          Your profile handle: <strong>@{username}</strong>
                        </p>
                      )}
                  </div>
                )}

                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 ml-2">{t.email}</label>
                    <input 
                        type="email" 
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-6 py-4 bg-white/50 border border-white/60 rounded-2xl focus:ring-4 focus:ring-red-100 focus:bg-white focus:border-red-200 outline-none transition-all shadow-inner text-gray-800 placeholder-gray-400"
                        placeholder="you@example.com"
                    />
                </div>
                
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 ml-2">{t.password}</label>
                    <input 
                        type="password" 
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-6 py-4 bg-white/50 border border-white/60 rounded-2xl focus:ring-4 focus:ring-red-100 focus:bg-white focus:border-red-200 outline-none transition-all shadow-inner text-gray-800 placeholder-gray-400"
                        placeholder="••••••••"
                    />
                </div>

                {mode === 'register' && (
                  <div className="animate-fade-in-down">
                      <label className="block text-sm font-bold text-gray-700 mb-2 ml-2">{t.confirmPassword}</label>
                      <input 
                          type="password" 
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className={`w-full px-6 py-4 bg-white/50 border rounded-2xl focus:ring-4 focus:ring-red-100 focus:bg-white focus:border-red-200 outline-none transition-all shadow-inner text-gray-800 placeholder-gray-400 ${
                            confirmPassword && password !== confirmPassword ? 'border-red-400 focus:border-red-400' : 'border-white/60'
                          }`}
                          placeholder="••••••••"
                      />
                      {confirmPassword && password !== confirmPassword && (
                        <p className="text-red-500 text-xs mt-2 ml-2 font-medium">{t.passwordsNoMatch}</p>
                      )}
                  </div>
                )}

                {mode === 'register' && (
                  <div className="pt-1 px-1 animate-fade-in-down">
                    <label className="flex items-start gap-3 cursor-pointer group select-none">
                      <input 
                        type="checkbox" 
                        checked={agreedToTerms}
                        onChange={(e) => setAgreedToTerms(e.target.checked)}
                        className="mt-1 w-4 h-4 rounded text-red-600 border-gray-300 focus:ring-red-500 cursor-pointer accent-red-600 shrink-0"
                      />
                      <span className="text-xs text-gray-600 leading-snug">
                        I have read and agree to AutoBid's{' '}
                        <button 
                          type="button" 
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTermsModal(true); }}
                          className="font-bold text-red-600 hover:text-red-700 underline cursor-pointer"
                        >
                          Terms & Conditions
                        </button>{' '}
                        and{' '}
                        <button 
                          type="button" 
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTermsModal(true); }}
                          className="font-bold text-red-600 hover:text-red-700 underline cursor-pointer"
                        >
                          Privacy Policy
                        </button>
                      </span>
                    </label>
                  </div>
                )}

                {mode === 'login' && (
                    <div className="flex justify-end">
                        <button type="button" className="text-sm font-bold text-red-500 hover:text-red-700 transition-colors">
                            {t.forgotPassword}
                        </button>
                    </div>
                )}

                <button 
                    type="submit" 
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold py-4 rounded-2xl hover:shadow-xl hover:shadow-red-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all text-lg shadow-lg mt-4 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
                >
                    {isLoading ? (
                        <span className="flex items-center justify-center gap-2">
                            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Processing...
                        </span>
                    ) : (
                        mode === 'login' ? t.signIn : t.createAccount
                    )}
                </button>
            </form>

            <div className="mt-8 flex items-center justify-center gap-4">
              <div className="h-px bg-gray-300 w-full opacity-50"></div>
              <span className="text-gray-400 text-sm font-medium whitespace-nowrap">{t.orContinue}</span>
              <div className="h-px bg-gray-300 w-full opacity-50"></div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mt-6">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold py-3.5 rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm flex items-center justify-center gap-2 group text-sm"
              >
                <svg className="w-5 h-5 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Google
              </button>

              <button
                type="button"
                onClick={handleMicrosoftLogin}
                disabled={isLoading}
                className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold py-3.5 rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm flex items-center justify-center gap-2 group text-sm"
              >
                <svg className="w-5 h-5 transition-transform group-hover:scale-110" viewBox="0 0 21 21">
                  <path d="M0 0h10v10H0z" fill="#f25022"/>
                  <path d="M11 0h10v10H11z" fill="#7fba00"/>
                  <path d="M0 11h10v10H0z" fill="#00a4ef"/>
                  <path d="M11 11h10v10H11z" fill="#ffb900"/>
                </svg>
                Microsoft
              </button>
            </div>

            <div className="mt-8 text-center">
                <p className="text-gray-600 font-medium">
                    {mode === 'login' ? `${t.dontHaveAccount} ` : `${t.alreadyHaveAccount} `}
                    <button 
                        onClick={() => {
                          setMode(mode === 'login' ? 'register' : 'login');
                          setConfirmPassword('');
                          setPassword('');
                          setUsername('');
                        }}
                        className="font-bold text-red-600 hover:text-red-700 hover:underline transition-all ml-1"
                    >
                        {mode === 'login' ? t.createAccount : t.signIn}
                    </button>
                </p>
            </div>
        </div>
      </div>

      {/* Terms & Conditions Modal */}
      {showTermsModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowTermsModal(false); }}
        >
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-gray-200 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center text-lg font-bold">
                  📜
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">AutoBid Terms & Conditions</h3>
                  <p className="text-xs text-gray-500">Platform User Agreement & Legal Guidelines</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center font-bold text-sm transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-gray-700 leading-relaxed">
              <div className="p-3 bg-red-50/70 border border-red-100 rounded-xl text-xs text-red-900 font-medium">
                By registering on AutoBid, you enter into a legally binding agreement governing vehicle bidding, direct purchases, marketplace listings, and user identity compliance.
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1 flex items-center gap-1.5">
                  <span className="text-red-500">1.</span> Account Eligibility & Registration
                </h4>
                <p className="text-gray-600 text-xs">
                  You must be at least 18 years of age to register. You agree to provide true, current, and complete registration details. Creating duplicate, fraudulent, or impersonation accounts is strictly forbidden.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1 flex items-center gap-1.5">
                  <span className="text-red-500">2.</span> Mandatory Identity & Phone (OTP) Verification
                </h4>
                <p className="text-gray-600 text-xs">
                  To safeguard marketplace trust and curb fraud, all users must complete a 2-step verification process before placing bids or listing vehicles:
                  <br />
                  <strong>• Step 1:</strong> Mobile number verification via One-Time Password (OTP). Your verified phone number is recorded on your official account profile.
                  <br />
                  <strong>• Step 2:</strong> Official identity documentation upload (PAN Card or Government National ID). Verification requests are securely audited by AutoBid Compliance.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1 flex items-center gap-1.5">
                  <span className="text-red-500">3.</span> Auction Rules & Legally Binding Bids
                </h4>
                <p className="text-gray-600 text-xs">
                  Every submitted bid constitutes an irrevocable offer to purchase the listed vehicle at that bid price. Bids cannot be retracted once placed. Shill bidding, artificial price inflation, or bidding without purchase capability results in immediate account termination and forfeiture of deposits.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1 flex items-center gap-1.5">
                  <span className="text-red-500">4.</span> Vehicle Listings & Seller Responsibilities
                </h4>
                <p className="text-gray-600 text-xs">
                  Sellers must hold genuine legal title and authority to sell listed vehicles. Vehicle condition, damage history (collision, mechanical, flood), odometer readings, and registration documents must be disclosed truthfully.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1 flex items-center gap-1.5">
                  <span className="text-red-500">5.</span> Wallet Deposits & Platform Payments
                </h4>
                <p className="text-gray-600 text-xs">
                  Bidding security deposits and wallet transactions are processed in Indian Rupees (INR) via CT Account to mint virtual wallet credits. Virtual funds spent on platform services, boosts, and auction commissions are collected into CT Collection.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1 flex items-center gap-1.5">
                  <span className="text-red-500">6.</span> Privacy & Anti-Fraud Protection
                </h4>
                <p className="text-gray-600 text-xs">
                  Your identity documents and phone number are kept encrypted and accessed strictly for authentication and transaction compliance. They will never be sold or shared with unauthorized third parties.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-gray-500 text-center sm:text-left">
                Last updated: October 2026 • AutoBid Legal Compliance
              </span>
              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setShowTermsModal(false)}
                  className="flex-1 sm:flex-none px-4 py-2.5 text-xs font-bold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgreedToTerms(true);
                    setShowTermsModal(false);
                  }}
                  className="flex-1 sm:flex-none px-5 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>✓</span>
                  <span>I Agree & Accept Terms</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};