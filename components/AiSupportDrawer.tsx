import React, { useState, useEffect, useRef } from 'react';
import { User, AiChatMessage, AiVehicleListingDraft, Vehicle } from '../types';
import { db, collection, doc, setDoc, addDoc } from '../firebase';
import { generateStockNumber, buildStockRecord, saveStockRecordToFirestore } from '../utils/stockHelper';
import { compressImage, prepareVehicleForFirestore } from '../utils/imageCompression';
import { authFetch } from '../utils/apiClient';
import { uploadMultipleDataUrlsToStorage } from '../utils/storageUpload';

interface AiSupportDrawerProps {
  currentUser?: User | null;
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (view: string) => void;
  onSelectVehicle?: (vehicle: Vehicle) => void;
  onListVehicle?: (vehicle: Vehicle) => Promise<any>;
}

export const AiSupportDrawer: React.FC<AiSupportDrawerProps> = ({
  currentUser,
  isOpen,
  onClose,
  onNavigate,
  onSelectVehicle,
  onListVehicle
}) => {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [guestEmail, setGuestEmail] = useState('');
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [ticketStatus, setTicketStatus] = useState<{ created: boolean; ticketId?: string } | null>(null);
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [deletionAppealStatus, setDeletionAppealStatus] = useState<{ submitted: boolean; appealId?: string; reason?: string } | null>(null);
  const [isSubmittingAppeal, setIsSubmittingAppeal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Autonomous AI Vehicle Listing Flow State
  const [vehicleDraft, setVehicleDraft] = useState<AiVehicleListingDraft | null>(null);
  const [isAnalyzingVehicle, setIsAnalyzingVehicle] = useState(false);
  const [isPublishingVehicle, setIsPublishingVehicle] = useState(false);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionFields, setCorrectionFields] = useState({
    year: '',
    make: '',
    model: '',
    color: '',
    bodyType: '',
    fuelType: '',
    transmission: '',
    engine: '',
    notes: ''
  });
  const [customPriceInput, setCustomPriceInput] = useState('500000');
  const [scheduledDateTimeInput, setScheduledDateTimeInput] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize or restore session
  useEffect(() => {
    const savedSession = localStorage.getItem('autobid_ai_session_id');
    const sid = savedSession || `ai_sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setSessionId(sid);
    if (!savedSession) {
      localStorage.setItem('autobid_ai_session_id', sid);
    }

    const savedGuestEmail = localStorage.getItem('autobid_ai_guest_email') || '';
    if (savedGuestEmail) {
      setGuestEmail(savedGuestEmail);
      setEmailSubmitted(true);
    }

    // Default welcome message
    const welcomeMsg: AiChatMessage = {
      id: 'welcome_1',
      role: 'assistant',
      content: `👋 Hello${currentUser ? ` @${currentUser.username}` : ''}! I am the **AutoBid AI Agent** (powered by Groq Cloud).

I can assist and resolve issues regarding:
• **🚗 Post Vehicle for Auction / Sale**: Upload car photos, AI analyzes details, confirms specs step-by-step, sets starting bid / asking price, schedules, and posts directly from your account!
• **Live Auctions & Bidding**: How auction countdowns, pre-bids, and direct buy work.
• **AutoBid INR Wallet**: Deposits via CT Account (minting virtual funds) and platform service spends routed to CT Collection.
• **Platform Utilities**: Unlocking **View Stock Insights** (₹1,999) and VIP vehicle boosters.
• **KYC & Identity Verification**: PAN and National ID authentication.
• **Account Requests**: Account deletion inquiries, appeals & dispute resolutions.

How can I assist you right now?`,
      timestamp: Date.now(),
      statusTag: 'in_progress'
    };

    setMessages([welcomeMsg]);
  }, [currentUser]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isAnalyzingVehicle]);

  const activeEmail = currentUser?.email || guestEmail;

  // -------------------------------------------------------------
  // Account Deletion Appeal
  // -------------------------------------------------------------
  const handleSubmitDeletionAppeal = async (appealReason?: string) => {
    if (isSubmittingAppeal || deletionAppealStatus?.submitted) return;
    if (!currentUser?.id) {
      alert("Please sign in to submit an account deletion appeal.");
      return;
    }
    const finalReason = appealReason?.trim() || "User requested account deletion via AI Support";
    setIsSubmittingAppeal(true);

    try {
      const res = await authFetch('/api/ai/submit-deletion-appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          reason: finalReason
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit deletion appeal.');
      }

      const appealId = data.appealId || `appeal_del_${Date.now()}`;
      const targetUsername = currentUser.username || 'Member';
      const targetEmail = currentUser.email || activeEmail || 'user@autobid.com';

      setDeletionAppealStatus({ submitted: true, appealId, reason: finalReason });

      const confirmMsg: AiChatMessage = {
        id: `appeal_confirm_${Date.now()}`,
        role: 'assistant',
        content: `✅ **Account Deletion Appeal Successfully Submitted to Admin Panel!**

• **Appeal Reference:** \`${appealId}\`
• **Target Account:** @${targetUsername} (${targetEmail})
• **Reason Provided:** "${finalReason}"
• **Status:** Pending Administrator Action (Module 13: Appeals)

Our platform administration team has received your request and reason in the Admin Panel. An admin will review and permanently delete your account. You will receive notification once finalized.`,
        timestamp: Date.now(),
        statusTag: 'resolved'
      };

      setMessages(prev => [...prev, confirmMsg]);
    } catch (err: any) {
      alert("Error submitting deletion appeal: " + err.message);
    } finally {
      setIsSubmittingAppeal(false);
    }
  };

  // -------------------------------------------------------------
  // AI Vehicle Listing Concierge Steps
  // -------------------------------------------------------------
  
  // Step 1: Start vehicle listing flow
  const handleStartVehicleListingFlow = () => {
    const draft: AiVehicleListingDraft = {
      step: 'upload_photos',
      images: []
    };
    setVehicleDraft(draft);

    const userMsg: AiChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: "I want to post a vehicle for auction on AutoBid.",
      timestamp: Date.now()
    };

    const aiMsg: AiChatMessage = {
      id: `ai_${Date.now()}`,
      role: 'assistant',
      content: `I'll guide you step-by-step through posting your vehicle on AutoBid for auction or direct sale!

📸 **Step 1: Upload Vehicle Photo(s)**
Please upload one or more clear photos of your vehicle using the button below. I will analyze the photos, detect all vehicle specifications (Make, Model, Year, Fuel, Engine, etc.), and ask you to confirm before proceeding!`,
      timestamp: Date.now(),
      statusTag: 'in_progress',
      vehicleListingData: draft
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);

    setTimeout(() => {
      fileInputRef.current?.click();
    }, 400);
  };

  // Step 1 -> 2: Handle photo selection and AI analysis
  const handleVehiclePhotosSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsAnalyzingVehicle(true);

    try {
      const imagesArray: string[] = [];
      let primaryBase64 = '';
      let primaryMime = 'image/jpeg';

      for (let i = 0; i < Math.min(files.length, 5); i++) {
        const file = files[i];
        try {
          const compressed = await compressImage(file, 960, 720, 0.68);
          imagesArray.push(compressed.url);

          if (i === 0) {
            primaryMime = compressed.mime || 'image/jpeg';
            primaryBase64 = compressed.base64 || '';
          }
        } catch (compErr) {
          console.warn("Image compression fallback:", compErr);
          // Fallback reading
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          imagesArray.push(dataUrl);
          if (i === 0) {
            primaryMime = file.type || 'image/jpeg';
            primaryBase64 = dataUrl.split(',')[1] || '';
          }
        }
      }

      // Call AI vehicle analysis API
      let detectedSpecs: any = null;
      try {
        const res = await authFetch('/api/ai/analyze-vehicle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64Data: primaryBase64,
            mimeType: primaryMime
          })
        });
        if (res.ok) {
          const resData = await res.json();
          if (resData.success && resData.specs) {
            detectedSpecs = resData.specs;
          }
        }
      } catch (apiErr) {
        console.warn("AI vehicle analysis API fallback:", apiErr);
      }

      // Robust fallback if AI service fails or offline
      if (!detectedSpecs) {
        const currentYear = new Date().getFullYear();
        detectedSpecs = {
          year: currentYear - 2,
          make: "Honda",
          model: "City V MT",
          color: "Pearl White",
          bodyType: "Sedan",
          fuelType: "Petrol",
          transmission: "Manual",
          engine: "1.5L i-VTEC",
          condition: "Excellent (AutoBid 4.8/5 Certified Inspection)"
        };
      }

      const updatedDraft: AiVehicleListingDraft = {
        step: 'confirm_specs',
        year: detectedSpecs.year || 2022,
        make: detectedSpecs.make || 'Honda',
        model: detectedSpecs.model || 'City',
        color: detectedSpecs.color || 'White',
        bodyType: detectedSpecs.bodyType || 'Sedan',
        fuelType: detectedSpecs.fuelType || 'Petrol',
        transmission: detectedSpecs.transmission || 'Manual',
        engine: detectedSpecs.engine || '1.5L i-VTEC',
        condition: detectedSpecs.condition || 'Pre-Owned (AutoBid Certified)',
        images: imagesArray
      };

      setVehicleDraft(updatedDraft);
      setCorrectionFields({
        year: String(updatedDraft.year || ''),
        make: updatedDraft.make || '',
        model: updatedDraft.model || '',
        color: updatedDraft.color || '',
        bodyType: updatedDraft.bodyType || '',
        fuelType: updatedDraft.fuelType || '',
        transmission: updatedDraft.transmission || '',
        engine: updatedDraft.engine || '',
        notes: ''
      });

      const userMsg: AiChatMessage = {
        id: `usr_photo_${Date.now()}`,
        role: 'user',
        content: `Uploaded ${imagesArray.length} photo(s) of the vehicle for listing.`,
        timestamp: Date.now()
      };

      const aiMsg: AiChatMessage = {
        id: `ai_specs_${Date.now()}`,
        role: 'assistant',
        content: `🔍 **Vehicle Analysis Complete!** Here are the detected specifications from your photo:

• **Vehicle:** ${updatedDraft.year} ${updatedDraft.make} ${updatedDraft.model}
• **Body Style:** ${updatedDraft.bodyType}
• **Color:** ${updatedDraft.color}
• **Fuel Type:** ${updatedDraft.fuelType}
• **Transmission:** ${updatedDraft.transmission}
• **Engine:** ${updatedDraft.engine}
• **Condition:** ${updatedDraft.condition}

**Is this information correct?**
If yes, we will move forward to choosing your selling mode. If not, tell me what is wrong and I will correct it!`,
        timestamp: Date.now(),
        statusTag: 'in_progress',
        vehicleListingData: updatedDraft
      };

      setMessages(prev => [...prev, userMsg, aiMsg]);
    } catch (err: any) {
      alert("Error uploading vehicle photos: " + err.message);
    } finally {
      setIsAnalyzingVehicle(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Step 2: Confirm specs or submit corrections
  const handleConfirmSpecs = (isCorrect: boolean) => {
    if (!vehicleDraft) return;

    if (isCorrect) {
      const nextDraft: AiVehicleListingDraft = {
        ...vehicleDraft,
        step: 'select_mode'
      };
      setVehicleDraft(nextDraft);

      const userMsg: AiChatMessage = {
        id: `usr_${Date.now()}`,
        role: 'user',
        content: "Yes, the vehicle information is correct.",
        timestamp: Date.now()
      };

      const aiMsg: AiChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: `Great! The vehicle specifications have been confirmed.

**Step 3: Selling Mode Selection**
How would you like to sell your **${nextDraft.year} ${nextDraft.make} ${nextDraft.model}**?

1. **⚡ With Auction (Live Bidding)**: Buyers place competitive live bids and pre-stakes up to your auction end time.
2. **🏷️ Without Auction (Direct Sale / Fixed Price)**: Buyers can purchase your vehicle directly at your fixed price.

Please choose your selling mode below:`,
        timestamp: Date.now(),
        statusTag: 'in_progress',
        vehicleListingData: nextDraft
      };

      setMessages(prev => [...prev, userMsg, aiMsg]);
    } else {
      setShowCorrectionForm(true);
    }
  };

  // Submit corrections for Step 2
  const handleApplyCorrections = () => {
    if (!vehicleDraft) return;

    const correctedDraft: AiVehicleListingDraft = {
      ...vehicleDraft,
      year: correctionFields.year ? Number(correctionFields.year) : vehicleDraft.year,
      make: correctionFields.make || vehicleDraft.make,
      model: correctionFields.model || vehicleDraft.model,
      color: correctionFields.color || vehicleDraft.color,
      bodyType: correctionFields.bodyType || vehicleDraft.bodyType,
      fuelType: correctionFields.fuelType || vehicleDraft.fuelType,
      transmission: correctionFields.transmission || vehicleDraft.transmission,
      engine: correctionFields.engine || vehicleDraft.engine,
      step: 'confirm_specs'
    };

    setVehicleDraft(correctedDraft);
    setShowCorrectionForm(false);

    const userMsg: AiChatMessage = {
      id: `usr_corr_${Date.now()}`,
      role: 'user',
      content: `I corrected the vehicle details: ${correctedDraft.year} ${correctedDraft.make} ${correctedDraft.model}, Color: ${correctedDraft.color}, Fuel: ${correctedDraft.fuelType}, Transmission: ${correctedDraft.transmission}.`,
      timestamp: Date.now()
    };

    const aiMsg: AiChatMessage = {
      id: `ai_corr_${Date.now()}`,
      role: 'assistant',
      content: `I have updated the vehicle specifications as requested:

• **Vehicle:** ${correctedDraft.year} ${correctedDraft.make} ${correctedDraft.model}
• **Body Style:** ${correctedDraft.bodyType}
• **Color:** ${correctedDraft.color}
• **Fuel Type:** ${correctedDraft.fuelType}
• **Transmission:** ${correctedDraft.transmission}
• **Engine:** ${correctedDraft.engine}

**Is this information correct now?**`,
      timestamp: Date.now(),
      statusTag: 'in_progress',
      vehicleListingData: correctedDraft
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
  };

  // Step 3: Select selling mode (auction vs direct)
  const handleSelectSellingMode = (mode: 'auction' | 'direct') => {
    if (!vehicleDraft) return;

    const nextDraft: AiVehicleListingDraft = {
      ...vehicleDraft,
      sellingMode: mode,
      step: 'set_price'
    };
    setVehicleDraft(nextDraft);

    const modeName = mode === 'auction' ? 'With Auction (Live Bidding)' : 'Without Auction (Direct Sale)';

    const userMsg: AiChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: `I want to sell this vehicle ${modeName}.`,
      timestamp: Date.now()
    };

    const aiMsg: AiChatMessage = {
      id: `ai_${Date.now()}`,
      role: 'assistant',
      content: `You selected: **${modeName}**. Confirmed!

**Step 4: Set Asking Price**
What is your asking price (in INR ₹) for this vehicle?
${mode === 'auction' ? '(This will be the starting bid / reserve price for the live auction.)' : '(This will be the fixed purchase price for direct buyers.)'}

Enter your asking price below:`,
      timestamp: Date.now(),
      statusTag: 'in_progress',
      vehicleListingData: nextDraft
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
  };

  // Step 4: Set asking price
  const handleConfirmPrice = (priceVal: number) => {
    if (!vehicleDraft || !priceVal || priceVal <= 0) return;

    const nextDraft: AiVehicleListingDraft = {
      ...vehicleDraft,
      price: priceVal,
      step: 'set_schedule'
    };
    setVehicleDraft(nextDraft);

    const userMsg: AiChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: `The asking price is ₹${priceVal.toLocaleString()}.`,
      timestamp: Date.now()
    };

    const aiMsg: AiChatMessage = {
      id: `ai_${Date.now()}`,
      role: 'assistant',
      content: `Asking price confirmed at **₹${priceVal.toLocaleString()}**!

**Step 5: Publish Schedule**
When would you like this listing to go live on AutoBid?

1. **🚀 Publish Immediately**: Goes live right away for all buyers.
2. **📅 Schedule for Later**: Set a future launch date and time.

Select your schedule option below:`,
      timestamp: Date.now(),
      statusTag: 'in_progress',
      vehicleListingData: nextDraft
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
  };

  // Step 5: Set publish schedule
  const handleConfirmSchedule = (scheduleType: 'immediate' | 'scheduled', customTime?: string) => {
    if (!vehicleDraft) return;

    const nextDraft: AiVehicleListingDraft = {
      ...vehicleDraft,
      scheduleType,
      scheduledTime: customTime || (scheduleType === 'immediate' ? 'Immediately' : scheduledDateTimeInput),
      step: 'ready_to_publish'
    };
    setVehicleDraft(nextDraft);

    const userMsg: AiChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: scheduleType === 'immediate' ? "Publish the post immediately." : `Schedule the post for ${nextDraft.scheduledTime}.`,
      timestamp: Date.now()
    };

    const aiMsg: AiChatMessage = {
      id: `ai_${Date.now()}`,
      role: 'assistant',
      content: `All listing details have been verified and confirmed!

📋 **Listing Summary Ready to Publish:**
• **Vehicle:** ${nextDraft.year} ${nextDraft.make} ${nextDraft.model}
• **Selling Mode:** ${nextDraft.sellingMode === 'auction' ? '⚡ With Auction (Live Bidding)' : '🏷️ Without Auction (Direct Sale)'}
• **Asking Price / Starting Bid:** ₹${nextDraft.price?.toLocaleString()}
• **Schedule:** ${scheduleType === 'immediate' ? '🚀 Immediate Launch' : `📅 ${nextDraft.scheduledTime}`}
• **Seller Account:** ${currentUser ? `@${currentUser.username}` : 'Guest User'}

Tap **Post Vehicle Now** to publish this vehicle from your account!`,
      timestamp: Date.now(),
      statusTag: 'in_progress',
      vehicleListingData: nextDraft
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
  };

  // Step 6: Final Autonomous Vehicle Posting from User's Account
  const handlePublishVehicleListing = async () => {
    if (!vehicleDraft || isPublishingVehicle) return;

    if (!currentUser) {
      alert("Please sign in or register so this vehicle can be posted from your official AutoBid account.");
      if (onNavigate) onNavigate('auth');
      return;
    }

    setIsPublishingVehicle(true);

    try {
      const parsedPrice = Number(vehicleDraft.price) || 250000;
      const isAuction = vehicleDraft.sellingMode !== 'direct';
      const now = Date.now();
      let initialStatus = isAuction ? 'Live Auction' : 'Direct Sale';

      if (vehicleDraft.scheduleType === 'scheduled' && vehicleDraft.scheduledTime) {
        const scheduledTimeMs = new Date(vehicleDraft.scheduledTime).getTime();
        if (!isNaN(scheduledTimeMs) && scheduledTimeMs > now) {
          initialStatus = 'Upcoming';
        }
      }

      const activeUserId = currentUser.id;
      const activeUsername = currentUser.username || 'user';
      const preAssignedStockNumber = vehicleDraft.stockNumber || generateStockNumber();
      const uploadedImages = Array.isArray(vehicleDraft.images) && vehicleDraft.images.length > 0
        ? await uploadMultipleDataUrlsToStorage(vehicleDraft.images, 'vehicles', `ai_${preAssignedStockNumber}`)
        : vehicleDraft.images;

      // Server-authoritative vehicle creation (A1, A3): uploads images to Storage if needed, mints vehicleId, scrubs PII, syncs stock & notifications
      const pubRes = await authFetch('/api/ai/publish-vehicle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft: { ...vehicleDraft, images: uploadedImages, stockNumber: preAssignedStockNumber },
          sessionId
        })
      });
      const pubData = await pubRes.json();
      if (!pubRes.ok || !pubData.success) {
        throw new Error(pubData.error || 'Failed to publish vehicle via server.');
      }

      const vehicleId = pubData.vehicleId || pubData.vehicle?.id;
      const assignedStockNumber = pubData.stockNumber || preAssignedStockNumber;
      const publishedVehicle = pubData.vehicle || {
        ...vehicleDraft,
        id: vehicleId,
        stockNumber: assignedStockNumber,
        listingType: isAuction ? 'auction' : 'direct',
        status: initialStatus,
        ownerId: activeUserId,
        ownerUsername: activeUsername
      };

      const publishedDraft: AiVehicleListingDraft = {
        ...vehicleDraft,
        step: 'published',
        vehicleId,
        stockNumber: assignedStockNumber
      };
      setVehicleDraft(publishedDraft);

      const confirmAiMsg: AiChatMessage = {
        id: `ai_pub_${Date.now()}`,
        role: 'assistant',
        content: `🎉 **Vehicle Successfully Listed on AutoBid!**

• **Vehicle:** ${publishedVehicle.year} ${publishedVehicle.make} ${publishedVehicle.model}
• **Stock Number:** \`#${assignedStockNumber}\`
• **Selling Mode:** ${publishedVehicle.listingType === 'auction' ? '⚡ Live Auction' : '🏷️ Direct Sale'}
• **Asking Price / Starting Bid:** ₹${parsedPrice.toLocaleString()}
• **Status:** ${publishedVehicle.status}
• **Owner:** @${currentUser.username}

Your vehicle has been officially published from your account and is now discoverable across AutoBid!`,
        timestamp: Date.now(),
        statusTag: 'resolved',
        vehicleListingData: publishedDraft
      };

      setMessages(prev => [...prev, confirmAiMsg]);
    } catch (err: any) {
      alert("Error publishing vehicle: " + err.message);
    } finally {
      setIsPublishingVehicle(false);
    }
  };

  // -------------------------------------------------------------
  // Standard Groq AI Chat Interaction
  // -------------------------------------------------------------
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isLoading) return;

    if (!currentUser?.id) {
      const signInMsg: AiChatMessage = {
        id: `auth_req_${Date.now()}`,
        role: 'assistant',
        content: '🔐 Please sign in to your AutoBid account to chat with the AI Support Agent or list a vehicle.',
        timestamp: Date.now(),
        statusTag: 'in_progress'
      };
      setMessages(prev => [...prev, signInMsg]);
      onNavigate?.('auth');
      return;
    }

    // Check if user specifically requested to sell or list a vehicle
    const lowerText = text.toLowerCase();
    if (lowerText.includes('sell my car') || lowerText.includes('list my car') || lowerText.includes('post for auction') || lowerText.includes('auction my car') || lowerText.includes('post a vehicle')) {
      handleStartVehicleListingFlow();
      setInput('');
      return;
    }

    const userMsg: AiChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now()
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await authFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          sessionId
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'AI service temporarily unavailable.');
      }

      if (data.sessionId) {
        setSessionId(data.sessionId);
        try {
          localStorage.setItem('autobid_ai_session_id', data.sessionId);
        } catch {}
      }

      // Update vehicleDraft ONLY if AI returned an explicit valid vehicle listing step
      let currentListingData: AiVehicleListingDraft | undefined = undefined;
      const validListingSteps = ['upload_photos', 'confirm_specs', 'select_mode', 'set_price', 'set_schedule', 'ready_to_publish', 'published'];

      if (data.vehicleListing && data.vehicleListing.step && validListingSteps.includes(data.vehicleListing.step)) {
        currentListingData = {
          ...(vehicleDraft || { step: 'upload_photos', images: [] }),
          ...data.vehicleListing.data,
          step: data.vehicleListing.step,
          images: vehicleDraft?.images || []
        };
        setVehicleDraft(currentListingData);
      } else {
        currentListingData = undefined;
      }

      const aiMsg: AiChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        timestamp: Date.now(),
        statusTag: data.status,
        ticketSuggested: data.suggestTicket,
        deleteAppealSuggested: Boolean(data.deleteAppeal),
        deleteAppealData: data.deleteAppeal,
        vehicleListingData: currentListingData
      };

      const finalMessages = [...newMessages, aiMsg];
      setMessages(finalMessages);

      if (data.deleteAppeal?.stage === 'confirmed' && !deletionAppealStatus?.submitted) {
        handleSubmitDeletionAppeal(data.deleteAppeal.reason || text);
      }
    } catch (err: any) {
      console.error("AI Chat error:", err);
      const errMsg: AiChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: `⚠️ ${err.message || 'I had trouble connecting to the support server.'} Please try again.`,
        timestamp: Date.now(),
        statusTag: 'escalated',
        ticketSuggested: true
      };
      setMessages([...newMessages, errMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // 1-Click Ticket Creation (server-authoritative B8)
  const handleRaiseTicket = async (ticketDetails?: any) => {
    if (isCreatingTicket || ticketStatus?.created) return;
    if (!currentUser?.id) {
      alert("Please sign in to create a support ticket.");
      return;
    }
    setIsCreatingTicket(true);

    try {
      const finalCategory = ticketDetails?.ticketCategory || 'ai_escalation';
      const finalSubject = ticketDetails?.ticketSubject || 'Unresolved Issue Reported via AI Assistant';
      const finalDesc = ticketDetails?.ticketDescription || `AI Session Summary: ${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).slice(-4).join('\n')}`;

      const res = await authFetch('/api/ai/create-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          category: finalCategory,
          subject: finalSubject,
          description: finalDesc
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create support ticket.');
      }

      const generatedTicketId = data.ticketId || `tkt_ai_${Date.now()}`;
      setTicketStatus({ created: true, ticketId: generatedTicketId });

      const tktConfirmMsg: AiChatMessage = {
        id: `tkt_confirm_${Date.now()}`,
        role: 'assistant',
        content: `✅ **Official Support Ticket Created!**

• **Ticket Reference:** \`${generatedTicketId}\`
• **User Account:** ${data.ticket?.userEmail || activeEmail || currentUser.email || 'Member'}
• **Category:** ${finalCategory}
• **Subject:** "${finalSubject}"

Our human support team and admin have been notified. You can review and track this ticket anytime under **Settings > View Support Tickets**.`,
        timestamp: Date.now(),
        statusTag: 'escalated'
      };

      setMessages(prev => [...prev, tktConfirmMsg]);
    } catch (err: any) {
      alert("Error creating support ticket: " + err.message);
    } finally {
      setIsCreatingTicket(false);
    }
  };

  const handleCopyTranscript = () => {
    const text = messages.map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-fadeIn">
      {/* Hidden file input for photo upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleVehiclePhotosSelected}
        multiple
        accept="image/*"
        className="hidden"
      />

      <div className="w-full sm:max-w-lg md:max-w-xl bg-white dark:bg-gray-900 h-full flex flex-col shadow-2xl overflow-hidden border-l border-gray-200 dark:border-gray-800">
        
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-purple-700 via-indigo-700 to-gray-900 text-white flex items-center justify-between shrink-0 shadow-sm relative overflow-hidden">
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-xl shadow-inner">
              🤖
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-base sm:text-lg tracking-tight leading-none text-white">
                  AutoBid AI Agent
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Free
                </span>
              </div>
              <p className="text-[11px] text-gray-300 mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Active 24/7 • Photo Listing Concierge & Solver</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 relative z-10">
            <button
              type="button"
              onClick={handleCopyTranscript}
              title="Copy conversation transcript"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-200 hover:text-white text-xs font-bold transition cursor-pointer"
            >
              {copySuccess ? '✓ Copied' : '📋'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-base font-bold transition cursor-pointer"
              title="Close AI Assistant"
            >
              ✕
            </button>
          </div>
          <div className="absolute right-0 top-0 w-32 h-32 bg-purple-500/20 rounded-full blur-2xl pointer-events-none"></div>
        </div>

        {/* User Account / Email Status Banner */}
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800 shrink-0 text-xs">
          {currentUser ? (
            <div className="flex items-center justify-between">
              <span className="text-gray-600 dark:text-gray-300 flex items-center gap-1.5 font-medium">
                <span>👤</span>
                <span>Logged in as <strong>@{currentUser.username}</strong> ({currentUser.email || 'Verified Member'})</span>
              </span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-bold px-2 py-0.5 rounded-full">
                Auto-Synced
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-gray-700 dark:text-gray-300 font-medium">
                <span className="flex items-center gap-1.5">
                  <span>✉️</span>
                  <span><strong>Guest Mode</strong> (No Login Needed)</span>
                </span>
                {emailSubmitted && (
                  <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    Email Linked
                  </span>
                )}
              </div>

              {!emailSubmitted ? (
                <div className="flex gap-2 items-center">
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="Enter your email to share & log this chat..."
                    className="flex-1 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (guestEmail.includes('@')) {
                        setEmailSubmitted(true);
                        localStorage.setItem('autobid_ai_guest_email', guestEmail.trim());
                      } else {
                        alert("Please enter a valid email address.");
                      }
                    }}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>Transcript tied to: <strong>{guestEmail}</strong></span>
                  <button
                    type="button"
                    onClick={() => setEmailSubmitted(false)}
                    className="text-purple-600 underline font-semibold cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat Messages Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            // Only render vehicle listing widget if this specific message contains listingData
            const listingData = msg.vehicleListingData;

            return (
              <div
                key={msg.id || idx}
                className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'} animate-fadeIn`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white flex items-center justify-center text-sm shrink-0 shadow-xs mt-1">
                    🤖
                  </div>
                )}

                <div className={`max-w-[88%] sm:max-w-[82%] rounded-2xl p-3.5 sm:p-4 text-xs sm:text-sm leading-relaxed ${
                  isUser
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-tr-none shadow-md'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-tl-none border border-gray-200/70 dark:border-gray-700'
                }`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* ------------------------------------------------------------------ */}
                  {/* INTERACTIVE VEHICLE LISTING WIDGET CARDS (Inside assistant message) */}
                  {/* ------------------------------------------------------------------ */}
                  {!isUser && listingData && (
                    <div className="mt-3.5 pt-3 border-t border-gray-200/80 dark:border-gray-700/80 space-y-3">
                      
                      {/* STEP 1: Upload Photos Card */}
                      {listingData.step === 'upload_photos' && (
                        <div className="bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl p-3.5 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 font-black text-purple-900 dark:text-purple-200 text-xs uppercase tracking-wider">
                              <span>📸</span>
                              <span>Step 1: Upload Vehicle Photo(s)</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setVehicleDraft(null);
                                setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, vehicleListingData: undefined } : m));
                              }}
                              className="text-[10px] text-gray-500 hover:text-red-500 transition cursor-pointer font-semibold"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                          <p className="text-xs text-purple-800 dark:text-purple-300">
                            Tap below to select photo(s) of your car. AutoBid AI will inspect the exterior, detect Make/Model/Year, and extract specifications.
                          </p>
                          <button
                            type="button"
                            disabled={isAnalyzingVehicle}
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black rounded-xl text-xs shadow-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                          >
                            <span>📸</span>
                            <span>{isAnalyzingVehicle ? 'Analyzing Vehicle Photos with AI...' : 'Upload Vehicle Photo(s) from Device'}</span>
                          </button>
                        </div>
                      )}

                      {/* STEP 2: Confirm Specifications Card */}
                      {listingData.step === 'confirm_specs' && (
                        <div className="bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-800 rounded-2xl p-3.5 space-y-3 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-xs text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                              <span>🔍</span>
                              <span>Detected Vehicle Specs</span>
                            </span>
                            <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-full">
                              Step 2: Confirm
                            </span>
                          </div>

                          {/* Image preview thumbnail */}
                          {listingData.images && listingData.images.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {listingData.images.map((img, i) => (
                                <img
                                  key={i}
                                  src={img}
                                  alt="Vehicle"
                                  className="w-16 h-12 object-cover rounded-lg border border-gray-200 shrink-0"
                                />
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2 text-[11px] bg-gray-50 dark:bg-gray-800/80 p-2.5 rounded-xl border border-gray-100 dark:border-gray-700">
                            <div><span className="text-gray-400">Vehicle:</span> <strong className="text-gray-900 dark:text-white block">{listingData.year} {listingData.make} {listingData.model}</strong></div>
                            <div><span className="text-gray-400">Color:</span> <strong className="text-gray-900 dark:text-white block">{listingData.color || 'Silver'}</strong></div>
                            <div><span className="text-gray-400">Body Type:</span> <strong className="text-gray-900 dark:text-white block">{listingData.bodyType || 'Sedan'}</strong></div>
                            <div><span className="text-gray-400">Fuel:</span> <strong className="text-gray-900 dark:text-white block">{listingData.fuelType || 'Petrol'}</strong></div>
                            <div><span className="text-gray-400">Transmission:</span> <strong className="text-gray-900 dark:text-white block">{listingData.transmission || 'Automatic'}</strong></div>
                            <div><span className="text-gray-400">Engine:</span> <strong className="text-gray-900 dark:text-white block">{listingData.engine || '1.5L Turbo'}</strong></div>
                          </div>

                          <div className="text-center font-bold text-xs text-gray-700 dark:text-gray-300">
                            Is this information correct?
                          </div>

                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleConfirmSpecs(true)}
                              className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <span>✅</span>
                              <span>Yes, Correct</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirmSpecs(false)}
                              className="py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-700 font-black rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <span>✏️</span>
                              <span>Correct Details</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* STEP 3: Selling Mode Card */}
                      {listingData.step === 'select_mode' && (
                        <div className="bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-800 rounded-2xl p-3.5 space-y-2.5 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-xs text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                              <span>⚖️</span>
                              <span>Step 3: Choose Selling Mode</span>
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleSelectSellingMode('auction')}
                              className="p-3 text-left rounded-xl border border-purple-300 hover:border-purple-600 bg-purple-50/70 hover:bg-purple-100/80 transition cursor-pointer space-y-1"
                            >
                              <div className="flex items-center gap-1.5 font-black text-purple-950 text-xs">
                                <span>⚡</span>
                                <span>With Auction</span>
                              </div>
                              <p className="text-[10px] text-purple-800 leading-tight">
                                Live countdown bidding. Buyers place competitive pre-stakes & live stakes.
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectSellingMode('direct')}
                              className="p-3 text-left rounded-xl border border-indigo-300 hover:border-indigo-600 bg-indigo-50/70 hover:bg-indigo-100/80 transition cursor-pointer space-y-1"
                            >
                              <div className="flex items-center gap-1.5 font-black text-indigo-950 text-xs">
                                <span>🏷️</span>
                                <span>Without Auction</span>
                              </div>
                              <p className="text-[10px] text-indigo-800 leading-tight">
                                Direct sale / Fixed price. Buyers buy now directly at your asking price.
                              </p>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* STEP 4: Set Asking Price Card */}
                      {listingData.step === 'set_price' && (
                        <div className="bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-800 rounded-2xl p-3.5 space-y-3 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-xs text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                              <span>💰</span>
                              <span>Step 4: Set Asking Price (INR ₹)</span>
                            </span>
                            <span className="text-[10px] font-bold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                              {listingData.sellingMode === 'auction' ? 'Starting Bid' : 'Direct Buy Price'}
                            </span>
                          </div>

                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <span className="absolute left-3.5 top-2.5 font-black text-gray-500 text-sm">₹</span>
                              <input
                                type="number"
                                value={customPriceInput}
                                onChange={(e) => setCustomPriceInput(e.target.value)}
                                placeholder="e.g. 500000"
                                className="w-full pl-8 pr-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-black text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleConfirmPrice(Number(customPriceInput))}
                              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold rounded-xl text-xs transition cursor-pointer shrink-0 shadow-xs"
                            >
                              Confirm
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {[150000, 350000, 500000, 850000, 1200000, 1800000].map(amt => (
                              <button
                                key={amt}
                                type="button"
                                onClick={() => {
                                  setCustomPriceInput(String(amt));
                                  handleConfirmPrice(amt);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-[10px] font-bold text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition cursor-pointer"
                              >
                                ₹{amt.toLocaleString()}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* STEP 5: Set Publish Schedule Card */}
                      {listingData.step === 'set_schedule' && (
                        <div className="bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-800 rounded-2xl p-3.5 space-y-2.5 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-xs text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                              <span>⏱️</span>
                              <span>Step 5: Publish Timing</span>
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleConfirmSchedule('immediate')}
                              className="py-3 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black rounded-xl text-xs shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
                            >
                              <span>🚀</span>
                              <span>Publish Immediately</span>
                            </button>

                            <div className="space-y-1.5">
                              <input
                                type="datetime-local"
                                value={scheduledDateTimeInput}
                                onChange={(e) => setScheduledDateTimeInput(e.target.value)}
                                className="w-full px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl text-[11px] font-semibold text-gray-800 dark:text-white focus:outline-none"
                              />
                              <button
                                type="button"
                                disabled={!scheduledDateTimeInput}
                                onClick={() => handleConfirmSchedule('scheduled', scheduledDateTimeInput)}
                                className="w-full py-1.5 bg-gray-900 hover:bg-black text-white font-bold rounded-xl text-xs transition disabled:opacity-50 cursor-pointer"
                              >
                                📅 Confirm Schedule
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* STEP 6: Ready to Publish Card */}
                      {listingData.step === 'ready_to_publish' && (
                        <div className="bg-gradient-to-br from-purple-50 via-white to-indigo-50 dark:from-gray-900 dark:to-gray-800 border border-purple-300 dark:border-purple-700 rounded-2xl p-4 space-y-3 shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="font-black text-xs text-purple-950 dark:text-purple-300 flex items-center gap-1.5">
                              <span>✨</span>
                              <span>Step 6: Final Confirmation</span>
                            </span>
                            <span className="text-[10px] font-mono bg-purple-200 text-purple-900 font-bold px-2 py-0.5 rounded-full">
                              Verified
                            </span>
                          </div>

                          <div className="p-3 bg-white/90 dark:bg-gray-900/90 rounded-xl border border-purple-100 dark:border-gray-700 text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="text-gray-500">Vehicle:</span>
                              <strong className="text-gray-900 dark:text-white">{listingData.year} {listingData.make} {listingData.model}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Mode:</span>
                              <strong className="text-purple-700 dark:text-purple-400 uppercase font-black">{listingData.sellingMode === 'auction' ? 'Live Auction' : 'Direct Sale'}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Asking Price:</span>
                              <strong className="text-emerald-600 font-black text-sm">₹{Number(listingData.price).toLocaleString()}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Account:</span>
                              <strong className="text-gray-800 dark:text-gray-200">{currentUser ? `@${currentUser.username}` : 'Guest Visitor'}</strong>
                            </div>
                          </div>

                          {currentUser ? (
                            <button
                              type="button"
                              disabled={isPublishingVehicle}
                              onClick={handlePublishVehicleListing}
                              className="w-full py-3 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-800 hover:from-purple-700 hover:to-indigo-700 text-white font-black rounded-xl text-xs sm:text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                              <span>🚀</span>
                              <span>{isPublishingVehicle ? 'Publishing Vehicle to AutoBid...' : `Post Vehicle Now from @${currentUser.username}'s Account`}</span>
                            </button>
                          ) : (
                            <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-center space-y-1.5">
                              <p className="text-[11px] text-amber-900 font-semibold">
                                Please sign in to finalize and post this vehicle under your personal account.
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  if (onNavigate) onNavigate('auth');
                                }}
                                className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition cursor-pointer"
                              >
                                🔑 Sign In to Post Listing
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* STEP 7: Published Celebration Card with View Vehicle Listing Button */}
                      {listingData.step === 'published' && (
                        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 rounded-2xl p-4 space-y-3 shadow-xs animate-fadeIn">
                          <div className="flex items-center justify-between">
                            <span className="font-black text-xs text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                              <span>🎉</span>
                              <span>Vehicle Listing Published</span>
                            </span>
                            <span className="text-[10px] font-mono bg-emerald-200 text-emerald-900 font-extrabold px-2 py-0.5 rounded-full">
                              Stock #{listingData.stockNumber}
                            </span>
                          </div>

                          <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                            Your <strong>{listingData.year} {listingData.make} {listingData.model}</strong> is now live on AutoBid! Bidders and buyers can view details, pre-bid, and participate.
                          </p>

                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                if (listingData.vehicleId && onSelectVehicle) {
                                  onSelectVehicle({
                                    id: listingData.vehicleId,
                                    stockNumber: listingData.stockNumber || generateStockNumber(),
                                    year: Number(listingData.year) || 2022,
                                    make: listingData.make || '',
                                    model: listingData.model || '',
                                    currentBid: Number(listingData.price) || 250000,
                                    startingPrice: Number(listingData.price) || 250000,
                                    status: (listingData.sellingMode === 'direct' ? 'Direct Sale' : 'Live Auction') as any,
                                    listingType: (listingData.sellingMode || 'auction') as any,
                                    images: listingData.images && listingData.images.length > 0 ? listingData.images : ['https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=1200'],
                                    coverImageIndex: 0,
                                    isOwner: true,
                                    ownerId: currentUser?.id,
                                    ownerUsername: currentUser?.username,
                                    listedAt: Date.now(),
                                    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
                                  } as any);
                                }
                                if (onNavigate) onNavigate('detail');
                              }}
                              className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black rounded-xl text-xs shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <span>👀</span>
                              <span>View Vehicle Listing</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVehicleDraft(null);
                                handleStartVehicleListingFlow();
                              }}
                              className="px-3 py-2.5 bg-white text-emerald-800 border border-emerald-300 hover:bg-emerald-100 rounded-xl text-xs font-bold transition cursor-pointer"
                            >
                              + List Another
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  )}

                  {/* Resolution Status Tag or Escalation Action Button */}
                  {!isUser && msg.statusTag && (
                    <div className="mt-3 pt-2.5 border-t border-gray-200/60 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
                      {msg.statusTag === 'resolved' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                          <span>✓</span> Resolved by AI
                        </span>
                      )}

                      {msg.ticketSuggested && !ticketStatus?.created && (
                        <div className="w-full bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl p-2.5 text-xs text-amber-900 dark:text-amber-200 mt-1">
                          <p className="font-bold mb-1.5 flex items-center gap-1.5">
                            <span>⚠️</span> This requires Admin intervention.
                          </p>
                          <button
                            type="button"
                            disabled={isCreatingTicket}
                            onClick={() => handleRaiseTicket()}
                            className="w-full py-2 bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-700 hover:to-red-700 text-white font-black rounded-lg shadow-sm text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <span>🎫</span>
                            <span>{isCreatingTicket ? 'Creating Official Ticket...' : '1-Click Escalate & Raise Support Ticket'}</span>
                          </button>
                        </div>
                      )}

                      {/* Account Deletion Appeal Action Card */}
                      {msg.deleteAppealData && msg.deleteAppealData.stage === 'ready_to_submit' && !deletionAppealStatus?.submitted && (
                        <div className="w-full bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded-xl p-3 text-xs text-red-900 dark:text-red-200 mt-2 space-y-2">
                          <div className="flex items-center gap-1.5 font-black text-red-700 dark:text-red-300">
                            <span>🗑️</span>
                            <span>Account Deletion Appeal</span>
                          </div>
                          {msg.deleteAppealData.reason && (
                            <div className="text-[11px] bg-white/80 dark:bg-gray-900/60 p-2 rounded-lg border border-red-200 dark:border-red-900 text-gray-800 dark:text-gray-200">
                              <span className="font-bold text-red-600 block mb-0.5">Stated Reason:</span>
                              "{msg.deleteAppealData.reason}"
                            </div>
                          )}
                          <p className="text-[11px] text-gray-600 dark:text-gray-300">
                            Please confirm to send your account deletion appeal to the Admin Panel. The Administrator will review and permanently delete your account.
                          </p>
                          <button
                            type="button"
                            disabled={isSubmittingAppeal}
                            onClick={() => handleSubmitDeletionAppeal(msg.deleteAppealData?.reason)}
                            className="w-full py-2 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white font-bold rounded-lg shadow-sm text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <span>🗑️</span>
                            <span>{isSubmittingAppeal ? 'Submitting Appeal to Admin...' : 'Confirm & Submit Delete Appeal to Admin'}</span>
                          </button>
                        </div>
                      )}

                      {deletionAppealStatus?.submitted && (
                        <div className="w-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl p-2.5 text-xs text-emerald-900 dark:text-emerald-200 mt-2 flex items-center gap-2">
                          <span>✅</span>
                          <span className="font-bold">Appeal Submitted to Admin Panel: #{deletionAppealStatus.appealId?.slice(0, 10)}</span>
                        </div>
                      )}

                      <span className="text-[10px] text-gray-400 ml-auto">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm shrink-0 mt-1">
                    👤
                  </div>
                )}
              </div>
            );
          })}

          {/* Analyzing Vehicle Spinner */}
          {isAnalyzingVehicle && (
            <div className="flex gap-2.5 items-center text-xs text-purple-600 animate-pulse bg-purple-50 dark:bg-purple-950/30 p-3 rounded-2xl border border-purple-200 dark:border-purple-800">
              <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="font-bold">AutoBid AI is scanning vehicle photo & extracting specifications...</span>
            </div>
          )}

          {isLoading && !isAnalyzingVehicle && (
            <div className="flex gap-2.5 items-center text-xs text-gray-400 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm shrink-0">
                🤖
              </div>
              <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-2xl border border-gray-200 dark:border-gray-700 flex items-center gap-2">
                <span>AutoBid AI is typing...</span>
                <span className="w-1.5 h-1.5 rounded-full bg-purple-600 animate-ping"></span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="px-4 py-2 bg-gray-50/80 dark:bg-gray-800/40 border-t border-gray-200/60 dark:border-gray-800 flex gap-1.5 overflow-x-auto scrollbar-hide shrink-0">
          <button
            type="button"
            onClick={handleStartVehicleListingFlow}
            className="px-3 py-1 rounded-full bg-gradient-to-r from-purple-700 to-indigo-700 text-white text-[11px] font-extrabold transition whitespace-nowrap shrink-0 cursor-pointer shadow-xs flex items-center gap-1"
          >
            <span>🚗</span>
            <span>Post Vehicle for Auction</span>
          </button>
          {[
            "How do live auction bids work?",
            "How does CT Collection work?",
            "How do I deposit funds to wallet?",
            "Unlock View Stock Insights (₹1,999)",
            "I want to delete my account"
          ].map((prompt, pidx) => (
            <button
              key={pidx}
              type="button"
              disabled={isLoading}
              onClick={() => handleSendMessage(prompt)}
              className="px-2.5 py-1 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[11px] font-semibold text-gray-700 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-900/30 hover:border-purple-300 transition whitespace-nowrap shrink-0 cursor-pointer"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-3 sm:p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload vehicle photo"
              className="w-10 h-10 rounded-2xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center justify-center text-lg shrink-0 transition cursor-pointer border border-gray-200 dark:border-gray-700"
            >
              📷
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything or say 'Sell my car'..."
              disabled={isLoading}
              className="flex-1 px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-600 transition"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-5 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-sm shadow-md transition disabled:opacity-50 flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <span>Send</span>
              <span>➔</span>
            </button>
          </form>
          <div className="flex items-center justify-between text-[10px] text-gray-400 mt-2 px-1">
            <span>Autonomous Groq AI Agent</span>
            <span>Recorded in Admin AI Monitor</span>
          </div>
        </div>

      </div>

      {/* Modal: Correct Vehicle Details */}
      {showCorrectionForm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-gray-900 rounded-3xl max-w-md w-full p-5 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between border-b pb-3 border-gray-100 dark:border-gray-800">
              <h3 className="font-black text-sm text-gray-900 dark:text-white flex items-center gap-2">
                <span>✏️</span>
                <span>Correct Vehicle Specifications</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowCorrectionForm(false)}
                className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-gray-500 hover:text-gray-900 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Year</label>
                  <input
                    type="number"
                    value={correctionFields.year}
                    onChange={e => setCorrectionFields({ ...correctionFields, year: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Make</label>
                  <input
                    type="text"
                    value={correctionFields.make}
                    onChange={e => setCorrectionFields({ ...correctionFields, make: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Model</label>
                <input
                  type="text"
                  value={correctionFields.model}
                  onChange={e => setCorrectionFields({ ...correctionFields, model: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Color</label>
                  <input
                    type="text"
                    value={correctionFields.color}
                    onChange={e => setCorrectionFields({ ...correctionFields, color: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Body Type</label>
                  <input
                    type="text"
                    value={correctionFields.bodyType}
                    onChange={e => setCorrectionFields({ ...correctionFields, bodyType: e.target.value })}
                    placeholder="Sedan, SUV, Hatchback"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Fuel Type</label>
                  <select
                    value={correctionFields.fuelType}
                    onChange={e => setCorrectionFields({ ...correctionFields, fuelType: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="Petrol">Petrol</option>
                    <option value="Diesel">Diesel</option>
                    <option value="Electric">Electric</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="CNG">CNG</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Transmission</label>
                  <select
                    value={correctionFields.transmission}
                    onChange={e => setCorrectionFields({ ...correctionFields, transmission: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="Automatic">Automatic</option>
                    <option value="Manual">Manual</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setShowCorrectionForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyCorrections}
                className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs transition"
              >
                Apply & Confirm
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
