import React, { useState, useRef, useEffect } from 'react';
import {
  Hammer,
  Tag,
  Camera,
  MapPin,
  RefreshCw,
  Trash2,
  Save,
  FileText,
  AlertTriangle,
  CheckCircle2,
  X,
  Clock,
  Info,
  Package,
  Radio,
  Calendar,
  Flag,
  Check,
  Copy,
  Loader2,
  ArrowLeft,
  ArrowRight
} from 'lucide-react';
import { analyzeVehicleImage } from '../services/geminiService';
import { Vehicle, DamageType, VehicleStatus, User } from '../types';
import { CAR_BRANDS, COMMON_CAR_MODELS } from '../constants';
import { IdentityVerificationModal } from './IdentityVerificationModal';
import { compressImage } from '../utils/imageCompression';
import { generateStockNumber } from '../utils/stockHelper';
import { saveWorkflowDraft, getWorkflowDraft, clearWorkflowDraft } from '../utils/cookieManager';

interface SellCarProps {
  onNavigate: (page: string) => void;
  onListVehicle?: (vehicle: Vehicle) => Promise<boolean | void> | void;
  currentUser?: User;
}

interface UploadedImage {
  url: string;
  base64: string;
  mime: string;
}

export const SellCar: React.FC<SellCarProps> = ({ onNavigate, onListVehicle, currentUser }) => {
  const [assignedStockNumber, setAssignedStockNumber] = useState<string>(() => generateStockNumber());
  const [step, setStep] = useState<number>(1);
  const [sellingMode, setSellingMode] = useState<'auction' | 'direct'>('auction');
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copiedStockSuccess, setCopiedStockSuccess] = useState(false);

  // Cookie auto-recovery & exit dialog state
  const [isRestored, setIsRestored] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Uploaded images
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [coverIndex, setCoverIndex] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Registration Card (RC Card) upload
  const [rcCardImage, setRcCardImage] = useState<UploadedImage | null>(null);
  const [isCompressingRc, setIsCompressingRc] = useState(false);
  const rcFileInputRef = useRef<HTMLInputElement>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Postal Code Lookup
  const [isLoadingPostal, setIsLoadingPostal] = useState(false);
  const [postalError, setPostalError] = useState<string | null>(null);
  const [availableTowns, setAvailableTowns] = useState<string[]>([]);

  const todayStr = new Date().toISOString().split('T')[0];
  const defaultEndTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const defaultEndDateStr = defaultEndTime.toISOString().split('T')[0];

  // 12-Hour AM/PM Time State for Manual Auction Scheduling
  const [startHour, setStartHour] = useState('12');
  const [startMinute, setStartMinute] = useState('00');
  const [startPeriod, setStartPeriod] = useState<'AM' | 'PM'>('PM');

  const [endHour, setEndHour] = useState('12');
  const [endMinute, setEndMinute] = useState('30');
  const [endPeriod, setEndPeriod] = useState<'AM' | 'PM'>('PM');

  const convertTo24Hour = (hour12Str: string, minuteStr: string, period: 'AM' | 'PM'): string => {
    let hour = parseInt(hour12Str, 10);
    if (isNaN(hour)) hour = 12;
    if (period === 'AM') {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hour)}:${minuteStr.padStart(2, '0')}`;
  };

  const [formData, setFormData] = useState({
    year: '',
    make: '',
    model: '',
    vin: '',
    odometer: '',
    transmission: 'Automatic',
    fuelType: 'Petrol',
    engine: '',
    vehicleNumber: '',
    zipCode: '',
    city: '',
    district: '',
    state: '',
    streetAddress: '',
    price: '',
    directBuyPrice: '',
    allowDirectBuy: 'no',
    scheduleType: 'auto',
    auctionDate: todayStr,
    auctionStartTime: '12:00',
    auctionEndDate: defaultEndDateStr,
    auctionEndTime: '12:30',
    liveBidDuration: '0',
    hasRegistrationCard: 'yes',
    rcCardNumber: '',
    hasFine: 'no',
    isFirstOwner: 'yes',
    isUnderInsurance: 'yes',
    hasIssues: 'no',
    issueDescription: '',
    description: '',
    boostOption: 'none',
  });

  // 1. Auto-Restore from Cookies / Storage on initial mount
  useEffect(() => {
    const draft = getWorkflowDraft<any>('sell_car');
    if (draft && draft.step && draft.step < 7 && draft.data) {
      if (draft.step) setStep(draft.step);
      if (draft.data.sellingMode) setSellingMode(draft.data.sellingMode);
      if (draft.data.assignedStockNumber) setAssignedStockNumber(draft.data.assignedStockNumber);
      if (draft.data.formData) setFormData(prev => ({ ...prev, ...draft.data.formData }));
      if (draft.data.images && Array.isArray(draft.data.images) && draft.data.images.length > 0) {
        setImages(draft.data.images);
      }
      if (typeof draft.data.coverIndex === 'number') setCoverIndex(draft.data.coverIndex);
      if (draft.data.rcCardImage) setRcCardImage(draft.data.rcCardImage);
      if (draft.data.startHour) setStartHour(draft.data.startHour);
      if (draft.data.startMinute) setStartMinute(draft.data.startMinute);
      if (draft.data.startPeriod) setStartPeriod(draft.data.startPeriod);
      if (draft.data.endHour) setEndHour(draft.data.endHour);
      if (draft.data.endMinute) setEndMinute(draft.data.endMinute);
      if (draft.data.endPeriod) setEndPeriod(draft.data.endPeriod);
      setIsRestored(true);
    }
  }, []);

  // 2. Continuous Auto-Save to Cookies & Storage whenever state advances or values change
  useEffect(() => {
    if (step >= 7) return;
    const hasData = step > 1 || images.length > 0 || Boolean(formData.make || formData.price || formData.vin || formData.vehicleNumber);
    if (!hasData) return;

    saveWorkflowDraft('sell_car', step, {
      sellingMode,
      assignedStockNumber,
      formData,
      images,
      coverIndex,
      rcCardImage,
      startHour,
      startMinute,
      startPeriod,
      endHour,
      endMinute,
      endPeriod
    });
  }, [step, sellingMode, assignedStockNumber, formData, images, coverIndex, rcCardImage, startHour, startMinute, startPeriod, endHour, endMinute, endPeriod]);

  const handleDiscardAndStartOver = () => {
    clearWorkflowDraft('sell_car');
    setIsRestored(false);
    setShowExitConfirm(false);
    setStep(1);
    setImages([]);
    setRcCardImage(null);
    setAssignedStockNumber(generateStockNumber());
    setFormData({
      year: '',
      make: '',
      model: '',
      vin: '',
      odometer: '',
      transmission: 'Automatic',
      fuelType: 'Petrol',
      engine: '',
      vehicleNumber: '',
      zipCode: '',
      city: '',
      district: '',
      state: '',
      streetAddress: '',
      price: '',
      directBuyPrice: '',
      allowDirectBuy: 'no',
      scheduleType: 'auto',
      auctionDate: todayStr,
      auctionStartTime: '12:00',
      auctionEndDate: defaultEndDateStr,
      auctionEndTime: '12:30',
      liveBidDuration: '0',
      hasRegistrationCard: 'yes',
      rcCardNumber: '',
      hasFine: 'no',
      isFirstOwner: 'yes',
      isUnderInsurance: 'yes',
      hasIssues: 'no',
      issueDescription: '',
      description: '',
      boostOption: 'none',
    });
  };

  const handleCancelClick = () => {
    const hasProgress = step > 1 || images.length > 0 || Boolean(formData.make || formData.price);
    if (hasProgress && step < 7) {
      setShowExitConfirm(true);
    } else {
      onNavigate('home');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = async (files: File[]) => {
    setValidationError(null);
    setIsCompressing(true);
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          setValidationError('Please upload image files only.');
          continue;
        }
        const compressed = await compressImage(file, 1024, 768, 0.70);
        setImages(prev => {
          const updated = [...prev, compressed];
          if (updated.length === 1) {
            analyzeFirstImage(compressed.base64, compressed.mime);
          }
          return updated;
        });
      }
    } catch (err: any) {
      console.error('Error compressing image:', err);
      setValidationError('Failed to process image. Please try another image.');
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRcFile = async (file: File) => {
    setValidationError(null);
    if (!file.type.startsWith('image/')) {
      setValidationError('Please upload an image file (PNG, JPG, WebP) for your Registration Certificate (RC).');
      return;
    }
    setIsCompressingRc(true);
    try {
      const compressed = await compressImage(file, 1024, 768, 0.70);
      setRcCardImage(compressed);
    } catch (err: any) {
      console.error('Error compressing RC card:', err);
      setValidationError('Failed to process RC card. Please try another photo.');
    } finally {
      setIsCompressingRc(false);
    }
  };

  const analyzeFirstImage = async (base64: string, mime: string) => {
    setIsValidating(true);
    try {
      const res = await analyzeVehicleImage(base64, mime);
      if (res.isVehicle) {
        setFormData(prev => ({
          ...prev,
          make: res.make || prev.make,
          model: res.model || prev.model,
          year: res.year || prev.year,
          engine: res.engine || prev.engine,
          fuelType: res.fuelType || prev.fuelType,
        }));
      }
    } catch {
      // Ignore AI auto-fill error
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    if (coverIndex === index) {
      setCoverIndex(0);
    } else if (coverIndex > index) {
      setCoverIndex(coverIndex - 1);
    }
  };

  useEffect(() => {
    if (formData.make) {
      setIsLoadingModels(true);
      const brandKey = Object.keys(COMMON_CAR_MODELS).find(
        k => k.toLowerCase() === formData.make.toLowerCase()
      );
      if (brandKey && COMMON_CAR_MODELS[brandKey]) {
        setAvailableModels(COMMON_CAR_MODELS[brandKey]);
      } else {
        setAvailableModels([]);
      }
      setIsLoadingModels(false);
    } else {
      setAvailableModels([]);
    }
  }, [formData.make]);

  const handleZipCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const code = e.target.value.replace(/\D/g, '');
    setFormData(prev => ({ ...prev, zipCode: code }));
    setPostalError(null);

    if (code.length === 6) {
      setIsLoadingPostal(true);
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${code}`);
        const data = await res.json();
        if (data && data[0] && data[0].Status === 'Success' && data[0].PostOffice?.length > 0) {
          const po = data[0].PostOffice[0];
          const towns = Array.from(new Set(data[0].PostOffice.map((p: any) => p.Name))) as string[];
          setAvailableTowns(towns);
          setFormData(prev => ({
            ...prev,
            district: po.District || '',
            state: po.State || '',
            city: po.Name || po.District || '',
          }));
        } else {
          setPostalError('PIN code not found.');
        }
      } catch {
        setPostalError('Failed to fetch PIN code data.');
      } finally {
        setIsLoadingPostal(false);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleNextStep = () => {
    setValidationError(null);

    if (step === 1) {
      setStep(2);
      return;
    }

    if (step === 2) {
      if (images.length === 0) {
        setValidationError('Please upload at least one image of your vehicle.');
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      if (!formData.make || !formData.model || !formData.year || !formData.odometer) {
        setValidationError('Please fill in the required vehicle details (Make, Model, Year, Mileage).');
        return;
      }
      setStep(4);
      return;
    }

    if (step === 4) {
      const priceVal = parseInt(formData.price);
      if (!priceVal || priceVal <= 0) {
        setValidationError(sellingMode === 'auction' ? 'Please enter a valid starting bid.' : 'Please enter a valid selling price.');
        return;
      }

      if (sellingMode === 'auction') {
        if (formData.scheduleType === 'manual') {
          const startTime24 = convertTo24Hour(startHour, startMinute, startPeriod);
          const endTime24 = convertTo24Hour(endHour, endMinute, endPeriod);
          const start = new Date(`${formData.auctionDate}T${startTime24}`);
          const end = new Date(`${formData.auctionEndDate}T${endTime24}`);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            setValidationError('Please enter valid auction start and end dates and times.');
            return;
          }
          if (end <= start) {
            setValidationError(`Auction end time (${endHour}:${endMinute} ${endPeriod}) must be after the start time (${startHour}:${startMinute} ${startPeriod}).`);
            return;
          }
          if (end.getTime() <= Date.now()) {
            setValidationError('Auction end date & time must be in the future.');
            return;
          }
          const totalAuctionMs = end.getTime() - start.getTime();
          const maxAuctionMs = 14 * 24 * 60 * 60 * 1000;
          if (totalAuctionMs > maxAuctionMs) {
            setValidationError('Auction duration cannot exceed 14 days.');
            return;
          }
        }
      }

      setStep(5);
      return;
    }

    if (step === 5) {
      setStep(6);
      return;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (currentUser && !currentUser.isVerified && currentUser.role !== 'admin') {
      setShowVerificationModal(true);
      return;
    }

    const now = Date.now();
    let startTimeValue: number;
    let endTimeValue: number;
    let initialStatus: VehicleStatus;
    let expiresAt: number;

    if (sellingMode === 'direct') {
      startTimeValue = now;
      endTimeValue = now + 90 * 24 * 60 * 60 * 1000;
      expiresAt = endTimeValue;
      initialStatus = VehicleStatus.DIRECT_SALE;
    } else {
      if (formData.scheduleType === 'manual') {
        const startTime24 = convertTo24Hour(startHour, startMinute, startPeriod);
        const endTime24 = convertTo24Hour(endHour, endMinute, endPeriod);
        const start = new Date(`${formData.auctionDate}T${startTime24}`);
        const end = new Date(`${formData.auctionEndDate}T${endTime24}`);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          setValidationError('Please enter valid auction start and end dates and times.');
          return;
        }
        if (end <= start) {
          setValidationError(`Auction end time (${endHour}:${endMinute} ${endPeriod}) must be after start time (${startHour}:${startMinute} ${startPeriod}).`);
          return;
        }
        if (end.getTime() <= now) {
          setValidationError('Auction end time must be in the future.');
          return;
        }
        const totalAuctionMs = end.getTime() - start.getTime();
        const maxAuctionMs = 14 * 24 * 60 * 60 * 1000;
        if (totalAuctionMs > maxAuctionMs) {
          setValidationError('Auction period cannot be more than 14 days.');
          return;
        }
        startTimeValue = start.getTime();
        endTimeValue = end.getTime();
        expiresAt = endTimeValue;

        if (startTimeValue > now + 60000) {
          initialStatus = VehicleStatus.UPCOMING;
        } else {
          initialStatus = VehicleStatus.LIVE;
          startTimeValue = Math.min(startTimeValue, now);
        }
      } else {
        startTimeValue = now;
        endTimeValue = now + 7 * 24 * 60 * 60 * 1000;
        expiresAt = endTimeValue;
        initialStatus = VehicleStatus.LIVE;
      }
    }

    const parsedPrice = parseInt(formData.price) || 1000;
    const vehicleId = Date.now().toString();

    const newVehicle: Vehicle = {
      id: vehicleId,
      stockNumber: assignedStockNumber,
      year: parseInt(formData.year) || new Date().getFullYear(),
      make: formData.make || 'Unknown Make',
      model: formData.model || 'Unknown Model',
      vin: formData.vin || 'N/A',
      odometer: parseInt(formData.odometer) || 0,
      primaryDamage: DamageType.NORMAL,
      secondaryDamage: formData.hasFine === 'yes' ? 'Has Fines' : undefined,
      estRetailValue: Math.round(parsedPrice * 1.2),
      currentBid: parsedPrice,
      startingPrice: parsedPrice,
      directPrice: sellingMode === 'direct' ? parsedPrice : undefined,
      buyNowPrice: sellingMode === 'auction' && formData.allowDirectBuy === 'yes'
        ? parseInt(formData.directBuyPrice) || Math.round(parsedPrice * 1.5)
        : undefined,
      location: formData.district && formData.city && formData.district !== formData.city
        ? `${formData.city}, ${formData.district}, ${formData.state}`
        : `${formData.city || formData.district || 'India'}, ${formData.state}`,
      imageSeed: Math.floor(Math.random() * 500),
      images: (() => {
        const arr = images.map(img => img.url);
        if (coverIndex > 0 && coverIndex < arr.length) {
          const [cov] = arr.splice(coverIndex, 1);
          arr.unshift(cov);
        }
        return arr.length > 0 ? arr : [`https://picsum.photos/seed/${vehicleId}/1200/800`];
      })(),
      coverImageIndex: 0,
      status: initialStatus,
      hasStartedLive: initialStatus !== VehicleStatus.UPCOMING,
      listingType: sellingMode,
      startTime: startTimeValue,
      endTime: endTimeValue,
      listedAt: now,
      expiresAt: expiresAt,
      isBlacklisted: false,
      isConcluded: false,
      liveBidDuration: 0,
      watchCount: 0,
      views: 0,
      interestedCount: 0,
      hasKeys: true,
      engine: formData.engine || 'N/A',
      transmission: formData.transmission || 'Automatic',
      drive: 'FWD',
      fuelType: formData.fuelType,
      description: formData.description,
      isOwner: true,
      ownerId: currentUser?.id,
      ownerUsername: currentUser?.username,
      ownerName: currentUser?.fullName || currentUser?.username,
      listingFee: 0,
      boostOption: 'none',
      isUnderInsurance: formData.isUnderInsurance === 'yes',
      hasRegistrationCard: formData.hasRegistrationCard === 'yes',
      rcCardUrl: formData.hasRegistrationCard === 'yes' && rcCardImage ? rcCardImage.url : undefined,
      rcCardNumber: formData.rcCardNumber ? formData.rcCardNumber.toUpperCase().trim() : undefined,
      hasIssues: formData.hasIssues === 'yes',
      issueDescription: formData.hasIssues === 'yes' ? formData.issueDescription : '',
      vehicleNumber: formData.vehicleNumber,
      upcomingBids: [],
      liveParticipants: [],
    };

    if (onListVehicle) {
      setIsSubmitting(true);
      try {
        await onListVehicle(newVehicle);
        clearWorkflowDraft('sell_car');
        setIsRestored(false);
        setStep(7);
      } catch (err: any) {
        console.error("Vehicle listing error:", err);
        setValidationError(err?.message || "Failed to publish listing. Please check your connection and try again.");
      } finally {
        setIsSubmitting(false);
      }
    } else {
      clearWorkflowDraft('sell_car');
      setIsRestored(false);
      setStep(7);
    }
  };

  const stepTitles = sellingMode === 'auction'
    ? ['Method', 'Images', 'Vehicle Details', 'Auction Pricing', 'Condition & Info', 'Review & Confirm']
    : ['Method', 'Images', 'Vehicle Details', 'Fixed Price', 'Condition & Info', 'Review & Confirm'];

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      {showVerificationModal && (
        <IdentityVerificationModal
          isOpen={showVerificationModal}
          onClose={() => setShowVerificationModal(false)}
          currentUser={currentUser}
        />
      )}

      {/* Exit & Draft Preservation Confirmation Modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-6 shadow-lg border border-gray-200">
            <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center mb-3">
              <Save className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-1">
              Leave Listing Process?
            </h3>
            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              Your inputs and photos are auto-saved locally. You can resume from <strong>Step {step}</strong> anytime.
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirm(false);
                  onNavigate('home');
                }}
                className="w-full py-2.5 px-3 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>Save Draft & Exit</span>
              </button>
              <button
                type="button"
                onClick={handleDiscardAndStartOver}
                className="w-full py-2.5 px-3 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>Discard Draft & Start Fresh</span>
              </button>
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="w-full py-2 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Continue Editing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900 tracking-tight">
            {step === 7 ? 'Listing Published' : 'Sell Your Vehicle'}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {step === 7 ? 'Your vehicle is now listed on AutoBid' : 'List your vehicle for auction or direct fixed-price sale'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCancelClick}
          className="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          <span>Cancel</span>
        </button>
      </div>

      {/* Restored Draft Alert Banner */}
      {isRestored && step < 7 && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between gap-2 text-xs text-gray-800">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-gray-600 shrink-0" />
            <div>
              <p className="font-semibold leading-tight">Draft Restored</p>
              <p className="text-[11px] text-gray-500">Resumed from Step {step} of 6 with your saved data.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDiscardAndStartOver}
            className="text-xs font-semibold text-gray-700 hover:text-red-600 bg-white border border-gray-200 px-2.5 py-1 rounded-lg transition shrink-0 cursor-pointer"
          >
            Start Over
          </button>
        </div>
      )}

      {/* Progress Bar */}
      {step < 7 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 mb-1.5">
            <span>Step {step} of 6: <strong className="text-gray-900">{stepTitles[step - 1]}</strong></span>
            <span className="tabular-nums">{Math.round((step / 6) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-red-600 h-full transition-all duration-300"
              style={{ width: `${(step / 6) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Validation Error Banner */}
      {validationError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-lg flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{validationError}</span>
          </div>
          <button
            type="button"
            onClick={() => setValidationError(null)}
            className="text-red-800 hover:text-red-950 cursor-pointer shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Card Body */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-xs p-4 sm:p-6">
        {/* STEP 1: Choose Selling Method */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">Choose How to Sell</h2>
              <p className="text-xs text-gray-500 mt-0.5">Select the selling option that fits your vehicle</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: Sell by Auction */}
              <div
                onClick={() => setSellingMode('auction')}
                className={`p-4 rounded-lg border cursor-pointer transition ${
                  sellingMode === 'auction'
                    ? 'border-red-600 bg-red-50/40 ring-1 ring-red-600'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center">
                    <Hammer className="w-4 h-4" />
                  </div>
                  {sellingMode === 'auction' && (
                    <span className="bg-red-600 text-white text-[11px] font-semibold px-2 py-0.5 rounded-lg">
                      Selected
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1">Sell by Auction</h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  List for live competitive bidding. Choose immediate live start or schedule upcoming date.
                </p>
                <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-1.5 text-xs text-gray-500">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span>Up to 14 Days Max</span>
                </div>
              </div>

              {/* Option 2: Sell Without Auction */}
              <div
                onClick={() => setSellingMode('direct')}
                className={`p-4 rounded-lg border cursor-pointer transition ${
                  sellingMode === 'direct'
                    ? 'border-red-600 bg-red-50/40 ring-1 ring-red-600'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center">
                    <Tag className="w-4 h-4" />
                  </div>
                  {sellingMode === 'direct' && (
                    <span className="bg-red-600 text-white text-[11px] font-semibold px-2 py-0.5 rounded-lg">
                      Selected
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1">Direct Fixed Sale</h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Set a fixed asking price in Direct Sales without countdown pressure.
                </p>
                <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-1.5 text-xs text-gray-500">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <span>Active for 90 Days</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={handleNextStep}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue with {sellingMode === 'auction' ? 'Auction' : 'Direct Sale'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Upload Images */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Upload Vehicle Images</h2>
              <span className="text-xs text-gray-500 font-medium tabular-nums">{images.length} uploaded</span>
            </div>

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
                isDragging ? 'border-red-600 bg-red-50/40' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInput}
                multiple
                accept="image/*"
                className="hidden"
              />
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-white border border-gray-200 text-gray-700 flex items-center justify-center">
                <Camera className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-gray-900">Click to upload photos or drag and drop</p>
              <p className="text-xs text-gray-500 mt-0.5">PNG, JPG, WebP supported</p>
              {isCompressing && (
                <div className="mt-2 text-xs font-medium text-gray-700 flex items-center justify-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Optimizing photo size...</span>
                </div>
              )}
              {isValidating && (
                <div className="mt-2 text-xs font-medium text-gray-700 flex items-center justify-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Analyzing vehicle photo...</span>
                </div>
              )}
            </div>

            {images.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {images.map((img, i) => (
                  <div key={i} className="relative group aspect-[4/3] rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                    <img src={img.url} alt={`upload-${i}`} className="w-full h-full object-cover object-center" />
                    {coverIndex === i && (
                      <span className="absolute top-1 left-1 bg-red-600 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                        Cover
                      </span>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1.5">
                      {coverIndex !== i && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setCoverIndex(i); }}
                          title="Set as Cover"
                          className="bg-white hover:bg-gray-100 text-gray-900 text-[10px] font-semibold px-2 py-1 rounded cursor-pointer"
                        >
                          Cover
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleRemoveImage(i); }}
                        title="Remove"
                        className="bg-red-600 hover:bg-red-700 text-white p-1 rounded cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-4 border-t border-gray-100 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 py-2 inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={handleNextStep}
                disabled={images.length === 0}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Next: Vehicle Specs</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Vehicle Specs */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-gray-900">Vehicle Specifications</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Make *</label>
                <input
                  type="text"
                  name="make"
                  list="make-list"
                  value={formData.make}
                  onChange={handleInputChange}
                  placeholder="e.g. Toyota"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none focus:border-red-600"
                />
                <datalist id="make-list">
                  {CAR_BRANDS.map(b => <option key={b} value={b} />)}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Model *</label>
                <input
                  type="text"
                  name="model"
                  list="model-list"
                  value={formData.model}
                  onChange={handleInputChange}
                  placeholder="e.g. Fortuner"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none focus:border-red-600"
                />
                <datalist id="model-list">
                  {availableModels.map(m => <option key={m} value={m} />)}
                </datalist>
                {isLoadingModels && <span className="text-[11px] text-gray-400">Loading models...</span>}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Year *</label>
                <input
                  type="number"
                  name="year"
                  value={formData.year}
                  onChange={handleInputChange}
                  placeholder="e.g. 2022"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none focus:border-red-600 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Mileage (km) *</label>
                <input
                  type="number"
                  name="odometer"
                  value={formData.odometer}
                  onChange={handleInputChange}
                  placeholder="e.g. 35000"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none focus:border-red-600 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Fuel Type</label>
                <select
                  name="fuelType"
                  value={formData.fuelType}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
                >
                  <option value="Petrol">Petrol</option>
                  <option value="Diesel">Diesel</option>
                  <option value="Electric">Electric</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="CNG">CNG</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Transmission</label>
                <select
                  name="transmission"
                  value={formData.transmission}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
                >
                  <option value="Automatic">Automatic</option>
                  <option value="Manual">Manual</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Registration No.</label>
                <input
                  type="text"
                  name="vehicleNumber"
                  value={formData.vehicleNumber}
                  onChange={handleInputChange}
                  placeholder="e.g. MH 12 AB 1234"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Engine Spec</label>
                <input
                  type="text"
                  name="engine"
                  value={formData.engine}
                  onChange={handleInputChange}
                  placeholder="e.g. 2.8L Turbo"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">PIN Code</label>
                <input
                  type="text"
                  name="zipCode"
                  value={formData.zipCode}
                  onChange={handleZipCodeChange}
                  placeholder="e.g. 400001"
                  maxLength={6}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none font-mono"
                />
                {isLoadingPostal && <span className="text-[11px] text-gray-400">Looking up PIN...</span>}
                {postalError && <span className="text-[11px] text-red-600">{postalError}</span>}
              </div>
            </div>

            {availableTowns.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Town / Locality</label>
                <select
                  name="city"
                  value={formData.city}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
                >
                  {availableTowns.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {(formData.city || formData.district || formData.state) && (
              <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200 text-xs text-gray-700 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-gray-500 shrink-0" />
                <span>Location: <strong>{formData.city || formData.district}, {formData.state}</strong></span>
              </div>
            )}

            <div className="pt-4 border-t border-gray-100 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 py-2 inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={handleNextStep}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Next: Pricing</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Pricing & Schedule */}
        {step === 4 && (
          <div className="space-y-4">
            {sellingMode === 'direct' ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-gray-700" />
                  <div>
                    <h2 className="text-base font-bold text-gray-900">Set Fixed Selling Price</h2>
                    <p className="text-xs text-gray-500">Enter the fixed asking price for your vehicle</p>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                  <label className="block text-xs font-semibold text-gray-900 mb-1.5">
                    Asking Price (₹) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-gray-500 font-semibold text-sm">₹</span>
                    <input
                      type="number"
                      name="price"
                      value={formData.price}
                      onChange={handleInputChange}
                      placeholder="e.g. 850000"
                      className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-bold text-gray-900 outline-none focus:border-red-600 tabular-nums"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    Buyers can contact you directly or buy at this fixed rate.
                  </p>
                </div>

                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-xs text-gray-600 space-y-1.5">
                  <div className="flex justify-between">
                    <span>Listing Category</span>
                    <strong className="text-gray-900">Direct Sale</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Listing Validity</span>
                    <strong className="text-gray-900">3 Months (90 Days)</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Expiration</span>
                    <span className="text-gray-500">Auto-archived after 90 days if unsold</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-base font-bold text-gray-900">Auction Pricing & Timing</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Starting Bid (₹) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500 font-semibold">₹</span>
                      <input
                        type="number"
                        name="price"
                        value={formData.price}
                        onChange={handleInputChange}
                        placeholder="e.g. 500000"
                        className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none font-bold tabular-nums focus:border-red-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Auction Timing Mode
                    </label>
                    <select
                      name="scheduleType"
                      value={formData.scheduleType}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none font-medium text-gray-900"
                    >
                      <option value="auto">Start Immediately (Live Auction)</option>
                      <option value="manual">Custom Date & Time (Live or Upcoming)</option>
                    </select>
                  </div>
                </div>

                {formData.scheduleType === 'auto' && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <Radio className="w-4 h-4 text-green-700" />
                      <span>Immediate Live Auction (100% Free)</span>
                    </div>
                    <p className="text-xs text-green-700">
                      Your vehicle goes straight into <strong>Live Auction</strong> for 7 days upon publishing.
                    </p>
                  </div>
                )}

                {formData.scheduleType === 'manual' && (
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-xs space-y-3">
                    <div className="text-xs text-gray-700 bg-white border border-gray-200 p-3 rounded-lg leading-relaxed space-y-1">
                      <div className="font-semibold flex items-center gap-1.5 text-gray-900">
                        <Clock className="w-3.5 h-3.5 text-gray-600" />
                        <span>Schedule Rules</span>
                      </div>
                      <p>
                        • <strong>Upcoming Auction:</strong> Future start times list as Upcoming; participants can join at <strong>₹{(parseInt(formData.price) || 0).toLocaleString()}</strong>.
                      </p>
                      <p>
                        • <strong>Immediate Live:</strong> Past or current start times begin as Live Auction right away.
                      </p>
                    </div>

                    {/* Start Date & 12-Hour AM/PM Time */}
                    <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                          <Radio className="w-3.5 h-3.5 text-green-600" />
                          <span>Auction Start</span>
                        </span>
                        <span className="text-xs font-medium text-gray-700 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg tabular-nums">
                          {formData.auctionDate} at {startHour}:{startMinute} {startPeriod}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-gray-500 mb-1">Start Date</label>
                          <input
                            type="date"
                            name="auctionDate"
                            min={todayStr}
                            value={formData.auctionDate}
                            onChange={handleInputChange}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none font-medium text-gray-900"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-gray-500 mb-1">
                            Start Time (12-Hour)
                          </label>
                          <div className="flex items-center gap-1.5">
                            <select
                              value={startHour}
                              onChange={(e) => setStartHour(e.target.value)}
                              className="px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs font-semibold outline-none flex-1 tabular-nums"
                            >
                              {['12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'].map(h => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                            <span className="font-bold text-gray-400">:</span>
                            <select
                              value={startMinute}
                              onChange={(e) => setStartMinute(e.target.value)}
                              className="px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs font-semibold outline-none flex-1 tabular-nums"
                            >
                              {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                            <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-gray-100 p-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setStartPeriod('AM')}
                                className={`px-2 py-1 text-[11px] font-semibold rounded transition cursor-pointer ${
                                  startPeriod === 'AM' ? 'bg-red-600 text-white' : 'text-gray-600 hover:text-gray-900'
                                }`}
                              >
                                AM
                              </button>
                              <button
                                type="button"
                                onClick={() => setStartPeriod('PM')}
                                className={`px-2 py-1 text-[11px] font-semibold rounded transition cursor-pointer ${
                                  startPeriod === 'PM' ? 'bg-red-600 text-white' : 'text-gray-600 hover:text-gray-900'
                                }`}
                              >
                                PM
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* End Date & 12-Hour AM/PM Time */}
                    <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                          <Flag className="w-3.5 h-3.5 text-gray-600" />
                          <span>Auction End (Max 14 Days)</span>
                        </span>
                        <span className="text-xs font-medium text-gray-700 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg tabular-nums">
                          {formData.auctionEndDate} at {endHour}:{endMinute} {endPeriod}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-gray-500 mb-1">End Date</label>
                          <input
                            type="date"
                            name="auctionEndDate"
                            min={formData.auctionDate || todayStr}
                            value={formData.auctionEndDate}
                            onChange={handleInputChange}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none font-medium text-gray-900"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-gray-500 mb-1">
                            End Time (12-Hour)
                          </label>
                          <div className="flex items-center gap-1.5">
                            <select
                              value={endHour}
                              onChange={(e) => setEndHour(e.target.value)}
                              className="px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs font-semibold outline-none flex-1 tabular-nums"
                            >
                              {['12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'].map(h => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                            <span className="font-bold text-gray-400">:</span>
                            <select
                              value={endMinute}
                              onChange={(e) => setEndMinute(e.target.value)}
                              className="px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs font-semibold outline-none flex-1 tabular-nums"
                            >
                              {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                            <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-gray-100 p-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setEndPeriod('AM')}
                                className={`px-2 py-1 text-[11px] font-semibold rounded transition cursor-pointer ${
                                  endPeriod === 'AM' ? 'bg-red-600 text-white' : 'text-gray-600 hover:text-gray-900'
                                }`}
                              >
                                AM
                              </button>
                              <button
                                type="button"
                                onClick={() => setEndPeriod('PM')}
                                className={`px-2 py-1 text-[11px] font-semibold rounded transition cursor-pointer ${
                                  endPeriod === 'PM' ? 'bg-red-600 text-white' : 'text-gray-600 hover:text-gray-900'
                                }`}
                              >
                                PM
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <Info className="w-3.5 h-3.5" />
                        <span>Maximum duration: 14 days</span>
                      </span>
                      <span className="font-semibold text-green-700 inline-flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>Free Live Auction</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-gray-100 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 py-2 inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={handleNextStep}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Next: Additional Info</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: Additional Info & Condition */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-gray-900">Additional Information</h2>

            {/* Registration Card (RC Card) Section */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-900 mb-1">
                  Do you have the Vehicle Registration Card (RC Card)? *
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Specify whether you possess the original or digital Registration Certificate (RC).
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition ${formData.hasRegistrationCard === 'yes' ? 'bg-white border-red-600 ring-1 ring-red-600' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                    <input
                      type="radio"
                      name="hasRegistrationCard"
                      value="yes"
                      checked={formData.hasRegistrationCard === 'yes'}
                      onChange={handleInputChange}
                      className="text-red-600 focus:ring-red-600"
                    />
                    <div className="leading-tight">
                      <span className="font-semibold text-gray-900 block">Yes, I have RC Card</span>
                      <span className="text-[11px] text-green-700 font-medium">Recommended</span>
                    </div>
                  </label>
                  <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition ${formData.hasRegistrationCard === 'no' ? 'bg-white border-red-600 ring-1 ring-red-600' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                    <input
                      type="radio"
                      name="hasRegistrationCard"
                      value="no"
                      checked={formData.hasRegistrationCard === 'no'}
                      onChange={handleInputChange}
                      className="text-red-600 focus:ring-red-600"
                    />
                    <div className="leading-tight">
                      <span className="font-semibold text-gray-900 block">No RC Card</span>
                      <span className="text-[11px] text-gray-500">Pending or Lost</span>
                    </div>
                  </label>
                </div>
              </div>

              {formData.hasRegistrationCard === 'yes' ? (
                <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-3">
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-gray-900">Upload Registration Certificate (RC Card)</h4>
                      <p className="text-xs text-gray-500 leading-relaxed mt-0.5">
                        Upload a clear photo or scan to build buyer trust.
                      </p>
                    </div>
                  </div>

                  <input
                    type="file"
                    ref={rcFileInputRef}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleRcFile(e.target.files[0]);
                      }
                    }}
                    accept="image/*"
                    className="hidden"
                  />

                  {rcCardImage ? (
                    <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={rcCardImage.url}
                          alt="RC Card Preview"
                          className="w-16 h-12 rounded object-cover border border-green-200 bg-white shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-green-800 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>RC Card Uploaded</span>
                          </span>
                          <p className="text-[11px] text-green-700 truncate">Document attached</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => rcFileInputRef.current?.click()}
                          className="text-xs font-medium text-gray-700 bg-white border border-gray-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-gray-50"
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          onClick={() => setRcCardImage(null)}
                          className="text-xs font-medium text-red-600 bg-white border border-gray-200 px-2.5 py-1 rounded-lg cursor-pointer hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => rcFileInputRef.current?.click()}
                      className="border-2 border-dashed border-gray-300 hover:border-gray-400 bg-gray-50 rounded-lg p-4 text-center cursor-pointer transition"
                    >
                      <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 flex items-center justify-center">
                        <Camera className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-semibold text-gray-900">Click to upload RC Card photo or scan</p>
                      <p className="text-xs text-gray-500 mt-0.5">JPEG, PNG, or WebP</p>
                      {isCompressingRc && (
                        <div className="mt-2 text-xs font-medium text-gray-700 flex items-center justify-center gap-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Optimizing document...</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Registration Certificate (RC) Number (Optional)
                    </label>
                    <input
                      type="text"
                      name="rcCardNumber"
                      value={formData.rcCardNumber}
                      onChange={handleInputChange}
                      placeholder="e.g. DL 01 AB 1234"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none uppercase font-mono"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <strong>Notice:</strong> Your vehicle will display an <strong>"RC Not Available"</strong> label.
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">First Owner?</label>
                <select
                  name="isFirstOwner"
                  value={formData.isFirstOwner}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Insurance Active?</label>
                <select
                  name="isUnderInsurance"
                  value={formData.isUnderInsurance}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
                >
                  <option value="yes">Yes (Insured)</option>
                  <option value="no">No (Expired)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Pending Fines?</label>
                <select
                  name="hasFine"
                  value={formData.hasFine}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
                >
                  <option value="no">No Fines</option>
                  <option value="yes">Has Fines</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Any Known Issues or Defects?</label>
              <div className="flex gap-4 text-xs mb-2">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="hasIssues"
                    value="no"
                    checked={formData.hasIssues === 'no'}
                    onChange={handleInputChange}
                  />
                  <span>None (Clean Condition)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="hasIssues"
                    value="yes"
                    checked={formData.hasIssues === 'yes'}
                    onChange={handleInputChange}
                  />
                  <span>Yes (Describe below)</span>
                </label>
              </div>
              {formData.hasIssues === 'yes' && (
                <input
                  type="text"
                  name="issueDescription"
                  value={formData.issueDescription}
                  onChange={handleInputChange}
                  placeholder="Describe scratches, dent, or mechanical issue..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Seller Notes / Description</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={3}
                placeholder="Share service history, features, or reason for sale..."
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white text-xs outline-none"
              />
            </div>

            <div className="pt-4 border-t border-gray-100 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 py-2 inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={handleNextStep}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Next: Review & Confirm</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: Final Review & Confirmation */}
        {step === 6 && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-base font-bold text-gray-900">Review & Confirm Listing</h2>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Package className="w-5 h-5 text-gray-600" />
                <div>
                  <span className="text-[11px] text-gray-500 font-medium block">Assigned Stock Number</span>
                  <span className="text-sm font-bold font-mono text-gray-900">#{assignedStockNumber}</span>
                </div>
              </div>
              <span className="text-xs bg-white border border-gray-200 text-gray-700 px-2 py-0.5 rounded-lg font-medium">
                {assignedStockNumber.length} Digits
              </span>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                <span className="text-gray-500">Selling Method</span>
                <span className="font-semibold px-2 py-0.5 rounded-lg bg-white border border-gray-200 text-gray-900 inline-flex items-center gap-1">
                  {sellingMode === 'auction' ? (
                    <>
                      <Hammer className="w-3.5 h-3.5 text-red-600" />
                      <span>Auction</span>
                    </>
                  ) : (
                    <>
                      <Tag className="w-3.5 h-3.5 text-gray-700" />
                      <span>Direct Sale</span>
                    </>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-gray-500 text-[11px] block">Vehicle</span>
                  <strong className="text-gray-900">{formData.year} {formData.make} {formData.model}</strong>
                </div>
                <div>
                  <span className="text-gray-500 text-[11px] block">Mileage</span>
                  <strong className="text-gray-900 tabular-nums">{parseInt(formData.odometer || '0').toLocaleString()} km</strong>
                </div>
                <div>
                  <span className="text-gray-500 text-[11px] block">
                    {sellingMode === 'auction' ? 'Starting Bid' : 'Selling Price'}
                  </span>
                  <strong className="text-gray-900 text-sm tabular-nums">₹{parseInt(formData.price || '0').toLocaleString()}</strong>
                </div>
                <div>
                  <span className="text-gray-500 text-[11px] block">Listing Fee</span>
                  <strong className="text-green-700">₹0 (Free)</strong>
                </div>
                {sellingMode === 'auction' && (
                  <div className="col-span-2 pt-2 border-t border-gray-200">
                    <span className="text-gray-500 text-[11px] block">Auction Schedule</span>
                    <strong className="text-gray-900 block mt-0.5">
                      {formData.scheduleType === 'auto'
                        ? 'Immediate Live Auction (Active for 7 Days)'
                        : `${formData.auctionDate} ${startHour}:${startMinute} ${startPeriod} to ${formData.auctionEndDate} ${endHour}:${endMinute} ${endPeriod}`}
                    </strong>
                    {formData.scheduleType === 'manual' && (
                      <span className="text-xs text-gray-600 block mt-0.5">
                        {new Date(`${formData.auctionDate}T${convertTo24Hour(startHour, startMinute, startPeriod)}`).getTime() > Date.now() + 60000
                          ? 'Starts as Upcoming Auction (notifications sent when live)'
                          : 'Starts as Live Auction immediately'}
                      </span>
                    )}
                  </div>
                )}
                {sellingMode === 'direct' && (
                  <div>
                    <span className="text-gray-500 text-[11px] block">Validity Period</span>
                    <strong className="text-gray-900">90 Days</strong>
                  </div>
                )}
                <div className="col-span-2 pt-2 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-gray-500">Registration Card (RC)</span>
                  {formData.hasRegistrationCard === 'yes' ? (
                    <span className="font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-lg border border-green-200 inline-flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      <span>Available {rcCardImage ? '(Document Uploaded)' : '(No Document)'}</span>
                    </span>
                  ) : (
                    <span className="font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-lg border border-red-200">
                      Not Available
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 p-3 rounded-lg leading-relaxed flex items-start gap-2">
              <Info className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
              <span>
                {sellingMode === 'auction'
                  ? 'Your vehicle will be listed in the auction feed free of charge. The highest bidder wins at auction conclusion.'
                  : 'Your vehicle will be listed in Direct Sales for 90 days.'}
              </span>
            </div>

            <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setStep(5)}
                className="text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 py-2 disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-semibold px-5 py-2.5 rounded-lg transition flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Publishing Listing...</span>
                  </>
                ) : (
                  <span>Confirm & Publish Listing</span>
                )}
              </button>
            </div>
          </form>
        )}

        {/* STEP 7: Success Screen */}
        {step === 7 && (
          <div className="text-center py-6 space-y-4">
            <div className="w-12 h-12 bg-green-50 border border-green-200 text-green-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">
                Vehicle Successfully Listed
              </h2>
              <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                {sellingMode === 'direct'
                  ? 'Your vehicle is now live under Direct Sales and in your profile for 90 days.'
                  : 'Your auction listing is published and visible on the platform and in your profile.'}
              </p>
            </div>

            <div className="max-w-xs mx-auto bg-gray-50 border border-gray-200 rounded-lg p-4">
              <span className="text-xs text-gray-500 font-medium block">Official Stock Number</span>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className="text-lg font-bold font-mono text-gray-900 tracking-wide">#{assignedStockNumber}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(assignedStockNumber);
                    setCopiedStockSuccess(true);
                    setTimeout(() => setCopiedStockSuccess(false), 2000);
                  }}
                  className="px-2 py-1 bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 rounded-lg text-xs font-medium transition inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedStockSuccess ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedStockSuccess ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Saved to Stock Database ({sellingMode === 'direct' ? 'Direct Sale' : 'Live Inventory'}).
              </p>
            </div>

            <div className="flex gap-2 justify-center pt-2">
              <button
                type="button"
                onClick={() => onNavigate('home')}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition cursor-pointer"
              >
                Browse Vehicles
              </button>
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="bg-white hover:bg-gray-50 text-gray-900 border border-gray-200 text-xs font-semibold px-4 py-2 rounded-lg transition cursor-pointer"
              >
                View in Profile
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
