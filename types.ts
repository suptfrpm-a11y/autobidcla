export enum DamageType {
  COLLISION = 'Collision',
  FLOOD = 'Flood',
  THEFT = 'Theft Recovery',
  HAIL = 'Hail',
  NORMAL = 'Normal Wear',
  MECHANICAL = 'Mechanical',
}

export enum VehicleStatus {
  PENDING_REVIEW = 'Pending Review',
  UPCOMING = 'Upcoming',
  LIVE = 'Live Auction',
  SOLD = 'Sold',
  DIRECT_SALE = 'Direct Sale',
  BLACKLISTED = 'Blacklisted',
}

export type UserRole = 'admin' | 'finance' | 'accountant' | 'support' | 'employee' | 'user';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type IdDocumentType = 'pan_card' | 'national_id' | 'both';

export interface User {
  id: string;
  username: string;
  email?: string;
  fullName: string;
  avatarUrl: string;
  followers: number;
  following: number;
  bio: string;
  website?: string;
  isVerified?: boolean;
  verificationStatus?: VerificationStatus;
  verifiedAt?: number;
  idDocumentType?: IdDocumentType;
  panNumber?: string;
  nationalIdNumber?: string;
  role?: UserRole;
  deposits?: number;
  createdAt?: number;
  isDeleted?: boolean;
  suspensionStatus?: 'none' | 'temporary' | 'permanent';
  totalCommissionPaid?: number;
  followingIds?: string[];
  followersIds?: string[];
  phoneNumber?: string;
  phoneVerified?: boolean;
  phoneVerifiedAt?: number;
  agreedToTerms?: boolean;
  agreedToTermsAt?: number;
  hasStockInsightsAccess?: boolean;
  stockInsightsUnlockedAt?: number;
  isRevoked?: boolean;
  sessionRevokedAt?: number;
  loginTime?: number;
}

export interface UpcomingBid {
  userId: string;
  username: string;
  amount: number;
  timestamp: number;
}

export interface Vehicle {
  id: string;
  stockNumber?: string; // 8-9 digit unique stock number
  stockId?: string;
  ownerId?: string; // Link to a User
  ownerUsername?: string; // Quick reference to the owner's username
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  year: number;
  make: string;
  model: string;
  color?: string;
  bodyType?: string;
  vehicleType?: string;
  vin: string;
  odometer: number;
  primaryDamage: DamageType;
  secondaryDamage?: string;
  estRetailValue: number;
  currentBid: number;
  startingPrice?: number;
  buyNowPrice?: number;
  location: string;
  imageSeed: number; 
  images?: string[];
  coverImageIndex?: number;
  views?: number;
  interestedCount?: number;
  soldVia?: "bid" | "direct" | "live";
  isBoosted?: boolean;
  status: VehicleStatus;
  startTime?: number;
  endTime: number; 
  watchCount: number;
  hasKeys: boolean;
  engine: string;
  transmission: string;
  drive: string;
  topSpeed?: string;
  mpg?: string;
  fuelType?: string;
  condition?: string;
  description?: string;
  liveBidDuration?: number;
  listingFee?: number;
  boostOption?: string;
  isUnderInsurance?: boolean;
  hasIssues?: boolean;
  issueDescription?: string;
  vehicleNumber?: string;
  hasRegistrationCard?: boolean;
  rcCardUrl?: string;
  rcCardNumber?: string;
  
  // Upcoming auction pre-bids & live bidding state
  upcomingBids?: UpcomingBid[];
  liveParticipants?: string[];
  firstBidderId?: string;
  firstBidderUsername?: string;
  hasStartedLive?: boolean;
  
  // Selling Mode & Expiry (Auction vs Sell Without Auction / Direct Sale)
  listingType?: 'auction' | 'direct';
  directPrice?: number;
  listedAt?: number;
  expiresAt?: number;
  isBlacklisted?: boolean;
  isConcluded?: boolean;
  concludedAt?: number;
  isRestricted?: boolean;
  isShadowBanned?: boolean;
  isDeleted?: boolean;
  restrictionReason?: string;
  
  // Real Viewer, Wishlist and Like User Tracking
  viewersList?: { userId: string; username: string; fullName?: string; avatarUrl?: string; timestamp: number }[];
  wishlistUsers?: { userId: string; username: string; fullName?: string; avatarUrl?: string; timestamp: number }[];
  likesList?: { userId: string; username: string; fullName?: string; avatarUrl?: string; timestamp: number }[];
  likesCount?: number;
  
  // User specific fields (contextual to the viewer)
  isOwner?: boolean; // If true, viewer owns this
  isWatchlisted?: boolean;
  isLiked?: boolean;
  userBidStatus?: 'none' | 'winning' | 'outbid' | 'won' | 'lost';
  winningUserId?: string;
  winningUsername?: string;
  bidUserIds?: string[];
  boostPlan?: string;
  finalSoldPrice?: number;
  commissionAmount?: number;
}

export interface Bid {
  vehicleId: string;
  amount: number;
  timestamp: number;
}

export type TicketStatus = 'open' | 'closed';

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  description: string;
  status: TicketStatus;
  createdAt: number;
}

export interface AccountAppeal {
  id: string;
  userId: string;
  reason: string;
  type?: 'suspension' | 'verification';
  phone?: string;
  email?: string;
  documents?: string;
  status: 'pending' | 'reviewed' | 'resolved';
  createdAt: number;
}

export interface SupportChat {
  id: string;
  userId: string;
  username: string;
  status: 'open' | 'active' | 'closed';
  createdAt: number;
  updatedAt: number;
  unreadCountAdmin?: number;
  unreadCountUser?: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderRole: string;
  text: string;
  timestamp: number;
}

export interface WalletTransaction {
  id: string;
  transactionId?: string;
  userId: string;
  username?: string;
  userEmail?: string;
  phoneNumber?: string;
  type: 'deposit' | 'admin_add' | 'admin_deduct' | 'commission_deduct' | string;
  amount: number;
  description: string;
  timestamp: number;
  status: 'success' | 'pending' | 'failed';
  paymentMethod?: 'upi' | 'card' | 'netbanking' | 'wallet' | 'other' | string;
  paymentMethodDetails?: string;
  paymentId?: string;
  orderId?: string;
  gatewayOrderNumber?: string;
  autobidOrderId?: string;
  utr?: string;
  failureReason?: string;
  balanceAfter?: number;
  channel?: string;
  gatewayResponse?: any;
}

export interface VerificationRequest {
  id: string;
  userId: string;
  username: string;
  userEmail?: string;
  userFullName?: string;
  phoneNumber?: string;
  phoneVerified?: boolean;
  phoneVerifiedAt?: number;
  documentType: IdDocumentType; // 'pan_card' | 'national_id' | 'both'
  
  // PAN Card Details
  panNumber?: string;
  panCardName?: string;
  panCardPhotoUrl?: string; // photo/scan
  
  // National ID Details (Aadhaar / Voter ID / Passport)
  nationalIdType?: string; // 'Aadhaar Card' | 'Voter ID' | 'Passport' | 'Government ID'
  nationalIdNumber?: string;
  nationalIdName?: string;
  nationalIdPhotoUrl?: string; // front photo
  nationalIdBackPhotoUrl?: string; // back photo
  
  // General Info
  dob?: string;
  status: VerificationStatus; // 'pending' | 'verified' | 'rejected'
  submittedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  rejectionReason?: string;
  
  // AI Pre-validation
  aiValidationStatus?: 'passed' | 'warning' | 'failed' | 'not_applicable';
  aiConfidence?: number;
  aiNotes?: string;
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminEmail: string;
  adminRole?: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  timestamp: number;
}

export interface CarouselSlide {
  id: string;
  title?: string;
  subtitle?: string;
  imageUrl: string;
  targetUrl?: string;
  badge?: string;
  ctaText?: string;
}

export interface ContentBanner {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  targetUrl?: string;
  position: 'hero' | 'top_bar' | 'footer' | 'popup';
  isActive: boolean;
  createdAt: number;
  updatedAt?: number;
  isCarousel?: boolean;
  slides?: CarouselSlide[];
  badge?: string;
  ctaText?: string;
  backgroundGradient?: string;
  publishedBy?: string;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'percent' | 'flat';
  value: number;
  maxUses: number;
  usedCount: number;
  expiresAt: number;
  isActive: boolean;
  createdAt: number;
  description?: string;
}

export interface DealerPartner {
  id: string;
  userId: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  dealerLicense?: string;
  taxId?: string;
  tier: 'Silver' | 'Gold' | 'Platinum';
  isVerified: boolean;
  status: 'active' | 'pending' | 'suspended';
  activeListingsCount: number;
  totalGmv: number;
  rating: number;
  joinedAt: number;
}

export interface ModerationReport {
  id: string;
  reporterId: string;
  reporterUsername?: string;
  targetType: 'vehicle' | 'user' | 'chat';
  targetId: string;
  targetTitle: string;
  reason: string;
  details?: string;
  status: 'pending' | 'reviewed' | 'actioned' | 'dismissed';
  createdAt: number;
  actionTaken?: string;
  reviewedBy?: string;
}

export interface AppConfig {
  commissionRatePercent: number;
  minBidIncrement: number;
  defaultLiveBidMinutes: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  allowDirectBuy: boolean;
  requireKycToBid: boolean;
  announcementText?: string;
  announcementActive?: boolean;
}

export interface AppVersionInfo {
  currentVersion: string;
  minRequiredVersion: string;
  forceUpdateEnabled: boolean;
  updateMessage: string;
  lastUpdated: number;
}

export interface DirectChat {
  id: string;
  participantIds: string[];
  participants: {
    [userId: string]: {
      username: string;
      fullName?: string;
      avatarUrl?: string;
    };
  };
  lastMessage?: string;
  lastMessageType?: 'text' | 'voice' | 'fund_transfer';
  lastMessageTimestamp?: number;
  lastSenderId?: string;
  unreadCount?: {
    [userId: string]: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface DirectChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  recipientUsername?: string;
  type: 'text' | 'voice' | 'fund_transfer';
  text?: string;
  audioData?: string; // base64 data URI (audio/webm, audio/ogg, audio/mp4)
  audioDuration?: number; // duration in seconds
  transferAmount?: number;
  transferNote?: string;
  transferStatus?: 'completed' | 'failed';
  timestamp: number;
  read?: boolean;
}

export type StockCategory = 'live' | 'sold' | 'upcoming' | 'manual';

export interface StockOwnerInfo {
  id?: string;
  username?: string;
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  phoneVerified?: boolean;
  isVerified?: boolean;
  verificationStatus?: VerificationStatus;
  role?: UserRole;
  avatarUrl?: string;
  createdAt?: number;
}

export interface StockRecord {
  id: string; // Stock Number or Vehicle ID
  stockNumber: string; // 8-9 digit unique stock number
  vehicleId: string;
  category: StockCategory; // live, sold, upcoming, manual
  listingType: 'auction' | 'direct';
  status: VehicleStatus | string;
  
  // Complete vehicle specifications
  year: number;
  make: string;
  model: string;
  color?: string;
  bodyType?: string;
  vehicleType?: string;
  vin: string;
  odometer: number;
  primaryDamage: DamageType | string;
  secondaryDamage?: string;
  estRetailValue: number;
  currentBid: number;
  startingPrice?: number;
  buyNowPrice?: number;
  directPrice?: number;
  finalSoldPrice?: number;
  location: string;
  imageSeed?: number;
  images?: string[];
  coverImageIndex?: number;
  views?: number;
  interestedCount?: number;
  watchCount?: number;
  hasKeys?: boolean;
  engine?: string;
  transmission?: string;
  drive?: string;
  topSpeed?: string;
  mpg?: string;
  fuelType?: string;
  condition?: string;
  description?: string;
  vehicleNumber?: string;
  hasRegistrationCard?: boolean;
  rcCardUrl?: string;
  rcCardNumber?: string;
  hasIssues?: boolean;
  issueDescription?: string;
  isUnderInsurance?: boolean;
  startTime?: number;
  endTime?: number;
  listedAt?: number;
  expiresAt?: number;
  isBlacklisted?: boolean;
  winningUserId?: string;
  winningUsername?: string;
  
  // Complete owner information
  ownerId?: string;
  ownerUsername?: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerPhoneVerified?: boolean;
  ownerEmail?: string;
  ownerIsVerified?: boolean;
  ownerVerificationStatus?: VerificationStatus;
  ownerAvatarUrl?: string;
  ownerRole?: UserRole;
  ownerCreatedAt?: number;
  
  // Timestamps
  createdAt: number;
  updatedAt: number;
}

export interface AiVehicleListingDraft {
  step: 'upload_photos' | 'confirm_specs' | 'select_mode' | 'set_price' | 'set_schedule' | 'ready_to_publish' | 'published';
  year?: number | string;
  make?: string;
  model?: string;
  color?: string;
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  engine?: string;
  condition?: string;
  sellingMode?: 'auction' | 'direct';
  price?: number;
  scheduleType?: 'immediate' | 'scheduled';
  scheduledTime?: string;
  images?: string[];
  vehicleId?: string;
  stockNumber?: string;
}

export interface AiChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  text?: string;
  timestamp: number;
  statusTag?: 'resolved' | 'in_progress' | 'escalated';
  ticketSuggested?: boolean;
  deleteAppealSuggested?: boolean;
  deleteAppealData?: {
    stage?: 'need_reason' | 'ready_to_submit' | 'confirmed';
    reason?: string;
    submitted?: boolean;
    appealId?: string;
  };
  vehicleListingData?: AiVehicleListingDraft;
}

export interface AiChatSession {
  id: string;
  sessionId: string;
  userEmail: string;
  userId?: string | null;
  username?: string;
  isGuest: boolean;
  messages: AiChatMessage[];
  status: 'resolved' | 'in_progress' | 'escalated' | 'ticket_created' | 'appeal_submitted';
  resolutionStatus?: 'resolved' | 'in_progress' | 'escalated' | 'ticket_created' | 'appeal_submitted';
  isEscalated?: boolean;
  summary?: string;
  problemSummary?: string;
  escalationReason?: string | null;
  ticketId?: string | null;
  deletionAppeal?: {
    id?: string;
    reason?: string;
    status?: 'pending' | 'deleted' | 'rejected';
    submittedAt?: number;
  };
  createdAt: number;
  updatedAt: number;
  lastMessage?: string;
  notes?: string;
  adminNotes?: string;
}

export interface AccountDeletionAppeal {
  id: string;
  type: 'account_deletion' | 'suspension' | 'verification';
  userId: string;
  username: string;
  email?: string;
  phone?: string;
  reason: string;
  status: 'pending' | 'deleted' | 'rejected' | 'resolved';
  source?: string;
  sessionId?: string;
  createdAt: number;
  reviewedBy?: string | null;
  reviewedAt?: number;
  resolutionNote?: string;
}

export interface DeviceTimelineEntry {
  timestamp: number;
  event: 'signup' | 'login' | 'browser_switch' | 'ip_switch' | 'heartbeat' | 'revocation';
  ip: string;
  browser: string;
  device?: string;
  os?: string;
  status: 'active' | 'revoked';
  details: string;
}

export interface DeviceSessionRecord {
  id: string;
  userId: string;
  username: string;
  email?: string;
  role?: string;
  currentIp: string;
  previousIps: string[];
  currentBrowser: string;
  previousBrowsers: string[];
  distinctBrowsersCount: number;
  distinctBrowsers: string[];
  deviceTimeline: DeviceTimelineEntry[];
  device: string;
  os: string;
  isOnline: boolean;
  lastActiveAt: number;
  loginTime: number;
  status: 'active' | 'revoked';
  ipCollisionWarning?: boolean;
  collidingAccounts?: string[];
}

export interface BannerDraft {
  id?: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  targetUrl?: string;
  position: 'hero' | 'top_bar' | 'footer' | 'popup';
  isCarousel?: boolean;
  slides?: CarouselSlide[];
  badge?: string;
  ctaText?: string;
  backgroundGradient?: string;
  status: 'draft' | 'published';
  publishedAt?: number;
}

export interface AiBrainMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    scope?: string;
    modelUsed?: string;
    reportDownloadable?: boolean;
    reportTitle?: string;
    reportData?: any;
    reportType?: 'transactions' | 'accounting' | 'sessions' | 'moderation' | 'general' | 'marketing' | 'banners';
    bannerDraft?: BannerDraft;
    uploadedImageUrl?: string;
    actionType?: 'banner_draft' | 'banner_published' | 'session_revoked' | 'report';
  };
}

export interface AiBrainSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AiBrainMessage[];
  scope?: string;
}



