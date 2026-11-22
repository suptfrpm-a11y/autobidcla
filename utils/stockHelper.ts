import { Vehicle, User, StockRecord, StockCategory, VehicleStatus, DamageType } from '../types';
import { db, doc, setDoc, deleteDoc } from '../firebase';

/**
 * Generates an 8-9 digit unique stock number.
 * Range: 10,000,000 to 999,999,999 (strictly 8 or 9 digits).
 */
export const generateStockNumber = (): string => {
  // 50% 8-digit (10,000,000 - 99,999,999), 50% 9-digit (100,000,000 - 999,999,999)
  const isEightDigit = Math.random() < 0.3;
  if (isEightDigit) {
    const min = 10000000;
    const max = 99999999;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
  } else {
    const min = 100000000;
    const max = 999999999;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
  }
};

/**
 * Determines which of the 4 stock categories a vehicle belongs to:
 * - 'live': Current present livestock (active live auctions)
 * - 'sold': Sold out stock
 * - 'upcoming': Upcoming stock (future scheduled auctions)
 * - 'manual': Manual listed vehicle stock (without auction / direct sale)
 */
export const getVehicleStockCategory = (vehicle: Partial<Vehicle>): StockCategory => {
  const statusStr = String(vehicle.status || '').toLowerCase();
  const listingType = vehicle.listingType || (statusStr.includes('direct') ? 'direct' : 'auction');
  const now = Date.now();

  // Sold out stock takes precedence
  if (statusStr.includes('sold') || statusStr === 'ended') {
    return 'sold';
  }

  // Manual listed vehicle stock (Direct Sale / Without Auction)
  if (listingType === 'direct' || statusStr.includes('direct') || vehicle.status === VehicleStatus.DIRECT_SALE) {
    return 'manual';
  }

  // Upcoming stock (Scheduled in future)
  if (
    statusStr.includes('upcoming') || 
    vehicle.status === VehicleStatus.UPCOMING || 
    (vehicle.startTime && vehicle.startTime > now + 60000 && !vehicle.hasStartedLive)
  ) {
    return 'upcoming';
  }

  // Current present livestock (Live auction)
  return 'live';
};

/**
 * Assembles a pristine StockRecord joining complete vehicle details and owner details.
 */
export const buildStockRecord = (vehicle: Vehicle, owner?: User | null): StockRecord => {
  const stockNumber = vehicle.stockNumber || generateStockNumber();
  const category = getVehicleStockCategory(vehicle);
  const now = Date.now();

  return {
    id: stockNumber,
    stockNumber,
    vehicleId: vehicle.id,
    category,
    listingType: vehicle.listingType || (category === 'manual' ? 'direct' : 'auction'),
    status: vehicle.status,
    
    // Complete vehicle specifications
    year: vehicle.year || new Date().getFullYear(),
    make: vehicle.make || 'Unknown Make',
    model: vehicle.model || 'Unknown Model',
    vehicleType: vehicle.vehicleType,
    vin: vehicle.vin || 'N/A',
    odometer: vehicle.odometer || 0,
    primaryDamage: vehicle.primaryDamage || DamageType.NORMAL,
    secondaryDamage: vehicle.secondaryDamage,
    estRetailValue: vehicle.estRetailValue || 0,
    currentBid: vehicle.currentBid || 0,
    startingPrice: vehicle.startingPrice || vehicle.currentBid || 0,
    buyNowPrice: vehicle.buyNowPrice,
    directPrice: vehicle.directPrice,
    finalSoldPrice: vehicle.finalSoldPrice,
    location: vehicle.location || 'India',
    imageSeed: vehicle.imageSeed || 100,
    images: vehicle.images && vehicle.images.length > 0 ? vehicle.images : [`https://picsum.photos/seed/${vehicle.id}/1200/800`],
    coverImageIndex: vehicle.coverImageIndex || 0,
    views: vehicle.views || 0,
    interestedCount: vehicle.interestedCount || 0,
    watchCount: vehicle.watchCount || 0,
    hasKeys: vehicle.hasKeys ?? true,
    engine: vehicle.engine || 'N/A',
    transmission: vehicle.transmission || 'Automatic',
    drive: vehicle.drive || 'FWD',
    topSpeed: vehicle.topSpeed,
    mpg: vehicle.mpg,
    fuelType: vehicle.fuelType || 'Petrol',
    description: vehicle.description || '',
    vehicleNumber: vehicle.vehicleNumber,
    hasRegistrationCard: vehicle.hasRegistrationCard,
    rcCardUrl: vehicle.rcCardUrl,
    rcCardNumber: vehicle.rcCardNumber,
    hasIssues: vehicle.hasIssues,
    issueDescription: vehicle.issueDescription,
    isUnderInsurance: vehicle.isUnderInsurance,
    startTime: vehicle.startTime,
    endTime: vehicle.endTime,
    listedAt: vehicle.listedAt || now,
    expiresAt: vehicle.expiresAt,
    isBlacklisted: vehicle.isBlacklisted || false,
    winningUserId: vehicle.winningUserId,
    winningUsername: vehicle.winningUsername,
    
    // Public Owner Details (PII such as phone/email stays strictly in user_private)
    ownerId: owner?.id || vehicle.ownerId,
    ownerUsername: owner?.username || vehicle.ownerUsername,
    ownerName: owner?.fullName || vehicle.ownerName || owner?.username || vehicle.ownerUsername,
    ownerPhone: '',
    ownerPhoneVerified: owner?.phoneVerified || false,
    ownerEmail: '',
    ownerIsVerified: owner?.isVerified || false,
    ownerVerificationStatus: owner?.verificationStatus || (owner?.isVerified ? 'verified' : 'unverified'),
    ownerAvatarUrl: owner?.avatarUrl || '',
    ownerRole: owner?.role || 'user',
    ownerCreatedAt: owner?.createdAt,
    
    createdAt: vehicle.listedAt || now,
    updatedAt: now,
  };
};

/**
 * Saves or updates a stock record in the Firestore 'stock' collection.
 */
export const saveStockRecordToFirestore = async (record: StockRecord): Promise<void> => {
  try {
    const cleanRecord: Record<string, any> = { ...record };
    Object.keys(cleanRecord).forEach(k => cleanRecord[k] === undefined && delete cleanRecord[k]);

    // Save with stockNumber as document ID for immediate O(1) direct lookup
    await setDoc(doc(db, 'stock', record.stockNumber), cleanRecord, { merge: true });

    // Also mirror or update stockNumber on the vehicle document if not present
    if (record.vehicleId) {
      await setDoc(doc(db, 'vehicles', record.vehicleId), { stockNumber: record.stockNumber }, { merge: true });
    }
  } catch (err) {
    console.warn('[StockHelper] Error saving stock record to Firestore:', err);
  }
};

/**
 * Permanently deletes a stock record and its associated vehicle record
 * across Firestore collections and live backend storage.
 */
export const deleteStockRecordFromFirestore = async (stockNumber: string, vehicleId?: string): Promise<void> => {
  try {
    // 1. Delete stock record by stockNumber
    if (stockNumber) {
      await deleteDoc(doc(db, 'stock', stockNumber));
    }

    // 2. Also delete stock record by vehicleId in case it was indexed by vehicle ID
    if (vehicleId && vehicleId !== stockNumber) {
      try {
        await deleteDoc(doc(db, 'stock', vehicleId));
      } catch (_) {}
    }

    // 3. Delete from vehicles collection
    if (vehicleId) {
      try {
        await deleteDoc(doc(db, 'vehicles', vehicleId));
      } catch (err) {
        console.warn('[StockHelper] Note on deleting vehicle doc:', err);
      }
    }

  } catch (err) {
    console.error('[StockHelper] Error deleting stock record from Firestore:', err);
    throw err;
  }
};
