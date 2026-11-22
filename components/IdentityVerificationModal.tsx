import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  X,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Smartphone,
  CreditCard,
  IdCard,
  Layers,
  Camera,
  FileText,
  Lock,
  Check,
} from 'lucide-react';
import { User, VerificationRequest, IdDocumentType } from '../types';
import {
  auth,
  db,
  doc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  where,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  ConfirmationResult,
} from '../firebase';
import { saveWorkflowDraft, getWorkflowDraft, clearWorkflowDraft } from '../utils/cookieManager';
import { authFetch } from '../utils/apiClient';
import { uploadDataUrlToStorage } from '../utils/storageUpload';

export interface IdentityVerificationModalProps {
  currentUser: User;
  isOpen?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onVerificationSubmitted?: () => void;
  gateReason?: 'bid' | 'sell' | 'event' | 'general';
}

export const IdentityVerificationModal: React.FC<IdentityVerificationModalProps> = ({
  currentUser,
  isOpen = true,
  onClose,
  onSuccess,
  onVerificationSubmitted,
  gateReason = 'general',
}) => {
  const [activeStep, setActiveStep] = useState<1 | 2>(
    currentUser.phoneVerified && currentUser.phoneNumber ? 2 : 1
  );

  const [isRestored, setIsRestored] = useState(false);

  // Phone Verification & OTP State (Firebase Phone Auth)
  const [phone, setPhone] = useState(currentUser.phoneNumber || '');
  const [isPhoneVerified, setIsPhoneVerified] = useState(
    Boolean(currentUser.phoneVerified && currentUser.phoneNumber)
  );
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState<number | undefined>(
    currentUser.phoneVerifiedAt
  );
  const confirmationResultRef = useRef<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  const [docType, setDocType] = useState<IdDocumentType>('pan_card');
  const [fullName, setFullName] = useState(currentUser.fullName || '');
  const [dob, setDob] = useState('');

  // PAN Card State
  const [panNumber, setPanNumber] = useState(currentUser.panNumber || '');
  const [panImage, setPanImage] = useState<string | null>(null);

  // National ID State
  const [nationalIdType, setNationalIdType] = useState<
    'Aadhaar Card' | 'Voter ID' | 'Passport' | 'Government ID'
  >('Aadhaar Card');
  const [nationalIdNumber, setNationalIdNumber] = useState(currentUser.nationalIdNumber || '');
  const [nationalIdFront, setNationalIdFront] = useState<string | null>(null);
  const [nationalIdBack, setNationalIdBack] = useState<string | null>(null);

  // Existing Request & UI State
  const [existingRequest, setExistingRequest] = useState<VerificationRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isReSubmitting, setIsReSubmitting] = useState(false);

  // Auto-Restore Draft from Cookies / LocalStorage on mount
  useEffect(() => {
    const draft = getWorkflowDraft<any>('kyc_verification');
    if (draft && draft.data) {
      if (draft.step) setActiveStep(draft.step as 1 | 2);
      if (draft.data.phone && !currentUser.phoneNumber) setPhone(draft.data.phone);
      if (draft.data.docType) setDocType(draft.data.docType);
      if (draft.data.fullName && !currentUser.fullName) setFullName(draft.data.fullName);
      if (draft.data.dob) setDob(draft.data.dob);
      if (draft.data.panNumber && !currentUser.panNumber) setPanNumber(draft.data.panNumber);
      if (draft.data.nationalIdType) setNationalIdType(draft.data.nationalIdType);
      if (draft.data.nationalIdNumber && !currentUser.nationalIdNumber)
        setNationalIdNumber(draft.data.nationalIdNumber);
      if (draft.data.panImage) setPanImage(draft.data.panImage);
      if (draft.data.nationalIdFront) setNationalIdFront(draft.data.nationalIdFront);
      if (draft.data.nationalIdBack) setNationalIdBack(draft.data.nationalIdBack);
      setIsRestored(true);
    }
  }, []);

  // Continuous Auto-Save to Cookies & Storage on change
  useEffect(() => {
    if (successMsg) return;
    const hasData = Boolean(
      phone ||
        fullName ||
        panNumber ||
        nationalIdNumber ||
        panImage ||
        nationalIdFront ||
        activeStep === 2
    );
    if (!hasData) return;

    saveWorkflowDraft('kyc_verification', activeStep, {
      phone,
      docType,
      fullName,
      dob,
      panNumber,
      nationalIdType,
      nationalIdNumber,
      panImage,
      nationalIdFront,
      nationalIdBack,
    });
  }, [
    activeStep,
    phone,
    docType,
    fullName,
    dob,
    panNumber,
    nationalIdType,
    nationalIdNumber,
    panImage,
    nationalIdFront,
    nationalIdBack,
    successMsg,
  ]);

  const handleDiscardVerificationDraft = () => {
    clearWorkflowDraft('kyc_verification');
    setIsRestored(false);
    setFullName(currentUser.fullName || '');
    setDob('');
    setPanNumber(currentUser.panNumber || '');
    setPanImage(null);
    setNationalIdNumber(currentUser.nationalIdNumber || '');
    setNationalIdFront(null);
    setNationalIdBack(null);
    if (!currentUser.phoneVerified) {
      setActiveStep(1);
    }
  };

  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  useEffect(() => {
    if (currentUser.phoneVerified && currentUser.phoneNumber) {
      setIsPhoneVerified(true);
      setPhone(currentUser.phoneNumber);
      setPhoneVerifiedAt(currentUser.phoneVerifiedAt);
    }
  }, [currentUser.phoneVerified, currentUser.phoneNumber, currentUser.phoneVerifiedAt]);

  const handleSendOtp = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    const digitsOnly = phone.replace(/\D/g, '');
    const cleanNumber = digitsOnly.slice(-10);
    if (cleanNumber.length !== 10) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!auth.currentUser) {
      setErrorMsg('You must be signed in to verify your phone number.');
      return;
    }

    setIsSendingOtp(true);
    try {
      const e164Phone = `+91${cleanNumber}`;
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {}
      const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      recaptchaVerifierRef.current = verifier;
      const result = await linkWithPhoneNumber(auth.currentUser, e164Phone, verifier);
      confirmationResultRef.current = result;
      setOtpSent(true);
      setOtpCode('');
      setOtpCountdown(45);
      setSuccessMsg(`SMS verification code sent to ${e164Phone}. Please check your phone.`);
    } catch (err: any) {
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {}
      recaptchaVerifierRef.current = null;
      setErrorMsg(
        err?.message ||
          'Unable to dispatch SMS verification code. Please check Firebase Phone Auth configuration.'
      );
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setErrorMsg('Please enter the 6-digit SMS verification code.');
      return;
    }
    if (!confirmationResultRef.current || !auth.currentUser) {
      setErrorMsg('Verification session expired. Please request a new OTP code.');
      return;
    }

    setIsVerifyingOtp(true);
    try {
      await confirmationResultRef.current.confirm(otpCode.trim());
      await auth.currentUser.getIdToken(true);
      const res = await authFetch('/api/auth/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Server failed to record verified phone number.');
      }

      const verifiedPhoneStr =
        data.phoneNumber || `+91${phone.replace(/\D/g, '').slice(-10)}`;
      setIsPhoneVerified(true);
      setPhone(verifiedPhoneStr);
      setPhoneVerifiedAt(data.phoneVerifiedAt || Date.now());

      setSuccessMsg(`Mobile number ${verifiedPhoneStr} verified successfully.`);
      setTimeout(() => {
        setActiveStep(2);
        setSuccessMsg('');
      }, 700);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Invalid OTP code. Please check your SMS and try again.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  useEffect(() => {
    if (!currentUser?.id) return;
    const q = query(collection(db, 'verifications'), where('userId', '==', currentUser.id));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const docData = snapshot.docs[0].data() as VerificationRequest;
          setExistingRequest({ id: snapshot.docs[0].id, ...docData });
        } else {
          setExistingRequest(null);
        }
      },
      (err) => console.error('Error listening to verification request:', err)
    );
    return () => unsub();
  }, [currentUser?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (isOpen === false) return null;

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      setErrorMsg('File size exceeds 8MB. Please select a smaller photo or document.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
        setter(compressedBase64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const validateInputs = () => {
    if (!isPhoneVerified) {
      setErrorMsg(
        'Please complete Step 1 (Mobile Number OTP Verification) before submitting identity documents.'
      );
      setActiveStep(1);
      return false;
    }

    if (!fullName.trim()) {
      setErrorMsg('Please enter your full legal name as written on your official ID.');
      return false;
    }

    if (docType === 'pan_card' || docType === 'both') {
      const cleanPan = panNumber.trim().toUpperCase();
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(cleanPan)) {
        setErrorMsg(
          'Invalid PAN Card format. Standard PAN is 10 alphanumeric characters (e.g. ABCDE1234F).'
        );
        return false;
      }
      if (!panImage && !existingRequest?.panCardPhotoUrl) {
        setErrorMsg('Please upload a clear photograph of your PAN Card.');
        return false;
      }
    }

    if (docType === 'national_id' || docType === 'both') {
      if (!nationalIdNumber.trim() || nationalIdNumber.trim().length < 4) {
        setErrorMsg(`Please enter a valid ${nationalIdType} number.`);
        return false;
      }
      if (!nationalIdFront && !existingRequest?.nationalIdPhotoUrl) {
        setErrorMsg(`Please upload the front photo of your ${nationalIdType}.`);
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!validateInputs()) return;

    setIsSubmitting(true);
    setAiScanning(true);

    try {
      const primaryPhoto =
        docType === 'pan_card' || docType === 'both' ? panImage : nationalIdFront;

      let aiResult = {
        validationStatus: 'passed',
        confidenceScore: 85,
        notes: 'Document queued for admin verification.',
      };

      try {
        const res = await authFetch('/api/verify-id-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentType: docType === 'pan_card' ? 'pan_card' : 'national_id',
            idNumber: docType === 'pan_card' ? panNumber.toUpperCase() : nationalIdNumber,
            fullName: fullName.trim(),
            imageBase64: primaryPhoto,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          aiResult = {
            validationStatus: data.validationStatus || 'passed',
            confidenceScore: data.confidenceScore || 85,
            notes: data.notes || 'Document verified by AI engine and forwarded to admin.',
          };
        }
      } catch (aiErr) {
        console.warn('AI pre-check skipped, proceeding directly to admin verification:', aiErr);
      } finally {
        setAiScanning(false);
      }

      const reqId = existingRequest?.id || `verif_${currentUser.id}_${Date.now()}`;
      const verifiedPhone = phone.trim() || currentUser.phoneNumber || '';
      const verifiedAt = phoneVerifiedAt || currentUser.phoneVerifiedAt || Date.now();

      const payload: Partial<VerificationRequest> = {
        id: reqId,
        userId: currentUser.id,
        username: currentUser.username,
        userEmail: currentUser.email || '',
        userFullName: fullName.trim(),
        phoneNumber: verifiedPhone,
        phoneVerified: true,
        phoneVerifiedAt: verifiedAt,
        documentType: docType,
        dob: dob || '',
        status: 'pending',
        submittedAt: Date.now(),
        aiValidationStatus: aiResult.validationStatus as any,
        aiConfidence: aiResult.confidenceScore,
        aiNotes: aiResult.notes,
      };

      if (docType === 'pan_card' || docType === 'both') {
        payload.panNumber = panNumber.trim().toUpperCase();
        payload.panCardName = fullName.trim();
        if (panImage) {
          payload.panCardPhotoUrl = await uploadDataUrlToStorage(
            panImage,
            'kyc',
            `${currentUser.id}/pan_${reqId}.jpg`
          );
        }
      }

      if (docType === 'national_id' || docType === 'both') {
        payload.nationalIdType = nationalIdType;
        payload.nationalIdNumber = nationalIdNumber.trim();
        payload.nationalIdName = fullName.trim();
        if (nationalIdFront) {
          payload.nationalIdPhotoUrl = await uploadDataUrlToStorage(
            nationalIdFront,
            'kyc',
            `${currentUser.id}/id_front_${reqId}.jpg`
          );
        }
        if (nationalIdBack) {
          payload.nationalIdBackPhotoUrl = await uploadDataUrlToStorage(
            nationalIdBack,
            'kyc',
            `${currentUser.id}/id_back_${reqId}.jpg`
          );
        }
      }

      await setDoc(doc(db, 'verifications', reqId), payload, { merge: true });

      await setDoc(
        doc(db, 'user_private', currentUser.id),
        {
          panNumber: payload.panNumber || currentUser.panNumber || '',
          nationalIdNumber: payload.nationalIdNumber || currentUser.nationalIdNumber || '',
          idDocumentType: docType,
        },
        { merge: true }
      );

      await updateDoc(doc(db, 'users', currentUser.id), {
        verificationStatus: 'pending',
      });

      const docTypeLabel =
        docType === 'pan_card'
          ? 'PAN Card'
          : docType === 'both'
          ? 'PAN & National ID'
          : nationalIdType;
      await authFetch('/api/verifications/notify-submitted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docTypeLabel }),
      }).catch(() => {});

      setSuccessMsg(
        'Your identity verification details have been submitted successfully. AutoBid Admins and Verification Officers will review your documents shortly.'
      );
      clearWorkflowDraft('kyc_verification');
      setIsRestored(false);
      setIsReSubmitting(false);
      if (onSuccess) onSuccess();
      if (onVerificationSubmitted) onVerificationSubmitted();
    } catch (err: any) {
      console.error('Verification submit error:', err);
      setErrorMsg(err.message || 'Failed to submit verification request. Please try again.');
    } finally {
      setIsSubmitting(false);
      setAiScanning(false);
    }
  };

  const getGateReasonTitle = () => {
    switch (gateReason) {
      case 'bid':
        return 'Verify Your Identity to Place Bids';
      case 'sell':
        return 'ID Verification Required to Sell Vehicles';
      case 'event':
        return 'Verified Identity Required for Live Events';
      default:
        return 'AutoBid Identity Verification (KYC)';
    }
  };

  const getGateReasonDescription = () => {
    switch (gateReason) {
      case 'bid':
        return 'To protect our buyers and sellers from unauthorized or fraudulent bidding, AutoBid requires a one-time PAN Card or National ID verification before placing bids.';
      case 'sell':
        return 'As an auction marketplace compliance requirement, all sellers must be authenticated with an official PAN Card or National ID before listing vehicles.';
      case 'event':
        return 'Live auction bidding and special auction event participation requires verified identity credentials.';
      default:
        return 'Verify your account using your PAN Card or National ID Card to unlock unlimited bidding, vehicle selling, and platform privileges.';
    }
  };

  if (currentUser.isVerified && !isReSubmitting) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="relative bg-white rounded-lg max-w-md w-full max-h-[85vh] flex flex-col p-6 shadow-md border border-gray-200 text-center overflow-y-auto">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg w-8 h-8 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="w-12 h-12 bg-green-50 border border-green-200 text-green-600 rounded-lg flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-green-50 border border-green-200 text-green-700 text-xs font-semibold uppercase tracking-wider mb-2 mx-auto">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Account Verified</span>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Verified AutoBid Member</h3>
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            Your official identity has been authenticated. You have unrestricted access to place bids, join live auctions, and list vehicles.
          </p>

          <div className="bg-gray-50 rounded-lg p-4 mb-5 text-left border border-gray-200 text-xs space-y-2">
            <div className="flex justify-between items-center py-1 border-b border-gray-200">
              <span className="text-gray-500">Account Holder:</span>
              <span className="font-semibold text-gray-900">{currentUser.fullName}</span>
            </div>
            {currentUser.phoneNumber && (
              <div className="flex justify-between items-center py-1 border-b border-gray-200">
                <span className="text-gray-500">Mobile Number:</span>
                <span className="tabular-nums font-semibold text-gray-900 flex items-center gap-1.5">
                  <span>{currentUser.phoneNumber}</span>
                  <span className="text-green-600 text-[11px]">OTP Verified</span>
                </span>
              </div>
            )}
            {currentUser.panNumber && (
              <div className="flex justify-between items-center py-1 border-b border-gray-200">
                <span className="text-gray-500">PAN Card:</span>
                <span className="tabular-nums font-semibold text-gray-900">
                  {currentUser.panNumber.substring(0, 3)}****{currentUser.panNumber.slice(-2)}
                </span>
              </div>
            )}
            {currentUser.nationalIdNumber && (
              <div className="flex justify-between items-center py-1 border-b border-gray-200">
                <span className="text-gray-500">National ID:</span>
                <span className="tabular-nums font-semibold text-gray-900">
                  {currentUser.nationalIdNumber.substring(0, 2)}****
                  {currentUser.nationalIdNumber.slice(-2)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500">Bidding &amp; Selling:</span>
              <span className="font-semibold text-green-600">Active &amp; Authorized</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (currentUser.verificationStatus === 'pending' && !isReSubmitting) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="relative bg-white rounded-lg max-w-md w-full max-h-[85vh] flex flex-col p-6 shadow-md border border-gray-200 text-center overflow-y-auto">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg w-8 h-8 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="w-12 h-12 bg-gray-100 border border-gray-200 text-gray-700 rounded-lg flex items-center justify-center mx-auto mb-3">
            <Clock className="w-6 h-6" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 text-xs font-semibold uppercase tracking-wider mb-2 mx-auto">
            Verification Pending Review
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Review in Progress</h3>
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            Your PAN Card / National ID verification documents have been received and are currently being reviewed by our Compliance team.
          </p>

          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-left text-xs space-y-2 mb-5 text-gray-700">
            <div className="font-semibold text-gray-900 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-gray-500" />
              <span>Estimated review time: 15–30 Minutes</span>
            </div>
            {(currentUser.phoneNumber || existingRequest?.phoneNumber) && (
              <div className="text-xs text-gray-700 font-medium flex items-center justify-between py-1.5 border-t border-gray-200">
                <span className="text-gray-500">Verified Mobile:</span>
                <span className="tabular-nums font-semibold text-gray-900">
                  {currentUser.phoneNumber || existingRequest?.phoneNumber}{' '}
                  <span className="text-green-600">(OTP Verified)</span>
                </span>
              </div>
            )}
            <p className="text-gray-500 text-xs">
              Once approved, bidding, vehicle listing, and live auction access unlock automatically.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors text-sm"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => setIsReSubmitting(true)}
              className="text-xs text-gray-600 hover:text-gray-900 font-medium py-1.5"
            >
              Need to update details or upload a new photo?
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto flex items-start sm:items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-white rounded-lg max-w-lg w-full max-h-[90vh] sm:max-h-[85vh] flex flex-col shadow-md border border-gray-200 overflow-y-auto overscroll-contain my-auto">
        {/* Sticky Header */}
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white shrink-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors shrink-0 border border-gray-200 cursor-pointer"
              title="Go back and cancel verification"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-red-600 shrink-0" />
                <h2 className="text-sm font-semibold text-gray-900 truncate">
                  {getGateReasonTitle()}
                </h2>
              </div>
              <p className="text-xs text-gray-500 truncate">
                Official PAN &amp; National ID Verification
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel and close"
            className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-gray-900 flex items-center justify-center transition-colors shrink-0 ml-2 border border-gray-200 cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 sm:p-6 space-y-4 text-left text-sm flex-1">
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 leading-relaxed">
            {getGateReasonDescription()}
          </div>

          {isRestored && !successMsg && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between gap-2 text-xs text-gray-800">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-gray-600 shrink-0" />
                <div>
                  <p className="font-semibold leading-tight">Verification Draft Resumed</p>
                  <p className="text-gray-500">Auto-recovered so you don&apos;t have to restart.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDiscardVerificationDraft}
                className="text-xs font-medium text-gray-700 hover:text-red-600 bg-white border border-gray-200 px-2.5 py-1 rounded-lg transition-colors shrink-0 cursor-pointer"
              >
                Reset Form
              </button>
            </div>
          )}

          {existingRequest?.status === 'rejected' && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-left">
              <div className="flex items-center gap-1.5 text-red-700 font-semibold text-xs mb-1">
                <AlertTriangle className="w-4 h-4" />
                <span>Previous Submission Rejected</span>
              </div>
              <p className="text-xs text-red-700">
                {existingRequest.rejectionReason ||
                  'The uploaded document was unreadable or details did not match. Please upload clearer photos and verify your details.'}
              </p>
            </div>
          )}

          {/* 2-Step Indicator */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-lg border border-gray-200">
            <button
              type="button"
              onClick={() => {
                setActiveStep(1);
                setErrorMsg('');
              }}
              className={`p-2.5 rounded-lg border flex items-center gap-2.5 text-left transition-colors cursor-pointer ${
                activeStep === 1
                  ? 'bg-white border-gray-200 shadow-xs text-gray-900'
                  : isPhoneVerified
                  ? 'bg-green-50 border-green-200 text-green-900'
                  : 'bg-transparent border-transparent text-gray-600 hover:bg-white'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center font-semibold text-xs shrink-0 ${
                  isPhoneVerified
                    ? 'bg-green-600 text-white'
                    : activeStep === 1
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-200 text-gray-700'
                }`}
              >
                {isPhoneVerified ? <Check className="w-4 h-4" /> : '1'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold leading-tight truncate">1. Mobile OTP</p>
                <p
                  className={`text-[11px] truncate ${
                    isPhoneVerified ? 'text-green-700 font-medium' : 'text-gray-500'
                  }`}
                >
                  {isPhoneVerified ? 'Verified' : 'Required first'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isPhoneVerified) {
                  setErrorMsg('Please verify your mobile number via OTP in Step 1 first.');
                  return;
                }
                setActiveStep(2);
                setErrorMsg('');
              }}
              className={`p-2.5 rounded-lg border flex items-center gap-2.5 text-left transition-colors ${
                activeStep === 2
                  ? 'bg-white border-gray-200 shadow-xs text-gray-900'
                  : isPhoneVerified
                  ? 'bg-transparent border-transparent text-gray-700 hover:bg-white cursor-pointer'
                  : 'bg-transparent border-transparent opacity-60 cursor-not-allowed text-gray-400'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center font-semibold text-xs shrink-0 ${
                  activeStep === 2
                    ? 'bg-red-600 text-white'
                    : isPhoneVerified
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                2
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold leading-tight truncate">2. Documents</p>
                <p className="text-[11px] text-gray-500 truncate">
                  {isPhoneVerified ? 'PAN / National ID' : 'Finish Step 1'}
                </p>
              </div>
            </button>
          </div>

          {/* STEP 1: MOBILE OTP VERIFICATION */}
          {activeStep === 1 && (
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1">
                <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-red-600" />
                  <span>Step 1: Mobile Phone Number Verification</span>
                </div>
                <p className="text-gray-600 leading-relaxed">
                  Verify your mobile number first via SMS OTP. Identity documents will be uploaded in Step 2.
                </p>
              </div>

              {isPhoneVerified ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-left space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-green-600 text-white flex items-center justify-center">
                        <Check className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-green-900 text-sm">
                          Mobile Number Verified
                        </h4>
                        <p className="text-xs text-green-700 tabular-nums font-medium">{phone}</p>
                      </div>
                    </div>
                    <span className="text-[11px] uppercase font-semibold bg-white text-green-700 px-2.5 py-0.5 rounded-lg border border-green-200">
                      OTP Verified
                    </span>
                  </div>
                  <p className="text-xs text-green-800 leading-relaxed">
                    Your mobile number is authenticated and linked to your account. Proceed to Step 2 to upload your PAN Card or National ID.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveStep(2);
                        setErrorMsg('');
                      }}
                      className="w-full sm:flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>Proceed to Step 2: Upload Documents</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPhoneVerified(false);
                        setOtpSent(false);
                        setOtpCode('');
                      }}
                      className="text-xs text-gray-600 hover:text-gray-900 underline px-2 py-1 font-medium cursor-pointer"
                    >
                      Change Number
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                  <div id="recaptcha-container" />
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">
                      Mobile Number *
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="px-3 py-2.5 bg-white border border-gray-200 rounded-lg tabular-nums font-semibold text-xs sm:text-sm text-gray-700 shrink-0 select-none">
                        IN +91
                      </div>
                      <input
                        type="tel"
                        maxLength={10}
                        value={phone.replace(/^\+91\s*/, '')}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setPhone(val);
                          setOtpSent(false);
                        }}
                        placeholder="10-digit mobile number"
                        className="flex-1 px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 tabular-nums font-medium text-sm text-gray-900"
                      />
                      {!otpSent && (
                        <button
                          type="button"
                          onClick={handleSendOtp}
                          disabled={isSendingOtp}
                          className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold rounded-lg text-xs transition-colors shrink-0 cursor-pointer"
                        >
                          {isSendingOtp ? 'Sending...' : 'Send OTP'}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">
                      We will send a 6-digit OTP verification code via SMS to this number.
                    </p>
                  </div>

                  {otpSent && (
                    <div className="space-y-3 pt-3 border-t border-gray-200">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-medium text-gray-700">
                            Enter 6-Digit OTP Code *
                          </label>
                          {otpCountdown > 0 ? (
                            <span className="text-xs text-gray-500 tabular-nums">
                              Resend code in {otpCountdown}s
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={handleSendOtp}
                              className="text-xs text-red-600 hover:text-red-700 font-semibold underline cursor-pointer"
                            >
                              Resend OTP
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) =>
                            setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                          }
                          placeholder="000000"
                          className="w-full text-center tracking-[0.35em] text-lg tabular-nums font-semibold px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-gray-900"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleVerifyOtp}
                        disabled={isVerifyingOtp || otpCode.length < 6}
                        className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isVerifyingOtp ? (
                          <span>Verifying Code...</span>
                        ) : (
                          <>
                            <span>Verify Mobile OTP &amp; Continue</span>
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {successMsg && (
                    <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 font-medium flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{successMsg}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: ID DOCUMENT UPLOAD */}
          {activeStep === 2 && (
            <div className="space-y-4">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-green-900 font-medium">
                    Verified Mobile: <strong className="tabular-nums">{phone}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveStep(1)}
                  className="text-xs text-green-800 hover:text-green-950 font-semibold underline cursor-pointer"
                >
                  Edit Number
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Choose Document to Authenticate
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 rounded-lg border border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      setDocType('pan_card');
                      setErrorMsg('');
                    }}
                    className={`py-2 px-2 rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5 ${
                      docType === 'pan_card'
                        ? 'bg-white text-red-600 shadow-xs border border-gray-200'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>PAN Card</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDocType('national_id');
                      setErrorMsg('');
                    }}
                    className={`py-2 px-2 rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5 ${
                      docType === 'national_id'
                        ? 'bg-white text-red-600 shadow-xs border border-gray-200'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <IdCard className="w-3.5 h-3.5" />
                    <span>National ID</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDocType('both');
                      setErrorMsg('');
                    }}
                    className={`py-2 px-2 rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5 ${
                      docType === 'both'
                        ? 'bg-white text-red-600 shadow-xs border border-gray-200'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Both</span>
                  </button>
                </div>
              </div>

              <form id="identity-verification-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Full Legal Name (as on ID) *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white text-sm text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Date of Birth (Optional)
                  </label>
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white text-sm text-gray-900"
                  />
                </div>

                {(docType === 'pan_card' || docType === 'both') && (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                        <CreditCard className="w-4 h-4 text-gray-700" />
                        <span>PAN Card Authentication</span>
                      </span>
                      <span className="text-[11px] uppercase font-medium bg-white text-gray-700 border border-gray-200 px-2 py-0.5 rounded-lg">
                        10-Digit Alphanumeric
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        PAN Number *
                      </label>
                      <input
                        type="text"
                        maxLength={10}
                        required={docType === 'pan_card' || docType === 'both'}
                        value={panNumber}
                        onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                        placeholder="e.g. ABCDE1234F"
                        className="w-full px-3.5 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 tabular-nums font-semibold tracking-wider text-sm text-gray-900"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Format: 5 letters, 4 numbers, 1 letter (e.g. ABCDE1234F).
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Upload PAN Card Photo / Scan *
                      </label>
                      {panImage ? (
                        <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-white p-2">
                          <img
                            src={panImage}
                            alt="PAN preview"
                            className="w-full h-28 object-contain rounded-lg bg-gray-50"
                          />
                          <button
                            type="button"
                            onClick={() => setPanImage(null)}
                            className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white rounded-lg p-1 transition-colors"
                            title="Remove photo"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <div className="mt-1.5 text-center text-xs font-medium text-green-600 flex items-center justify-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>PAN Card image loaded</span>
                          </div>
                        </div>
                      ) : (
                        <label className="border border-dashed border-gray-300 hover:border-red-500 bg-white rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer transition-colors">
                          <Camera className="w-5 h-5 text-gray-500 mb-1" />
                          <span className="text-xs font-semibold text-gray-700">
                            Click to Upload PAN Card
                          </span>
                          <span className="text-xs text-gray-400">
                            JPG, PNG, WebP (Clear &amp; readable)
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFileChange(e, setPanImage)}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {(docType === 'national_id' || docType === 'both') && (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                    <div className="flex items-center gap-1.5">
                      <IdCard className="w-4 h-4 text-gray-700" />
                      <span className="text-xs font-semibold text-gray-900">
                        National ID Authentication
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          ID Document Type *
                        </label>
                        <select
                          value={nationalIdType}
                          onChange={(e: any) => setNationalIdType(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-xs text-gray-900"
                        >
                          <option value="Aadhaar Card">Aadhaar Card (UIDAI)</option>
                          <option value="Voter ID">Voter ID / EPIC</option>
                          <option value="Passport">Passport</option>
                          <option value="Government ID">Government Official ID</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          {nationalIdType} Number *
                        </label>
                        <input
                          type="text"
                          required={docType === 'national_id' || docType === 'both'}
                          value={nationalIdNumber}
                          onChange={(e) => setNationalIdNumber(e.target.value)}
                          placeholder="e.g. 1234 5678 9012"
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 tabular-nums font-medium text-xs text-gray-900"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Front Photo *
                        </label>
                        {nationalIdFront ? (
                          <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-white p-1.5">
                            <img
                              src={nationalIdFront}
                              alt="ID Front"
                              className="w-full h-20 object-contain rounded-lg bg-gray-50"
                            />
                            <button
                              type="button"
                              onClick={() => setNationalIdFront(null)}
                              className="absolute top-1.5 right-1.5 bg-red-600 text-white rounded-lg p-1"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <label className="border border-dashed border-gray-300 hover:border-red-500 bg-white rounded-lg p-3 flex flex-col items-center justify-center cursor-pointer transition-colors text-center">
                            <FileText className="w-5 h-5 text-gray-500 mb-1" />
                            <span className="text-xs font-semibold text-gray-700">Upload Front</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleFileChange(e, setNationalIdFront)}
                            />
                          </label>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Back Photo (Optional)
                        </label>
                        {nationalIdBack ? (
                          <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-white p-1.5">
                            <img
                              src={nationalIdBack}
                              alt="ID Back"
                              className="w-full h-20 object-contain rounded-lg bg-gray-50"
                            />
                            <button
                              type="button"
                              onClick={() => setNationalIdBack(null)}
                              className="absolute top-1.5 right-1.5 bg-red-600 text-white rounded-lg p-1"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <label className="border border-dashed border-gray-300 hover:border-red-500 bg-white rounded-lg p-3 flex flex-col items-center justify-center cursor-pointer transition-colors text-center">
                            <FileText className="w-5 h-5 text-gray-500 mb-1" />
                            <span className="text-xs font-semibold text-gray-700">Upload Back</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleFileChange(e, setNationalIdBack)}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {errorMsg && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {successMsg && (
                  <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 leading-normal border border-gray-200 flex items-start gap-2">
                  <Lock className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
                  <span>
                    Encrypted identity verification. Reviewed securely by AutoBid Compliance. Never shared with third parties.
                  </span>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 shrink-0 flex items-center gap-3 px-4 py-3 border-t border-gray-200 bg-white z-30 mt-auto">
          {activeStep === 1 ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200 font-medium rounded-lg transition-colors text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Cancel</span>
              </button>
              {isPhoneVerified ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveStep(2);
                    setErrorMsg('');
                  }}
                  className="flex-[1.6] py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Proceed to Step 2</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : otpSent ? (
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={isVerifyingOtp || otpCode.length < 6}
                  className="flex-[1.6] py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>{isVerifyingOtp ? 'Verifying OTP...' : 'Verify OTP & Continue'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={isSendingOtp}
                  className="flex-[1.6] py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>{isSendingOtp ? 'Sending OTP...' : 'Send OTP to Mobile'}</span>
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setActiveStep(1);
                  setErrorMsg('');
                }}
                className="flex-1 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200 font-medium rounded-lg transition-colors text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Step 1</span>
              </button>
              <button
                type="submit"
                form="identity-verification-form"
                disabled={isSubmitting || aiScanning}
                className="flex-[1.6] py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {aiScanning ? (
                  <span>AI Scanning...</span>
                ) : isSubmitting ? (
                  <span>Submitting...</span>
                ) : (
                  <>
                    <span>Submit Verification</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
